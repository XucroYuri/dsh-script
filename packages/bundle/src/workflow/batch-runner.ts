import {
  deriveChapterBatchItemStatus,
  deriveChapterBatchStatus,
  findActiveChapterBatchItem,
  MAX_CHAPTER_BATCH_SIZE,
  resolveChapterBatchPolicy,
} from '../domain/chapter-batches.js'
import {
  DomainError,
  type ChapterBatchItem,
  type ChapterBatchStatus,
  type ChapterGenerationBatch,
} from '../domain/model.js'

type Awaitable<T> = T | Promise<T>

function completionNeedsAuthorReview(item: ChapterBatchItem | null): boolean {
  const node = item?.workflow?.nodes?.find(value => value.nodeKey === 'generate_draft' && value.status === 'succeeded')
  if (!node?.outputJson) return false
  try {
    const output = JSON.parse(node.outputJson) as { completionAdvisory?: unknown }
    const advisory = output.completionAdvisory
    if (advisory === true) return true
    return !!advisory && typeof advisory === 'object' && !Array.isArray(advisory)
      && (advisory as Record<string, unknown>).requiresAuthorReview === true
  } catch {
    return false
  }
}

export interface ChapterBatchDispatch {
  itemId: string
  workflowRunId: string
}

/**
 * Persistence boundary for the coordinator. dispatchNext must atomically
 * validate the batch, claim one queued item, create its WorkflowRun and link
 * that run to the item before returning. This prevents crash-orphaned claims.
 */
export interface ChapterBatchRunnerStore {
  listRecoverableBatchIds(): Awaitable<readonly string[]>
  getBatch(batchId: string): Awaitable<ChapterGenerationBatch>
  setBatchStatus(batchId: string, status: ChapterBatchStatus): Awaitable<void>
  /** Applies the persisted plan without edits; used only by explicit YOLO mode. */
  approvePlan(batchId: string): Awaitable<void>
  dispatchNext(batchId: string): Awaitable<ChapterBatchDispatch | null>
}

/** WorkflowRunner/WorkflowEngine adapter; every operation is idempotent. */
export interface ChapterBatchWorkflowPort {
  enqueue(workflowRunId: string): Awaitable<void>
  pause(workflowRunId: string): Awaitable<void>
  resume(workflowRunId: string): Awaitable<void>
  approve(workflowRunId: string): Awaitable<void>
}

export class ChapterBatchRunner {
  private readonly tails = new Map<string, Promise<void>>()

  constructor(
    private readonly store: ChapterBatchRunnerStore,
    private readonly workflows: ChapterBatchWorkflowPort,
  ) {}

  async recover(): Promise<ChapterBatchStatus[]> {
    const batchIds = await this.store.listRecoverableBatchIds()
    return Promise.all(batchIds.map(batchId => this.reconcile(batchId)))
  }

  reconcile(batchId: string): Promise<ChapterBatchStatus> {
    return this.serialized(batchId, () => this.reconcileUnlocked(batchId))
  }

  async dispatch(batchId: string): Promise<ChapterBatchDispatch | null> {
    return this.serialized(batchId, async () => {
      const snapshot = await this.store.getBatch(batchId)
      const status = deriveChapterBatchStatus(snapshot.status, snapshot.items)
      if (status !== 'queued' && status !== 'running') throw new DomainError('invalid-state', `Batch ${batchId} cannot dispatch while ${status}.`)
      if (findActiveChapterBatchItem(snapshot.items)) throw new DomainError('invalid-state', `Batch ${batchId} already has an active workflow.`)
      const dispatched = await this.store.dispatchNext(batchId)
      if (dispatched) await this.workflows.enqueue(dispatched.workflowRunId)
      return dispatched
    })
  }

  pause(batchId: string): Promise<ChapterBatchStatus> {
    return this.serialized(batchId, async () => {
      const snapshot = await this.store.getBatch(batchId)
      if (['planning', 'awaiting_plan_approval', 'succeeded', 'completed_with_skips', 'cancelled'].includes(snapshot.status)) {
        throw new DomainError('invalid-state', `Batch ${batchId} cannot be paused while ${snapshot.status}.`)
      }
      const active = findActiveChapterBatchItem(snapshot.items)
      await this.store.setBatchStatus(batchId, active && deriveChapterBatchItemStatus(active) === 'waiting_approval' ? 'paused' : 'pause_requested')
      return this.reconcileUnlocked(batchId)
    })
  }

