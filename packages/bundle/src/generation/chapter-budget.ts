import type { GenerationContext } from '../domain/model.js'

export const DEFAULT_CHAPTER_TARGET_WORDS = 2_000
export const MIN_CHAPTER_DRAFT_OUTPUT_TOKENS = 8_000
export const FALLBACK_CHAPTER_DRAFT_OUTPUT_TOKENS = 16_000
export const RECOMMENDED_CHAPTER_DRAFT_MIN_RATIO = 0.85
export const RECOMMENDED_CHAPTER_DRAFT_MAX_RATIO = 1.05

export function effectiveChapterTargetWords(context: Pick<GenerationContext, 'chapterBrief' | 'project'>): number {
  const value = context.chapterBrief?.targetWords ?? context.project.chapterTargetWords ?? DEFAULT_CHAPTER_TARGET_WORDS
  return Number.isFinite(value) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value))) : DEFAULT_CHAPTER_TARGET_WORDS
}

export interface ChapterDraftBudget {
  targetWords: number
  desiredMaxTokens: number
  maxTokens: number
  providerMaxTokens: number | null
  fallbackMaxTokens: number
  capacitySource: 'provider' | 'fallback'
  safeTargetWords: number
  constrained: boolean
}

export function chapterDraftBudget(targetWords: number, providerMaxTokens: number | null): ChapterDraftBudget {
  const normalizedTarget = Number.isFinite(targetWords)
    ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(targetWords)))
    : DEFAULT_CHAPTER_TARGET_WORDS
  const normalizedProviderMax = providerMaxTokens && Number.isFinite(providerMaxTokens) && providerMaxTokens > 0
    ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(providerMaxTokens)))
    : null
  const availableMaxTokens = normalizedProviderMax ?? FALLBACK_CHAPTER_DRAFT_OUTPUT_TOKENS
  // The response wraps Chinese prose in JSON and still needs room for closing
  // quotes, Canon candidates and self-check metadata.  The minimum is
  // deliberately generous: maxTokens is a completion ceiling, not a prose
  // length target.
  const desiredMaxTokens = Math.min(Number.MAX_SAFE_INTEGER, Math.max(MIN_CHAPTER_DRAFT_OUTPUT_TOKENS, Math.ceil(normalizedTarget * 1.5) + 2_000))
  const safeTargetWords = Math.max(1, Math.floor((availableMaxTokens - 1_200) / 1.25))
  return {
    targetWords: normalizedTarget,
    desiredMaxTokens,
    maxTokens: Math.min(desiredMaxTokens, availableMaxTokens),
    providerMaxTokens: normalizedProviderMax,
    fallbackMaxTokens: FALLBACK_CHAPTER_DRAFT_OUTPUT_TOKENS,
    capacitySource: normalizedProviderMax === null ? 'fallback' : 'provider',
    safeTargetWords,
    constrained: desiredMaxTokens > availableMaxTokens,
  }
}

export interface ChapterDraftLengthAdvisory {
  kind: 'shorter-than-target' | 'longer-than-target'
  targetWords: number
  actualWords: number
  recommendedMinWords: number
  recommendedMaxWords: number
  message: string
}

export function chapterDraftLengthAdvisory(targetWords: number, actualWords: number): ChapterDraftLengthAdvisory | null {
  const normalizedTarget = Number.isFinite(targetWords)
    ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(targetWords)))
    : DEFAULT_CHAPTER_TARGET_WORDS
  const normalizedActual = Math.max(0, Math.trunc(actualWords))
  const recommendedMinWords = Math.max(1, Math.floor(normalizedTarget * RECOMMENDED_CHAPTER_DRAFT_MIN_RATIO))
  const recommendedMaxWords = Math.max(recommendedMinWords, Math.ceil(normalizedTarget * RECOMMENDED_CHAPTER_DRAFT_MAX_RATIO))
  if (normalizedActual >= recommendedMinWords && normalizedActual <= recommendedMaxWords) return null
  const kind = normalizedActual < recommendedMinWords ? 'shorter-than-target' : 'longer-than-target'
  return {
    kind, targetWords: normalizedTarget, actualWords: normalizedActual, recommendedMinWords, recommendedMaxWords,
    message: kind === 'shorter-than-target'
      ? `本章实际 ${normalizedActual} 字，少于 ${normalizedTarget} 字目标的建议范围；正文仍已完整保存，可由作者直接审阅或继续扩写。`
      : `本章实际 ${normalizedActual} 字，超过 ${normalizedTarget} 字目标的建议范围；正文仍已完整保存，可由作者直接审阅或删改。`,
  }
}

export interface ScenePlanWordBudgetAudit {
  targetWords: number
  originalEstimatedWords: number
  normalizedEstimatedWords: number
  normalized: boolean
}

function proportionalAllocations(weights: number[], targetWords: number): number[] {
  if (weights.length === 0) return []
  const positive = weights.map(value => Number.isFinite(value) && value > 0 ? value : 1)
  const total = positive.reduce((sum, value) => sum + value, 0)
  const raw = positive.map(value => value / total * targetWords)
  const result = raw.map(value => Math.floor(value))
  let remaining = targetWords - result.reduce((sum, value) => sum + value, 0)
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) result[order[index % order.length]!.index]! += 1
  return result
}

export function normalizeScenePlanWordBudget(output: Record<string, unknown>, targetWords: number): { output: Record<string, unknown>; audit: ScenePlanWordBudgetAudit } {
  const scenes = Array.isArray(output.scenes) ? output.scenes : []
  const weights = scenes.map(scene => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return 1
    const estimatedWords = Number((scene as Record<string, unknown>).estimatedWords)
    return Number.isFinite(estimatedWords) && estimatedWords > 0 ? estimatedWords : 1
  })
  const originalEstimatedWords = weights.reduce((sum, value) => sum + value, 0)
  const allocations = proportionalAllocations(weights, targetWords)
  const normalizedScenes = scenes.map((scene, index) => ({
    ...(scene && typeof scene === 'object' && !Array.isArray(scene) ? scene as Record<string, unknown> : { scenePurpose: String(scene ?? '') }),
    estimatedWords: allocations[index] ?? 0,
  }))
  const audit: ScenePlanWordBudgetAudit = {
    targetWords,
    originalEstimatedWords,
    normalizedEstimatedWords: allocations.reduce((sum, value) => sum + value, 0),
    normalized: originalEstimatedWords !== targetWords || scenes.some((scene, index) => !scene || typeof scene !== 'object' || Array.isArray(scene) || Number((scene as Record<string, unknown>).estimatedWords) !== allocations[index]),
  }
  return { output: { ...output, scenes: normalizedScenes, wordBudget: audit }, audit }
}

export function budgetedScenePlanJson(contentJson: string, targetWords: number): string {
  try {
    const parsed = JSON.parse(contentJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return contentJson
    const normalized = normalizeScenePlanWordBudget(parsed as Record<string, unknown>, targetWords)
    const { wordBudget: _audit, ...promptPlan } = normalized.output
    return JSON.stringify({
      ...promptPlan,
      wordBudget: { targetWords: normalized.audit.targetWords, normalizedEstimatedWords: normalized.audit.normalizedEstimatedWords },
    })
  } catch {
    return contentJson
  }
}

export function scenePlanWordBudgetAudit(contentJson: string, targetWords: number): ScenePlanWordBudgetAudit | null {
  try {
    const parsed = JSON.parse(contentJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return normalizeScenePlanWordBudget(parsed as Record<string, unknown>, targetWords).audit
  } catch {
    return null
  }
}
