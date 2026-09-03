import { describe, expect, it } from 'vitest'
import type { ChapterBatchItem, ChapterBatchStatus, ChapterGenerationBatch, WorkflowRun, WorkflowRunStatus } from '../src/domain/model.js'
import { ChapterBatchRunner, type ChapterBatchDispatch, type ChapterBatchRunnerStore, type ChapterBatchWorkflowPort } from '../src/workflow/batch-runner.js'

function workflow(id: string, status: WorkflowRunStatus): WorkflowRun { return { id, status } as WorkflowRun }

function item(index: number, queueState: ChapterBatchItem['queueState'] = 'queued', workflowStatus: WorkflowRunStatus | null = null): ChapterBatchItem {
  const workflowRunId = workflowStatus || queueState === 'dispatched' ? `workflow-${index}` : null
  return {
    id: `item-${index}`, batchId: 'batch-1', chapterId: `chapter-${index}`, position: index,
    plannedTitle: `第 ${index} 章`, writingGoal: '推进冲突', openingContinuity: '', endingHook: '', targetWords: 3000,
    queueState, workflowRunId, workflow: workflowRunId && workflowStatus ? workflow(workflowRunId, workflowStatus) : null,
    chapterRevisionAtEnqueue: 0, blockedReason: null,
    createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

function batch(status: ChapterBatchStatus, items: ChapterBatchItem[], automationMode: 'auto' | 'yolo' = 'auto'): ChapterGenerationBatch {
  return {
    id: 'batch-1', projectId: 'project-1', mode: 'selected', automationMode, status, requestedCount: items.length,
    policyJson: '{}', revision: 0, errorJson: null, plan: null, items,
    createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', startedAt: null, finishedAt: null,
  }
}

class FakeStore implements ChapterBatchRunnerStore {
  dispatchCalls = 0
  planApprovalCalls = 0
  constructor(public batch: ChapterGenerationBatch) {}
  listRecoverableBatchIds(): readonly string[] { return [this.batch.id] }
  getBatch(): ChapterGenerationBatch { return this.batch }
  setBatchStatus(_batchId: string, status: ChapterBatchStatus): void { this.batch.status = status; this.batch.revision++ }
  approvePlan(): void {
    this.planApprovalCalls++
    for (const candidate of this.batch.items) if (candidate.queueState === 'planned') candidate.queueState = 'queued'
    this.batch.status = 'queued'
    this.batch.revision++
  }
  dispatchNext(): ChapterBatchDispatch | null {
    this.dispatchCalls++
    if (this.batch.items.some(candidate => candidate.queueState === 'dispatched' && !['succeeded', 'cancelled'].includes(candidate.workflow?.status ?? ''))) return null
    const next = [...this.batch.items].sort((left, right) => left.position - right.position).find(candidate => candidate.queueState === 'queued')
    if (!next) return null
    next.queueState = 'dispatched'
    next.workflowRunId = `workflow-${next.chapterId}`
    next.workflow = workflow(next.workflowRunId, 'running')
    return { itemId: next.id, workflowRunId: next.workflowRunId }
  }
}

class FakeWorkflows implements ChapterBatchWorkflowPort {
  enqueued: string[] = []
  paused: string[] = []
  resumed: string[] = []
  approved: string[] = []
  constructor(private readonly store: FakeStore) {}
  enqueue(id: string): void { this.enqueued.push(id) }
  pause(id: string): void { this.paused.push(id); this.workflowItem(id).workflow!.status = 'paused' }
  resume(id: string): void { this.resumed.push(id); this.workflowItem(id).workflow!.status = 'running' }
  approve(id: string): void { this.approved.push(id); this.workflowItem(id).workflow!.status = 'succeeded' }
  private workflowItem(id: string): ChapterBatchItem {
    const found = this.store.batch.items.find(candidate => candidate.workflowRunId === id)
    if (!found) throw new Error(`Missing workflow ${id}`)
    return found
  }
}

function setup(value: ChapterGenerationBatch) {
  const store = new FakeStore(value)
  const workflows = new FakeWorkflows(store)
  return { store, workflows, runner: new ChapterBatchRunner(store, workflows) }
}

describe('chapter batch runner coordination', () => {
  it('recovers a linked workflow without dispatching a duplicate', async () => {
    const { store, workflows, runner } = setup(batch('running', [item(1, 'dispatched', 'running'), item(2)]))
    await expect(runner.recover()).resolves.toEqual(['running'])
    expect(workflows.enqueued).toEqual(['workflow-1'])
    expect(store.dispatchCalls).toBe(0)
  })

  it('dispatches only one item across serialized reconciliations', async () => {
    const { store, workflows, runner } = setup(batch('queued', [item(1), item(2)]))
    await Promise.all([runner.reconcile('batch-1'), runner.reconcile('batch-1')])
    expect(store.dispatchCalls).toBe(1)
    expect(store.batch.items.filter(candidate => candidate.queueState === 'dispatched')).toHaveLength(1)
    expect(workflows.enqueued.every(id => id === 'workflow-chapter-1')).toBe(true)
  })

  it('soft-pauses and resumes the same workflow', async () => {
    const { store, workflows, runner } = setup(batch('running', [item(1, 'dispatched', 'running'), item(2)]))
    await expect(runner.pause('batch-1')).resolves.toBe('paused')
    expect(store.batch.status).toBe('paused')
    expect(workflows.paused).toEqual(['workflow-1'])
    await expect(runner.resume('batch-1')).resolves.toBe('running')
    expect(workflows.resumed).toEqual(['workflow-1'])
    expect(store.dispatchCalls).toBe(0)
  })

  it('pauses at an AUTO approval boundary and restores that boundary on resume', async () => {
    const { store, workflows, runner } = setup(batch('waiting_approval', [item(1, 'dispatched', 'waiting_approval'), item(2)]))
    await expect(runner.pause('batch-1')).resolves.toBe('paused')
    expect(store.batch.status).toBe('paused')
    expect(workflows.paused).toEqual([])

    await expect(runner.resume('batch-1')).resolves.toBe('waiting_approval')
    expect(store.batch.status).toBe('waiting_approval')
    expect(workflows.resumed).toEqual([])
    expect(store.dispatchCalls).toBe(0)
  })

  it('keeps AUTO at chapter approval and lets YOLO advance', async () => {
    const auto = setup(batch('running', [item(1, 'dispatched', 'waiting_approval'), item(2)], 'auto'))
    await expect(auto.runner.reconcile('batch-1')).resolves.toBe('waiting_approval')
    expect(auto.workflows.approved).toEqual([])

    const yolo = setup(batch('waiting_approval', [item(1, 'dispatched', 'waiting_approval'), item(2)], 'yolo'))
    await expect(yolo.runner.reconcile('batch-1')).resolves.toBe('running')
    expect(yolo.workflows.approved).toEqual(['workflow-1'])
    expect(yolo.store.batch.items[1]).toMatchObject({ queueState: 'dispatched', workflow: { status: 'running' } })
  })

  it('pauses YOLO for an output-limited draft that still needs author review instead of auto-approving it', async () => {
    const reviewable = item(1, 'dispatched', 'waiting_approval')
    reviewable.workflow = {
      id: reviewable.workflowRunId,
      status: 'waiting_approval',
      nodes: [{
        nodeKey: 'generate_draft',
        status: 'succeeded',
        outputJson: JSON.stringify({
          manuscriptVersionId: 'saved-reviewable-version',
          completionAdvisory: { kind: 'incomplete-after-output-limit', requiresAuthorReview: true },
        }),
      }],
    } as WorkflowRun
    const { store, workflows, runner } = setup(batch('waiting_approval', [reviewable, item(2)], 'yolo'))

    await expect(runner.reconcile('batch-1')).resolves.toBe('paused')

    expect(store.batch).toMatchObject({
      status: 'paused',
      items: [
        expect.objectContaining({ workflow: expect.objectContaining({ status: 'waiting_approval' }) }),
        expect.objectContaining({ queueState: 'queued' }),
      ],
    })
    expect(workflows.approved).toEqual([])
    expect(store.dispatchCalls).toBe(0)
  })

  it('keeps AUTO plan review visible and lets YOLO approve the persisted plan', async () => {
    const auto = setup(batch('awaiting_plan_approval', [item(1, 'planned')], 'auto'))
    await expect(auto.runner.reconcile('batch-1')).resolves.toBe('awaiting_plan_approval')
    expect(auto.store.planApprovalCalls).toBe(0)

    const yolo = setup(batch('awaiting_plan_approval', [item(1, 'planned')], 'yolo'))
    await expect(yolo.runner.reconcile('batch-1')).resolves.toBe('running')
    expect(yolo.store.planApprovalCalls).toBe(1)
    expect(yolo.store.batch.items[0]).toMatchObject({ queueState: 'dispatched', workflow: { status: 'running' } })
  })

  it('blocks on failure without retrying or skipping', async () => {
    const { store, workflows, runner } = setup(batch('running', [item(1, 'dispatched', 'failed'), item(2)], 'yolo'))
    await expect(runner.reconcile('batch-1')).resolves.toBe('blocked')
    expect(store.batch.status).toBe('blocked')
    expect(workflows.enqueued).toEqual([])
    expect(store.dispatchCalls).toBe(0)
  })

  it.each(['auto', 'yolo'] as const)('dispatches the next %s item when the succeeded workflow only carries post-processing warnings', async automationMode => {
    const completed = item(1, 'dispatched', 'succeeded')
    completed.workflow = {
      id: completed.workflowRunId,
      status: 'succeeded',
      nodes: [{
        nodeKey: 'refresh_summaries_and_indexes',
        status: 'succeeded',
        outputJson: JSON.stringify({ postProcessingWarnings: [{ stage: 'relationship-extraction', code: 'model-output-limit', message: 'temporary output limit', regenerable: true }] }),
      }],
    } as WorkflowRun
    const { store, workflows, runner } = setup(batch('running', [completed, item(2)], automationMode))

    await expect(runner.reconcile('batch-1')).resolves.toBe('running')

    expect(store.dispatchCalls).toBe(1)
    expect(store.batch.items[1]).toMatchObject({ queueState: 'dispatched', workflow: { status: 'running' } })
    expect(workflows.enqueued).toEqual(['workflow-chapter-2'])
  })
})