  resume(batchId: string): Promise<ChapterBatchStatus> {
    return this.serialized(batchId, async () => {
      const snapshot = await this.store.getBatch(batchId)
      if (!['paused', 'pause_requested'].includes(snapshot.status)) {
        throw new DomainError('invalid-state', `Batch ${batchId} cannot resume while ${snapshot.status}.`)
      }
      const active = findActiveChapterBatchItem(snapshot.items)
      await this.store.setBatchStatus(batchId, active && deriveChapterBatchItemStatus(active) === 'waiting_approval' ? 'waiting_approval' : 'running')
      return this.reconcileUnlocked(batchId)
    })
  }

  private async reconcileUnlocked(batchId: string): Promise<ChapterBatchStatus> {
    // A YOLO approval may immediately finish a workflow and expose the next
    // queued item. The bound keeps a broken adapter from spinning forever.
    for (let transition = 0; transition < MAX_CHAPTER_BATCH_SIZE * 3 + 4; transition++) {
      let snapshot = await this.store.getBatch(batchId)
      if (snapshot.status === 'planning') return 'planning'
      const status = deriveChapterBatchStatus(snapshot.status, snapshot.items)
      if (status !== snapshot.status) {
        await this.store.setBatchStatus(batchId, status)
        snapshot = await this.store.getBatch(batchId)
      }

      if (['succeeded', 'completed_with_skips', 'cancelled'].includes(status)) return status
      if (status === 'awaiting_plan_approval') {
        const policy = resolveChapterBatchPolicy(snapshot.automationMode)
        if (policy.planApproval === 'required') return status
        await this.store.approvePlan(batchId)
        continue
      }

      const active = findActiveChapterBatchItem(snapshot.items)
      if (status === 'pause_requested') {
        if (active?.workflowRunId && deriveChapterBatchItemStatus(active) === 'waiting_approval') {
          await this.store.setBatchStatus(batchId, 'paused')
          return 'paused'
        }
        if (active?.workflowRunId && deriveChapterBatchItemStatus(active) === 'running') await this.workflows.pause(active.workflowRunId)
        const afterPause = await this.store.getBatch(batchId)
        const pausedStatus = deriveChapterBatchStatus('pause_requested', afterPause.items)
        if (pausedStatus !== afterPause.status) await this.store.setBatchStatus(batchId, pausedStatus)
        return pausedStatus
      }
      if (status === 'paused' || status === 'blocked') return status

      if (status === 'waiting_approval') {
        const policy = resolveChapterBatchPolicy(snapshot.automationMode)
        if (policy.chapterApproval === 'required') return status
        if (!active?.workflowRunId) throw new DomainError('invalid-state', `Batch ${batchId} is waiting for approval without an active workflow.`)
        if (completionNeedsAuthorReview(active)) {
          await this.store.setBatchStatus(batchId, 'paused')
          return 'paused'
        }
        await this.workflows.approve(active.workflowRunId)
        continue
      }

      if (active) {
        const activeStatus = deriveChapterBatchItemStatus(active)
        if (!active.workflowRunId) throw new DomainError('invalid-state', `Active batch item ${active.id} has no workflow run.`)
        if (activeStatus === 'paused') {
          await this.workflows.resume(active.workflowRunId)
          return 'running'
        }
        if (activeStatus === 'running' || activeStatus === 'cancel_requested' || activeStatus === 'dispatching') {
          await this.workflows.enqueue(active.workflowRunId)
          return 'running'
        }
      }

      const hasQueuedItem = snapshot.items.some(item => item.queueState === 'queued')
      if (!hasQueuedItem) throw new DomainError('invalid-state', `Batch ${batchId} has no active or queued item but is not complete.`)
      const dispatched = await this.store.dispatchNext(batchId)
      if (dispatched) {
        await this.workflows.enqueue(dispatched.workflowRunId)
        return 'running'
      }
      // Another process may have claimed the item. Re-read the authoritative
      // snapshot instead of creating a second WorkflowRun.
    }
    throw new DomainError('invalid-state', `Batch ${batchId} did not converge while reconciling.`)
  }

  private serialized<T>(batchId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(batchId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const tail = current.then(() => undefined, () => undefined)
    this.tails.set(batchId, tail)
    return current.finally(() => {
      if (this.tails.get(batchId) === tail) this.tails.delete(batchId)
    })
  }
}
