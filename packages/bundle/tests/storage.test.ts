import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DomainError } from '../src/domain/model.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../src/storage-sqlite/migrations.js'

const roots: string[] = []

function repository(root = mkdtempSync(join(tmpdir(), 'novel-studio-storage-'))) {
  roots.push(root)
  return { root, value: new SqliteNovelRepository({ dataRoot: root }) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Phase 1 SQLite repository', () => {
  it('migrates a blank database with the required runtime pragmas', () => {
    const { value } = repository()
    expect(value.health()).toMatchObject({ ready: true, schemaVersion: 20, expectedSchemaVersion: 20, journalMode: 'wal', foreignKeys: true })
    value.close()
  })

  it('creates the project hierarchy and immutable manuscript versions', () => {
    const { value } = repository()
    const tree = value.createProject({ title: '潮汐尽头', genre: '科幻' })
    expect(tree.books).toHaveLength(1)
    expect(tree.books[0]?.volumes).toHaveLength(1)

    const chapter = value.createChapter(tree.project.id, '第一章 雾港')
    const first = value.saveDraft(chapter.id, { content: '第一版正文。', baseRevision: chapter.revision })
    const second = value.saveDraft(chapter.id, { content: '第二版正文，内容仍然保留历史。', baseRevision: first.revision })
    expect(second.versions).toHaveLength(2)
    expect(new Set(second.versions.map(version => version.content))).toEqual(new Set(['第一版正文。', '第二版正文，内容仍然保留历史。']))

    const approved = value.approveVersion(chapter.id, second.currentDraftVersionId!, second.revision)
    expect(approved.currentApprovedVersionId).toBe(second.currentDraftVersionId)
    expect(approved.versions.find(version => version.id === second.currentDraftVersionId)?.status).toBe('approved')
    value.close()
  })

  it('rejects stale revisions without creating a version', () => {
    const { value } = repository()
    const project = value.createProject({ title: '并发测试' })
    const chapter = value.createChapter(project.project.id)
    value.saveDraft(chapter.id, { content: '新内容', baseRevision: chapter.revision })
    expect(() => value.saveDraft(chapter.id, { content: '过期内容', baseRevision: chapter.revision })).toThrow(DomainError)
    expect(value.getChapter(chapter.id).versions).toHaveLength(1)
    value.close()
  })

  it('projects manuscript versions into a content-free story growth map', () => {
    const { value } = repository()
    const project = value.createProject({ title: '枝干测试' })
    const firstChapter = value.createChapter(project.project.id, '主干一')
    const firstDraft = value.saveDraft(firstChapter.id, { content: '不可出现在可视化接口里的正文秘密。', baseRevision: firstChapter.revision })
    value.saveDraft(firstChapter.id, { content: '第二版正文继续生长。', baseRevision: firstDraft.revision })
    value.createChapter(project.project.id, '主干二')

    const growth = value.getStoryGrowthMap(project.project.id)
    expect(growth.anchors.map(anchor => anchor.chapterTitle)).toEqual(['主干一', '主干二'])
    expect(growth.anchors[0]?.branches).toHaveLength(2)
    expect(growth.anchors[0]?.totalWordCount).toBeGreaterThan(0)
    expect(JSON.stringify(growth)).not.toContain('正文秘密')
    value.close()
  })

  it('aggregates content-free generation statistics without estimating missing usage', () => {
    const { root, value } = repository()
    const project = value.createProject({ title: '统计测试' })
    const chapter = value.createChapter(project.project.id, '消耗明细')
    value.saveDraft(chapter.id, { content: 'MANUAL_SECRET must not enter statistics.', baseRevision: chapter.revision })
    const current = value.getChapter(chapter.id)
    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    const prompt = database.prepare('SELECT id FROM prompt_asset_versions ORDER BY created_at LIMIT 1').get() as { id: string }
    const insertRun = database.prepare(`INSERT INTO model_runs(
      id,project_id,chapter_id,purpose,provider,model,prompt_asset_version_id,project_revision,chapter_revision,status,input_snapshot_json,output_json,usage_json,created_at,finished_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    insertRun.run('stats-scene-success', project.project.id, chapter.id, 'scene-plan', 'test', 'test', prompt.id, current.revision, current.revision, 'succeeded', '{"secret":"INPUT_SECRET"}', '{"secret":"OUTPUT_SECRET"}', '{"inputTokens":10,"outputTokens":4,"cacheReadTokens":3}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z')
    insertRun.run('stats-draft-success', project.project.id, chapter.id, 'chapter-draft', 'test', 'test', prompt.id, current.revision, current.revision, 'succeeded', '{}', '{}', '{"inputTokens":20,"outputTokens":30,"reasoningTokens":5}', '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:01.000Z')
    insertRun.run('stats-draft-failed', project.project.id, chapter.id, 'chapter-draft', 'test', 'test', prompt.id, current.revision, current.revision, 'failed', '{}', null, null, '2026-01-01T00:02:00.000Z', '2026-01-01T00:02:01.000Z')
    insertRun.run('stats-scene-running', project.project.id, chapter.id, 'scene-plan', 'test', 'test', prompt.id, current.revision, current.revision, 'running', '{}', null, null, '2026-01-01T00:03:00.000Z', null)
    database.prepare(`INSERT INTO manuscript_versions(
      id,project_id,chapter_id,status,content,content_hash,word_count,origin,created_by,prompt_asset_version_id,model_run_id,created_at
    ) VALUES (?,?,?,'draft','MODEL_SECRET must not enter statistics.','hash-model',321,'model','model',?,?,?)`).run('stats-model-version', project.project.id, chapter.id, prompt.id, 'stats-draft-success', '2026-01-01T00:01:01.000Z')
    database.prepare(`INSERT INTO manuscript_versions(
      id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,prompt_asset_version_id,model_run_id,created_at,approved_at
    ) VALUES (?,?,?,'stats-model-version','approved','MODEL_SECRET later revision.','hash-model-copy',999,'model','model',?,?,?,?)`).run('stats-model-version-copy', project.project.id, chapter.id, prompt.id, 'stats-draft-success', '2026-01-01T00:01:02.000Z', '2026-01-01T00:01:02.000Z')
    database.prepare("UPDATE chapters SET current_approved_version_id='stats-model-version-copy',status='approved' WHERE id=?").run(chapter.id)
    database.close()

    const statistics = value.getProjectGenerationStatistics(project.project.id)
    expect(statistics.totals).toEqual({
      runs: 4,
      succeededRuns: 2,
      failedRuns: 1,
      runningRuns: 1,
      usageReportedRuns: 2,
      inputTokens: 30,
      outputTokens: 34,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
      reasoningTokens: 5,
      generatedDrafts: 1,
      generatedWords: 321,
    })
    expect(statistics.purposes.find(item => item.purpose === 'scene-plan')).toMatchObject({ runs: 2, succeededRuns: 1, runningRuns: 1, usageReportedRuns: 1, generatedWords: 0 })
    expect(statistics.purposes.find(item => item.purpose === 'chapter-draft')).toMatchObject({ runs: 2, succeededRuns: 1, failedRuns: 1, usageReportedRuns: 1, generatedWords: 321 })
    expect(statistics.chapters[0]).toMatchObject({ chapterTitle: '消耗明细', runs: 4, generatedWords: 321, lastRunAt: '2026-01-01T00:03:00.000Z' })
    expect(statistics.project).toEqual({ id: project.project.id, title: '统计测试', status: 'active' })
    expect(statistics.project).not.toHaveProperty('workspacePath')
    expect(JSON.stringify(statistics)).not.toMatch(/MANUAL_SECRET|MODEL_SECRET|INPUT_SECRET|OUTPUT_SECRET/)
    value.close()
  })

  it('recovers workspace and content after the repository is reopened', () => {
    const { root, value } = repository()
    const project = value.createProject({ title: '重启恢复' })
    const chapter = value.createChapter(project.project.id, '恢复章')
    const first = value.saveDraft(chapter.id, { content: '重启后仍在。', baseRevision: chapter.revision })
    value.selectWorkspace(project.project.id, chapter.id)
    value.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    const workspace = reopened.getWorkspace()
    expect(workspace.selectedProjectId).toBe(project.project.id)
    expect(workspace.selectedChapterId).toBe(chapter.id)
    expect(workspace.selectedChapter?.versions[0]?.content).toBe('重启后仍在。')
    expect(workspace.selectedChapter?.revision).toBe(first.revision)
    reopened.close()
  })

  it('opens archived projects as a durable read-only workspace', () => {
    const { root, value } = repository()
    const project = value.createProject({ title: '归档只读' })
    const chapter = value.createChapter(project.project.id, '只读章节')
    const archived = value.archiveProject(project.project.id, value.getProjectTree(project.project.id).project.revision)
    expect(archived.status).toBe('archived')
    const selected = value.selectWorkspace(project.project.id, null)
    expect(selected.selectedProject?.project).toMatchObject({ id: project.project.id, status: 'archived' })
    expect(selected.projects.map(item => item.id)).not.toContain(project.project.id)
    expect(() => value.createChapter(project.project.id, '禁止写入')).toThrow(/归档|只读/)
    value.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    expect(reopened.getWorkspace()).toMatchObject({ selectedProjectId: project.project.id, selectedProject: { project: { status: 'archived' } } })
    expect(reopened.getProjectTree(project.project.id).books[0]?.volumes[0]?.chapters[0]?.id).toBe(chapter.id)
    reopened.close()
  })

  it('leaves the database available after code-side close', () => {
    const { root, value } = repository()
    const project = value.createProject({ title: '卸载保留' })
    value.close()
    const reopened = new SqliteNovelRepository({ dataRoot: root })
    expect(reopened.listProjects().map(item => item.id)).toContain(project.project.id)
    reopened.close()
  })

  it('migrates a Phase 1 database without losing manuscript content', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-phase1-upgrade-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    database.exec('PRAGMA foreign_keys=ON; ' + migrations[0]!.sql)
    const timestamp = new Date().toISOString()
    database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (1,?,?)').run('phase-1-project-and-manuscript-core', timestamp)
    database.prepare("INSERT INTO projects(id,title,slug,language,status,current_book_id,created_at,updated_at) VALUES ('p','旧项目','old','zh-CN','active','b',?,?)").run(timestamp, timestamp)
    database.prepare("INSERT INTO books(id,project_id,title,position,created_at) VALUES ('b','p','旧项目',1,?)").run(timestamp)
    database.prepare("INSERT INTO volumes(id,project_id,book_id,title,position,created_at) VALUES ('v','p','b','第一卷',1,?)").run(timestamp)
    database.prepare("INSERT INTO chapters(id,project_id,book_id,volume_id,chapter_number,title,status,current_draft_version_id,revision,created_at,updated_at) VALUES ('c','p','b','v',1,'旧章','draft','mv',1,?,?)").run(timestamp, timestamp)
    database.prepare("INSERT INTO manuscript_versions(id,project_id,chapter_id,status,content,content_hash,word_count,origin,created_by,created_at) VALUES ('mv','p','c','draft','旧正文','hash',3,'user','user',?)").run(timestamp)
    database.close()

    const upgraded = new SqliteNovelRepository({ dataRoot: root })
    expect(upgraded.health().schemaVersion).toBe(20)
    expect(upgraded.getChapter('c').versions[0]).toMatchObject({ content: '旧正文', origin: 'user', promptAssetVersionId: null, modelRunId: null })
    expect(upgraded.getPromptCatalog('p').assets).toHaveLength(2)
    upgraded.close()
  })

  it('adds immutable chapter-draft v2 and upgrades only official v1 selections on reopen', () => {
    const { root, value } = repository()
    const project = value.createProject({ title: '旧 Prompt 升级' }).project
    expect(value.getPromptCatalog(project.id).selections['chapter-draft']).toBe('prompt-chapter-draft-v2')
    value.selectPromptVersion(project.id, 'chapter-draft', 'prompt-chapter-draft-v1')
    value.close()

    const legacy = new DatabaseSync(join(root, 'novel-studio.db'))
    legacy.prepare("UPDATE prompt_assets SET active_version_id='prompt-chapter-draft-v1' WHERE id='prompt-chapter-draft'").run()
    legacy.prepare("DELETE FROM prompt_asset_versions WHERE id='prompt-chapter-draft-v2'").run()
    legacy.close()

    const upgraded = new SqliteNovelRepository({ dataRoot: root })
    const catalog = upgraded.getPromptCatalog(project.id)
    const chapterDraft = catalog.assets.find(item => item.id === 'prompt-chapter-draft')!
    const scenePlan = catalog.assets.find(item => item.id === 'prompt-scene-plan')!
    expect(chapterDraft.activeVersionId).toBe('prompt-chapter-draft-v2')
    expect(catalog.selections['chapter-draft']).toBe('prompt-chapter-draft-v2')
    expect(chapterDraft.versions.map(item => item.id)).toEqual(['prompt-chapter-draft-v2', 'prompt-chapter-draft-v1'])
    expect(scenePlan.activeVersionId).toBe('prompt-scene-plan-v1')
    expect(catalog.selections['scene-plan']).toBe('prompt-scene-plan-v1')
    upgraded.close()
  })

  it('preserves a custom chapter prompt selection while adding builtin v2 around an occupied version number', () => {
    const { root, value } = repository()
    const project = value.createProject({ title: '自定义 Prompt 保留' }).project
    value.close()

    const legacy = new DatabaseSync(join(root, 'novel-studio.db'))
    const timestamp = new Date().toISOString()
    legacy.prepare("UPDATE prompt_assets SET active_version_id='prompt-chapter-draft-v1' WHERE id='prompt-chapter-draft'").run()
    legacy.prepare("DELETE FROM prompt_asset_versions WHERE id='prompt-chapter-draft-v2'").run()
    legacy.prepare(`INSERT INTO prompt_asset_versions(id,prompt_asset_id,version,locale,template,input_schema_json,output_schema_json,source,content_hash,created_at)
      VALUES ('custom-chapter-v2','prompt-chapter-draft',2,'zh-CN','作者自定义章节 Prompt','{}','{}','user','custom-hash',?)`).run(timestamp)
    legacy.prepare("UPDATE prompt_assets SET active_version_id='custom-chapter-v2' WHERE id='prompt-chapter-draft'").run()
    legacy.prepare(`INSERT INTO project_prompt_overrides(project_id,purpose,prompt_asset_version_id,updated_at)
      VALUES (?,'chapter-draft','custom-chapter-v2',?)`).run(project.id, timestamp)
    legacy.close()

    const reopened = new SqliteNovelRepository({ dataRoot: root })
    const catalog = reopened.getPromptCatalog(project.id)
    const chapterDraft = catalog.assets.find(item => item.id === 'prompt-chapter-draft')!
    const custom = chapterDraft.versions.find(item => item.id === 'custom-chapter-v2')!
    const builtinV2 = chapterDraft.versions.find(item => item.id === 'prompt-chapter-draft-v2')!
    expect(chapterDraft.activeVersionId).toBe(custom.id)
    expect(catalog.selections['chapter-draft']).toBe(custom.id)
    expect(custom).toMatchObject({ version: 2, source: 'user', template: '作者自定义章节 Prompt' })
    expect(builtinV2).toMatchObject({ version: 3, source: 'builtin' })
    reopened.close()
  })

  it('upgrades schema v8 planner runs through v11 without losing persisted questions or answers', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-phase8-upgrade-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    database.exec('PRAGMA foreign_keys=ON')
    const timestamp = new Date().toISOString()
    for (const migration of migrations.slice(0, 8)) {
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=OFF')
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(migration.version, migration.name, timestamp)
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=ON')
    }
    database.prepare("INSERT INTO projects(id,title,slug,language,status,revision,created_at,updated_at) VALUES ('p8','旧规划项目','phase8','zh-CN','active',0,?,?)").run(timestamp, timestamp)
    database.prepare(`INSERT INTO project_foundation_generation_runs(
      id,project_id,foundation_kind,guided,status,phase,progress,brief,questions_json,answers_json,dependency_version_ids_json,provider,model,streamed_characters,created_at,updated_at,started_at)
      VALUES ('run8','p8','outline',1,'waiting_input','awaiting_answers',35,'旧补充',?,?, '[]','mock','old-planner',123,?,?,?)`).run(
        JSON.stringify([{ id: 'q1', question: '旧问题？', why: '旧原因', options: [{ id: 'q1-o1', label: '旧选项', description: '旧说明', recommended: true }, { id: 'q1-o2', label: '另一个', description: '另一个说明', recommended: false }] }]),
        JSON.stringify([{ questionId: 'q1', optionId: 'q1-o1', customText: '旧回答' }]), timestamp, timestamp, timestamp,
      )
    database.close()

    const upgraded = new SqliteNovelRepository({ dataRoot: root })
    expect(upgraded.health().schemaVersion).toBe(20)
    expect(upgraded.getFoundationGenerationRun('run8')).toMatchObject({
      planningRound: 1,
      informationReady: false,
      readinessSummary: '已恢复旧版本规划问题；请完成当前回答后继续检查信息充分性。',
      interactionSessionId: null,
      questions: [{ id: 'q1', question: '旧问题？' }],
      answers: [{ questionId: 'q1', optionId: 'q1-o1', customText: '旧回答' }],
    })
    upgraded.close()
  })

  it('adds a nullable native Harness interaction session to schema v9 runs without changing their intake history', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-v9-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    const timestamp = new Date().toISOString()
    for (const migration of migrations.filter(item => item.version <= 9)) {
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=OFF')
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(migration.version, migration.name, timestamp)
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=ON')
    }
    database.prepare("INSERT INTO projects(id,title,slug,language,status,revision,created_at,updated_at) VALUES ('p9','原生交互迁移','native-v9','zh-CN','active',0,?,?)").run(timestamp, timestamp)
    database.prepare(`INSERT INTO project_foundation_generation_runs(
      id,project_id,foundation_kind,guided,status,phase,progress,brief,questions_json,answers_json,dependency_version_ids_json,provider,model,planning_round,information_ready,readiness_summary,planning_history_json,created_at,updated_at,started_at)
      VALUES ('run9','p9','outline',1,'waiting_input','awaiting_answers',35,'保留原始要求','[]','[]','[]','mock','planner',1,0,'仍需确认','[]',?,?,?)`).run(timestamp, timestamp, timestamp)
    database.close()

    const upgraded = new SqliteNovelRepository({ dataRoot: root })
    expect(upgraded.health().schemaVersion).toBe(20)
    expect(upgraded.getFoundationGenerationRun('run9')).toMatchObject({
      status: 'waiting_input', planningRound: 1, readinessSummary: '仍需确认', interactionSessionId: null,
    })
    upgraded.close()
  })

  it('upgrades schema v10 runs with an empty recoverable live manuscript without changing intake state', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-v10-live-manuscript-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    const timestamp = new Date().toISOString()
    for (const migration of migrations.filter(item => item.version <= 10)) {
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=OFF')
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(migration.version, migration.name, timestamp)
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=ON')
    }
    database.prepare("INSERT INTO projects(id,title,slug,language,status,revision,created_at,updated_at) VALUES ('p10','实时稿迁移','live-v10','zh-CN','active',0,?,?)").run(timestamp, timestamp)
    database.prepare(`INSERT INTO project_foundation_generation_runs(
      id,project_id,foundation_kind,guided,status,phase,progress,brief,questions_json,answers_json,dependency_version_ids_json,provider,model,streamed_characters,planning_round,information_ready,readiness_summary,planning_history_json,interaction_session_id,created_at,updated_at,started_at)
      VALUES ('run10','p10','outline',1,'waiting_input','awaiting_answers',35,'保留原始要求','[]','[]','[]','mock','planner',87,1,0,'仍需确认','[]',NULL,?,?,?)`).run(timestamp, timestamp, timestamp)
    database.close()

    const upgraded = new SqliteNovelRepository({ dataRoot: root })
    expect(upgraded.getFoundationGenerationRun('run10')).toMatchObject({
      status: 'waiting_input', readinessSummary: '仍需确认', streamedCharacters: 87, streamedText: '', streamedTextUpdatedAt: null,
    })
    upgraded.close()
  })

  it('moves schema v12 over-limit intake runs into formal generation without dropping saved answers', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-v12-bounded-intake-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    const timestamp = new Date().toISOString()
    for (const migration of migrations.filter(item => item.version <= 12)) {
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=OFF')
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(migration.version, migration.name, timestamp)
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=ON')
    }
    const questions = Array.from({ length: 4 }, (_, index) => ({
      id: `r${index + 1}-q1`, question: `第 ${index + 1} 轮问题`, why: '旧版本问题',
      options: [{ id: `r${index + 1}-q1-o1`, label: '确认', description: '确认方向', recommended: true }, { id: `r${index + 1}-q1-o2`, label: '调整', description: '调整方向', recommended: false }],
    }))
    const answers = questions.slice(0, 3).map(question => ({ questionId: question.id, optionId: question.options[0]!.id, customText: '' }))
    database.prepare("INSERT INTO projects(id,title,slug,language,status,revision,created_at,updated_at) VALUES ('p12','旧循环项目','bounded-v12','zh-CN','active',0,?,?)").run(timestamp, timestamp)
    database.prepare(`INSERT INTO project_foundation_generation_runs(
      id,project_id,foundation_kind,guided,status,phase,progress,brief,questions_json,answers_json,dependency_version_ids_json,provider,model,planning_round,information_ready,readiness_summary,planning_history_json,created_at,updated_at,started_at)
      VALUES ('run12','p12','outline',1,'waiting_input','awaiting_answers',40,'旧要求',?,?,'[]','mock','planner',4,0,'仍在追问','[]',?,?,?)`).run(
        JSON.stringify(questions), JSON.stringify(answers), timestamp, timestamp, timestamp,
      )
    database.close()

    const upgraded = new SqliteNovelRepository({ dataRoot: root })
    expect(upgraded.health().schemaVersion).toBe(20)
    expect(upgraded.getFoundationGenerationRun('run12')).toMatchObject({
      status: 'generating', phase: 'information_ready', informationReady: true, planningRound: 4,
      questions: [{ id: 'r1-q1' }, { id: 'r2-q1' }, { id: 'r3-q1' }, { id: 'r4-q1' }],
      answers: [{ questionId: 'r1-q1' }, { questionId: 'r2-q1' }, { questionId: 'r3-q1' }],
    })
    expect(upgraded.getFoundationGenerationRun('run12').readinessSummary).toContain('达到 4 轮或 12 项确认上限')
    upgraded.close()
  })

  it('cancels removed foundation runs in schema v14 while preserving historical content and the new three-stage chain', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-v14-three-stage-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const database = new DatabaseSync(join(root, 'novel-studio.db'))
    const timestamp = new Date().toISOString()
    for (const migration of migrations.filter(item => item.version <= 13)) {
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=OFF')
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)').run(migration.version, migration.name, timestamp)
      if (migration.disableForeignKeys) database.exec('PRAGMA foreign_keys=ON')
    }
    database.prepare("INSERT INTO projects(id,title,slug,language,status,revision,created_at,updated_at) VALUES ('p14','三段基建迁移','three-stage-v14','zh-CN','active',0,?,?)").run(timestamp, timestamp)
    database.prepare(`INSERT INTO project_foundation_versions(
      id,project_id,foundation_kind,version,title,content,content_hash,status,provider,model,prompt_version,prompt_hash,dependency_version_ids_json,output_json,created_at,approved_at,generation_run_id)
      VALUES ('world-version','p14','worldbuilding',1,'历史世界观','这份历史内容必须保留。','world-hash','approved','mock','legacy','v1','prompt-hash','[]','{}',?,?,NULL)`).run(timestamp, timestamp)
    database.prepare(`INSERT INTO project_foundation_generation_runs(
      id,project_id,foundation_kind,guided,status,phase,progress,brief,questions_json,answers_json,dependency_version_ids_json,provider,model,planning_round,information_ready,readiness_summary,planning_history_json,created_at,updated_at,started_at)
      VALUES ('world-run','p14','worldbuilding',1,'waiting_input','awaiting_answers',30,'旧世界观修订','[]','[]','[]','mock','legacy',1,0,'等待旧问题','[]',?,?,?)`).run(timestamp, timestamp, timestamp)
    database.close()

    const upgraded = new SqliteNovelRepository({ dataRoot: root })
    expect(upgraded.health().schemaVersion).toBe(20)
    expect(upgraded.getFoundationGenerationRun('world-run')).toMatchObject({ status: 'cancelled', phase: 'cancelled' })
    expect(upgraded.getProjectFoundation('p14').stages.map(stage => stage.kind)).toEqual(['outline', 'characters', 'timeline'])
    for (const kind of ['outline', 'characters', 'timeline'] as const) {
      const workspace = upgraded.createProjectFoundationVersion('p14', kind, { title: kind, content: `${kind} active content` }, {
        provider: 'mock', model: 'v14', promptVersion: 'v14', promptHash: `hash-${kind}`, outputJson: '{}',
      })
      const version = workspace.stages.find(stage => stage.kind === kind)!.latestVersion!
      upgraded.approveProjectFoundationVersion('p14', kind, version.id)
    }
    const ready = upgraded.getProjectFoundation('p14')
    expect(ready.readyForChapterGeneration).toBe(true)
    expect(ready.approvedVersionIds).toHaveLength(3)
    expect(ready.approvedVersionIds).not.toContain('world-version')
    upgraded.close()

    const preserved = new DatabaseSync(join(root, 'novel-studio.db'), { readOnly: true })
    expect(preserved.prepare("SELECT content FROM project_foundation_versions WHERE id='world-version'").get()).toEqual({ content: '这份历史内容必须保留。' })
    preserved.close()
  })

  it('can clear a native interaction binding while preserving an inline waiting run', () => {
    const { value } = repository()
    const project = value.createProject({ title: '内嵌提问接管' }).project
    const run = value.createFoundationGenerationRun(project.id, 'outline', '', true, { provider: 'mock', model: 'planner' }, 'session-old-composer')
    const waiting = value.setFoundationGenerationQuestions(run.id, [{
      id: 'q1', question: '主角如何选择？', why: '决定故事代价。', options: [
        { id: 'q1-o1', label: '承担代价', description: '主动承担后果。', recommended: true },
        { id: 'q1-o2', label: '逃避代价', description: '把冲突延后。', recommended: false },
      ],
    }], '仍需确认主角选择。', 'prompt-hash', '{}')
    expect(waiting.interactionSessionId).toBe('session-old-composer')
    expect(value.clearFoundationInteractionSession(run.id)).toMatchObject({ status: 'waiting_input', interactionSessionId: null, planningRound: 1 })
    value.close()
  })
})
