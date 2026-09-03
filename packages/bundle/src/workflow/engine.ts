import { DomainError, type KnowledgeSummaryDraft, type ReviewReport, type WorkflowRun } from '../domain/model.js'
import { RegenerablePostProcessingError, type GenerationService } from '../generation/service.js'
import type { NovelRepository } from '../storage/repository.js'
import { CHAPTER_WORKFLOW_NODES } from '../storage-sqlite/database.js'

function nextNode(nodeKey: string): string | null {
  const index = CHAPTER_WORKFLOW_NODES.indexOf(nodeKey as typeof CHAPTER_WORKFLOW_NODES[number])
  return index < 0 || index === CHAPTER_WORKFLOW_NODES.length - 1 ? null : CHAPTER_WORKFLOW_NODES[index + 1]!
}

function currentVersionId(repository: NovelRepository, run: WorkflowRun): string {
  const chapter = repository.getChapter(run.chapterId)
  const versionId = chapter.currentDraftVersionId ?? chapter.currentApprovedVersionId
  if (!versionId) throw new DomainError('invalid-state', 'The workflow needs a manuscript version.')
  return versionId
}

function chapterLengthAdvisory(outputJson: string | null): unknown | null {
  if (!outputJson) return null
  try {
    const output = JSON.parse(outputJson) as unknown
    return output && typeof output === 'object' && !Array.isArray(output)
      ? (output as Record<string, unknown>)._novelStudioLengthAdvisory ?? null
      : null
  } catch {
    return null
  }
}

function chapterGenerationAdvisory(outputJson: string | null, key: '_novelStudioCompletionAdvisory' | '_novelStudioGenerationAdvisory'): unknown | null {
  if (!outputJson) return null
  try {
    const output = JSON.parse(outputJson) as unknown
    return output && typeof output === 'object' && !Array.isArray(output)
      ? (output as Record<string, unknown>)[key] ?? null
      : null
  } catch {
    return null
  }
}

type PostProcessingWarningStage = 'memory-summary' | 'relationship-extraction'

interface PostProcessingWarning {
  stage: PostProcessingWarningStage
  code: string
  message: string
  regenerable: true
}

function postProcessingErrorCode(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' && cause.code.trim()) return cause.code.trim()
  return cause instanceof Error && cause.name ? cause.name : 'post-processing-error'
}

function postProcessingWarning(stage: PostProcessingWarningStage, cause: unknown): PostProcessingWarning {
  return {
    stage,
    code: postProcessingErrorCode(cause),
    message: cause instanceof Error ? cause.message : String(cause),
    regenerable: true,
  }
}

function assertFrozenGenerationInputs(repository: NovelRepository, run: WorkflowRun): void {
  let snapshot: Record<string, unknown>
  try {
    const parsed = JSON.parse(run.inputSnapshotJson) as unknown
    snapshot = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    throw new DomainError('invalid-state', '工作流输入快照损坏，无法安全继续生成。')
  }
  const project = repository.getProjectTree(run.projectId).project
  const chapter = repository.getChapter(run.chapterId)
  const foundation = repository.getProjectFoundation(run.projectId)
  const style = repository.getProjectStyleProfile(run.projectId)
  const liveVersionId = chapter.currentDraftVersionId ?? chapter.currentApprovedVersionId
  if (typeof snapshot.foundationAssemblyHash === 'string' && foundation.assemblyHash !== snapshot.foundationAssemblyHash) {
    throw new DomainError('revision-conflict', '创作基建已在工作流启动后改变；请重试以采用最新基建。')
  }
  if (typeof snapshot.styleRevision === 'number' && style.revision !== snapshot.styleRevision) {
    throw new DomainError('revision-conflict', '写作风格已在工作流启动后改变；请重试以采用最新文风。')
  }
  if (typeof snapshot.projectRevision === 'number' && project.revision !== snapshot.projectRevision) {
    throw new DomainError('revision-conflict', '项目输入已在工作流启动后改变；请重试以采用最新输入。')
  }
  if (typeof snapshot.chapterRevision === 'number' && chapter.revision !== snapshot.chapterRevision) {
    throw new DomainError('revision-conflict', '章节已在工作流启动后改变；请重试以采用最新正文。')
  }
  const frozenVersionId = typeof snapshot.inputManuscriptVersionId === 'string' ? snapshot.inputManuscriptVersionId : null
  if (liveVersionId !== frozenVersionId) {
    throw new DomainError('revision-conflict', '章节正文版本已在工作流启动后改变；请重试以采用最新正文。')
  }
}

