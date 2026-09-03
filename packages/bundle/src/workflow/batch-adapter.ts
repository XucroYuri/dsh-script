import type { ChapterBatchStatus } from '../domain/model.js'
import type { NovelRepository } from '../storage/repository.js'
import type { ChapterBatchDispatch, ChapterBatchRunnerStore, ChapterBatchWorkflowPort } from './batch-runner.js'
import type { WorkflowEngine } from './engine.js'
import type { WorkflowRunner } from './runner.js'

export class RepositoryChapterBatchStore implements ChapterBatchRunnerStore {
  constructor(private readonly repository: NovelRepository) {}

  listRecoverableBatchIds(): string[] {
    return this.repository.listRecoverableChapterBatches().map(batch => batch.id)
  }

  getBatch(batchId: string) { return this.repository.getChapterBatch(batchId) }

  setBatchStatus(batchId: string, status: ChapterBatchStatus): void {
    this.repository.setChapterBatchRuntimeStatus(batchId, status)
  }

  approvePlan(batchId: string): void {
    const batch = this.repository.getChapterBatch(batchId)
    const project = this.repository.getProjectTree(batch.projectId).project
    this.repository.approveChapterBatchPlan(batchId, batch.items.map(item => ({
      id: item.id, plannedTitle: item.plannedTitle, writingGoal: item.writingGoal,
      openingContinuity: item.openingContinuity, endingHook: item.endingHook, targetWords: item.targetWords,
    })), project.revision)
  }

  dispatchNext(batchId: string): ChapterBatchDispatch | null {
    const result = this.repository.dispatchNextBatchItem(batchId)
    if (!result.workflow) return null
    const item = result.batch.items.find(value => value.workflowRunId === result.workflow!.id)
    return item ? { itemId: item.id, workflowRunId: result.workflow.id } : null
  }
}

export class HarnessChapterBatchWorkflowPort implements ChapterBatchWorkflowPort {
  constructor(private readonly runner: WorkflowRunner, private readonly engine: WorkflowEngine) {}

  enqueue(workflowRunId: string): void { this.runner.enqueue(workflowRunId) }
  pause(workflowRunId: string): void { this.engine.pause(workflowRunId) }
  resume(workflowRunId: string): void { this.runner.resume(workflowRunId) }
  approve(workflowRunId: string): void { this.runner.decide(workflowRunId, 'approved', 'YOLO 批次自动批准；仍不代表质量审校。') }
}
