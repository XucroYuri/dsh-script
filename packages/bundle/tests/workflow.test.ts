import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { AutomationMode, WorkflowRun } from '../src/domain/model.js'
import { ModelOutputLimitError, type ModelGateway } from '../src/generation/model-gateway.js'
import { GenerationService } from '../src/generation/service.js'
import { renderBudgetedGenerationPrompt } from '../src/prompt-assets/render.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import type { NovelRepository } from '../src/storage/repository.js'
import { WorkflowEngine } from '../src/workflow/engine.js'
import { WorkflowRunner } from '../src/workflow/runner.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []
const WORKFLOW_EVIDENCE_EXCERPT = '林舟在旧码头找到了刻有日期的铜牌'
const WORKFLOW_MANUSCRIPT = `${'潮声沿着封锁线反复拍岸，巡逻灯在雾中逐段扫过。'.repeat(25)}${WORKFLOW_EVIDENCE_EXCERPT}。${'顾岚记下潮位变化，两人继续核对失踪者留下的路线。'.repeat(25)}`

function createGateway(failFirstScenePlan = false, ambiguousRelationship = false, failRelationshipExtraction = false): ModelGateway {
  let calls = 0
  return {
    selection: () => ({ provider: 'workflow-test', model: 'deterministic-v1' }),
    providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
    async generate(request) {
      calls++
      if (failFirstScenePlan && calls === 1) throw new Error('temporary model outage')
      if (request.prompt.startsWith('任务：提炼批准章节并增量更新长篇记忆')) {
        const structuredSummary = { stateChanges: ['林舟取得铜牌'], decisionsAndConsequences: ['决定继续追查失踪案'], newInformation: ['铜牌刻有日期'], timeAndPlace: ['旧码头'], relationshipChanges: [], foreshadowing: ['铜牌与失踪案有关'], unresolvedConflicts: ['日期含义未明'] }
        return { text: JSON.stringify(Object.fromEntries(['foundation','chapter','arc','volume','book','project'].map(scope => [scope, { compactNarrative: `${scope} memory keeps the copper token and unresolved disappearance connected.`, structuredSummary }]))) }
      }
      if (request.prompt.startsWith('任务：从本章批准正文')) {
        if (failRelationshipExtraction) throw new Error('relationship extractor offline')
        return { text: JSON.stringify({ relationships: ambiguousRelationship ? [{ sourceEntityId: null, targetEntityId: null, sourceLabel: '未知甲', targetLabel: '未知乙', predicateKey: 'knows', label: '认识', category: 'knowledge', directionality: 'directed', factLayer: 'canon', confidence: .6 }] : [] }) }
      }
      const chapterDraft = request.prompt.includes('任务：根据场景计划生成章节初稿')
      return chapterDraft
        ? { text: JSON.stringify({ title: '工作流章节', manuscript: WORKFLOW_MANUSCRIPT, canonCandidates: [{ kind: 'foreshadowing', subject: '刻有日期的铜牌', predicate: 'foreshadows', value: '与失踪案有关', entityType: 'item', aliases: ['铜牌'], storyOrder: 1000, foreshadowStatus: 'planted', evidenceExcerpt: WORKFLOW_EVIDENCE_EXCERPT }], uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }) }
        : { text: JSON.stringify({ chapterGoal: '找到铜牌', scenes: [{ scenePurpose: '搜索旧码头' }], risks: [] }) }
    },
  }
}

function createPostProcessingFailureGateway(
  stage: 'memory-summary' | 'relationship-extraction',
  failure: () => Error,
): ModelGateway {
  const fallback = createGateway()
  return {
    selection: fallback.selection,
    providers: fallback.providers,
    async generate(request) {
      if (stage === 'memory-summary' && request.prompt.startsWith('任务：提炼批准章节并增量更新长篇记忆')) throw failure()
      if (stage === 'relationship-extraction' && request.prompt.startsWith('任务：从本章批准正文')) throw failure()
      return fallback.generate(request)
    },
  }
}

function createStructurallyInvalidRelationshipGateway(): ModelGateway {
  const fallback = createGateway()
  return {
    selection: fallback.selection,
    providers: fallback.providers,
    async generate(request) {
      if (request.prompt.startsWith('任务：从本章批准正文')) return { text: '{"relationships":[' }
      return fallback.generate(request)
    },
  }
}

function createStructurallyInvalidMemoryGateway(): ModelGateway {
  const fallback = createGateway()
  return {
    selection: fallback.selection,
    providers: fallback.providers,
    async generate(request) {
      if (request.prompt.startsWith('任务：提炼批准章节并增量更新长篇记忆')) return { text: '{"chapter":' }
      return fallback.generate(request)
    },
  }
}

function createCanonCandidatesGateway(canonCandidates: Array<Record<string, unknown>>, manuscript = WORKFLOW_MANUSCRIPT): ModelGateway {
  const fallback = createGateway()
  return {
    selection: fallback.selection,
    providers: fallback.providers,
    async generate(request) {
      if (!request.prompt.includes('任务：根据场景计划生成章节初稿')) return fallback.generate(request)
      return { text: JSON.stringify({
        title: '证据校验章节', manuscript, canonCandidates,
        uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] },
      }) }
    },
  }
}

function createCanonEvidenceGateway(evidenceExcerpt: string, manuscript = WORKFLOW_MANUSCRIPT): ModelGateway {
  return createCanonCandidatesGateway([{
    kind: 'fact', subject: '测试事实', predicate: 'is_supported_by', value: '正文证据',
    entityType: 'concept', aliases: [], storyOrder: 1000, foreshadowStatus: null, evidenceExcerpt,
  }], manuscript)
}

function setup(gateway = createGateway()) {
  const root = mkdtempSync(join(tmpdir(), 'novel-studio-phase3-'))
  roots.push(root)
  const repository = new SqliteNovelRepository({ dataRoot: root })
  const project = repository.createProject({ title: '持久化工作流' })
  approveTestFoundation(repository, project.project.id)
  const chapter = repository.createChapter(project.project.id, '铜牌')
  const engine = new WorkflowEngine(repository, new GenerationService(repository, gateway))
  return { root, repository, project, chapter, engine }
}

function completedWorkflowModelSnapshot(
  context: ReturnType<SqliteNovelRepository['getGenerationContext']>,
  purpose: 'scene-plan' | 'chapter-draft',
  workflowRunId: string,
  workflowNodeRunId: string,
): Record<string, unknown> {
  if (!context.styleProfile) throw new Error('Test project must have an active writing style profile.')
  return {
    purpose,
    projectId: context.project.id,
    projectRevision: context.project.revision,
    chapterId: context.chapter.id,
    chapterRevision: context.chapter.revision,
    inputManuscriptVersionId: context.inputManuscriptVersionId,
    promptAssetVersionId: context.promptVersion.id,
    promptContentHash: context.promptVersion.contentHash,
    projectRulesRevision: context.rules.revision,
    foundationVersionIds: context.foundationVersions.map(version => version.id),
    foundationAssemblyHash: context.foundationAssemblyHash,
    styleProfile: { revision: context.styleProfile.revision },
    workflowGuard: { workflowRunId, workflowNodeRunId },
  }
}

async function seedLegacyLengthFailure(
  repository: SqliteNovelRepository,
  engine: WorkflowEngine,
  chapterId: string,
  input: { code: string; manuscript?: string; outputJson?: string | null; workflowId?: string },
): Promise<{ workflowId: string; nodeRunId: string; modelRunId: string }> {
  const preparedWorkflow = await engine.resume(input.workflowId ? repository.getWorkflowRun(input.workflowId) : repository.startChapterWorkflow(chapterId), 'validate_scene_plan')
  const preparedNode = repository.prepareWorkflowNode(preparedWorkflow.id, 'generate_draft', {})
  const context = repository.getGenerationContext(chapterId, 'chapter-draft')
  const modelRun = repository.startModelRun(context, { provider: 'workflow-test', model: 'legacy-length-v1' }, JSON.stringify({
    projectId: context.project.id,
    projectRevision: context.project.revision,
    chapterId: context.chapter.id,
    chapterRevision: context.chapter.revision,
    inputManuscriptVersionId: context.inputManuscriptVersionId,
    foundationAssemblyHash: context.foundationAssemblyHash,
    styleProfile: context.styleProfile ? { revision: context.styleProfile.revision } : null,
    effectiveTargetWords: 2_400,
    workflowGuard: { workflowRunId: preparedWorkflow.id, workflowNodeRunId: preparedNode.nodeRunId },
  }))
  const manuscript = input.manuscript ?? WORKFLOW_MANUSCRIPT
  if (manuscript) repository.updateModelRunStream(modelRun.id, manuscript)
  const failure = Object.assign(new Error(`legacy failure: ${input.code}`), {
    code: input.code,
    targetWords: 2_400,
    actualWords: manuscript.length,
    partialResponse: {
      usage: { inputTokens: 111, outputTokens: 222, cacheReadTokens: 0 },
      telemetry: { firstVisibleTokenAt: null, lastVisibleTokenAt: null, visibleCharacters: manuscript.length, estimatedOutputTokens: 222, estimatedTokensPerSecond: null, finalOutputTokens: 222, finalReasoningTokens: null, decodeSeconds: null, finalTokensPerSecond: null },
    },
  })
  repository.failModelRun(modelRun.id, failure)
  if (input.outputJson !== undefined) {
    const database = new DatabaseSync(repository.databasePath)
    try { database.prepare('UPDATE model_runs SET output_json=? WHERE id=?').run(input.outputJson, modelRun.id) }
    finally { database.close() }
  }
  repository.failWorkflowNode(preparedWorkflow.id, preparedNode.nodeRunId, failure, true)
  return { workflowId: preparedWorkflow.id, nodeRunId: preparedNode.nodeRunId, modelRunId: modelRun.id }
}