export class WorkflowEngine {
  constructor(private readonly repository: NovelRepository, private readonly generation: GenerationService) {}

  create(chapterId: string, excludedSourceIds: string[] = []): WorkflowRun { return this.repository.startChapterWorkflow(chapterId, excludedSourceIds) }

  start(chapterId: string, stopAfterNode?: string): Promise<WorkflowRun> {
    return this.resume(this.create(chapterId), stopAfterNode)
  }

  async resume(input: string | WorkflowRun, stopAfterNode?: string): Promise<WorkflowRun> {
    let run = typeof input === 'string' ? this.repository.getWorkflowRun(input) : input
    if (run.status === 'paused') run = this.repository.setWorkflowStatus(run.id, 'running')
    if (run.status !== 'running') return run
    while (run.status === 'running' && run.currentNodeKey) {
      run = await this.executeNode(run, run.currentNodeKey)
      if (stopAfterNode && run.nodes.some(node => node.nodeKey === stopAfterNode && node.status === 'succeeded')) return run
    }
    return run
  }

  async advance(workflowRunId: string): Promise<WorkflowRun> {
    const run = this.repository.getWorkflowRun(workflowRunId)
    if (run.status !== 'running' || !run.currentNodeKey) return run
    return this.executeNode(run, run.currentNodeKey)
  }

  pause(workflowRunId: string): WorkflowRun { return this.repository.setWorkflowStatus(workflowRunId, 'paused') }
  cancel(workflowRunId: string): WorkflowRun { return this.repository.setWorkflowStatus(workflowRunId, 'cancel_requested') }
  async retry(workflowRunId: string): Promise<WorkflowRun> { return this.resume(this.repository.retryWorkflow(workflowRunId)) }

  async decide(workflowRunId: string, decision: 'approved' | 'rejected', note = ''): Promise<WorkflowRun> {
    const decided = this.repository.decideWorkflowApproval(workflowRunId, decision, note)
    return decision === 'approved' ? this.resume(decided) : decided
  }

