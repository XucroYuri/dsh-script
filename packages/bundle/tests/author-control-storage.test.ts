import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { DomainError, type RelationshipCandidate } from '../src/domain/model.js'
import { memoryItemMarkdownPath } from '../src/storage/markdown-mirror.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { migrations } from '../src/storage-sqlite/migrations.js'
import { RepositoryChapterBatchStore } from '../src/workflow/batch-adapter.js'
import { ChapterBatchRunner } from '../src/workflow/batch-runner.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []
const repositories: SqliteNovelRepository[] = []

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function openRepository(root = temporaryRoot('novel-studio-author-control-')): SqliteNovelRepository {
  const repository = new SqliteNovelRepository({ dataRoot: root })
  repositories.push(repository)
  return repository
}

function projectRevision(repository: SqliteNovelRepository, projectId: string): number {
  return repository.getProjectTree(projectId).project.revision
}

function approveSelectedBatch(repository: SqliteNovelRepository, projectId: string, chapterIds: string[]) {
  const created = repository.createChapterBatch(projectId, {
    mode: 'selected', automationMode: 'auto', chapterIds, count: chapterIds.length,
  }, { provider: 'test', model: 'batch-planner' }, projectRevision(repository, projectId))
  const planned = repository.completeChapterBatchPlan(created.id, chapterIds.map((chapterId, index) => ({
    chapterId,
    plannedTitle: `互斥计划第 ${index + 1} 章`,
    writingGoal: `验证项目级互斥 ${index + 1}`,
    openingContinuity: index === 0 ? '承接当前 Canon' : `承接计划 ${index}`,
    endingHook: `互斥钩子 ${index + 1}`,
    targetWords: 2_400 + index * 100,
  })), { promptHash: 'workflow-mutex-plan', outputJson: JSON.stringify({ count: chapterIds.length }) })
  return repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
    id: item.id,
    plannedTitle: item.plannedTitle,
    writingGoal: item.writingGoal,
    openingContinuity: item.openingContinuity,
    endingHook: item.endingHook,
    targetWords: item.targetWords,
  })), projectRevision(repository, projectId))
}

function seedSchemaV16(root: string, entityCount = 0): void {
  mkdirSync(root, { recursive: true })
  const database = new DatabaseSync(join(root, 'novel-studio.db'))
  const timestamp = '2026-08-27T00:00:00.000Z'
  database.exec('PRAGMA foreign_keys=ON')
  for (const migration of migrations.filter(candidate => candidate.version <= 16)) {
    if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=OFF')
    database.exec(migration.sql)
    database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)')
      .run(migration.version, migration.name, timestamp)
    if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=ON')
  }

  const manuscript = '旧正文：潮汐证据。迁移后仍应完整保留。'
  const summaryContent = 'v16 派生连续性摘要'
  const summaryHash = createHash('sha256').update(`{}\n${summaryContent}`).digest('hex')
  database.prepare(`INSERT INTO projects(
    id,title,slug,language,status,current_book_id,revision,created_at,updated_at,project_root_path,markdown_sync_enabled
  ) VALUES ('project-v16','v16 迁移项目','schema-v16','zh-CN','active','book-v16',0,?,?,NULL,0)`).run(timestamp, timestamp)
  database.prepare("INSERT INTO books(id,project_id,title,position,created_at) VALUES ('book-v16','project-v16','v16 迁移项目',1,?)").run(timestamp)
  database.prepare("INSERT INTO volumes(id,project_id,book_id,title,position,created_at) VALUES ('volume-v16','project-v16','book-v16','第一卷',1,?)").run(timestamp)
  database.prepare(`INSERT INTO chapters(
    id,project_id,book_id,volume_id,chapter_number,title,status,current_draft_version_id,current_approved_version_id,revision,created_at,updated_at
  ) VALUES ('chapter-v16','project-v16','book-v16','volume-v16',1,'迁移章节','approved','manuscript-v16','manuscript-v16',1,?,?)`).run(timestamp, timestamp)
  database.prepare(`INSERT INTO manuscript_versions(
    id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,created_at,approved_at
  ) VALUES ('manuscript-v16','project-v16','chapter-v16',NULL,'approved',?,?,18,'user','user',?,?)`).run(
    manuscript,
    createHash('sha256').update(manuscript).digest('hex'),
    timestamp,
    timestamp,
  )
  database.prepare(`INSERT INTO knowledge_summaries(
    id,project_id,summary_scope,source_id,source_version_id,content,status,updated_at,structured_json,compact_narrative,
    source_start_chapter,source_end_chapter,source_version_ids_json,content_hash,provider,model,prompt_hash
  ) VALUES ('summary-v16','project-v16','chapter','chapter-v16','manuscript-v16','旧摘要','current',?,'{}',?,1,1,'["manuscript-v16"]',?,'legacy','legacy-model','legacy-prompt')`).run(timestamp, summaryContent, summaryHash)

  for (let index = 1; index <= entityCount; index += 1) {
    database.prepare(`INSERT INTO story_entities(
      id,project_id,entity_type,name,description,source_manuscript_version_id,created_at,updated_at
    ) VALUES (?, 'project-v16', ?, ?, ?, 'manuscript-v16', ?, ?)`).run(
      `entity-v16-${index}`,
      index % 4 === 0 ? 'location' : index % 3 === 0 ? 'organization' : 'character',
      `迁移实体 ${index}`,
      `用于关系存储测试的第 ${index} 个实体。`,
      timestamp,
      timestamp,
    )
  }
  database.close()
}

function seedSchemaV19Batch(root: string): void {
  seedSchemaV16(root)
  const database = new DatabaseSync(join(root, 'novel-studio.db'))
  const timestamp = '2026-08-27T00:00:00.000Z'
  database.exec('PRAGMA foreign_keys=ON')
  for (const migration of migrations.filter(candidate => candidate.version > 16 && candidate.version <= 19)) {
    if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=OFF')
    database.exec(migration.sql)
    database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)')
      .run(migration.version, migration.name, timestamp)
    if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=ON')
  }
  database.prepare(`INSERT INTO chapter_generation_batches(
    id,project_id,mode,automation_mode,status,requested_count,policy_json,revision,created_at,updated_at
  ) VALUES ('batch-v19','project-v16','selected','auto','awaiting_plan_approval',1,'{}',1,?,?)`).run(timestamp, timestamp)
  database.prepare(`INSERT INTO chapter_generation_batch_plans(
    id,batch_id,status,provider,model,prompt_hash,input_snapshot_json,output_json,streamed_text,created_at,updated_at,finished_at
  ) VALUES ('plan-v19','batch-v19','succeeded','legacy','legacy-planner','legacy-prompt','{}','{}','',?,?,?)`).run(timestamp, timestamp, timestamp)
  database.prepare(`INSERT INTO chapter_generation_batch_items(
    id,batch_id,chapter_id,position,planned_title,writing_goal,opening_continuity,ending_hook,target_words,
    queue_state,workflow_run_id,chapter_revision_at_enqueue,blocked_reason,created_at,updated_at
  ) VALUES ('item-v19','batch-v19','chapter-v16',1,'旧批次章节','旧写作目标','旧承接','旧钩子',3000,
    'planned',NULL,1,NULL,?,?)`).run(timestamp, timestamp)
  database.prepare(`INSERT INTO chapter_writing_briefs(
    chapter_id,writing_goal,opening_continuity,ending_hook,target_words,source,revision,batch_item_id,provider,model,prompt_hash,updated_at
  ) VALUES ('chapter-v16','旧写作目标','旧承接','旧钩子',3000,'batch-plan',1,'item-v19','legacy','legacy-planner','legacy-prompt',?)`).run(timestamp)
  database.prepare(`INSERT INTO chapter_generation_batch_events(id,batch_id,item_id,event_type,payload_json,created_at)
    VALUES ('event-v19','batch-v19','item-v19','legacy.event','{}',?)`).run(timestamp)
  database.close()
}