function dispatchSelectedBatchWorkflow(repository: SqliteNovelRepository, projectId: string, chapterId: string, automationMode: AutomationMode) {
  const projectRevision = () => repository.getProjectTree(projectId).project.revision
  const created = repository.createChapterBatch(projectId, {
    mode: 'selected', automationMode, chapterIds: [chapterId], count: 1,
  }, { provider: 'workflow-test', model: 'batch-planner' }, projectRevision())
  const planned = repository.completeChapterBatchPlan(created.id, [{
    chapterId, plannedTitle: '批次关系安全门', writingGoal: '验证关系歧义不会被有界 YOLO 跳过',
    openingContinuity: '承接当前 Canon', endingHook: '保留待核对关系', targetWords: 2_400,
  }], { promptHash: 'relationship-safety-plan', outputJson: '{"items":1}' })
  const approved = repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
    id: item.id, plannedTitle: item.plannedTitle, writingGoal: item.writingGoal,
    openingContinuity: item.openingContinuity, endingHook: item.endingHook, targetWords: item.targetWords,
  })), projectRevision())
  repository.setChapterBatchStatus(approved.id, 'start', projectRevision())
  const dispatched = repository.dispatchNextBatchItem(approved.id)
  if (!dispatched.workflow) throw new Error('Expected the batch to dispatch a workflow.')
  return { batchId: approved.id, workflow: dispatched.workflow }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Phase 3 persistent workflow and approval', () => {
  it('retargets a pending approval when the author saves a newer draft and can approve that version', async () => {
    const { repository, chapter, engine } = setup()
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    const approvalId = waiting.approval!.id
    const originalVersionId = waiting.approval!.manuscriptVersionId
    const beforeEdit = repository.getChapter(chapter.id)

    const saved = repository.saveDraft(chapter.id, {
      content: `${WORKFLOW_MANUSCRIPT}\n\n作者补写了结尾，并确认这一版进入审批。`,
      baseRevision: beforeEdit.revision,
    })
    const savedVersionId = saved.currentDraftVersionId!
    expect(savedVersionId).not.toBe(originalVersionId)
    expect(saved.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: originalVersionId }),
      expect.objectContaining({ id: savedVersionId, parentVersionId: originalVersionId }),
    ]))

    const retargeted = repository.getWorkflowRun(waiting.id)
    expect(retargeted).toMatchObject({
      status: 'waiting_approval',
      approval: { id: approvalId, status: 'pending', manuscriptVersionId: savedVersionId },
    })
    expect(JSON.parse(retargeted.nodes.find(node => node.nodeKey === 'wait_chapter_approval' && node.status === 'waiting_approval')!.outputJson!))
      .toEqual({ manuscriptVersionId: savedVersionId })
    expect(retargeted.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'workflow.approval.draft_retargeted',
        payloadJson: JSON.stringify({ chapterId: chapter.id, previousManuscriptVersionId: originalVersionId, manuscriptVersionId: savedVersionId }),
      }),
    ]))

    const completed = await engine.decide(waiting.id, 'approved', '批准作者保存的新版本')
    expect(completed).toMatchObject({ status: 'succeeded', approvedVersionId: savedVersionId })
    expect(repository.getChapter(chapter.id)).toMatchObject({ currentApprovedVersionId: savedVersionId })
    expect(repository.getChapter(chapter.id).versions.some(version => version.id === originalVersionId)).toBe(true)
    repository.close()
  })

  it('resumes after restart without rerunning successful nodes and commits Canon only after approval', async () => {
    const { root, repository, project, chapter, engine } = setup()
    const started = repository.startChapterWorkflow(chapter.id)
    const interrupted = await engine.resume(started, 'validate_scene_plan')
    expect(interrupted.currentNodeKey).toBe('generate_draft')
    expect(interrupted.nodes.filter(node => node.status === 'succeeded')).toHaveLength(4)
    repository.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    const resumedEngine = new WorkflowEngine(reopened, new GenerationService(reopened, createGateway()))
    const waiting = await resumedEngine.resume(started.id)
    expect(waiting.status).toBe('waiting_approval')
    expect(waiting.nodes.filter(node => node.nodeKey === 'freeze_input_snapshot')).toHaveLength(1)
    expect(waiting.nodes.filter(node => node.nodeKey === 'plan_scenes')).toHaveLength(1)
    expect(waiting.canonFacts).toHaveLength(0)

    const rejectedVersionId = waiting.approval!.manuscriptVersionId
    const rejected = await resumedEngine.decide(waiting.id, 'rejected', '加强铜牌与失踪案的联系。')
    expect(rejected.status).toBe('waiting_approval')
    expect(rejected.approval!.manuscriptVersionId).not.toBe(rejectedVersionId)
    const chapterAfterReject = reopened.getChapter(chapter.id)
    const revision = chapterAfterReject.versions.find(version => version.id === rejected.approval!.manuscriptVersionId)!
    expect(revision.parentVersionId).toBe(rejectedVersionId)
    expect(chapterAfterReject.versions.find(version => version.id === rejectedVersionId)).toBeDefined()
    expect(rejected.canonFacts).toHaveLength(0)

    const completed = await resumedEngine.decide(rejected.id, 'approved', '通过')
    expect(completed.status).toBe('succeeded')
    expect(completed.canonCandidates).toHaveLength(1)
    expect(completed.canonCandidates[0]?.status).toBe('committed')
    expect(completed.canonFacts).toHaveLength(1)
    expect(reopened.getChapter(chapter.id).currentApprovedVersionId).toBe(revision.id)
    const knowledge = reopened.getKnowledgeWorkspace(project.project.id)
    expect(knowledge.entities.some(entity => entity.type === 'item' && entity.name === '刻有日期的铜牌' && entity.aliases.includes('铜牌'))).toBe(true)
    expect(knowledge.foreshadowing).toEqual(expect.arrayContaining([expect.objectContaining({ title: '刻有日期的铜牌', status: 'planted' })]))
    expect(knowledge.summaries.map(summary => summary.scope)).toEqual(expect.arrayContaining(['foundation','chapter','arc','volume','book','project']))
    expect(knowledge.summaries.find(summary => summary.scope === 'project')?.compactNarrative).toContain('copper token')
    reopened.close()
  })

  it.each(['auto', 'yolo'] as const)('skips unsupported Canon evidence without blocking %s batch post-processing', async automationMode => {
    const { repository, project, chapter, engine } = setup(createCanonEvidenceGateway('这段证据并不存在于批准正文中'))
    repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
    const { batchId, workflow } = dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, automationMode)
    const waiting = await engine.resume(workflow.id)

    const completed = await engine.decide(waiting.id, 'approved', automationMode === 'yolo' ? '有界 YOLO 自动批准' : '作者批准 AUTO 批次章节')

    expect(completed).toMatchObject({ status: 'succeeded', currentNodeKey: null })
    expect(completed.canonCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'rejected', manuscriptVersionId: completed.approvedVersionId, subject: '测试事实' }),
      expect.objectContaining({ status: 'committed', manuscriptVersionId: completed.approvedVersionId, predicate: 'chapter.approved_content' }),
    ]))
    expect(completed.canonFacts).toEqual([
      expect.objectContaining({ predicate: 'chapter.approved_content', sourceManuscriptVersionId: completed.approvedVersionId }),
    ])
    expect(completed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'workflow.canon.candidates.validated', payloadJson: expect.stringContaining('无法在当前批准正文中唯一定位') }),
    ]))
    expect(completed.nodes.find(node => node.nodeKey === 'validate_canon_candidates')).toMatchObject({ status: 'succeeded' })
    expect(completed.nodes.find(node => node.nodeKey === 'commit_canon')).toMatchObject({ status: 'succeeded' })
    expect(completed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')).toMatchObject({ status: 'succeeded' })
    expect(repository.getKnowledgeWorkspace(project.project.id).summaries.length).toBeGreaterThan(0)
    expect(repository.listRelationshipExtractionRuns(project.project.id)).toEqual([expect.objectContaining({ status: 'succeeded' })])
    expect(repository.reconcileChapterBatch(workflow.id)).toMatchObject({ id: batchId, status: 'succeeded' })
    repository.close()
  })

  it('rejects a non-unique Canon excerpt and continues with approved-version metadata', async () => {
    const duplicateExcerpt = '潮声沿着封锁线反复拍岸'
    const { repository, chapter, engine } = setup(createCanonEvidenceGateway(duplicateExcerpt))
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))

    const completed = await engine.decide(waiting.id, 'approved', '通过')

    expect(completed.status).toBe('succeeded')
    expect(completed.canonCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: '测试事实', status: 'rejected' }),
      expect.objectContaining({ predicate: 'chapter.approved_content', status: 'committed' }),
    ]))
    expect(completed.canonFacts).toEqual([expect.objectContaining({ predicate: 'chapter.approved_content' })])
    expect(completed.events.find(event => event.type === 'workflow.canon.candidates.validated')?.payloadJson).toContain('无法在当前批准正文中唯一定位')
    repository.close()
  })

  it('commits evidenced Canon candidates while rejecting only invalid siblings', async () => {
    const gateway = createCanonCandidatesGateway([{
      kind: 'fact', subject: '铜牌', predicate: 'was_found_at', value: '旧码头',
      entityType: 'item', aliases: [], storyOrder: 1000, foreshadowStatus: null,
      evidenceExcerpt: WORKFLOW_EVIDENCE_EXCERPT,
    }, {
      kind: 'fact', subject: '伪事实', predicate: 'unsupported', value: '不存在',
      entityType: 'concept', aliases: [], storyOrder: 1000, foreshadowStatus: null,
      evidenceExcerpt: '正文中没有这段伪证据',
    }])
    const { repository, chapter, engine } = setup(gateway)
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))

    const completed = await engine.decide(waiting.id, 'approved', '通过有证据的事实')

    expect(completed.status).toBe('succeeded')
    expect(completed.canonCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: '铜牌', status: 'committed' }),
      expect.objectContaining({ subject: '伪事实', status: 'rejected' }),
    ]))
    expect(completed.canonCandidates.some(candidate => candidate.predicate === 'chapter.approved_content')).toBe(false)
    expect(completed.canonFacts).toEqual([expect.objectContaining({ subject: '铜牌', predicate: 'was_found_at' })])
    const committedValue = JSON.parse(completed.canonFacts[0]!.valueJson) as Record<string, unknown>
    expect(committedValue).toMatchObject({
      evidenceExcerpt: WORKFLOW_EVIDENCE_EXCERPT,
      evidence: { sourceVersionId: completed.approvedVersionId, verification: 'unique-exact-excerpt' },
    })
    expect(completed.events.find(event => event.type === 'workflow.canon.candidates.validated')?.payloadJson).toContain('伪事实')
    repository.close()
  })

  it('rechecks persisted Canon evidence immediately before commit', async () => {
    const { root, repository, chapter, engine } = setup()
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    const approved = repository.decideWorkflowApproval(waiting.id, 'approved', '通过')
    const validated = await engine.resume(approved, 'validate_canon_candidates')
    expect(validated.currentNodeKey).toBe('commit_canon')
    const evidencedValue = JSON.parse(validated.canonCandidates[0]!.valueJson) as Record<string, unknown>
    expect(evidencedValue).toMatchObject({
      evidenceExcerpt: WORKFLOW_EVIDENCE_EXCERPT,
      evidence: { sourceVersionId: validated.approvedVersionId, verification: 'unique-exact-excerpt' },
    })

    const tamper = new DatabaseSync(repository.databasePath)
    try {
      tamper.exec('PRAGMA busy_timeout = 5000')
      tamper.prepare('UPDATE canon_candidates SET value_json=? WHERE id=?').run(JSON.stringify({
        ...evidencedValue,
        evidenceExcerpt: '提交前被替换成正文中不存在的伪证据',
      }), validated.canonCandidates[0]!.id)
    } finally {
      tamper.close()
    }

    const completed = await engine.resume(validated.id)
    expect(completed.status).toBe('succeeded')
    expect(completed.canonCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: validated.canonCandidates[0]!.id, status: 'rejected' }),
      expect.objectContaining({ predicate: 'chapter.approved_content', status: 'committed' }),
    ]))
    expect(completed.canonFacts).toEqual([expect.objectContaining({ predicate: 'chapter.approved_content' })])
    expect(completed.events.find(event => event.type === 'workflow.canon.committed')?.payloadJson).toContain('无法在当前批准正文中唯一定位')
    expect(completed.nodes.find(node => node.nodeKey === 'commit_canon')).toMatchObject({ status: 'succeeded' })
    expect(completed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')).toMatchObject({ status: 'succeeded' })
    repository.close()
  })

  it('supports pause, resume, cancellation and retryable failure', async () => {
    const fallback = createGateway()
    let remainingDraftFailures = 2
    const gateway: ModelGateway = {
      selection: fallback.selection,
      providers: fallback.providers,
      async generate(request) {
        if (request.prompt.includes('任务：根据场景计划生成章节初稿') && remainingDraftFailures-- > 0) throw new Error('temporary model outage')
        return fallback.generate(request)
      },
    }
    const { repository, chapter, engine } = setup(gateway)
    const started = repository.startChapterWorkflow(chapter.id)
    const paused = engine.pause(started.id)
    expect(paused.status).toBe('paused')
    await expect(engine.resume(paused.id)).rejects.toThrow('temporary model outage')
    const failed = repository.getWorkflowRun(paused.id)
    expect(failed.status).toBe('failed')
    expect(failed.nodes.find(node => node.nodeKey === 'plan_scenes')?.status).toBe('succeeded')
    expect(failed.nodes.find(node => node.nodeKey === 'generate_draft')?.status).toBe('failed_retryable')
    const waiting = await engine.retry(failed.id)
    expect(waiting.status).toBe('waiting_approval')
    expect(engine.cancel(waiting.id).status).toBe('cancelled')

    const other = repository.createChapter(repository.getChapter(chapter.id).projectId, '取消章')
    const cancellable = repository.startChapterWorkflow(other.id)
    expect(engine.cancel(cancellable.id).status).toBe('cancelled')
    repository.close()
  })

  it('downgrades a malformed scene plan to a local minimum plan and keeps writing', async () => {
    const fallback = createGateway()
    let invalidScenePlan = true
    const gateway: ModelGateway = {
      selection: fallback.selection,
      providers: fallback.providers,
      async generate(request) {
        if (invalidScenePlan && request.prompt.includes('任务：')) {
          invalidScenePlan = false
          return { text: '{"scenes":"not-an-array"}' }
        }
        return fallback.generate(request)
      },
    }
    const { repository, chapter, engine } = setup(gateway)
    const started = repository.startChapterWorkflow(chapter.id)
    const waiting = await engine.resume(started)
    expect(waiting).toMatchObject({ status: 'waiting_approval', currentNodeKey: 'wait_chapter_approval' })
    const planNode = waiting.nodes.find(node => node.nodeKey === 'plan_scenes')!
    expect(planNode.status).toBe('succeeded')
    expect(JSON.parse(planNode.outputJson!)).toMatchObject({ generationAdvisory: { kind: 'local-scene-plan-fallback' } })
    repository.close()
  })

  it('retries a failed batch draft without regenerating its successful scene plan', async () => {
    const fallback = createGateway()
    let scenePlanCalls = 0
    let draftCalls = 0
    const draftBudgets: number[] = []
    let remainingDraftFailures = 2
    const gateway: ModelGateway = {
      selection: fallback.selection,
      providers: fallback.providers,
      async generate(request) {
        if (request.prompt.includes('任务：根据场景计划生成章节初稿')) {
          draftCalls++
          draftBudgets.push(request.maxTokens)
          if (remainingDraftFailures-- > 0) throw new Error('temporary draft outage')
        } else scenePlanCalls++
        return fallback.generate(request)
      },
    }
    const { repository, project, chapter, engine } = setup(gateway)
    const { batchId, workflow } = dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, 'auto')

    await expect(engine.resume(workflow.id)).rejects.toThrow('temporary draft outage')
    const failed = repository.getWorkflowRun(workflow.id)
    const scenePlanNode = failed.nodes.find(node => node.nodeKey === 'plan_scenes')!
    const draftNode = failed.nodes.find(node => node.nodeKey === 'generate_draft')!
    expect(failed).toMatchObject({ status: 'failed', currentNodeKey: 'generate_draft', revisionRound: 0 })
    expect(scenePlanNode.status).toBe('succeeded')
    expect(draftNode.status).toBe('failed_retryable')
    const persistedPlan = repository.getGenerationContext(chapter.id, 'chapter-draft').latestScenePlan!
    const plannedScenes = (JSON.parse(persistedPlan.contentJson) as { scenes: Array<{ estimatedWords: number }> }).scenes
    expect(plannedScenes.reduce((total, scene) => total + scene.estimatedWords, 0)).toBe(2_400)
    expect(repository.reconcileChapterBatch(workflow.id)).toMatchObject({ status: 'blocked' })

    const blocked = repository.getChapterBatch(batchId)
    const retried = repository.retryChapterBatchItem(
      batchId,
      blocked.items[0]!.id,
      repository.getProjectTree(project.project.id).project.revision,
    ).workflow!
    expect(retried).toMatchObject({ revisionRound: 0, currentNodeKey: 'generate_draft', status: 'running' })
    const waiting = await engine.resume(retried)

    expect(waiting.status).toBe('waiting_approval')
    expect(scenePlanCalls).toBe(1)
    expect(draftCalls).toBe(3)
    expect(draftBudgets).toEqual([8_000, 8_000, 8_000])
    expect(waiting.nodes.filter(node => node.nodeKey === 'plan_scenes').map(node => node.id)).toEqual([scenePlanNode.id])
    expect(waiting.nodes.filter(node => node.nodeKey === 'generate_draft')).toEqual([
      expect.objectContaining({ id: draftNode.id, status: 'succeeded', attempt: 2 }),
    ])
    const retriedDraftNode = waiting.nodes.find(node => node.nodeKey === 'generate_draft')!
    expect(JSON.parse(retriedDraftNode.outputJson!)).toMatchObject({
      lengthAdvisory: { kind: 'shorter-than-target', targetWords: 2_400, actualWords: expect.any(Number) },
    })
    expect(repository.getChapter(chapter.id).versions).toEqual([
      expect.objectContaining({ modelRunId: expect.any(String), wordCount: expect.any(Number) }),
    ])
    engine.cancel(waiting.id)
    repository.close()
  })

  it('recovers a stream-only legacy length rejection without calling the model again', async () => {
    const prepared = setup()
    const legacy = await seedLegacyLengthFailure(prepared.repository, prepared.engine, prepared.chapter.id, {
      code: 'chapter-draft-too-long', manuscript: WORKFLOW_MANUSCRIPT,
    })
    let gatewayCalls = 0
    const noDuplicateGateway: ModelGateway = {
      selection: () => ({ provider: 'workflow-test', model: 'must-not-run' }),
      providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
      async generate() { gatewayCalls++; throw new Error('legacy recovery must not call the model') },
    }
    const recovered = await new WorkflowEngine(prepared.repository, new GenerationService(prepared.repository, noDuplicateGateway)).retry(legacy.workflowId)

    expect(gatewayCalls).toBe(0)
    expect(recovered).toMatchObject({ status: 'waiting_approval', currentNodeKey: 'wait_chapter_approval' })
    expect(recovered.nodes.find(node => node.id === legacy.nodeRunId)).toMatchObject({ status: 'succeeded', attempt: 2 })
    expect(JSON.parse(recovered.nodes.find(node => node.id === legacy.nodeRunId)!.outputJson!)).toMatchObject({
      modelRunId: legacy.modelRunId,
      legacyRecovery: { source: 'streamed-text', originalErrorCode: 'chapter-draft-too-long' },
    })
    const chapter = prepared.repository.getChapter(prepared.chapter.id)
    expect(chapter.versions).toEqual([expect.objectContaining({
      content: WORKFLOW_MANUSCRIPT, modelRunId: legacy.modelRunId, workflowRunId: legacy.workflowId, workflowNodeRunId: legacy.nodeRunId,
    })])
    const persistedRun = prepared.repository.listModelRuns(prepared.chapter.id).find(run => run.id === legacy.modelRunId)!
    expect(persistedRun).toMatchObject({ status: 'succeeded', usageJson: expect.stringContaining('222') })
    expect(JSON.parse(persistedRun.outputJson!)).toMatchObject({
      manuscript: WORKFLOW_MANUSCRIPT,
      canonCandidates: [],
      _novelStudioLegacyRecovery: {
        recovered: true, source: 'streamed-text', originalErrorCode: 'chapter-draft-too-long', canonCandidatesDiscarded: true,
      },
      _novelStudioLengthAdvisory: expect.objectContaining({ targetWords: 2_400, actualWords: expect.any(Number) }),
    })
    expect(recovered.events.some(event => event.type === 'workflow.legacy_draft.recovered')).toBe(true)
    prepared.repository.close()
  })

  it.each(['chapter-draft-too-long', 'chapter-draft-too-short'])('recovers %s through the batch-item retry entry without creating control-plane revision drift', async code => {
    const prepared = setup()
    const { batchId, workflow } = dispatchSelectedBatchWorkflow(prepared.repository, prepared.project.project.id, prepared.chapter.id, 'auto')
    const legacy = await seedLegacyLengthFailure(prepared.repository, prepared.engine, prepared.chapter.id, {
      code,
      manuscript: WORKFLOW_MANUSCRIPT,
      workflowId: workflow.id,
    })
    expect(prepared.repository.reconcileChapterBatch(workflow.id)).toMatchObject({ status: 'blocked' })
    const blocked = prepared.repository.getChapterBatch(batchId)
    const projectRevisionBeforeRetry = prepared.repository.getProjectTree(prepared.project.project.id).project.revision
    let gatewayCalls = 0
    const noDuplicateGateway: ModelGateway = {
      selection: () => ({ provider: 'workflow-test', model: 'must-not-run' }),
      providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
      async generate() { gatewayCalls++; throw new Error('batch legacy recovery must not call the model') },
    }

    const retried = prepared.repository.retryChapterBatchItem(batchId, blocked.items[0]!.id, projectRevisionBeforeRetry).workflow!
    expect(prepared.repository.getProjectTree(prepared.project.project.id).project.revision).toBe(projectRevisionBeforeRetry)
    const recovered = await new WorkflowEngine(prepared.repository, new GenerationService(prepared.repository, noDuplicateGateway)).resume(retried)

    expect(gatewayCalls).toBe(0)
    expect(recovered).toMatchObject({ status: 'waiting_approval', currentNodeKey: 'wait_chapter_approval' })
    expect(recovered.events.some(event => event.type === 'workflow.legacy_draft.recovered')).toBe(true)
    expect(recovered.events.some(event => event.type === 'workflow.retry.requested' && JSON.parse(event.payloadJson).preservedLegacyRecoveryRevision === true)).toBe(true)
    expect(prepared.repository.getChapter(prepared.chapter.id).versions).toEqual([expect.objectContaining({
      content: WORKFLOW_MANUSCRIPT,
      modelRunId: legacy.modelRunId,
      workflowRunId: workflow.id,
    })])
    expect(prepared.repository.listModelRuns(prepared.chapter.id).filter(run => run.purpose === 'chapter-draft')).toHaveLength(1)
    prepared.repository.close()
  })

  it.each([
    ['non-legacy failure', 'temporary-network-error'],
    ['malformed output failure', 'invalid-state'],
    ['provider output limit', 'model-output-limit'],
  ])('does not recover %s from streamed text', async (_label, code) => {
    const prepared = setup()
    const legacy = await seedLegacyLengthFailure(prepared.repository, prepared.engine, prepared.chapter.id, { code, manuscript: WORKFLOW_MANUSCRIPT })
    let gatewayCalls = 0
    const fallback = createGateway()
    const retryGateway: ModelGateway = {
      ...fallback,
      async generate(request) { gatewayCalls++; return fallback.generate(request) },
    }
    const retried = await new WorkflowEngine(prepared.repository, new GenerationService(prepared.repository, retryGateway)).retry(legacy.workflowId)

    expect(gatewayCalls).toBe(1)
    expect(retried.status).toBe('waiting_approval')
    expect(prepared.repository.listModelRuns(prepared.chapter.id).find(run => run.id === legacy.modelRunId)?.status).toBe('failed')
    expect(prepared.repository.getChapter(prepared.chapter.id).versions).toHaveLength(1)
    prepared.repository.close()
  })

  it('refuses legacy length recovery after project or chapter revision drift', async () => {
    const prepared = setup()
    const legacy = await seedLegacyLengthFailure(prepared.repository, prepared.engine, prepared.chapter.id, {
      code: 'chapter-draft-too-short', manuscript: WORKFLOW_MANUSCRIPT,
    })
    const beforeEdit = prepared.repository.getChapter(prepared.chapter.id)
    prepared.repository.saveDraft(prepared.chapter.id, { content: '作者在失败后保存的新正文。', baseRevision: beforeEdit.revision })
    let gatewayCalls = 0
    const fallback = createGateway()
    const retryGateway: ModelGateway = {
      ...fallback,
      async generate(request) { gatewayCalls++; return fallback.generate(request) },
    }

    await expect(new WorkflowEngine(prepared.repository, new GenerationService(prepared.repository, retryGateway)).retry(legacy.workflowId)).rejects.toThrow(/发生变化|最新输入|最新正文/)
    expect(gatewayCalls).toBe(0)
    expect(prepared.repository.listModelRuns(prepared.chapter.id).find(run => run.id === legacy.modelRunId)?.status).toBe('failed')
    expect(prepared.repository.getChapter(prepared.chapter.id).versions).toEqual([
      expect.objectContaining({ origin: 'user', content: '作者在失败后保存的新正文。' }),
    ])
    prepared.repository.close()
  })

  it('refuses legacy length recovery when the live writing style changed without a project revision bump', async () => {
    const prepared = setup()
    const legacy = await seedLegacyLengthFailure(prepared.repository, prepared.engine, prepared.chapter.id, {
      code: 'chapter-draft-too-long', manuscript: WORKFLOW_MANUSCRIPT,
    })
    const retried = prepared.repository.retryWorkflow(legacy.workflowId)
    const runningNode = prepared.repository.prepareWorkflowNode(retried.id, 'generate_draft', {})
    const style = prepared.repository.getProjectStyleProfile(prepared.project.project.id)
    prepared.repository.setProjectStylePreset(prepared.project.project.id, 'suspense-cinematic', style.revision)

    expect(() => prepared.repository.tryRecoverLegacyLengthRejectedDraft(retried.id, runningNode.nodeRunId)).toThrow(/文风.*变化/)
    expect(prepared.repository.getChapter(prepared.chapter.id).versions).toHaveLength(0)
    expect(prepared.repository.listModelRuns(prepared.chapter.id).find(run => run.id === legacy.modelRunId)).toMatchObject({ status: 'failed' })
    prepared.repository.close()
  })

  it('refuses an idempotent legacy recovery continuation after its recovered draft pointer changed', async () => {
    const prepared = setup()
    const legacy = await seedLegacyLengthFailure(prepared.repository, prepared.engine, prepared.chapter.id, {
      code: 'chapter-draft-too-short', manuscript: WORKFLOW_MANUSCRIPT,
    })
    const retried = prepared.repository.retryWorkflow(legacy.workflowId)
    const runningNode = prepared.repository.prepareWorkflowNode(retried.id, 'generate_draft', {})
    const firstRecovery = prepared.repository.tryRecoverLegacyLengthRejectedDraft(retried.id, runningNode.nodeRunId)
    expect(firstRecovery).toMatchObject({ modelRunId: legacy.modelRunId, manuscriptVersionId: expect.any(String) })

    const recoveredChapter = prepared.repository.getChapter(prepared.chapter.id)
    prepared.repository.saveDraft(prepared.chapter.id, {
      content: '作者在恢复写入后又保存了新的正文，恢复续接不得覆盖它。',
      baseRevision: recoveredChapter.revision,
    })

    expect(() => prepared.repository.tryRecoverLegacyLengthRejectedDraft(retried.id, runningNode.nodeRunId)).toThrow(/发生变化|旧输出未恢复/)
    expect(prepared.repository.getChapter(prepared.chapter.id).versions).toHaveLength(2)
    expect(prepared.repository.listModelRuns(prepared.chapter.id).filter(run => run.id === legacy.modelRunId)).toEqual([
      expect.objectContaining({ status: 'succeeded' }),
    ])
    prepared.repository.close()
  })

  it('rejects a late model result after cancellation without writing or advancing', async () => {
    let release!: (text: string) => void
    let startedGeneration!: () => void
    const began = new Promise<void>(resolve => { startedGeneration = resolve })
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'workflow-test', model: 'deferred-v1' }),
      providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
      async generate() {
        startedGeneration()
        return { text: await new Promise<string>(resolve => { release = resolve }) }
      },
    }
    const { repository, chapter, engine } = setup(gateway)
    const started = repository.startChapterWorkflow(chapter.id)
    await engine.resume(started, 'retrieve_context')
    const advancing = engine.advance(started.id)
    await began
    expect(engine.cancel(started.id)).toMatchObject({ status: 'cancelled', currentNodeKey: null })
    release(JSON.stringify({ chapterGoal: '迟到规划', scenes: [{ scenePurpose: '不应落库' }], risks: [] }))
    await expect(advancing).rejects.toThrow(/迟到|cannot accept|不再运行|暂停、取消/)

    const cancelled = repository.getWorkflowRun(started.id)
    expect(cancelled).toMatchObject({ status: 'cancelled', currentNodeKey: null })
    expect(cancelled.nodes.find(node => node.nodeKey === 'plan_scenes')).toMatchObject({ status: 'cancelled' })
    expect(repository.listModelRuns(chapter.id)).toEqual([expect.objectContaining({ status: 'failed' })])
    expect(repository.getGenerationContext(chapter.id, 'scene-plan').latestScenePlan).toBeNull()
    repository.close()
  })

  it('refreshes a drifted input snapshot before retrying generation', async () => {
    const { repository, chapter, engine } = setup()
    const started = repository.startChapterWorkflow(chapter.id)
    await engine.resume(started, 'retrieve_context')
    const changed = repository.saveDraft(chapter.id, { content: '作者在生成前补充了新的开场正文。', baseRevision: repository.getChapter(chapter.id).revision })

    await expect(engine.advance(started.id)).rejects.toThrow(/改变|变化|最新输入/)
    const failed = repository.getWorkflowRun(started.id)
    expect(failed).toMatchObject({ status: 'failed', errorJson: expect.stringContaining('revision-conflict') })
    const retried = await engine.retry(started.id)
    expect(retried.status).toBe('waiting_approval')
    expect(retried.revisionRound).toBe(1)
    const snapshot = JSON.parse(retried.inputSnapshotJson) as Record<string, unknown>
    expect(snapshot).toMatchObject({
      projectRevision: changed.projectId ? repository.getProjectTree(changed.projectId).project.revision - 1 : expect.any(Number),
      chapterRevision: changed.revision,
      inputManuscriptVersionId: changed.currentDraftVersionId,
    })
    expect(retried.nodes.filter(node => node.nodeKey === 'freeze_input_snapshot')).toHaveLength(2)
    repository.close()
  })

  it('fails orphaned running model runs on restart and resumes the durable workflow node', async () => {
    const { root, repository, chapter, engine } = setup()
    const started = repository.startChapterWorkflow(chapter.id)
    await engine.resume(started, 'retrieve_context')
    const prepared = repository.prepareWorkflowNode(started.id, 'plan_scenes', {})
    const context = repository.getGenerationContext(chapter.id, 'scene-plan')
    const orphan = repository.startModelRun(context, { provider: 'workflow-test', model: 'orphan-v1' }, JSON.stringify({
      workflowGuard: { workflowRunId: started.id, workflowNodeRunId: prepared.nodeRunId },
    }))
    repository.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    expect(reopened.listRecoverableWorkflows().map(run => run.id)).toContain(started.id)
    expect(reopened.listModelRuns(chapter.id).find(run => run.id === orphan.id)).toMatchObject({ status: 'failed', errorJson: expect.stringContaining('host-restart-interrupted') })
    const resumed = await new WorkflowEngine(reopened, new GenerationService(reopened, createGateway())).resume(started.id)
    expect(resumed.status).toBe('waiting_approval')
    expect(reopened.listModelRuns(chapter.id).filter(run => run.purpose === 'scene-plan')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: orphan.id, status: 'failed' }),
      expect.objectContaining({ status: 'succeeded' }),
    ]))
    reopened.close()
  })

  it('finalizes the legacy crash residue where the final node succeeded before the Workflow status update', async () => {
    const { root, repository, chapter, engine } = setup()
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    const completed = await engine.decide(waiting.id, 'approved', '通过')
    const databasePath = repository.databasePath
    const finalNode = completed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')!
    repository.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec('BEGIN IMMEDIATE')
    try {
      legacy.prepare("UPDATE workflow_runs SET status='running',current_node_key=NULL,finished_at=NULL WHERE id=?").run(completed.id)
      legacy.prepare("DELETE FROM workflow_events WHERE workflow_run_id=? AND event_type='workflow.succeeded'").run(completed.id)
      legacy.exec('COMMIT')
    } catch (cause) {
      legacy.exec('ROLLBACK')
      throw cause
    } finally {
      legacy.close()
    }

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    expect(reopened.listRecoverableWorkflows().map(run => run.id)).not.toContain(completed.id)
    expect(reopened.listRecoverableWorkflows().map(run => run.id)).not.toContain(completed.id)
    const repaired = reopened.getWorkflowRun(completed.id)
    expect(repaired).toMatchObject({ status: 'succeeded', currentNodeKey: null })
    expect(repaired.nodes.find(node => node.id === finalNode.id)).toMatchObject({ status: 'succeeded' })
    expect(repaired.events.filter(event => event.type === 'workflow.succeeded')).toEqual([
      expect.objectContaining({ nodeRunId: finalNode.id, payloadJson: expect.stringContaining('host-recovery') }),
    ])
    reopened.close()
  })

  it('runs the same durable Canon, Memory and relationship chain after a manually authored version is approved', async () => {
    const { repository, project, chapter, engine } = setup()
    const drafted = repository.saveDraft(chapter.id, {
      content: '林舟亲手记下旧码头铜牌上的日期，并决定把它作为失踪案的新线索。',
      baseRevision: chapter.revision,
    })
    const approved = repository.approveVersionAndStartPostProcessing(chapter.id, drafted.currentDraftVersionId!, drafted.revision)

    expect(approved.chapter).toMatchObject({ status: 'approved', currentApprovedVersionId: drafted.currentDraftVersionId })
    expect(approved.workflow).toMatchObject({ status: 'running', currentNodeKey: 'extract_canon_candidates', approvedVersionId: drafted.currentDraftVersionId })
    const completed = await engine.resume(approved.workflow.id)

    expect(completed.status).toBe('succeeded')
    expect(completed.canonFacts).toHaveLength(1)
    expect(completed.events.some(event => event.type === 'workflow.manual_approval.post_processing_started')).toBe(true)
    const knowledge = repository.getKnowledgeWorkspace(project.project.id)
    expect(knowledge.summaries.map(summary => summary.scope)).toEqual(expect.arrayContaining(['foundation', 'chapter', 'arc', 'volume', 'book', 'project']))
    expect(knowledge.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ chapterId: chapter.id, status: 'canon' })]))
    repository.close()
  })

  it('keeps archived and prompt-excluded derived summaries out of memory refresh, retrieval, and rendered prompts', async () => {
    const { root, repository, project, chapter, engine } = setup()
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    await engine.decide(waiting.id, 'approved', '建立可归档的派生摘要')

    const summaries = repository.getKnowledgeWorkspace(project.project.id).summaries
    const projectSummary = summaries.find(summary => summary.scope === 'project')!
    const bookSummary = summaries.find(summary => summary.scope === 'book')!
    const derived = repository.searchMemory(project.project.id, { origin: 'derived', limit: 100 }).items
    const archivedItem = derived.find(item => item.sourceKey === projectSummary.id)!
    const excludedItem = derived.find(item => item.sourceKey === bookSummary.id)!
    expect(archivedItem).toBeDefined()
    expect(excludedItem).toBeDefined()

    repository.setMemoryItemArchived(
      archivedItem.id,
      true,
      archivedItem.revision,
      repository.getProjectTree(project.project.id).project.revision,
    )
    repository.upsertKnowledgeSummary(project.project.id, {
      scope: projectSummary.scope,
      sourceId: projectSummary.sourceId,
      sourceVersionId: projectSummary.sourceVersionId,
      structuredJson: projectSummary.structuredJson,
      compactNarrative: 'ARCHIVED_DERIVED_SUMMARY must stay outside every prompt path.',
      sourceStartChapter: projectSummary.sourceStartChapter,
      sourceEndChapter: projectSummary.sourceEndChapter,
      sourceVersionIds: projectSummary.sourceVersionIds,
      provider: projectSummary.provider ?? 'workflow-test',
      model: projectSummary.model ?? 'deterministic-v1',
      promptHash: projectSummary.promptHash ?? 'test-prompt',
    })
    expect(repository.getMemoryItem(archivedItem.id).state).toBe('archived')
    repository.close()

    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    database.prepare("UPDATE memory_items SET prompt_policy='excluded' WHERE id=?").run(excludedItem.id)
    database.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    reopened.upsertKnowledgeSummary(project.project.id, {
      scope: bookSummary.scope,
      sourceId: bookSummary.sourceId,
      sourceVersionId: bookSummary.sourceVersionId,
      structuredJson: bookSummary.structuredJson,
      compactNarrative: 'EXCLUDED_DERIVED_SUMMARY must stay outside every prompt path.',
      sourceStartChapter: bookSummary.sourceStartChapter,
      sourceEndChapter: bookSummary.sourceEndChapter,
      sourceVersionIds: bookSummary.sourceVersionIds,
      provider: bookSummary.provider ?? 'workflow-test',
      model: bookSummary.model ?? 'deterministic-v1',
      promptHash: bookSummary.promptHash ?? 'test-prompt',
    })
    expect(reopened.getMemoryItem(excludedItem.id)).toMatchObject({ state: 'active', promptPolicy: 'excluded' })

    const currentChapter = reopened.getChapter(chapter.id)
    const revision = reopened.saveDraft(chapter.id, {
      content: '林舟改写本章，但不复述已归档或关闭的摘要内容。',
      baseRevision: currentChapter.revision,
    })
    const postProcessing = reopened.approveVersionAndStartPostProcessing(chapter.id, revision.currentDraftVersionId!, revision.revision)
    const refreshContext = reopened.getKnowledgeRefreshContext(postProcessing.workflow.id)
    expect(refreshContext.previousProject).toBeNull()
    expect(refreshContext.previousBook).toBeNull()
    reopened.setWorkflowStatus(postProcessing.workflow.id, 'cancel_requested')

    const nextChapter = reopened.createChapter(project.project.id, '下一章')
    const retrievalRun = reopened.startChapterWorkflow(nextChapter.id)
    const bundle = reopened.createRetrievalBundle(retrievalRun.id)
    expect(bundle.items.map(item => item.sourceId)).not.toContain(projectSummary.id)
    expect(bundle.items.map(item => item.sourceId)).not.toContain(bookSummary.id)
    expect(bundle.items.map(item => item.content).join('\n')).not.toContain('ARCHIVED_DERIVED_SUMMARY')
    expect(bundle.items.map(item => item.content).join('\n')).not.toContain('EXCLUDED_DERIVED_SUMMARY')

    const context = reopened.getGenerationContext(nextChapter.id, 'scene-plan')
    expect(context.longMemory.map(summary => summary.id)).not.toContain(projectSummary.id)
    expect(context.longMemory.map(summary => summary.id)).not.toContain(bookSummary.id)
    const rendered = renderBudgetedGenerationPrompt(context, {
      contextWindow: 32_000,
      contextWindowSource: 'provider',
      maxOutputTokens: 4_000,
      system: 'Novel Studio system prompt',
    })
    expect(rendered.prompt).not.toContain('ARCHIVED_DERIVED_SUMMARY')
    expect(rendered.prompt).not.toContain('EXCLUDED_DERIVED_SUMMARY')
    reopened.setWorkflowStatus(retrievalRun.id, 'cancel_requested')
    reopened.close()
  })

  it('keeps superseded approval artifacts as history while exposing only the current approval to knowledge and relationship prompts', async () => {
    const baseGateway = createGateway()
    const relationshipPrompts: string[] = []
    const gateway: ModelGateway = {
      selection: baseGateway.selection,
      providers: baseGateway.providers,
      async generate(request) {
        if (request.prompt.startsWith('任务：从本章批准正文')) relationshipPrompts.push(request.prompt)
        return baseGateway.generate(request)
      },
    }
    const { root, repository, project, chapter, engine } = setup(gateway)
    repository.setRelationshipMode(
      project.project.id,
      'auto',
      repository.getProjectTree(project.project.id).project.revision,
    )

    const firstDraft = repository.saveDraft(chapter.id, {
      content: '第一版批准正文保留旧版暗号旧鹭。',
      baseRevision: chapter.revision,
    })
    const firstPostProcessing = repository.approveVersionAndStartPostProcessing(chapter.id, firstDraft.currentDraftVersionId!, firstDraft.revision)
    await engine.resume(firstPostProcessing.workflow.id)

    const afterFirst = repository.getChapter(chapter.id)
    const secondDraft = repository.saveDraft(chapter.id, {
      content: '第二版批准正文改为新版暗号白鲸。',
      baseRevision: afterFirst.revision,
    })
    const secondPostProcessing = repository.approveVersionAndStartPostProcessing(chapter.id, secondDraft.currentDraftVersionId!, secondDraft.revision)
    await engine.resume(secondPostProcessing.workflow.id)

    const firstVersionId = firstDraft.currentDraftVersionId!
    const secondVersionId = secondDraft.currentDraftVersionId!
    const knowledge = repository.getKnowledgeWorkspace(project.project.id)
    expect(knowledge.canonFacts.map(fact => fact.sourceManuscriptVersionId)).toEqual([secondVersionId])
    expect(knowledge.timeline.map(event => event.sourceManuscriptVersionId)).toEqual([secondVersionId])
    expect(relationshipPrompts).toHaveLength(2)
    expect(relationshipPrompts.at(-1)).toContain('新版暗号白鲸')
    expect(relationshipPrompts.at(-1)).not.toContain('旧版暗号旧鹭')

    expect(repository.searchKnowledge(project.project.id, '旧鹭')).toEqual([])
    expect(repository.searchKnowledge(project.project.id, '白鲸')).toEqual(expect.arrayContaining([
      expect.objectContaining({ authority: 'current_project_approved', sourceVersionId: secondVersionId }),
    ]))
    repository.close()

    const history = new DatabaseSync(join(root, 'novel-studio.db'), { readOnly: true })
    expect(history.prepare('SELECT status FROM manuscript_versions WHERE id=?').get(firstVersionId)).toEqual({ status: 'superseded' })
    expect(history.prepare('SELECT COUNT(*) count FROM canon_facts WHERE source_manuscript_version_id=?').get(firstVersionId)).toEqual({ count: 1 })
    expect(history.prepare('SELECT COUNT(*) count FROM timeline_events WHERE source_manuscript_version_id=?').get(firstVersionId)).toEqual({ count: 1 })
    expect(history.prepare('SELECT COUNT(*) count FROM knowledge_fts WHERE source_version_id=?').get(firstVersionId)).toEqual({ count: 0 })
    history.close()
  })

  it('only injects confirmed relationships whose validity interval includes the chapter story order', async () => {
    const { repository, project, chapter, engine } = setup()
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    await engine.decide(waiting.id, 'approved', '建立关系测试实体')
    const entities = repository.getKnowledgeWorkspace(project.project.id).entities
    expect(entities.length).toBeGreaterThanOrEqual(2)
    const target = repository.createChapter(project.project.id, '关系边界章')
    const current = repository.createEntityRelationship(project.project.id, {
      sourceEntityId: entities[0]!.id,
      targetEntityId: entities[1]!.id,
      predicateKey: 'current-clue',
      label: '当前已成立',
      category: 'knowledge',
      directionality: 'directed',
      factLayer: 'canon',
      validFromStoryOrder: target.chapterNumber * 1000,
    }, repository.getProjectTree(project.project.id).project.revision)
    const future = repository.createEntityRelationship(project.project.id, {
      sourceEntityId: entities[0]!.id,
      targetEntityId: entities[1]!.id,
      predicateKey: 'future-clue',
      label: '未来才成立',
      category: 'knowledge',
      directionality: 'directed',
      factLayer: 'planned',
      validFromStoryOrder: (target.chapterNumber + 1) * 1000,
    }, repository.getProjectTree(project.project.id).project.revision)

    const context = repository.getGenerationContext(target.id, 'scene-plan')
    expect(context.confirmedRelationships?.map(item => item.id)).toContain(current.id)
    expect(context.confirmedRelationships?.map(item => item.id)).not.toContain(future.id)
    repository.close()
  })

  it('anchors extracted relationships to the approved source chapter and persists an exact evidence excerpt', async () => {
    const base = createGateway()
    let endpoints: { sourceId: string; targetId: string; source: string; target: string } | null = null
    const evidenceQuote = '林舟在旧码头找到了刻有日期的铜牌'
    const gateway: ModelGateway = {
      selection: base.selection,
      providers: base.providers,
      async generate(request) {
        if (request.prompt.startsWith('任务：从本章批准正文') && endpoints) {
          return { text: JSON.stringify({ relationships: [{
            sourceEntityId: endpoints.sourceId, targetEntityId: endpoints.targetId, sourceLabel: endpoints.source, targetLabel: endpoints.target,
            predicateKey: 'found-together', label: '共同出现在发现现场', category: 'knowledge', directionality: 'directed',
            factLayer: 'planned', validFromStoryOrder: -999, validToStoryOrder: null, confidence: .9, evidenceLabel: evidenceQuote,
          }] }) }
        }
        return base.generate(request)
      },
    }
    const { repository, project, chapter, engine } = setup(gateway)
    const firstWaiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    await engine.decide(firstWaiting.id, 'approved', '建立关系端点')
    const entities = repository.getKnowledgeWorkspace(project.project.id).entities
    expect(entities.length).toBeGreaterThanOrEqual(2)
    endpoints = { sourceId: entities[0]!.id, targetId: entities[1]!.id, source: entities[0]!.name, target: entities[1]!.name }

    repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
    const sourceChapter = repository.createChapter(project.project.id, '关系证据章')
    const secondWaiting = await engine.resume(repository.startChapterWorkflow(sourceChapter.id))
    await engine.decide(secondWaiting.id, 'approved', '提取关系证据')
    const candidate = repository.listRelationshipCandidates(project.project.id).find(item => item.predicateKey === 'found-together')!
    expect(candidate).toMatchObject({ status: 'pending', validFromStoryOrder: sourceChapter.chapterNumber * 1000, factLayer: 'canon' })
    expect(JSON.parse(candidate.evidenceJson)).toEqual([expect.objectContaining({
      sourceType: 'manuscript-version', excerptStart: expect.any(Number), excerptEnd: expect.any(Number),
    })])

    const relationship = repository.decideRelationshipCandidate(
      project.project.id, candidate.id, 'confirm', undefined, repository.getProjectTree(project.project.id).project.revision,
    )!
    const evidence = repository.getRelationshipEvidence(project.project.id, relationship.id)
    expect(evidence).toMatchObject([{ excerpt: evidenceQuote, excerptStart: expect.any(Number), excerptEnd: expect.any(Number) }])
    expect(repository.getGenerationContext(chapter.id, 'scene-plan').confirmedRelationships?.map(item => item.id)).not.toContain(relationship.id)
    expect(repository.getGenerationContext(sourceChapter.id, 'scene-plan').confirmedRelationships?.map(item => item.id)).toContain(relationship.id)
    repository.close()
  })

  it('recovers a committed scene plan after restart without invoking the model twice', async () => {
    const { root, repository, chapter, engine } = setup()
    const started = repository.startChapterWorkflow(chapter.id)
    await engine.resume(started, 'retrieve_context')
    const prepared = repository.prepareWorkflowNode(started.id, 'plan_scenes', {})
    const context = repository.getGenerationContext(chapter.id, 'scene-plan')
    const modelRun = repository.startModelRun(context, { provider: 'workflow-test', model: 'committed-v1' }, JSON.stringify(
      completedWorkflowModelSnapshot(context, 'scene-plan', started.id, prepared.nodeRunId),
    ))
    const scenePlan = repository.completeScenePlan(modelRun.id, { chapterGoal: '已提交规划', scenes: [{ scenePurpose: '唯一场景' }], risks: [] })
    repository.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    reopened.listRecoverableWorkflows()
    let calls = 0
    const noDuplicateGateway: ModelGateway = {
      selection: () => ({ provider: 'workflow-test', model: 'must-not-run' }),
      providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
      async generate() { calls++; throw new Error('model should not be called for recovered node') },
    }
    const recovered = await new WorkflowEngine(reopened, new GenerationService(reopened, noDuplicateGateway)).advance(started.id)
    expect(calls).toBe(0)
    expect(recovered.currentNodeKey).toBe('validate_scene_plan')
    expect(recovered.nodes.find(node => node.id === prepared.nodeRunId)).toMatchObject({ status: 'succeeded', outputJson: expect.stringContaining(scenePlan.id) })
    expect(recovered.events.some(event => event.type === 'workflow.node.recovered')).toBe(true)
    reopened.close()
  })

  it.each([
    ['project revision', 'projectRevision', undefined],
    ['chapter revision', 'chapterRevision', 'broken'],
    ['input manuscript version', 'inputManuscriptVersionId', 42],
    ['Foundation hash', 'foundationAssemblyHash', undefined],
    ['style revision', 'styleProfile', { revision: 'broken' }],
  ])('fails closed when a committed model snapshot has an invalid %s authority field', async (_label, field, value) => {
    const { repository, chapter, engine } = setup()
    const started = repository.startChapterWorkflow(chapter.id)
    await engine.resume(started, 'retrieve_context')
    const prepared = repository.prepareWorkflowNode(started.id, 'plan_scenes', {})
    const context = repository.getGenerationContext(chapter.id, 'scene-plan')
    const snapshot = completedWorkflowModelSnapshot(context, 'scene-plan', started.id, prepared.nodeRunId)
    const modelRun = repository.startModelRun(context, { provider: 'workflow-test', model: 'corrupt-snapshot-v1' }, JSON.stringify(snapshot))
    repository.completeScenePlan(modelRun.id, { chapterGoal: '不可信快照', scenes: [{ scenePurpose: '不应自动恢复' }], risks: [] })
    if (value === undefined) delete snapshot[field]
    else snapshot[field] = value
    const database = new DatabaseSync(repository.databasePath)
    try { database.prepare('UPDATE model_runs SET input_snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot), modelRun.id) }
    finally { database.close() }
    let calls = 0
    const noDuplicateGateway: ModelGateway = {
      selection: () => ({ provider: 'workflow-test', model: 'must-not-run' }),
      providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
      async generate() { calls++; throw new Error('invalid committed snapshot must not invoke the model') },
    }

    await expect(new WorkflowEngine(repository, new GenerationService(repository, noDuplicateGateway)).advance(started.id)).rejects.toThrow(/完整.*权威输入字段/)
    expect(calls).toBe(0)
    expect(repository.getWorkflowRun(started.id)).toMatchObject({
      status: 'failed',
      nodes: expect.arrayContaining([expect.objectContaining({ id: prepared.nodeRunId, status: 'failed_retryable' })]),
    })
    repository.close()
  })

  it('keeps two Host recovery attempts idempotent without overwriting the already advanced node', async () => {
    const { root, repository, chapter, engine } = setup()
    const started = repository.startChapterWorkflow(chapter.id)
    await engine.resume(started, 'retrieve_context')
    const prepared = repository.prepareWorkflowNode(started.id, 'plan_scenes', {})
    const context = repository.getGenerationContext(chapter.id, 'scene-plan')
    const modelRun = repository.startModelRun(context, { provider: 'workflow-test', model: 'committed-v1' }, JSON.stringify(
      completedWorkflowModelSnapshot(context, 'scene-plan', started.id, prepared.nodeRunId),
    ))
    repository.completeScenePlan(modelRun.id, { chapterGoal: '双 Host 恢复', scenes: [{ scenePurpose: '只推进一次' }], risks: [] })
    const secondHost = new SqliteNovelRepository({ dataRoot: root })
    let calls = 0
    const noDuplicateGateway: ModelGateway = {
      selection: () => ({ provider: 'workflow-test', model: 'must-not-run' }),
      providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
      async generate() { calls++; throw new Error('recovery must not invoke the model') },
    }

    try {
      const firstResult = await new WorkflowEngine(repository, new GenerationService(repository, noDuplicateGateway)).advance(started.id)
      const secondAttempt = secondHost.prepareWorkflowNode(started.id, 'plan_scenes', {})
      expect(calls).toBe(0)
      expect(firstResult.currentNodeKey).toBe('validate_scene_plan')
      expect(secondAttempt).toMatchObject({ alreadySucceeded: true, nodeRunId: prepared.nodeRunId })
      expect(secondAttempt.run.currentNodeKey).toBe('validate_scene_plan')
      secondHost.failWorkflowNode(started.id, prepared.nodeRunId, new Error('stale losing Host result'), true)
      const final = secondHost.getWorkflowRun(started.id)
      expect(final.status).toBe('running')
      expect(final.nodes.find(node => node.id === prepared.nodeRunId)).toMatchObject({ status: 'succeeded' })
      expect(final.events.filter(event => event.type === 'workflow.node.recovered')).toHaveLength(1)
    } finally {
      secondHost.close()
      repository.close()
    }
  })

  it('fails a stale committed scene-plan recovery once without leaving the runner in a retry loop', async () => {
    const { root, repository, project, chapter, engine } = setup()
    const started = repository.startChapterWorkflow(chapter.id)
    await engine.resume(started, 'retrieve_context')
    const prepared = repository.prepareWorkflowNode(started.id, 'plan_scenes', {})
    const context = repository.getGenerationContext(chapter.id, 'scene-plan')
    const modelRun = repository.startModelRun(context, { provider: 'workflow-test', model: 'committed-v1' }, JSON.stringify(
      completedWorkflowModelSnapshot(context, 'scene-plan', started.id, prepared.nodeRunId),
    ))
    repository.completeScenePlan(modelRun.id, { chapterGoal: '已提交规划', scenes: [{ scenePurpose: '唯一场景' }], risks: [] })
    const style = repository.getProjectStyleProfile(project.project.id)
    repository.setProjectStylePreset(project.project.id, 'suspense-cinematic', style.revision)
    repository.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    reopened.listRecoverableWorkflows()
    let calls = 0
    const noDuplicateGateway: ModelGateway = {
      selection: () => ({ provider: 'workflow-test', model: 'must-not-run' }),
      providers: () => [{ id: 'workflow-test', name: 'Workflow Test' }],
      async generate() { calls++; throw new Error('model should not be called for stale committed output') },
    }
    const runner = new WorkflowRunner(reopened, new WorkflowEngine(reopened, new GenerationService(reopened, noDuplicateGateway)))
    let settlements = 0
    const settled = new Promise<WorkflowRun>(resolve => runner.setSettledHandler((_workflowRunId, run) => {
      settlements++
      resolve(run)
    }))
    runner.enqueue(started.id)
    const failed = await settled
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(calls).toBe(0)
    expect(settlements).toBe(1)
    expect(failed).toMatchObject({ status: 'failed', errorJson: expect.stringContaining('revision-conflict') })
    expect(reopened.getWorkflowRun(started.id).nodes.find(node => node.id === prepared.nodeRunId)).toMatchObject({
      status: 'failed_retryable', errorJson: expect.stringMatching(/文风.*变化/),
    })
    reopened.close()
  })

  it('keeps the chapter successful and records a warning when a relationship needs review', async () => {
    const { repository, project, chapter, engine } = setup(createGateway(false, true))
    repository.setRelationshipMode(project.project.id, 'yolo', repository.getProjectTree(project.project.id).project.revision)
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    const completed = await engine.decide(waiting.id, 'approved', '通过')
    expect(completed).toMatchObject({ status: 'succeeded', currentNodeKey: null })
    const output = JSON.parse(completed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')!.outputJson!) as Record<string, unknown>
    expect(output).toMatchObject({ postProcessingWarnings: [expect.objectContaining({ code: 'relationship-needs-review' })] })
    repository.close()
  })

  it('lets a YOLO batch finish while ambiguous relationship candidates remain outside the Prompt', async () => {
    const { repository, project, chapter, engine } = setup(createGateway(false, true))
    repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
    const { batchId, workflow } = dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, 'yolo')
    expect(repository.getWorkflowBatchAutomationMode(workflow.id)).toBe('yolo')

    const waiting = await engine.resume(workflow.id)
    const completed = await engine.decide(waiting.id, 'approved', '有界 YOLO 自动批准')
    expect(completed).toMatchObject({ status: 'succeeded', currentNodeKey: null })
    const batch = repository.reconcileChapterBatch(workflow.id)
    expect(batch).toMatchObject({ id: batchId, status: 'succeeded', items: [expect.objectContaining({ workflowRunId: workflow.id })] })
    expect(repository.listRelationshipExtractionRuns(project.project.id, 1)).toMatchObject([{
      automationMode: 'auto', status: 'waiting_review', candidateCount: 1, pendingCount: 1,
    }])
    repository.close()
  })

  it('keeps an AUTO batch non-blocking when AUTO relationship candidates need review', async () => {
    const { repository, project, chapter, engine } = setup(createGateway(false, true))
    repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
    const { workflow } = dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, 'auto')
    expect(repository.getWorkflowBatchAutomationMode(workflow.id)).toBe('auto')

    const waiting = await engine.resume(workflow.id)
    const completed = await engine.decide(waiting.id, 'approved', '作者批准 AUTO 批次章节')
    expect(completed.status).toBe('succeeded')
    expect(repository.reconcileChapterBatch(workflow.id)).toMatchObject({ status: 'succeeded' })
    expect(repository.listRelationshipCandidates(project.project.id, 'ambiguous')).toHaveLength(1)
    repository.close()
  })

  it.each([
    { automationMode: null, failureKind: 'output-limit' as const },
    { automationMode: 'yolo' as const, failureKind: 'provider' as const },
    { automationMode: null, failureKind: 'invalid-json' as const },
  ])('keeps approved text, Canon and fallback indexes when $automationMode memory summary hits a $failureKind failure', async ({ automationMode, failureKind }) => {
    const gateway = failureKind === 'invalid-json'
      ? createStructurallyInvalidMemoryGateway()
      : createPostProcessingFailureGateway('memory-summary', () => failureKind === 'output-limit'
        ? new ModelOutputLimitError({ text: '{"chapter":' }, 5_200)
        : new Error('memory summary provider temporarily offline'))
    const { repository, project, chapter, engine } = setup(gateway)
    if (automationMode === 'yolo') repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
    const workflow = automationMode === 'yolo'
      ? dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, automationMode).workflow
      : repository.startChapterWorkflow(chapter.id)
    const waiting = await engine.resume(workflow.id)

    const completed = await engine.decide(waiting.id, 'approved', '正文审批通过')

    expect(completed).toMatchObject({ status: 'succeeded', currentNodeKey: null })
    expect(repository.getChapter(chapter.id).currentApprovedVersionId).toBe(completed.approvedVersionId)
    expect(completed.canonFacts).toHaveLength(1)
    const refreshNode = completed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')!
    const refreshOutput = JSON.parse(refreshNode.outputJson!) as Record<string, unknown>
    expect(refreshNode.status).toBe('succeeded')
    expect(refreshOutput).toMatchObject({
      memoryRefreshError: expect.stringContaining(failureKind === 'output-limit' ? '模型输出达到单次上限' : failureKind === 'invalid-json' ? 'valid JSON' : 'temporarily offline'),
      relationshipExtractionError: null,
      postProcessingWarnings: [expect.objectContaining({
        stage: 'memory-summary',
        code: failureKind === 'output-limit' ? 'model-output-limit' : failureKind === 'invalid-json' ? 'invalid-model-output' : 'provider-error',
        regenerable: true,
      })],
    })
    const knowledge = repository.getKnowledgeWorkspace(project.project.id)
    expect(knowledge.summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'chapter', sourceId: chapter.id, sourceVersionId: completed.approvedVersionId }),
    ]))
    expect(knowledge.entities.length).toBeGreaterThan(0)
    expect(knowledge.timeline.length).toBeGreaterThan(0)
    expect(repository.listRelationshipExtractionRuns(project.project.id)).toHaveLength(automationMode === 'yolo' ? 1 : 0)
    if (automationMode === 'yolo') expect(repository.reconcileChapterBatch(workflow.id)).toMatchObject({ status: 'succeeded' })
    repository.close()
  })

  it('does not misclassify a post-processing programming error as a regenerable provider warning', async () => {
    const gateway = createPostProcessingFailureGateway('memory-summary', () => new TypeError('post-processing programming defect'))
    const { repository, chapter, engine } = setup(gateway)
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))

    await expect(engine.decide(waiting.id, 'approved', '正文审批通过')).rejects.toThrow('programming defect')

    const failed = repository.getWorkflowRun(waiting.id)
    expect(failed).toMatchObject({ status: 'failed', currentNodeKey: 'refresh_summaries_and_indexes', errorJson: expect.stringContaining('programming defect') })
    expect(failed.nodes.find(node => node.nodeKey === 'commit_canon')).toMatchObject({ status: 'succeeded' })
    expect(failed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')).toMatchObject({ status: 'failed_retryable', outputJson: null })
    expect(repository.getChapter(chapter.id).currentApprovedVersionId).toBe(failed.approvedVersionId)
    expect(failed.canonFacts).toHaveLength(1)
    repository.close()
  })

  it.each([
    { automationMode: 'auto' as const, failureKind: 'provider' as const },
    { automationMode: 'yolo' as const, failureKind: 'output-limit' as const },
  ])('records a non-blocking relationship warning for $automationMode after a $failureKind failure', async ({ automationMode, failureKind }) => {
    const gateway = createPostProcessingFailureGateway('relationship-extraction', () => failureKind === 'output-limit'
      ? new ModelOutputLimitError({ text: '{"relationships":[' }, 4_200)
      : new Error('relationship provider temporarily offline'))
    const { repository, project, chapter, engine } = setup(gateway)
    repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
    const { workflow } = dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, automationMode)
    const waiting = await engine.resume(workflow.id)

    const completed = await engine.decide(waiting.id, 'approved', automationMode === 'yolo' ? '有界 YOLO 自动批准' : '作者批准 AUTO 批次章节')

    expect(completed).toMatchObject({ status: 'succeeded', currentNodeKey: null })
    expect(completed.canonFacts).toHaveLength(1)
    const refreshNode = completed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')!
    const refreshOutput = JSON.parse(refreshNode.outputJson!) as Record<string, unknown>
    expect(refreshNode.status).toBe('succeeded')
    expect(refreshOutput).toMatchObject({
      relationshipCandidateCount: 0,
      relationshipExtractionError: expect.stringContaining(failureKind === 'output-limit' ? '模型输出达到单次上限' : 'temporarily offline'),
      postProcessingWarnings: [expect.objectContaining({
        stage: 'relationship-extraction',
        code: failureKind === 'output-limit' ? 'model-output-limit' : 'provider-error',
        regenerable: true,
      })],
    })
    expect(repository.listRelationshipExtractionRuns(project.project.id, 1)).toEqual([
      expect.objectContaining({ status: 'failed', errorJson: expect.stringContaining(failureKind === 'output-limit' ? '模型输出达到单次上限' : 'temporarily offline') }),
    ])
    expect(repository.reconcileChapterBatch(workflow.id)).toMatchObject({ status: 'succeeded' })
    repository.close()
  })

  it('turns structurally invalid relationship output into a non-blocking post-processing warning', async () => {
    let memoryModelCalls = 0
    const countingGateway = (gateway: ModelGateway): ModelGateway => ({
      ...gateway,
      async generate(request) {
        if (request.prompt.startsWith('任务：提炼批准章节并增量更新长篇记忆')) memoryModelCalls++
        return gateway.generate(request)
      },
    })
    const { repository, project, chapter, engine } = setup(countingGateway(createStructurallyInvalidRelationshipGateway()))
    repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
    const { batchId, workflow } = dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, 'yolo')

    const waiting = await engine.resume(workflow.id)
    const completed = await engine.decide(waiting.id, 'approved', '有界 YOLO 自动批准')
    const finalNode = completed.nodes.find(node => node.nodeKey === 'refresh_summaries_and_indexes')!
    expect(completed.status).toBe('succeeded')
    expect(finalNode).toMatchObject({ status: 'succeeded' })
    expect(JSON.parse(finalNode.outputJson!)).toMatchObject({
      postProcessingWarnings: [expect.objectContaining({ stage: 'relationship-extraction', code: 'invalid-model-output' })],
    })
    expect(repository.reconcileChapterBatch(workflow.id)).toMatchObject({ id: batchId, status: 'succeeded' })
    expect(repository.listRelationshipExtractionRuns(project.project.id, 1)).toMatchObject([{
      automationMode: 'auto', status: 'failed', errorJson: expect.stringContaining('valid JSON'),
    }])
    const knowledgeRefreshRows = () => {
      const audit = new DatabaseSync(repository.databasePath, { readOnly: true })
      try {
        return {
          foreshadowingIds: (audit.prepare('SELECT id FROM foreshadowing_items WHERE project_id=? ORDER BY id').all(project.project.id) as Array<Record<string, unknown>>).map(row => String(row.id)),
          transitionIds: (audit.prepare(`SELECT t.id FROM foreshadowing_transitions t
            JOIN foreshadowing_items f ON f.id=t.foreshadowing_id WHERE f.project_id=? ORDER BY t.id`).all(project.project.id) as Array<Record<string, unknown>>).map(row => String(row.id)),
          derivedRevisionIds: (audit.prepare(`SELECT mr.id FROM memory_revisions mr
            JOIN memory_items mi ON mi.id=mr.item_id WHERE mi.project_id=? AND mi.origin='derived'
            ORDER BY mi.source_key,mr.revision,mr.id`).all(project.project.id) as Array<Record<string, unknown>>).map(row => String(row.id)),
        }
      } finally { audit.close() }
    }
    const refreshState = knowledgeRefreshRows()
    expect(refreshState).toMatchObject({ foreshadowingIds: [expect.any(String)], transitionIds: [expect.any(String)] })
    expect(refreshState.derivedRevisionIds).toHaveLength(6)
    expect(memoryModelCalls).toBe(1)
    repository.close()
  })

  it('skips optional relationship extraction without stopping a YOLO chapter when the mode is turned OFF', async () => {
    const { repository, project, chapter, engine } = setup(createGateway())
    try {
      repository.setRelationshipMode(project.project.id, 'auto', repository.getProjectTree(project.project.id).project.revision)
      const { workflow } = dispatchSelectedBatchWorkflow(repository, project.project.id, chapter.id, 'yolo')
      const waiting = await engine.resume(workflow.id)
      repository.setRelationshipMode(project.project.id, 'off', repository.getProjectTree(project.project.id).project.revision)

      const completed = await engine.decide(waiting.id, 'approved', '有界 YOLO 自动批准')
      expect(completed).toMatchObject({ status: 'succeeded', currentNodeKey: null })
      expect(repository.listRelationshipExtractionRuns(project.project.id)).toHaveLength(0)
      expect(repository.getChapterBatch(repository.reconcileChapterBatch(workflow.id)!.id)).toMatchObject({
        status: 'succeeded', items: [{ queueState: 'dispatched', blockedReason: null }],
      })
    } finally {
      repository.close()
    }
  })

  it('summarizes multiple projects and advances their queued workflows independently', async () => {
    const { repository, project, chapter, engine } = setup()
    const otherProject = repository.createProject({ title: '并行项目' })
    approveTestFoundation(repository, otherProject.project.id)
    const otherChapter = repository.createChapter(otherProject.project.id, '并行章')
    const runner = new WorkflowRunner(repository, engine, 2)
    const first = runner.create(chapter.id)
    const second = runner.create(otherChapter.id)
    expect(first.status).toBe('running')
    expect(second.status).toBe('running')
    await waitUntil(() => repository.getWorkflowRun(first.id).status === 'waiting_approval' && repository.getWorkflowRun(second.id).status === 'waiting_approval')
    const overview = repository.getStudioOverview()
    expect(overview.projects.map(item => item.project.id)).toEqual(expect.arrayContaining([project.project.id, otherProject.project.id]))
    expect(overview.waitingApprovalRuns.map(run => run.id)).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(overview.projects.find(item => item.project.id === otherProject.project.id)).toMatchObject({ chapterCount: 1, activeWorkflowCount: 1, waitingApprovalCount: 1 })
    repository.close()
  })

  it('serializes legacy same-project queue entries while preserving the second slot for another project', async () => {
    const runs = new Map<string, WorkflowRun>([
      ['project-a-1', { id: 'project-a-1', projectId: 'project-a', status: 'running' } as WorkflowRun],
      ['project-a-2', { id: 'project-a-2', projectId: 'project-a', status: 'running' } as WorkflowRun],
      ['project-b-1', { id: 'project-b-1', projectId: 'project-b', status: 'running' } as WorkflowRun],
    ])
    const gates = new Map<string, { promise: Promise<void>; release: () => void }>()
    for (const id of runs.keys()) {
      let release!: () => void
      const promise = new Promise<void>(resolve => { release = resolve })
      gates.set(id, { promise, release })
    }
    const starts: string[] = []
    const activeByProject = new Map<string, number>()
    let activeGlobal = 0, maxGlobal = 0, maxProjectA = 0
    const repository = {
      getWorkflowRun: (workflowRunId: string) => runs.get(workflowRunId)!,
      enforceWorkflowRelationshipSafety: () => true,
    } as unknown as NovelRepository
    const engine = {
      advance: async (workflowRunId: string) => {
        const run = runs.get(workflowRunId)!
        starts.push(workflowRunId)
        activeGlobal += 1
        maxGlobal = Math.max(maxGlobal, activeGlobal)
        const projectActive = (activeByProject.get(run.projectId) ?? 0) + 1
        activeByProject.set(run.projectId, projectActive)
        if (run.projectId === 'project-a') maxProjectA = Math.max(maxProjectA, projectActive)
        await gates.get(workflowRunId)!.promise
        activeGlobal -= 1
        activeByProject.set(run.projectId, projectActive - 1)
        const settled = { ...run, status: 'waiting_approval' as const }
        runs.set(workflowRunId, settled)
        return settled
      },
    } as unknown as WorkflowEngine
    const runner = new WorkflowRunner(repository, engine, 2)

    runner.enqueue('project-a-1')
    runner.enqueue('project-a-2')
    runner.enqueue('project-b-1')
    try {
      await waitUntil(() => starts.length === 2)
      expect(starts).toEqual(['project-a-1', 'project-b-1'])
      expect(maxGlobal).toBe(2)
      expect(maxProjectA).toBe(1)

      gates.get('project-a-1')!.release()
      await waitUntil(() => starts.includes('project-a-2'))
      expect(maxProjectA).toBe(1)
      expect(maxGlobal).toBe(2)
    } finally {
      for (const gate of gates.values()) gate.release()
    }
    await waitUntil(() => [...runs.values()].every(run => run.status === 'waiting_approval'))
  })
})

