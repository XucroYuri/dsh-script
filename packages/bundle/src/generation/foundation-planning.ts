import type { FoundationGenerationRun, FoundationPlannerQuestion } from '../domain/model.js'

export const FOUNDATION_MAX_PLANNING_ROUNDS = 4
export const FOUNDATION_MAX_CONFIRMED_ANSWERS = 12

export type FoundationPlanningStopReason = 'round-limit' | 'answer-limit' | 'duplicate-only' | 'user-finished'

export function foundationPlanningStopReason(run: FoundationGenerationRun): FoundationPlanningStopReason | null {
  if (!run.guided || run.answers.length === 0) return null
  if (run.planningRound >= FOUNDATION_MAX_PLANNING_ROUNDS) return 'round-limit'
  if (run.answers.length >= FOUNDATION_MAX_CONFIRMED_ANSWERS) return 'answer-limit'
  return null
}

export function boundedPlanningSummary(run: FoundationGenerationRun, reason: FoundationPlanningStopReason): string {
  const pending = run.questions.filter(question => !run.answers.some(answer => answer.questionId === question.id)).length
  const reasonText = reason === 'user-finished'
    ? '你已确认现有信息足够进入草稿'
    : reason === 'duplicate-only'
      ? 'AI 新提出的问题与已确认内容重复'
      : `有界需求采集已达到 ${FOUNDATION_MAX_PLANNING_ROUNDS} 轮或 ${FOUNDATION_MAX_CONFIRMED_ANSWERS} 项确认上限`
  return `${reasonText}。系统将使用已保存的 ${run.answers.length} 项确认生成正式草稿${pending > 0 ? `；剩余 ${pending} 个未回答细节不再阻塞生成` : ''}。未明确的次要细节会采用与现有设定一致的保守假设，并可在草稿审批前修改。`
}

function normalizedQuestion(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2))
  return result
}

function similarity(left: string, right: string): number {
  const a = normalizedQuestion(left)
  const b = normalizedQuestion(right)
  if (!a || !b) return 0
  if (a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)))) return 1
  const aPairs = bigrams(a)
  const bPairs = bigrams(b)
  if (aPairs.size === 0 || bPairs.size === 0) return 0
  let shared = 0
  for (const pair of aPairs) if (bPairs.has(pair)) shared += 1
  return shared / Math.max(aPairs.size, bPairs.size)
}

export function removeRepeatedPlannerQuestions(
  proposed: FoundationPlannerQuestion[],
  previous: FoundationPlannerQuestion[],
): FoundationPlannerQuestion[] {
  const accepted: FoundationPlannerQuestion[] = []
  for (const question of proposed) {
    const seen = [...previous, ...accepted].some(existing => similarity(question.question, existing.question) >= 0.42)
    if (!seen) accepted.push(question)
  }
  return accepted
}