type CandidateInput = Omit<RelationshipCandidate, 'id' | 'runId' | 'status' | 'createdAt' | 'updatedAt'>

function relationshipCandidate(index: number, overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    sourceEntityId: 'entity-v16-1',
    targetEntityId: `entity-v16-${index}`,
    sourceLabel: '迁移实体 1',
    targetLabel: `迁移实体 ${index}`,
    predicateKey: `supports-${index}`,
    label: `支持 ${index}`,
    category: 'alliance',
    directionality: 'directed',
    factLayer: 'canon',
    validFromStoryOrder: 1,
    validToStoryOrder: null,
    confidence: 0.92,
    evidenceJson: '[]',
    fingerprint: `model-fingerprint-${index}`,
    ...overrides,
  }
}

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('author control schema migration', () => {
  it('migrates a real v16 database through v20 once and reopens idempotently', () => {
    const root = temporaryRoot('novel-studio-v16-v20-')
    seedSchemaV16(root)

    const upgraded = openRepository(root)
    expect(upgraded.health()).toMatchObject({ ready: true, schemaVersion: 20, expectedSchemaVersion: 20 })
    expect(upgraded.getChapter('chapter-v16').versions[0]).toMatchObject({
      id: 'manuscript-v16', status: 'approved', content: '旧正文：潮汐证据。迁移后仍应完整保留。',
    })
    const migratedMemory = upgraded.searchMemory('project-v16', { origin: 'derived' })
    expect(migratedMemory.items.find(item => item.sourceKey === 'summary-v16')).toMatchObject({
      origin: 'derived', currentRevision: { content: 'v16 派生连续性摘要' },
    })
    upgraded.close()

    const firstCounts = new DatabaseSync(join(root, 'novel-studio.db'), { readOnly: true })
    expect(firstCounts.prepare('SELECT COUNT(*) count FROM schema_migrations').get()).toEqual({ count: 20 })
    const memoryItemCount = firstCounts.prepare("SELECT COUNT(*) count FROM memory_items WHERE origin='derived'").get()
    const memoryRevisionCount = firstCounts.prepare('SELECT COUNT(*) count FROM memory_revisions').get()
    firstCounts.close()

    const reopened = openRepository(root)
    expect(reopened.health().schemaVersion).toBe(20)
    expect(reopened.searchMemory('project-v16', { origin: 'derived' }).total).toBe(migratedMemory.total)
    reopened.close()

    const secondCounts = new DatabaseSync(join(root, 'novel-studio.db'), { readOnly: true })
    expect(secondCounts.prepare('SELECT COUNT(*) count FROM schema_migrations').get()).toEqual({ count: 20 })
    expect(secondCounts.prepare("SELECT COUNT(*) count FROM memory_items WHERE origin='derived'").get()).toEqual(memoryItemCount)
    expect(secondCounts.prepare('SELECT COUNT(*) count FROM memory_revisions').get()).toEqual(memoryRevisionCount)
    secondCounts.close()
  }, 15_000)

  it('migrates v19 batch word-target constraints without changing legacy rows and reopens idempotently', () => {
    const root = temporaryRoot('novel-studio-v19-v20-')
    seedSchemaV19Batch(root)

    const upgraded = openRepository(root)
    expect(upgraded.health()).toMatchObject({ ready: true, schemaVersion: 20, expectedSchemaVersion: 20 })
    expect(upgraded.getChapterBatch('batch-v19')).toMatchObject({
      id: 'batch-v19',
      plan: { id: 'plan-v19', promptHash: 'legacy-prompt' },
      items: [{ id: 'item-v19', chapterId: 'chapter-v16', targetWords: 3_000, writingGoal: '旧写作目标' }],
    })
    upgraded.close()

    const first = new DatabaseSync(join(root, 'novel-studio.db'), { readOnly: true })
    expect(first.prepare('SELECT COUNT(*) count FROM schema_migrations').get()).toEqual({ count: 20 })
    expect(first.prepare("SELECT id,item_id,event_type FROM chapter_generation_batch_events WHERE id='event-v19'").get())
      .toEqual({ id: 'event-v19', item_id: 'item-v19', event_type: 'legacy.event' })
    expect(first.prepare("SELECT target_words,batch_item_id,prompt_hash FROM chapter_writing_briefs WHERE chapter_id='chapter-v16'").get())
      .toEqual({ target_words: 3_000, batch_item_id: 'item-v19', prompt_hash: 'legacy-prompt' })
    expect(first.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    first.close()

    const reopened = openRepository(root)
    expect(reopened.health().schemaVersion).toBe(20)
    expect(reopened.getChapterBatch('batch-v19').items[0]).toMatchObject({ id: 'item-v19', targetWords: 3_000 })
    reopened.close()

    const second = new DatabaseSync(join(root, 'novel-studio.db'), { readOnly: true })
    expect(second.prepare('SELECT COUNT(*) count FROM schema_migrations').get()).toEqual({ count: 20 })
    expect(second.prepare("SELECT target_words FROM chapter_writing_briefs WHERE chapter_id='chapter-v16'").get()).toEqual({ target_words: 3_000 })
    second.close()
  }, 15_000)
})

describe('recoverable chapter batch storage', () => {
  it('creates and approves batch targets above 20,000 words without truncation', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '长章节目标' }).project
    approveTestFoundation(repository, project.id)
    const chapter = repository.createChapter(project.id, '超长章节')
    const created = repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'auto', chapterIds: [chapter.id], count: 1,
    }, { provider: 'test', model: 'planner' }, projectRevision(repository, project.id))
    const planned = repository.completeChapterBatchPlan(created.id, [{
      chapterId: chapter.id,
      plannedTitle: '超长章节计划',
      writingGoal: '验证大目标不会被产品上限拒绝',
      openingContinuity: '承接批准基建',
      endingHook: '保留后续钩子',
      targetWords: 50_000,
    }], { promptHash: 'large-target-plan', outputJson: '{"items":[]}' })
    expect(planned.items[0]?.targetWords).toBe(50_000)

    const approved = repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
      id: item.id,
      plannedTitle: item.plannedTitle,
      writingGoal: item.writingGoal,
      openingContinuity: item.openingContinuity,
      endingHook: item.endingHook,
      targetWords: 75_000,
    })), projectRevision(repository, project.id))
    expect(approved.items[0]?.targetWords).toBe(75_000)
    expect(repository.getGenerationContext(chapter.id, 'chapter-draft').chapterBrief?.targetWords).toBe(75_000)
  })

  it('does not invalidate an active ModelRun when batch creation competes for the same project', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '批次创建与模型互斥' }).project
    approveTestFoundation(repository, project.id)
    const generatingChapter = repository.createChapter(project.id, '正在生成')
    const batchChapter = repository.createChapter(project.id, '计划批次')
    const context = repository.getGenerationContext(generatingChapter.id, 'scene-plan')
    const run = repository.startModelRun(context, { provider: 'test', model: 'active-run' }, JSON.stringify({
      purpose: 'scene-plan',
      projectId: context.project.id,
      projectRevision: context.project.revision,
      chapterId: context.chapter.id,
      chapterRevision: context.chapter.revision,
      inputManuscriptVersionId: context.inputManuscriptVersionId,
      promptAssetVersionId: context.promptVersion.id,
      promptContentHash: context.promptVersion.contentHash,
      projectRulesRevision: context.rules.revision,
      styleProfile: context.styleProfile ? { revision: context.styleProfile.revision } : null,
      foundationVersionIds: context.foundationVersions.map(version => version.id),
      foundationAssemblyHash: context.foundationAssemblyHash,
    }))
    const revisionBefore = projectRevision(repository, project.id)

    expect(() => repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'auto', chapterIds: [batchChapter.id], count: 1,
    }, { provider: 'test', model: 'planner' }, revisionBefore)).toThrow(/模型生成|等待生成完成/)
    expect(projectRevision(repository, project.id)).toBe(revisionBefore)
    expect(repository.completeScenePlan(run.id, { chapterGoal: '原生成继续完成', scenes: [{ scenePurpose: '不被批次 revision 干扰' }], risks: [] })).toMatchObject({ modelRunId: run.id })
  })

  it('keeps a cancelled planning batch terminal when its model result arrives late', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '迟到批次规划结果' }).project
    approveTestFoundation(repository, project.id)
    const chapter = repository.createChapter(project.id, '规划锚点')
    const created = repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'auto', chapterIds: [chapter.id], count: 1,
    }, { provider: 'test', model: 'planner' }, projectRevision(repository, project.id))
    repository.setChapterBatchStatus(created.id, 'cancel', projectRevision(repository, project.id))

    expect(() => repository.completeChapterBatchPlan(created.id, [{
      chapterId: chapter.id, plannedTitle: '不得复活', writingGoal: '迟到结果', openingContinuity: '', endingHook: '', targetWords: 2_000,
    }], { promptHash: 'late-plan', outputJson: '{"items":[]}' })).toThrow(/已结束|状态已变化|迟到/)
    expect(repository.getChapterBatch(created.id)).toMatchObject({ status: 'cancelled', plan: { status: 'cancelled' }, items: [] })
  })

  it('re-enters persisted planning after a failed plan with no chapter items', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '批次规划重试' }).project
    approveTestFoundation(repository, project.id)
    const chapter = repository.createChapter(project.id, '规划锚点')
    const created = repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'auto', chapterIds: [chapter.id], count: 1,
    }, { provider: 'test', model: 'planner' }, projectRevision(repository, project.id))
    const failed = repository.failChapterBatchPlan(created.id, new Error('结构化计划无效'))
    expect(failed).toMatchObject({ status: 'blocked', plan: { status: 'failed' }, items: [] })

    const planning = repository.setChapterBatchRuntimeStatus(created.id, 'planning')
    expect(planning).toMatchObject({ status: 'planning', errorJson: null, plan: { status: 'planning', errorJson: null, finishedAt: null }, items: [] })
  })

  it('cancels the linked workflow atomically and releases the project mutex', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '批次取消收敛' }).project
    approveTestFoundation(repository, project.id)
    const batchChapter = repository.createChapter(project.id, '批次运行章')
    const nextChapter = repository.createChapter(project.id, '取消后普通章')
    const approved = approveSelectedBatch(repository, project.id, [batchChapter.id])
    repository.setChapterBatchStatus(approved.id, 'start', projectRevision(repository, project.id))
    const dispatched = repository.dispatchNextBatchItem(approved.id)
    expect(dispatched.workflow?.status).toBe('running')

    const cancelled = repository.setChapterBatchStatus(approved.id, 'cancel', projectRevision(repository, project.id))
    expect(cancelled).toMatchObject({ status: 'cancelled', items: [{ queueState: 'cancelled', workflow: { status: 'cancelled', currentNodeKey: null } }] })
    expect(repository.listRecoverableWorkflows()).toEqual([])
    expect(repository.startChapterWorkflow(nextChapter.id)).toMatchObject({ status: 'running', chapterId: nextChapter.id })
  })

  it('keeps cross-host batch cancellation terminal when a late workflow result is reconciled', () => {
    const root = temporaryRoot('novel-studio-batch-cancel-race-')
    const dispatchHost = openRepository(root)
    const project = dispatchHost.createProject({ title: '跨 Host 批次取消' }).project
    approveTestFoundation(dispatchHost, project.id)
    const chapter = dispatchHost.createChapter(project.id, '刚绑定的章节')
    const approved = approveSelectedBatch(dispatchHost, project.id, [chapter.id])
    dispatchHost.setChapterBatchStatus(approved.id, 'start', projectRevision(dispatchHost, project.id))

    const cancelHost = openRepository(root)
    const dispatched = dispatchHost.dispatchNextBatchItem(approved.id)
    expect(dispatched.workflow).toMatchObject({ status: 'running', chapterId: chapter.id })
    const cancelled = cancelHost.setChapterBatchStatus(approved.id, 'cancel', projectRevision(cancelHost, project.id))
    expect(cancelled).toMatchObject({ status: 'cancelled', items: [{ queueState: 'cancelled', workflow: { status: 'cancelled' } }] })

    // Simulate an already-delivered worker completion being observed after the
    // durable cancellation. Reconciliation must treat the batch row as authority.
    const lateResult = new DatabaseSync(join(root, 'novel-studio.db'))
    lateResult.prepare("UPDATE workflow_runs SET status='succeeded',current_node_key=NULL,finished_at=? WHERE id=?")
      .run(new Date().toISOString(), dispatched.workflow!.id)
    lateResult.close()

    expect(dispatchHost.reconcileChapterBatch(dispatched.workflow!.id)).toMatchObject({
      status: 'cancelled',
      items: [{ queueState: 'cancelled' }],
    })
  })

  it('reserves one project workflow slot for an active batch while other projects remain independent', () => {
    const root = temporaryRoot('novel-studio-project-workflow-mutex-')
    const repository = openRepository(root)
    const project = repository.createProject({ title: '批次互斥项目' }).project
    approveTestFoundation(repository, project.id)
    const batchChapter = repository.createChapter(project.id, '批次章')
    const ordinaryChapter = repository.createChapter(project.id, '普通生成章')
    const approved = approveSelectedBatch(repository, project.id, [batchChapter.id])
    const running = repository.setChapterBatchStatus(approved.id, 'start', projectRevision(repository, project.id))
    const reservedRevision = projectRevision(repository, project.id)

    expect(running.status).toBe('running')
    const competingHost = openRepository(root)
    expect(() => competingHost.startChapterWorkflow(ordinaryChapter.id)).toThrow(/项目已有.*章节批次|先暂停或完成批次/)
    expect(projectRevision(repository, project.id)).toBe(reservedRevision)

    const dispatched = repository.dispatchNextBatchItem(running.id)
    expect(dispatched).toMatchObject({ batch: { status: 'running', items: [{ queueState: 'dispatched' }] }, workflow: { projectId: project.id, status: 'running' } })
    expect(() => competingHost.startChapterWorkflow(ordinaryChapter.id)).toThrow(/项目已有.*章节工作流|先处理该运行/)
    expect(projectRevision(repository, project.id)).toBe(reservedRevision)

    const otherProject = repository.createProject({ title: '跨项目并发' }).project
    approveTestFoundation(repository, otherProject.id)
    const otherChapter = repository.createChapter(otherProject.id, '独立章')
    expect(repository.startChapterWorkflow(otherChapter.id)).toMatchObject({ projectId: otherProject.id, status: 'running' })
  })

  it('serializes direct ModelRuns and workflow activation across two SQLite connections', () => {
    const root = temporaryRoot('novel-studio-model-workflow-mutex-')
    const firstHost = openRepository(root)
    const project = firstHost.createProject({ title: '模型与工作流互斥' }).project
    approveTestFoundation(firstHost, project.id)
    const directChapter = firstHost.createChapter(project.id, '直连生成章')
    const workflowChapter = firstHost.createChapter(project.id, '工作流生成章')
    const batchChapter = firstHost.createChapter(project.id, '批次生成章')
    const approvedBatch = approveSelectedBatch(firstHost, project.id, [batchChapter.id])
    const secondHost = openRepository(root)
    const directContext = firstHost.getGenerationContext(directChapter.id, 'scene-plan')
    const competingContext = secondHost.getGenerationContext(workflowChapter.id, 'scene-plan')

    const directRun = firstHost.startModelRun(directContext, { provider: 'test', model: 'direct-owner' }, '{}')
    expect(() => secondHost.startModelRun(competingContext, { provider: 'test', model: 'direct-competitor' }, '{}')).toThrow(/已有.*模型生成|等待生成完成/)
    expect(() => secondHost.startChapterWorkflow(workflowChapter.id)).toThrow(/已有.*模型生成|等待生成完成/)

    firstHost.setChapterBatchStatus(approvedBatch.id, 'start', projectRevision(firstHost, project.id))
    expect(() => secondHost.dispatchNextBatchItem(approvedBatch.id)).toThrow(/已有.*模型生成|等待生成完成/)
    firstHost.setChapterBatchStatus(approvedBatch.id, 'cancel', projectRevision(firstHost, project.id))
    firstHost.failModelRun(directRun.id, new Error('释放直连模型槽'))

    const workflow = secondHost.startChapterWorkflow(workflowChapter.id)
    const freeze = secondHost.prepareWorkflowNode(workflow.id, 'freeze_input_snapshot', {})
    secondHost.completeWorkflowNode(workflow.id, freeze.nodeRunId, {}, 'retrieve_context')
    const retrieve = secondHost.prepareWorkflowNode(workflow.id, 'retrieve_context', {})
    secondHost.completeWorkflowNode(workflow.id, retrieve.nodeRunId, {}, 'plan_scenes')
    const plan = secondHost.prepareWorkflowNode(workflow.id, 'plan_scenes', {})
    const guardedContext = firstHost.getGenerationContext(workflowChapter.id, 'scene-plan')

    expect(() => firstHost.startModelRun(guardedContext, { provider: 'test', model: 'unguarded-inside-workflow' }, '{}')).toThrow(/章节工作流|运行中或待审/)
    const guardedRun = firstHost.startModelRun(guardedContext, { provider: 'test', model: 'guarded-owner' }, JSON.stringify({
      workflowGuard: { workflowRunId: workflow.id, workflowNodeRunId: plan.nodeRunId },
    }))
    expect(guardedRun.status).toBe('running')
    firstHost.failModelRun(guardedRun.id, new Error('测试结束'))
    secondHost.setWorkflowStatus(workflow.id, 'cancel_requested')
  })

  it('rejects a stale generation context after another connection changes project revision', () => {
    const root = temporaryRoot('novel-studio-model-revision-race-')
    const firstHost = openRepository(root)
    const project = firstHost.createProject({ title: '模型快照原子校验' }).project
    approveTestFoundation(firstHost, project.id)
    const chapter = firstHost.createChapter(project.id, '快照章节')
    const context = firstHost.getGenerationContext(chapter.id, 'scene-plan')
    const secondHost = openRepository(root)
    secondHost.createUserMemory(project.id, { content: '另一 Host 改变项目输入。', scope: 'project', category: 'constraint' }, projectRevision(secondHost, project.id))

    expect(() => firstHost.startModelRun(context, { provider: 'test', model: 'stale-context' }, '{}')).toThrow(/上下文已发生变化|revision/i)
    expect(firstHost.listModelRuns(chapter.id)).toHaveLength(0)
  })

  it('retries a normal batch failure from its failed node and opens a new round only for revision conflicts', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '批次失败节点重试' }).project
    approveTestFoundation(repository, project.id)
    const chapter = repository.createChapter(project.id, '重试章节')
    const approved = approveSelectedBatch(repository, project.id, [chapter.id])
    repository.setChapterBatchStatus(approved.id, 'start', projectRevision(repository, project.id))
    const dispatched = repository.dispatchNextBatchItem(approved.id)
    const workflowId = dispatched.workflow!.id
    const itemId = dispatched.batch.items[0]!.id

    const freeze = repository.prepareWorkflowNode(workflowId, 'freeze_input_snapshot', {})
    repository.completeWorkflowNode(workflowId, freeze.nodeRunId, {}, 'retrieve_context')
    const retrieve = repository.prepareWorkflowNode(workflowId, 'retrieve_context', {})
    repository.completeWorkflowNode(workflowId, retrieve.nodeRunId, {}, 'plan_scenes')
    const firstPlan = repository.prepareWorkflowNode(workflowId, 'plan_scenes', {})
    repository.failWorkflowNode(workflowId, firstPlan.nodeRunId, new Error('temporary provider failure'), true)
    repository.reconcileChapterBatch(workflowId)

    const beforeRetry = repository.getWorkflowRun(workflowId)
    const succeededIds = beforeRetry.nodes.filter(node => node.status === 'succeeded').map(node => node.id)
    const ordinaryRetry = repository.retryChapterBatchItem(approved.id, itemId, projectRevision(repository, project.id)).workflow!
    expect(ordinaryRetry).toMatchObject({ revisionRound: 0, currentNodeKey: 'plan_scenes', status: 'running' })
    expect(ordinaryRetry.nodes.filter(node => node.status === 'succeeded').map(node => node.id)).toEqual(succeededIds)
    expect(JSON.parse(ordinaryRetry.inputSnapshotJson)).toMatchObject({
      projectRevision: projectRevision(repository, project.id),
    })
    expect(ordinaryRetry.projectRevisionAtStart).toBe(projectRevision(repository, project.id))

    const retriedPlan = repository.prepareWorkflowNode(workflowId, 'plan_scenes', {})
    expect(retriedPlan.nodeRunId).toBe(firstPlan.nodeRunId)
    expect(repository.getWorkflowRun(workflowId).nodes.find(node => node.id === firstPlan.nodeRunId)).toMatchObject({ status: 'running', attempt: 2 })
    repository.failWorkflowNode(workflowId, retriedPlan.nodeRunId, new DomainError('revision-conflict', 'project changed'), true)
    repository.reconcileChapterBatch(workflowId)

    const conflictRetry = repository.retryChapterBatchItem(approved.id, itemId, projectRevision(repository, project.id)).workflow!
    expect(conflictRetry).toMatchObject({ revisionRound: 1, currentNodeKey: 'freeze_input_snapshot', status: 'running' })
    expect(JSON.parse(conflictRetry.inputSnapshotJson)).toMatchObject({ projectRevision: projectRevision(repository, project.id) })
  })

  it('pauses batch dispatch behind a foreign project workflow and resumes without stealing its run', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '普通与批次混合互斥' }).project
    approveTestFoundation(repository, project.id)
    const ordinaryChapter = repository.createChapter(project.id, '先启动普通工作流')
    const batchChapter = repository.createChapter(project.id, '等待批次章')
    const approved = approveSelectedBatch(repository, project.id, [batchChapter.id])
    const ordinary = repository.startChapterWorkflow(ordinaryChapter.id)
    const running = repository.setChapterBatchStatus(approved.id, 'start', projectRevision(repository, project.id))
    const revisionBeforeDispatch = projectRevision(repository, project.id)

    const held = repository.dispatchNextBatchItem(running.id)
    expect(held.workflow).toBeNull()
    expect(held.batch).toMatchObject({
      status: 'paused',
      items: [{ queueState: 'queued', workflowRunId: null }],
    })
    expect(JSON.parse(held.batch.errorJson ?? '{}')).toMatchObject({
      code: 'project-workflow-conflict',
      workflowRunId: ordinary.id,
      message: expect.stringMatching(/批次已安全暂停/),
    })
    expect(repository.getWorkflowRun(ordinary.id)).toMatchObject({ status: 'running', chapterId: ordinaryChapter.id })
    expect(repository.listChapterWorkflows(batchChapter.id)).toHaveLength(0)
    expect(projectRevision(repository, project.id)).toBe(revisionBeforeDispatch)

    repository.setWorkflowStatus(ordinary.id, 'cancel_requested')
    const resumed = repository.setChapterBatchStatus(held.batch.id, 'resume', projectRevision(repository, project.id))
    expect(resumed.status).toBe('running')
    const dispatched = repository.dispatchNextBatchItem(resumed.id)
    expect(dispatched).toMatchObject({ batch: { status: 'running', items: [{ queueState: 'dispatched' }] }, workflow: { projectId: project.id, chapterId: batchChapter.id, status: 'running' } })
    expect(dispatched.workflow?.id).not.toBe(ordinary.id)
    expect(repository.getWorkflowRun(ordinary.id).status).toBe('cancelled')
  })

  it('keeps relationship extraction optional for YOLO creation, start, and recovered dispatch', async () => {
    const repository = openRepository()
    const project = repository.createProject({ title: 'YOLO 关系安全前置条件' }).project
    approveTestFoundation(repository, project.id)
    const chapter = repository.createChapter(project.id, '安全门章节')
    const extractionRun = repository.createRelationshipExtractionRun(
      project.id, 'auto', { provider: 'test', model: 'relationship-extractor' }, '{}', 'non-blocking-ambiguity',
    )
    const [ambiguous] = repository.completeRelationshipExtractionRun(extractionRun, [{
      sourceEntityId: null, targetEntityId: null, sourceLabel: '未知人物', targetLabel: '同名组织',
      predicateKey: 'possibly-joins', label: '可能加入', category: 'membership', directionality: 'directed',
      factLayer: 'canon', validFromStoryOrder: null, validToStoryOrder: null, confidence: 0.4,
      evidenceJson: '[]', fingerprint: 'non-blocking-ambiguity',
    }])
    expect(ambiguous).toMatchObject({ status: 'ambiguous' })
    const createYolo = () => repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'yolo', chapterIds: [chapter.id], count: 1,
    }, { provider: 'test', model: 'batch-planner' }, projectRevision(repository, project.id))

    expect(repository.getRelationshipMode(project.id)).toBe('off')
    const created = createYolo()
    const planned = repository.completeChapterBatchPlan(created.id, [{
      chapterId: chapter.id, plannedTitle: '安全门章节', writingGoal: '验证恢复调度不会绕过关系安全门',
      openingContinuity: '', endingHook: '等待关系核对', targetWords: 2_400,
    }], { promptHash: 'yolo-relationship-precondition', outputJson: '{"items":1}' })
    const approved = repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
      id: item.id, plannedTitle: item.plannedTitle, writingGoal: item.writingGoal,
      openingContinuity: item.openingContinuity, endingHook: item.endingHook, targetWords: item.targetWords,
    })), projectRevision(repository, project.id))

    repository.setChapterBatchStatus(approved.id, 'start', projectRevision(repository, project.id))
    const enqueued: string[] = []
    const runner = new ChapterBatchRunner(new RepositoryChapterBatchStore(repository), {
      enqueue: workflowRunId => { enqueued.push(workflowRunId) },
      pause: () => undefined, resume: () => undefined, approve: () => undefined,
    })
    await expect(runner.recover()).resolves.toContain('running')
    const running = repository.getChapterBatch(approved.id)
    expect(running).toMatchObject({ status: 'running', errorJson: null, items: [{ queueState: 'dispatched', blockedReason: null }] })
    expect(enqueued).toEqual([running.items[0]!.workflowRunId])
    expect(repository.getWorkflowBatchAutomationMode('workflow-does-not-exist')).toBeNull()
  })

  it('does not invalidate an already-dispatched YOLO workflow when relationship extraction is turned OFF', () => {
    const root = temporaryRoot('novel-studio-yolo-workflow-guard-')
    const repository = openRepository(root)
    const project = repository.createProject({ title: '已派发 YOLO 关系安全门' }).project
    approveTestFoundation(repository, project.id)
    const chapter = repository.createChapter(project.id, '恢复安全门章节')
    repository.setRelationshipMode(project.id, 'auto', projectRevision(repository, project.id))
    const created = repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'yolo', chapterIds: [chapter.id], count: 1,
    }, { provider: 'test', model: 'batch-planner' }, projectRevision(repository, project.id))
    const planned = repository.completeChapterBatchPlan(created.id, [{
      chapterId: chapter.id, plannedTitle: '恢复安全门章节', writingGoal: '验证通用工作流入口不能绕过关系 OFF',
      openingContinuity: '', endingHook: '等待关系检查', targetWords: 2_400,
    }], { promptHash: 'dispatched-yolo-safety', outputJson: '{"items":1}' })
    const approved = repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
      id: item.id, plannedTitle: item.plannedTitle, writingGoal: item.writingGoal,
      openingContinuity: item.openingContinuity, endingHook: item.endingHook, targetWords: item.targetWords,
    })), projectRevision(repository, project.id))
    repository.setChapterBatchStatus(approved.id, 'start', projectRevision(repository, project.id))
    const dispatched = repository.dispatchNextBatchItem(approved.id)
    expect(dispatched.workflow).toMatchObject({ status: 'running' })

    repository.setRelationshipMode(project.id, 'off', projectRevision(repository, project.id))
    const workflowId = dispatched.workflow!.id
    expect(repository.getChapterBatch(approved.id)).toMatchObject({
      status: 'running', errorJson: null,
      items: [{ queueState: 'dispatched', workflowRunId: workflowId, blockedReason: null, workflow: { status: 'running' } }],
    })
    expect(repository.enforceWorkflowRelationshipSafety(workflowId)).toBe(true)
    expect(repository.setWorkflowStatus(workflowId, 'paused')).toMatchObject({ status: 'paused' })
    expect(repository.setWorkflowStatus(workflowId, 'running')).toMatchObject({ status: 'running' })
  })

  it('leaves independent workflows and AUTO batches available when relationship extraction is OFF', () => {
    const repository = openRepository()
    const independentProject = repository.createProject({ title: '独立工作流 OFF 语义' }).project
    approveTestFoundation(repository, independentProject.id)
    const independentChapter = repository.createChapter(independentProject.id, '独立章节')
    const independent = repository.startChapterWorkflow(independentChapter.id)
    expect(repository.enforceWorkflowRelationshipSafety(independent.id)).toBe(true)
    expect(repository.setWorkflowStatus(independent.id, 'paused').status).toBe('paused')
    expect(repository.setWorkflowStatus(independent.id, 'running').status).toBe('running')
    repository.setWorkflowStatus(independent.id, 'cancel_requested')

    const autoChapter = repository.createChapter(independentProject.id, 'AUTO 批次章节')
    const autoBatch = approveSelectedBatch(repository, independentProject.id, [autoChapter.id])
    repository.setChapterBatchStatus(autoBatch.id, 'start', projectRevision(repository, independentProject.id))
    const dispatched = repository.dispatchNextBatchItem(autoBatch.id)
    expect(dispatched.workflow).not.toBeNull()
    expect(repository.enforceWorkflowRelationshipSafety(dispatched.workflow!.id)).toBe(true)
    expect(repository.getChapterBatch(autoBatch.id)).toMatchObject({ status: 'running', items: [{ queueState: 'dispatched' }] })
  })

  it('persists approved briefs, fixes started queue positions, records continuity gaps, and recovers after restart', () => {
    const root = temporaryRoot('novel-studio-batch-storage-')
    const repository = openRepository(root)
    const project = repository.createProject({ title: '批次存储项目' }).project
    approveTestFoundation(repository, project.id)
    const chapters = [
      repository.createChapter(project.id, '第一章'),
      repository.createChapter(project.id, '第二章'),
      repository.createChapter(project.id, '第三章'),
    ]

    const created = repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'auto', chapterIds: chapters.map(chapter => chapter.id), count: chapters.length,
    }, { provider: 'test', model: 'batch-planner' }, projectRevision(repository, project.id))
    const planned = repository.completeChapterBatchPlan(created.id, chapters.map((chapter, index) => ({
      chapterId: chapter.id,
      plannedTitle: `计划第 ${index + 1} 章`,
      writingGoal: `推进第 ${index + 1} 个冲突`,
      openingContinuity: `承接节点 ${index}`,
      endingHook: `钩子 ${index + 1}`,
      targetWords: 2_800 + index * 100,
    })), { promptHash: 'batch-plan-hash', outputJson: '{"items":3}', streamedText: '批次计划预览' })
    const approved = repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
      id: item.id,
      plannedTitle: item.plannedTitle,
      writingGoal: item.writingGoal,
      openingContinuity: item.openingContinuity,
      endingHook: item.endingHook,
      targetWords: item.targetWords,
    })), projectRevision(repository, project.id))

    expect(approved).toMatchObject({ status: 'queued', items: [
      { queueState: 'queued', chapterRevisionAtEnqueue: 1 },
      { queueState: 'queued', chapterRevisionAtEnqueue: 1 },
      { queueState: 'queued', chapterRevisionAtEnqueue: 1 },
    ] })
    expect(repository.getGenerationContext(chapters[1]!.id, 'chapter-draft').chapterBrief).toMatchObject({
      writingGoal: '推进第 2 个冲突', openingContinuity: '承接节点 1', endingHook: '钩子 2', targetWords: 2_900,
      source: 'batch-plan', provider: 'test', model: 'batch-planner', promptHash: 'batch-plan-hash',
    })

    const running = repository.setChapterBatchStatus(approved.id, 'start', projectRevision(repository, project.id))
    expect(running.status).toBe('running')
    const dispatched = repository.dispatchNextBatchItem(running.id).batch
    const fixed = dispatched.items[0]!
    expect(fixed).toMatchObject({ queueState: 'dispatched', workflow: { status: 'running' } })

    expect(() => repository.reorderChapterBatch(dispatched.id, [
      dispatched.items[1]!.id, fixed.id, dispatched.items[2]!.id,
    ], projectRevision(repository, project.id))).toThrow(/already started|已经开始|已启动/i)

    const reordered = repository.reorderChapterBatch(dispatched.id, [
      fixed.id, dispatched.items[2]!.id, dispatched.items[1]!.id,
    ], projectRevision(repository, project.id))
    expect(reordered.items.map(item => item.id)).toEqual([fixed.id, dispatched.items[2]!.id, dispatched.items[1]!.id])

    const skipped = repository.skipChapterBatchItem(
      reordered.id,
      reordered.items[1]!.id,
      projectRevision(repository, project.id),
    )
    expect(skipped).toMatchObject({
      status: 'paused',
      items: [
        { id: fixed.id, queueState: 'dispatched' },
        { queueState: 'skipped', blockedReason: expect.stringContaining('连续性缺口') },
        { queueState: 'queued' },
      ],
    })
    expect(JSON.parse(skipped.errorJson ?? '{}')).toEqual({ warning: 'continuity-gap' })
    repository.close()

    const reopened = openRepository(root)
    const recovered = reopened.listRecoverableChapterBatches().find(batch => batch.id === skipped.id)
    expect(recovered).toMatchObject({
      id: skipped.id,
      status: 'paused',
      items: [
        { id: fixed.id, queueState: 'dispatched', workflowRunId: fixed.workflowRunId, workflow: { status: 'running' } },
        { id: reordered.items[1]!.id, queueState: 'skipped', blockedReason: expect.stringContaining('连续性缺口') },
        { id: reordered.items[2]!.id, queueState: 'queued' },
      ],
    })
  })
})