describe('Phase 4 knowledge selection and retrieval', () => {
  it('freezes enabled historical summaries, keeps original text disabled, and ranks current Canon first', async () => {
    const { repository, project, chapter, engine } = setup()
    const historical = repository.createProject({ title: '旧作潮声' })
    approveTestFoundation(repository, historical.project.id)
    const historicalChapter = repository.createChapter(historical.project.id, '旧港')
    const historicalDraft = repository.saveDraft(historicalChapter.id, { content: '旧作原文中的密码名为蓝鲸。', baseRevision: historicalChapter.revision })
    repository.approveVersion(historicalChapter.id, historicalDraft.currentDraftVersionId!, historicalDraft.revision)
    const historicalRun = repository.startChapterWorkflow(historicalChapter.id)
    const historicalWaiting = await engine.resume(historicalRun)
    await engine.decide(historicalWaiting.id, 'approved', '建立历史项目摘要')

    repository.configureHistoricalSource(project.project.id, historical.project.id, true, ['structure_summary'])
    const run = repository.startChapterWorkflow(chapter.id)
    expect(run.knowledgeSelectionSnapshot?.items).toEqual([{ sourceProjectId: historical.project.id, sourceProjectTitle: '旧作潮声', scopes: ['structure_summary'] }])
    repository.configureHistoricalSource(project.project.id, historical.project.id, false, [])
    const bundle = repository.createRetrievalBundle(run.id)
    expect(bundle.items.some(item => item.authority === 'historical_reference')).toBe(true)
    expect(bundle.items.filter(item => item.authority === 'historical_reference').every(item => item.content.startsWith('[Historical reference:'))).toBe(true)
    expect(bundle.items.some(item => item.content.includes('蓝鲸'))).toBe(false)
    const currentCanonRank = bundle.items.findIndex(item => item.authority === 'current_project_canon')
    const historicalRank = bundle.items.findIndex(item => item.authority === 'historical_reference')
    expect(currentCanonRank === -1 || currentCanonRank < historicalRank).toBe(true)
    repository.close()
  })

  it('can exclude a historical source in a new immutable workflow snapshot', () => {
    const { repository, project, chapter } = setup()
    const historical = repository.createProject({ title: '可排除旧作' })
    approveTestFoundation(repository, historical.project.id)
    repository.configureHistoricalSource(project.project.id, historical.project.id, true, ['structure_summary', 'original_excerpt'])
    const first = repository.startChapterWorkflow(chapter.id)
    expect(first.knowledgeSelectionSnapshot?.items).toHaveLength(1)
    repository.setWorkflowStatus(first.id, 'cancel_requested')
    const second = repository.startChapterWorkflow(chapter.id, [historical.project.id])
    expect(second.knowledgeSelectionSnapshot?.items).toHaveLength(0)
    expect(second.knowledgeSelectionSnapshot?.excludedSourceIds).toContain(historical.project.id)
    repository.close()
  })
})

