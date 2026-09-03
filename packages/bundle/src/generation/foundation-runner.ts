import { DomainError, type FoundationGenerationRun, type FoundationPlannerAnswer, type ProjectFoundationKind } from '../domain/model.js'
import type { NovelRepository } from '../storage/repository.js'
import type { GenerationService } from './service.js'
import { boundedPlanningSummary, foundationPlanningStopReason } from './foundation-planning.js'

export interface FoundationQuestionInteraction {
  ask(run: FoundationGenerationRun, signal: AbortSignal): Promise<FoundationPlannerAnswer[]>
}

export class FoundationInteractionDeferredError extends Error {
  constructor(message: string) { super(message); this.name = 'FoundationInteractionDeferredError' }
}

export class FoundationInteractionCancelledError extends Error {
  constructor(message: string) { super(message); this.name = 'FoundationInteractionCancelledError' }
}

export class FoundationGenerationRunner {
  private readonly queued = new Set<string>()
  private readonly running = new Map<string, AbortController>()

  constructor(
    private readonly repository: NovelRepository,
    private readonly generation: GenerationService,
    private readonly interaction?: FoundationQuestionInteraction,
    private readonly concurrency = 1,
  ) {}

  recover(): void {
    for (const run of this.repository.listRecoverableFoundationGenerationRuns()) {
      if (run.status !== 'waiting_input' || foundationPlanningStopReason(run)) this.enqueue(run.id)
    }
  }

  create(projectId: string, kind: ProjectFoundationKind, brief: string, guided: boolean, interactionSessionId: string | null = null): FoundationGenerationRun {
    const run = this.repository.createFoundationGenerationRun(projectId, kind, brief, guided, this.generation.status().selection, interactionSessionId)
    this.enqueue(run.id)
    return run
  }

  answer(runId: string, answers: FoundationPlannerAnswer[]): FoundationGenerationRun {
    const run = this.repository.getFoundationGenerationRun(runId)
    if (run.status !== 'waiting_input') throw new DomainError('invalid-state', '当前规划没有在等待回答。')
    const currentQuestions = run.questions.filter(question => !run.answers.some(answer => answer.questionId === question.id))
    const supplied = new Map(answers.map(answer => [answer.questionId, answer]))
    if (supplied.size !== answers.length || supplied.size !== currentQuestions.length || currentQuestions.some(question => !supplied.has(question.id))) {
      throw new DomainError('validation', '请回答全部规划问题后再继续生成。')
    }
    for (const question of currentQuestions) {
      const answer = supplied.get(question.id)!
      if (answer.optionId && !question.options.some(option => option.id === answer.optionId)) throw new DomainError('validation', '规划选项与当前问题不匹配。')
      if (!answer.optionId && !answer.customText.trim() && answer.skipped !== true) throw new DomainError('validation', '每个问题都需要选择一个方向、填写自定义答案或明确跳过。')
    }
    let updated = run
    for (const question of currentQuestions) updated = this.repository.answerFoundationGenerationQuestion(runId, supplied.get(question.id)!)
    if (updated.status === 'planning' || updated.status === 'generating') {
      if (updated.interactionSessionId === null && this.running.has(updated.id)) this.queued.add(updated.id)
      else this.enqueue(updated.id)
    }
    return updated
  }

  cancel(runId: string): FoundationGenerationRun {
    const run = this.repository.cancelFoundationGenerationRun(runId)
    this.queued.delete(runId)
    this.running.get(runId)?.abort()
    return run
  }

  retry(runId: string): FoundationGenerationRun {
    const run = this.repository.retryFoundationGenerationRun(runId)
    this.enqueue(run.id)
    return run
  }

  finishPlanning(runId: string): FoundationGenerationRun {
    const run = this.repository.getFoundationGenerationRun(runId)
    if (run.status !== 'waiting_input') throw new DomainError('invalid-state', '只有正在等待回答的规划可以按现有信息直接生成。')
    const closed = this.repository.closeFoundationPlanning(run.id, boundedPlanningSummary(run, 'user-finished'), 'user-finished')
    this.enqueue(closed.id)
    return closed
  }

  resumeInteraction(runId: string, sessionId: string): FoundationGenerationRun {
    const run = this.repository.bindFoundationInteractionSession(runId, sessionId)
    this.enqueue(run.id)
    return run
  }

  resumeWaitingForSession(sessionId: string): void {
    for (const run of this.repository.listWaitingFoundationInteractions(sessionId)) this.enqueue(run.id)
  }

  moveToInline(runId: string): FoundationGenerationRun {
    const run = this.repository.clearFoundationInteractionSession(runId)
    if (run.status === 'waiting_input') this.running.get(runId)?.abort()
    return run
  }

  enqueue(runId: string): void {
    if (this.queued.has(runId) || this.running.has(runId)) return
    this.queued.add(runId)
    queueMicrotask(() => { void this.drain() })
  }

  private async execute(runId: string, controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      let run = this.repository.getFoundationGenerationRun(runId)
      const boundedStop = foundationPlanningStopReason(run)
      if (boundedStop && (run.status === 'planning' || run.status === 'waiting_input')) {
        run = this.repository.closeFoundationPlanning(run.id, boundedPlanningSummary(run, boundedStop), boundedStop)
      }
      if (run.status === 'planning') run = await this.generation.planProjectFoundation(run, controller.signal)
      if (run.status === 'waiting_input') {
        if (!this.interaction || !run.interactionSessionId) return
        const answers = await this.interaction.ask(run, controller.signal)
        run = this.answer(run.id, answers)
        if (run.status === 'planning' || run.status === 'generating') continue
        return
      }
      if (run.status === 'generating') await this.generation.generateProjectFoundationFromRun(run, controller.signal)
      return
    }
  }

  private async drain(): Promise<void> {
    while (this.running.size < this.concurrency && this.queued.size > 0) {
      const runId = this.queued.values().next().value as string
      this.queued.delete(runId)
      const controller = new AbortController()
      this.running.set(runId, controller)
      void this.execute(runId, controller).catch(cause => {
        const latest = this.repository.getFoundationGenerationRun(runId)
        if (cause instanceof FoundationInteractionDeferredError) return
        if (cause instanceof FoundationInteractionCancelledError) {
          if (latest.status === 'waiting_input' && latest.interactionSessionId !== null) this.repository.cancelFoundationGenerationRun(runId)
          return
        }
        if (latest.status !== 'cancelled') this.repository.failFoundationGenerationRun(runId, cause)
      }).finally(() => {
        this.running.delete(runId)
        void this.drain()
      })
    }
  }
}