describe('versioned Memory Browser storage', () => {
  it('pages beyond 60 memories and exposes every ModelRun usage event through a dedicated cursor', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '记忆分页项目' }).project
    approveTestFoundation(repository, project.id)
    const chapter = repository.createChapter(project.id, '审计章节')
    const memories = Array.from({ length: 65 }, (_, index) => repository.createUserMemory(project.id, {
      content: `pagination-memory-${String(index + 1).padStart(2, '0')} 不可丢失。`, scope: 'project', category: index === 0 ? 'constraint' : 'other',
    }, projectRevision(repository, project.id)))

    const firstPage = repository.searchMemory(project.id, { origin: 'user', limit: 60 })
    expect(firstPage).toMatchObject({ total: 65, nextCursor: '60' })
    expect(firstPage.items).toHaveLength(60)
    const secondPage = repository.searchMemory(project.id, { origin: 'user', limit: 60, cursor: firstPage.nextCursor! })
    expect(secondPage).toMatchObject({ total: 65, nextCursor: null })
    expect(secondPage.items).toHaveLength(5)
    expect(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size).toBe(65)

    const target = memories[0]!
    const context = repository.getGenerationContext(chapter.id, 'chapter-draft')
    for (let index = 0; index < 35; index += 1) {
      const run = repository.startModelRun(context, { provider: 'test', model: `usage-${index}` }, JSON.stringify({
        promptAssemblyTrace: { sections: [{
          key: `memory:${target.id}`, sourceIds: [target.id], included: index % 4 !== 0, truncated: index % 5 === 0,
          estimatedTokens: 10 + index, reason: index % 4 === 0 ? '预算未纳入' : '按作者约束纳入',
        }] },
      }))
      repository.failModelRun(run.id, new Error('usage pagination fixture completed'))
    }
    const usagePage = repository.listMemoryUsages(target.id, { limit: 20 })
    expect(usagePage).toMatchObject({ total: 35, nextCursor: '20' })
    expect(usagePage.items).toHaveLength(20)
    expect(usagePage.items[0]).toEqual(expect.objectContaining({ modelRunId: expect.any(String), sectionKey: `memory:${target.id}`, estimatedTokens: expect.any(Number), reason: expect.any(String) }))
    const usageTail = repository.listMemoryUsages(target.id, { limit: 20, cursor: usagePage.nextCursor! })
    expect(usageTail).toMatchObject({ total: 35, nextCursor: null })
    expect(usageTail.items).toHaveLength(15)
  })

  it('keeps archived projects searchable while every Memory mutation remains blocked', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '归档记忆项目' }).project
    const memory = repository.createUserMemory(project.id, { content: '归档后仍可阅读。', scope: 'project', category: 'continuity' }, projectRevision(repository, project.id))
    const archived = repository.archiveProject(project.id, projectRevision(repository, project.id))
    expect(repository.searchMemory(project.id, { q: '归档后' })).toMatchObject({ total: 1, items: [{ id: memory.id }] })
    expect(repository.listMemoryRevisions(memory.id)).toHaveLength(1)
    expect(() => repository.updateUserMemory(memory.id, { content: '禁止修改', baseRevision: memory.revision, projectRevision: archived.revision })).toThrow(/只读|归档/)
    expect(() => repository.createUserMemory(project.id, { content: '禁止新增', scope: 'project', category: 'other' }, archived.revision)).toThrow(/只读|归档/)
  })

  it('searches current content and keeps immutable content revisions continuous across archive and restore', () => {
    const repository = openRepository()
    const project = repository.createProject({ title: '记忆版本项目' }).project
    const first = repository.createUserMemory(project.id, {
      content: 'memoryphase1 月亮最初是白色。', scope: 'project', category: 'constraint',
    }, projectRevision(repository, project.id))
    const second = repository.updateUserMemory(first.id, {
      content: 'memoryphase2 月亮已经固定为红色。',
      category: 'continuity',
      promptPolicy: 'auto',
      baseRevision: first.revision,
      projectRevision: projectRevision(repository, project.id),
    })

    expect(repository.searchMemory(project.id, {
      q: 'memoryphase2', origin: 'user', category: 'continuity', promptPolicy: 'auto', state: 'active',
    })).toMatchObject({ total: 1, items: [{ id: first.id, currentRevision: { id: second.currentRevision.id } }] })
    expect(repository.searchMemory(project.id, { q: 'memoryphase1' }).total).toBe(0)
    expect(repository.getMemoryRevisionDiff(first.id, first.currentRevision.id, second.currentRevision.id).lines)
      .toEqual(expect.arrayContaining([
        { kind: 'removed', text: 'memoryphase1 月亮最初是白色。' },
        { kind: 'added', text: 'memoryphase2 月亮已经固定为红色。' },
      ]))

    const archived = repository.setMemoryItemArchived(
      first.id,
      true,
      second.revision,
      projectRevision(repository, project.id),
    )
    expect(repository.searchMemory(project.id, { state: 'archived' })).toMatchObject({ total: 1, items: [{ id: first.id }] })
    const restored = repository.setMemoryItemArchived(
      first.id,
      false,
      archived.revision,
      projectRevision(repository, project.id),
    )
    const third = repository.updateUserMemory(first.id, {
      content: 'memoryphase3 归档恢复后继续补充红月约束。',
      baseRevision: restored.revision,
      projectRevision: projectRevision(repository, project.id),
    })

    expect(third).toMatchObject({ revision: 5, state: 'active', currentRevision: { revision: 3, parentRevisionId: second.currentRevision.id } })
    expect(repository.listMemoryRevisions(first.id).map(revision => ({
      revision: revision.revision, id: revision.id, parentRevisionId: revision.parentRevisionId, content: revision.content,
    }))).toEqual([
      { revision: 3, id: third.currentRevision.id, parentRevisionId: second.currentRevision.id, content: 'memoryphase3 归档恢复后继续补充红月约束。' },
      { revision: 2, id: second.currentRevision.id, parentRevisionId: first.currentRevision.id, content: 'memoryphase2 月亮已经固定为红色。' },
      { revision: 1, id: first.currentRevision.id, parentRevisionId: null, content: 'memoryphase1 月亮最初是白色。' },
    ])
  })

  it('surfaces a real Markdown three-way conflict and resolves it as a new immutable revision', () => {
    const root = temporaryRoot('novel-studio-memory-conflict-')
    const workspace = join(root, 'author-workspace')
    mkdirSync(workspace, { recursive: true })
    const repository = openRepository(root)
    const project = repository.createProject({
      title: 'Markdown 冲突项目', workspacePath: workspace, markdownSyncEnabled: true,
    }).project
    const first = repository.createUserMemory(project.id, {
      content: 'database-base-memory', scope: 'project', category: 'continuity',
    }, projectRevision(repository, project.id))
    const relativePath = memoryItemMarkdownPath(first.id, 'user')
    const absolutePath = join(workspace, ...relativePath.split('/'))
    const originalFile = readFileSync(absolutePath, 'utf8')
    writeFileSync(absolutePath, originalFile.replace('database-base-memory', 'filesystem-branch-memory'), 'utf8')

    const databaseBranch = repository.updateUserMemory(first.id, {
      content: 'database-branch-memory',
      baseRevision: first.revision,
      projectRevision: projectRevision(repository, project.id),
    })
    expect(databaseBranch).toMatchObject({ state: 'conflicted', currentRevision: { revision: 2, content: 'database-branch-memory' } })
    const rescanned = repository.rescanMemoryMarkdown(project.id, projectRevision(repository, project.id))
    expect(rescanned.conflicts).toHaveLength(1)
    expect(rescanned.conflicts[0]).toMatchObject({
      itemId: first.id,
      baseRevisionId: first.currentRevision.id,
      baseContent: 'database-base-memory',
      databaseRevisionId: databaseBranch.currentRevision.id,
      databaseContent: 'database-branch-memory',
      fileContent: 'filesystem-branch-memory',
      status: 'open',
    })
    expect(rescanned.conflicts[0]!.baseToDatabaseDiff).toEqual(expect.arrayContaining([{ kind: 'removed', text: 'database-base-memory' }, { kind: 'added', text: 'database-branch-memory' }]))
    expect(rescanned.conflicts[0]!.baseToFileDiff).toEqual(expect.arrayContaining([{ kind: 'removed', text: 'database-base-memory' }, { kind: 'added', text: 'filesystem-branch-memory' }]))
    expect(() => repository.updateUserMemory(first.id, {
      content: 'must-not-overwrite-conflict',
      baseRevision: databaseBranch.revision,
      projectRevision: projectRevision(repository, project.id),
    })).toThrow(/冲突|conflict/i)

    expect(() => repository.resolveMemoryConflict(
      first.id,
      rescanned.conflicts[0]!.id,
      'both',
      databaseBranch.revision,
      projectRevision(repository, project.id),
    )).toThrow(/合并正文/)
    const mergedContent = 'author-edited-merged-memory：保留双方事实，但由作者明确重写。'
    const merged = repository.resolveMemoryConflict(
      first.id,
      rescanned.conflicts[0]!.id,
      'merged',
      databaseBranch.revision,
      projectRevision(repository, project.id),
      mergedContent,
    )
    expect(merged).toMatchObject({ state: 'active', revision: 3, currentRevision: { revision: 3, parentRevisionId: databaseBranch.currentRevision.id } })
    expect(merged.currentRevision).toMatchObject({ content: mergedContent, actor: 'user' })
    expect(repository.listMemoryConflicts(project.id)).toMatchObject([{ id: rescanned.conflicts[0]!.id, status: 'resolved', resolution: 'merged' }])
    expect(readFileSync(absolutePath, 'utf8')).toContain(mergedContent)
  })
})