describe('Phase 5 session recovery', () => {
  it('binds a Session, tracks approval state, and never returns manuscript text', async () => {
    const { repository, project, chapter, engine } = setup()
    const secret = '正文机密片段不得进入恢复胶囊'
    const saved = repository.saveDraft(chapter.id, { content: secret, baseRevision: chapter.revision })
    repository.bindSessionProject('session-recovery-a', project.project.id, chapter.id)
    const waiting = await engine.resume(repository.startChapterWorkflow(chapter.id))
    expect(waiting.status).toBe('waiting_approval')

    const resumed = repository.getResumeContext('session-recovery-a')
    expect(resumed.capsule.projectId).toBe(project.project.id)
    expect(resumed.capsule.chapterId).toBe(chapter.id)
    expect(resumed.capsule.activeDraftVersionId).toBe(waiting.approval!.manuscriptVersionId)
    expect(resumed.capsule.workflowRunId).toBe(waiting.id)
    expect(resumed.capsule.pendingUserDecisions).toEqual([`Approve or reject chapter version ${waiting.approval!.manuscriptVersionId}`])
    expect(resumed.pendingApprovals).toEqual([{ workflowRunId: waiting.id, manuscriptVersionId: waiting.approval!.manuscriptVersionId }])
    expect(JSON.stringify(resumed)).not.toContain(secret)
    repository.close()
  })

  it('refreshes a stale capsule and requires a new Session to select a project explicitly', () => {
    const { repository, project, chapter } = setup()
    const first = repository.bindSessionProject('session-stale', project.project.id, chapter.id)
    expect(() => repository.getResumeContext('session-new')).toThrow(/not bound/)

    const external = new DatabaseSync(repository.databasePath)
    external.prepare('UPDATE projects SET revision=revision+1 WHERE id=?').run(project.project.id)
    external.close()

    const refreshed = repository.getResumeContext('session-stale')
    expect(refreshed.staleRevisionDetected).toBe(true)
    expect(refreshed.previousCapsuleRevision).toBe(first.project.revision)
    expect(refreshed.project.revision).toBe(first.project.revision + 1)
    expect(refreshed.capsule.lastApprovedProjectRevision).toBe(refreshed.project.revision)

    const explicit = repository.getResumeContext('session-new', project.project.id)
    expect(explicit.project.id).toBe(project.project.id)
    expect(explicit.capsule.chapterId).toBeNull()
    repository.close()
  })
})

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for workflow runner')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
