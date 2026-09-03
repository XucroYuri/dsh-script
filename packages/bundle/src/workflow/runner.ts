import type { WorkflowRun } from '../domain/model.js'
import type { NovelRepository } from '../storage/repository.js'
import type { WorkflowEngine } from './engine.js'

export class WorkflowRunner {
  private readonly queued = new Set<string>()
  private readonly running = new Set<string>()
  private readonly runningProjects = new Set<string>()
  private settledHandler: ((workflowRunId: string, run: WorkflowRun) => void | Promise<void>) | null = null

  constructor(private readonly repository: NovelRepository, private readonly engine: WorkflowEngine, private readonly concurrency = 2) {}

  setSettledHandler(handler: (workflowRunId: string, run: WorkflowRun) => void | Promise<void>): void {
    this.settledHandler = handler
  }

  recover(): void {
    for (const run of this.repository.listRecoverableWorkflows()) this.enqueue(run.id)
  }

  enqueue(workflowRunId: string): void {
    if (this.queued.has(workflowRunId) || this.running.has(workflowRunId)) return
    this.queued.add(workflowRunId)
    queueMicrotask(() => { void this.drain() })
  }

  create(chapterId: string, excludedSourceIds: string[] = []): WorkflowRun {
    const run = this.engine.create(chapterId, excludedSourceIds)
    this.enqueue(run.id)
    return run
  }

  resume(workflowRunId: string): WorkflowRun {
    const before = this.repository.getWorkflowRun(workflowRunId)
    const run = before.status === 'paused' ? this.repository.setWorkflowStatus(workflowRunId, 'running') : before
    this.enqueue(run.id)
    return run
  }

  retry(workflowRunId: string): WorkflowRun {
    const run = this.repository.retryWorkflow(workflowRunId)
    this.enqueue(run.id)
    return run
  }

  decide(workflowRunId: string, decision: 'approved' | 'rejected', note = ''): WorkflowRun {
    const run = this.repository.decideWorkflowApproval(workflowRunId, decision, note)
    if (decision === 'approved') this.enqueue(run.id)
    return run
  }

  private async drain(): Promise<void> {
    while (this.running.size < this.concurrency && this.queued.size > 0) {
      let selected: { workflowRunId: string; projectId: string } | null = null
      for (const workflowRunId of this.queued) {
        const projectId = this.repository.getWorkflowRun(workflowRunId).projectId
        if (!this.runningProjects.has(projectId)) {
          selected = { workflowRunId, projectId }
          break
        }
      }
      // Every queued workflow currently belongs to a project that already owns
      // a runner slot. The corresponding completion will drain the queue again.
      if (!selected) break
      const { workflowRunId, projectId } = selected
      this.queued.delete(workflowRunId)
      this.running.add(workflowRunId)
      this.runningProjects.add(projectId)
      void this.engine.advance(workflowRunId).catch(() => undefined).finally(async () => {
        this.running.delete(workflowRunId)
        this.runningProjects.delete(projectId)
        const latest = this.repository.getWorkflowRun(workflowRunId)
        if (latest.status === 'running') this.enqueue(latest.id)
        try { await this.settledHandler?.(workflowRunId, latest) } catch { /* Batch recovery remains durable and will retry on the next transition or Host restart. */ }
        void this.drain()
      })
    }
  }
}