describe('entity relationship storage', () => {
  it('persists AUTO review evidence, bounds YOLO graph output, and leaves ambiguous candidates pending', () => {
    const root = temporaryRoot('novel-studio-relationship-storage-')
    seedSchemaV16(root, 90)
    const repository = openRepository(root)
    const projectId = 'project-v16'
    expect(repository.getRelationshipMode(projectId)).toBe('off')
    expect(repository.setRelationshipMode(projectId, 'auto', projectRevision(repository, projectId))).toBe('auto')

    const autoRun = repository.createRelationshipExtractionRun(
      projectId,
      'auto',
      { provider: 'test', model: 'relationship-extractor' },
      '{"sources":["manuscript-v16"]}',
      'auto-prompt-hash',
    )
    const evidenceHash = createHash('sha256').update('旧正文：潮汐证据。迁移后仍应完整保留。').digest('hex')
    const [pending] = repository.completeRelationshipExtractionRun(autoRun, [relationshipCandidate(2, {
      predicateKey: 'mentors',
      label: '指导',
      category: 'knowledge',
      evidenceJson: JSON.stringify([{
        sourceType: 'manuscript-version', sourceId: 'manuscript-v16', label: '批准正文证据', excerptStart: 0, excerptEnd: 4, contentHash: evidenceHash,
      }]),
    })])
    expect(pending).toMatchObject({ status: 'pending', sourceEntityId: 'entity-v16-1', targetEntityId: 'entity-v16-2' })
    expect(repository.getRelationshipGraph(projectId).pendingCount).toBe(1)

    const confirmed = repository.decideRelationshipCandidate(
      projectId,
      pending!.id,
      'confirm',
      undefined,
      projectRevision(repository, projectId),
    )
    expect(confirmed).toMatchObject({ createdBy: 'ai_confirmed', label: '指导' })
    const confirmedEvidence = repository.getRelationshipEvidence(projectId, confirmed!.id)
    expect(confirmedEvidence).toMatchObject([{
      sourceType: 'manuscript-version', sourceId: 'manuscript-v16', label: '批准正文证据', excerptStart: 0, excerptEnd: 4,
      contentHash: evidenceHash, excerpt: '旧正文：',
    }])
    expect(confirmedEvidence[0]!.createdAt).toBe(confirmed!.createdAt)

    const duplicateRun = repository.createRelationshipExtractionRun(
      projectId, 'auto', { provider: 'test', model: 'relationship-extractor' }, '{"sources":["manuscript-v16"]}', 'duplicate-evidence-run',
    )
    const [duplicateCandidate] = repository.completeRelationshipExtractionRun(duplicateRun, [relationshipCandidate(2, {
      predicateKey: 'mentors', label: '指导', category: 'knowledge',
      evidenceJson: JSON.stringify([{
        sourceType: 'manuscript-version', sourceId: 'manuscript-v16', label: '批准正文证据', excerptStart: 0, excerptEnd: 4, contentHash: evidenceHash,
      }]),
    })])
    const duplicateRelationship = repository.decideRelationshipCandidate(
      projectId, duplicateCandidate!.id, 'confirm', undefined, projectRevision(repository, projectId),
    )
    expect(duplicateRelationship!.id).toBe(confirmed!.id)
    expect(repository.getRelationshipEvidence(projectId, confirmed!.id)).toHaveLength(1)

    const unlocatedRun = repository.createRelationshipExtractionRun(
      projectId, 'auto', { provider: 'test', model: 'relationship-extractor' }, '{"sources":["manuscript-v16"]}', 'unlocated-evidence-run',
    )
    const [unlocatedCandidate] = repository.completeRelationshipExtractionRun(unlocatedRun, [relationshipCandidate(2, {
      predicateKey: 'unlocated-evidence', label: '未定位证据', category: 'knowledge',
      evidenceJson: JSON.stringify([{
        sourceType: 'manuscript-version', sourceId: 'manuscript-v16', label: '只有来源，没有精确摘录', contentHash: evidenceHash,
      }]),
    })])
    expect(unlocatedCandidate!.status).toBe('ambiguous')
    const unlocatedRelationship = repository.decideRelationshipCandidate(
      projectId, unlocatedCandidate!.id, 'confirm', undefined, projectRevision(repository, projectId),
    )!
    expect(repository.getRelationshipEvidence(projectId, unlocatedRelationship.id)).toMatchObject([{ excerptStart: null, excerptEnd: null, excerpt: null }])

    expect(repository.setRelationshipMode(projectId, 'yolo', projectRevision(repository, projectId))).toBe('yolo')
    const yoloRun = repository.createRelationshipExtractionRun(
      projectId,
      'yolo',
      { provider: 'test', model: 'relationship-extractor' },
      '{"sources":["approved-foundation","approved-manuscript","canon"]}',
      'yolo-prompt-hash',
    )
    const yoloEvidenceJson = JSON.stringify([{
      sourceType: 'manuscript-version', sourceId: 'manuscript-v16', sourceVersionId: 'manuscript-v16',
      label: '旧正文：', excerptStart: 0, excerptEnd: 4, contentHash: evidenceHash,
    }])
    const yoloInput = [
      ...Array.from({ length: 88 }, (_, offset) => relationshipCandidate(offset + 3, { evidenceJson: yoloEvidenceJson })),
      relationshipCandidate(999, {
        sourceEntityId: null,
        targetEntityId: null,
        sourceLabel: '未知人物',
        targetLabel: '同名组织',
        predicateKey: 'possibly-joins',
        label: '可能加入',
        confidence: 0.4,
      }),
    ]
    const yoloCandidates = repository.completeRelationshipExtractionRun(yoloRun, yoloInput)
    expect(yoloCandidates.filter(candidate => candidate.status === 'confirmed')).toHaveLength(88)
    expect(yoloCandidates.filter(candidate => candidate.status === 'ambiguous')).toHaveLength(1)
    expect(repository.listRelationshipCandidates(projectId, 'ambiguous')).toMatchObject([{
      sourceLabel: '未知人物', targetLabel: '同名组织', status: 'ambiguous',
    }])

    const graph = repository.getRelationshipGraph(projectId, {
      rootEntityId: 'entity-v16-1', depth: 2, limitNodes: 999, limitEdges: 999,
    })
    expect(graph).toMatchObject({ mode: 'yolo', pendingCount: 1, truncated: true })
    expect(graph.nodes).toHaveLength(80)
    expect(graph.edges.length).toBeLessThanOrEqual(180)
    expect(graph.edges.some(edge => edge.createdBy === 'ai_yolo')).toBe(true)

    const compactGraph = repository.getRelationshipGraph(projectId, {
      rootEntityId: 'entity-v16-1', depth: 1,
    })
    expect(compactGraph.nodes).toHaveLength(60)
    expect(compactGraph.edges.length).toBeLessThanOrEqual(120)
    expect(compactGraph.truncated).toBe(true)

    const batchRun = repository.createRelationshipExtractionRun(
      projectId,
      'auto',
      { provider: 'test', model: 'relationship-extractor' },
      '{"sources":["manual-review"]}',
      'batch-review-prompt-hash',
    )
    const batchCandidates = repository.completeRelationshipExtractionRun(batchRun, [
      relationshipCandidate(89, { predicateKey: 'batch-review-a', label: '批量候选 A' }),
      relationshipCandidate(90, { predicateKey: 'batch-review-b', label: '批量候选 B' }),
    ])
    const revisionBeforeBatch = projectRevision(repository, projectId)
    const decided = repository.decideRelationshipCandidates(projectId, [
      {
        candidateId: batchCandidates[0]!.id,
        decision: 'confirm',
        input: {
          sourceEntityId: 'entity-v16-2',
          targetEntityId: 'entity-v16-3',
          predicateKey: 'batch-confirmed',
          label: '批量确认关系',
          category: 'conflict',
          directionality: 'symmetric',
          factLayer: 'planned',
          validFromStoryOrder: 5,
          validToStoryOrder: 9,
        },
      },
      { candidateId: batchCandidates[1]!.id, decision: 'reject' },
    ], revisionBeforeBatch)
    expect(projectRevision(repository, projectId)).toBe(revisionBeforeBatch + 1)
    expect(decided).toMatchObject([
      { candidateId: batchCandidates[0]!.id, decision: 'confirm', relationship: {
        sourceEntityId: 'entity-v16-2', targetEntityId: 'entity-v16-3', predicateKey: 'batch-confirmed', label: '批量确认关系',
        category: 'conflict', directionality: 'symmetric', factLayer: 'planned', validFromStoryOrder: 5, validToStoryOrder: 9,
      } },
      { candidateId: batchCandidates[1]!.id, decision: 'reject', relationship: null },
    ])
    expect(repository.listRelationshipCandidates(projectId).filter(candidate => batchCandidates.some(item => item.id === candidate.id)).map(candidate => candidate.status).sort()).toEqual(['confirmed', 'rejected'])

    const filtered = repository.listEntityRelationships(projectId, {
      q: '批量确认', categories: ['conflict'], factLayers: ['planned'], atStoryOrder: 7, limit: 1,
    })
    expect(filtered).toMatchObject({ total: 1, nextCursor: null, items: [{
      label: '批量确认关系', sourceEntityName: '迁移实体 2', targetEntityName: '迁移实体 3', evidenceCount: 0,
    }] })
    expect(repository.listEntityRelationships(projectId, { categories: ['conflict'], factLayers: ['planned'], atStoryOrder: 10 }).total).toBe(0)

    const firstPage = repository.listEntityRelationships(projectId, { categories: ['alliance'], factLayers: ['canon'], atStoryOrder: 1, limit: 10 })
    expect(firstPage.total).toBeGreaterThanOrEqual(88)
    expect(firstPage.items).toHaveLength(10)
    expect(firstPage.nextCursor).toBe('10')
    const secondPage = repository.listEntityRelationships(projectId, { categories: ['alliance'], factLayers: ['canon'], atStoryOrder: 1, cursor: firstPage.nextCursor!, limit: 10 })
    expect(secondPage.items).toHaveLength(10)
    expect(secondPage.items.some(item => firstPage.items.some(first => first.id === item.id))).toBe(false)

    expect(repository.listRelationshipExtractionRuns(projectId, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: batchRun, status: 'succeeded', candidateCount: 2, pendingCount: 0 }),
      expect.objectContaining({ id: yoloRun, status: 'blocked', candidateCount: 89, pendingCount: 1 }),
    ]))
    expect(() => repository.decideRelationshipCandidates(projectId, [{ candidateId: batchCandidates[0]!.id, decision: 'reject' }], revisionBeforeBatch)).toThrow(/revision|version|版本/i)
  })
})