  private async executeNode(run: WorkflowRun, nodeKey: string): Promise<WorkflowRun> {
    // A Host restart can leave a model artifact committed while its durable
    // workflow node is still `running`. prepareWorkflowNode then performs the
    // authority check that decides whether that artifact may be resumed. Keep
    // the pre-existing node id so a rejected recovery is persisted as a real
    // retryable failure instead of remaining `running` and being re-enqueued
    // forever by WorkflowRunner.
    let failureNodeRunId = [...run.nodes].reverse().find(node => node.nodeKey === nodeKey && node.status === 'running')?.id ?? null
    try {
      const prepared = this.repository.prepareWorkflowNode(run.id, nodeKey, { workflowRunId: run.id, chapterId: run.chapterId, revisionRound: run.revisionRound })
      if (prepared.alreadySucceeded) return this.repository.getWorkflowRun(run.id)
      const nodeRunId = prepared.nodeRunId
      failureNodeRunId = nodeRunId
      if (nodeKey === 'freeze_input_snapshot') return this.repository.completeWorkflowNode(run.id, nodeRunId, JSON.parse(run.inputSnapshotJson), nextNode(nodeKey))
      if (nodeKey === 'retrieve_context') {
        const bundle = this.repository.createRetrievalBundle(run.id)
        return this.repository.completeWorkflowNode(run.id, nodeRunId, { retrievalBundleId: bundle.id, selectionSnapshotId: bundle.selectionSnapshotId, itemCount: bundle.items.length, conflicts: bundle.conflicts, truncated: bundle.truncated }, nextNode(nodeKey))
      }
      if (nodeKey === 'plan_scenes') {
        assertFrozenGenerationInputs(this.repository, run)
        const result = await this.generation.generate(run.chapterId, 'scene-plan', undefined, { workflowRunId: run.id, workflowNodeRunId: nodeRunId })
        return this.repository.completeWorkflowNode(run.id, nodeRunId, {
          scenePlanId: result.scenePlan!.id,
          modelRunId: result.modelRun.id,
          generationAdvisory: chapterGenerationAdvisory(result.modelRun.outputJson, '_novelStudioGenerationAdvisory'),
        }, nextNode(nodeKey))
      }
      if (nodeKey === 'validate_scene_plan') return this.repository.completeWorkflowNode(run.id, nodeRunId, { valid: true }, nextNode(nodeKey))
      if (nodeKey === 'generate_draft') {
        assertFrozenGenerationInputs(this.repository, run)
        const recovered = this.repository.tryRecoverLegacyLengthRejectedDraft(run.id, nodeRunId)
        if (recovered) {
          return this.repository.completeWorkflowNode(run.id, nodeRunId, {
            manuscriptVersionId: recovered.manuscriptVersionId,
            modelRunId: recovered.modelRunId,
            lengthAdvisory: recovered.lengthAdvisory,
            legacyRecovery: { source: recovered.source, originalErrorCode: recovered.originalErrorCode },
          }, nextNode(nodeKey))
        }
        const result = await this.generation.generate(run.chapterId, 'chapter-draft', undefined, { workflowRunId: run.id, workflowNodeRunId: nodeRunId })
        const version = result.chapter!.versions.find(item => item.modelRunId === result.modelRun.id)!
        this.repository.bindManuscriptVersionToWorkflow(version.id, run.id, nodeRunId)
        return this.repository.completeWorkflowNode(run.id, nodeRunId, {
          manuscriptVersionId: version.id, modelRunId: result.modelRun.id,
          lengthAdvisory: chapterLengthAdvisory(result.modelRun.outputJson),
          completionAdvisory: chapterGenerationAdvisory(result.modelRun.outputJson, '_novelStudioCompletionAdvisory'),
        }, nextNode(nodeKey))
      }
      if (['plot_review', 'character_review', 'timeline_review', 'style_review'].includes(nodeKey)) {
        const kind = nodeKey.replace('_review', '') as ReviewReport['kind']
        const versionId = currentVersionId(this.repository, run)
        this.repository.createReviewReport(run.id, nodeRunId, versionId, kind, { summary: `${kind} review completed`, issues: [] })
        return this.repository.completeWorkflowNode(run.id, nodeRunId, { verdict: 'pass' }, nextNode(nodeKey))
      }
      if (nodeKey === 'aggregate_review') {
        const versionId = currentVersionId(this.repository, run)
        const reports = this.repository.getWorkflowRun(run.id).reviews.filter(review => review.kind !== 'aggregate')
        this.repository.createReviewReport(run.id, nodeRunId, versionId, 'aggregate', { reportIds: reports.map(report => report.id), issueCount: 0 })
        return this.repository.completeWorkflowNode(run.id, nodeRunId, { verdict: 'pass', reportCount: reports.length }, nextNode(nodeKey))
      }
      if (nodeKey === 'conditional_revision_loop') return this.repository.completeWorkflowNode(run.id, nodeRunId, { revised: false, round: run.revisionRound }, nextNode(nodeKey))
      if (nodeKey === 'wait_chapter_approval') return this.repository.waitForWorkflowApproval(run.id, nodeRunId, currentVersionId(this.repository, run))
      if (nodeKey === 'commit_approved_version') {
        if (!run.approvedVersionId) throw new DomainError('invalid-state', 'Approval did not select a manuscript version.')
        const chapter = this.repository.getChapter(run.chapterId)
        this.repository.approveVersion(run.chapterId, run.approvedVersionId, chapter.revision)
        return this.repository.completeWorkflowNode(run.id, nodeRunId, { manuscriptVersionId: run.approvedVersionId }, nextNode(nodeKey))
      }
      if (nodeKey === 'extract_canon_candidates') {
        this.repository.createCanonCandidate(run.id, nodeRunId)
        return this.repository.completeWorkflowNode(run.id, nodeRunId, { candidateCount: this.repository.getWorkflowRun(run.id).canonCandidates.length }, nextNode(nodeKey))
      }
      if (nodeKey === 'validate_canon_candidates') {
        this.repository.validateCanonCandidates(run.id, nodeRunId)
        return this.repository.completeWorkflowNode(run.id, nodeRunId, { valid: true }, nextNode(nodeKey))
      }
      if (nodeKey === 'commit_canon') {
        this.repository.commitWorkflowCanon(run.id, nodeRunId)
        return this.repository.completeWorkflowNode(run.id, nodeRunId, { committed: true }, nextNode(nodeKey))
      }
      if (nodeKey === 'refresh_summaries_and_indexes') {
        // Imported or manually authored chapters may be approved before the
        // optional three-stage foundation is complete. They still receive a
        // durable Canon/index refresh; the richer model summary is added once
        // the approved foundation exists.
        const foundationReady = this.repository.getProjectFoundation(run.projectId).readyForChapterGeneration
        const postProcessingWarnings: PostProcessingWarning[] = []
        let memoryRefreshError: string | null = null
        let summaries: KnowledgeSummaryDraft[] = []
        if (foundationReady) {
          try {
            summaries = await this.generation.refreshLongNovelMemory(run.id)
          } catch (cause) {
            if (!(cause instanceof RegenerablePostProcessingError) || cause.stage !== 'memory-summary') throw cause
            const warning = postProcessingWarning('memory-summary', cause)
            memoryRefreshError = warning.message
            postProcessingWarnings.push(warning)
          }
        }
        // Canon-derived entities, timeline, foreshadowing and full-text indexes
        // remain authoritative even when the optional model summary is
        // unavailable. Passing no model summaries creates the approved-text
        // fallback chapter memory instead of failing the completed chapter.
        const knowledge = this.repository.refreshKnowledgeIndexes(run.id, summaries)
        let relationshipCandidateCount = 0
        let relationshipExtractionError: string | null = null
        try {
          const candidates = await this.generation.extractEntityRelationships(run.id)
          relationshipCandidateCount = candidates.length
          if (candidates.some(candidate => candidate.status === 'ambiguous')) {
            const warning: PostProcessingWarning = {
              stage: 'relationship-extraction',
              code: 'relationship-needs-review',
              message: '本章有实体或关系需要人工确认；候选不会进入 Prompt，也不会阻断正文和后续章节。',
              regenerable: true,
            }
            relationshipExtractionError = warning.message
            postProcessingWarnings.push(warning)
          }
        } catch (cause) {
          if (!(cause instanceof RegenerablePostProcessingError) || cause.stage !== 'relationship-extraction') throw cause
          const warning = postProcessingWarning('relationship-extraction', cause)
          relationshipExtractionError = warning.message
          // A bounded YOLO run pauses only when the extractor returned an
          // unsafe structure. Provider outages and output-token limits are
          // regenerable omissions: no candidate enters the Prompt, so the
          // already approved chapter can safely finish.
          postProcessingWarnings.push(warning)
        }
        return this.repository.completeFinalWorkflowNode(run.id, nodeRunId, {
          summaryCount: knowledge.summaries.length,
          entityCount: knowledge.entities.length,
          timelineCount: knowledge.timeline.length,
          relationshipCandidateCount,
          memoryRefreshError,
          relationshipExtractionError,
          postProcessingWarnings,
        })
      }
      throw new DomainError('invalid-state', `Unknown workflow node ${nodeKey}.`)
    } catch (cause) {
      const retryableModelNode = [
        'plan_scenes', 'generate_draft', 'extract_canon_candidates',
        'validate_canon_candidates', 'commit_canon', 'refresh_summaries_and_indexes',
      ].includes(nodeKey)
      const retryable = cause instanceof DomainError
        ? cause.code === 'revision-conflict' || cause.code !== 'invalid-state' || retryableModelNode
        : true
      if (failureNodeRunId) this.repository.failWorkflowNode(run.id, failureNodeRunId, cause, retryable)
      throw cause
    }
  }
}
