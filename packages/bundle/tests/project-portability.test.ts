import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DomainError, type GenerationContext } from '../src/domain/model.js'
import { manuscriptWordCount } from '../src/domain/manuscript.js'
import { normalizePortableProjectSnapshot, parseManuscriptImport, type PortableProjectSnapshotV1 } from '../src/domain/project-portability.js'
import { handleNovelApi } from '../src/host-api/api.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'

const roots: string[] = []

function repository(): SqliteNovelRepository {
  const root = mkdtempSync(join(tmpdir(), 'novel-studio-portability-'))
  roots.push(root)
  return new SqliteNovelRepository({ dataRoot: root })
}

function modelContext(repo: SqliteNovelRepository, projectId: string, chapterId: string): GenerationContext {
  const project = repo.getProjectTree(projectId).project
  const chapter = repo.getChapter(chapterId)
  const catalog = repo.getPromptCatalog(projectId)
  const promptVersionId = catalog.selections['chapter-draft']
  const promptVersion = catalog.assets.flatMap(asset => asset.versions).find(version => version.id === promptVersionId)
  if (!promptVersion) throw new Error('Test prompt version is unavailable.')
  return {
    purpose: 'chapter-draft', project, chapter, rules: catalog.projectRules, styleProfile: catalog.projectRules.styleProfile,
    promptVersion, inputManuscriptVersionId: chapter.currentDraftVersionId, inputManuscript: '', latestScenePlan: null,
    retrievalBundle: null, foundationVersions: [], foundationAssemblyHash: 'test', longMemory: [], priorChapterSummaries: [],
    previousChapterContinuity: null, filesystemMemory: [],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('manuscript import parser', () => {
  it('parses Markdown document titles and common Chinese chapter headings', () => {
    const parsed = parseManuscriptImport({
      format: 'markdown', sourceName: 'old-name.md',
      content: '\uFEFF# 潮汐尽头\r\n\r\n一段前言。\r\n\r\n## 第一章 雾港\r\n第一章正文。\r\n\r\n### 场景注记\r\n仍属于第一章。\r\n\r\n## 第二章 归潮\r\n第二章正文。',
    })
    expect(parsed.title).toBe('潮汐尽头')
    expect(parsed.chapters.map(chapter => chapter.title)).toEqual(['第一章 雾港', '第二章 归潮'])
    expect(parsed.chapters[0]?.content).toContain('一段前言。')
    expect(parsed.chapters[0]?.content).toContain('### 场景注记')
    expect(parsed.chapters[1]?.content).toBe('第二章正文。')
    expect(parsed.sourceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('parses TXT chapter lines and falls back to one chapter without headings', () => {
    const txt = parseManuscriptImport({ format: 'txt', sourceName: '长夜.txt', content: '第一章 起风\n甲。\n\nChapter 2 Return\n乙。' })
    expect(txt.chapters.map(chapter => chapter.title)).toEqual(['第一章 起风', 'Chapter 2 Return'])
    const single = parseManuscriptImport({ format: 'txt', sourceName: '散文.txt', content: '没有章节行，但正文必须完整保留。' })
    expect(single.chapters).toEqual([{ title: '正文', content: '没有章节行，但正文必须完整保留。' }])
    expect(single.warnings).toContain('未识别到章节标题，已作为单章导入。')
    expect(() => parseManuscriptImport({ format: 'txt', sourceName: 'bad.txt', content: '正文\0二进制' })).toThrow(DomainError)
  })
})

describe('project library and portability repository', () => {
  it('archives safely, clears navigation state, and restores the project', () => {
    const repo = repository()
    const other = repo.createProject({ title: '仍在创作' }).project
    const project = repo.createProject({ title: '暂时封存' }).project
    const chapter = repo.createChapter(project.id, '第一章')
    repo.selectWorkspace(project.id, chapter.id, 'session-to-clear')

    const archived = repo.archiveProject(project.id, repo.getProjectTree(project.id).project.revision)
    expect(archived).toMatchObject({ status: 'archived' })
    expect(archived.archivedAt).toBeTruthy()
    expect(repo.getLibraryOverview().archived.map(item => item.id)).toContain(project.id)
    expect(repo.listProjects().map(item => item.id)).toEqual([other.id])
    expect(repo.getWorkspace().selectedProjectId).toBe(other.id)
    expect(() => repo.getResumeContext('session-to-clear')).toThrow(DomainError)

    const restored = repo.restoreProject(project.id, archived.revision)
    expect(restored).toMatchObject({ status: 'active', archivedAt: null })
    expect(repo.getLibraryOverview().active.map(item => item.id)).toContain(project.id)
    repo.close()
  })

  it('refuses to archive projects with active workflow or foundation runs', () => {
    const repo = repository()
    const workflowProject = repo.createProject({ title: '工作流进行中' }).project
    const chapter = repo.createChapter(workflowProject.id)
    repo.startChapterWorkflow(chapter.id)
    expect(() => repo.archiveProject(workflowProject.id)).toThrow(/活动中的章节工作流/)

    const foundationProject = repo.createProject({ title: '基建进行中' }).project
    repo.createFoundationGenerationRun(foundationProject.id, 'outline', '', true, { provider: 'test', model: 'test' })
    expect(() => repo.archiveProject(foundationProject.id)).toThrow(/活动中的创作基建生成/)
    repo.close()
  })

  it('treats archived projects as read-only across writes, runs, session binding, and history settings', () => {
    const repo = repository()
    const imported = repo.importManuscript({ format: 'txt', sourceName: '边界.txt', content: '第一章 边界\n初稿。' })
    const projectId = imported.project.project.id
    const chapter = repo.getChapter(imported.chapterIds[0]!)
    const sourceProject = repo.createProject({ title: '历史来源' }).project
    const rules = repo.getPromptCatalog(projectId).projectRules
    const style = repo.getProjectStyleProfile(projectId)
    const selectedPromptVersionId = repo.getPromptCatalog(projectId).selections['chapter-draft']
    const context = modelContext(repo, projectId, chapter.id)
    const workflow = repo.startChapterWorkflow(chapter.id)
    repo.setWorkflowStatus(workflow.id, 'cancelled')
    const beforeVersions = repo.getChapter(chapter.id).versions.length

    repo.archiveProject(projectId)

    const writes: Array<[string, () => unknown]> = [
      ['createChapter', () => repo.createChapter(projectId, '归档后新章')],
      ['saveDraft', () => repo.saveDraft(chapter.id, { content: '归档后草稿', baseRevision: chapter.revision })],
      ['approveVersion', () => repo.approveVersion(chapter.id, chapter.currentDraftVersionId!, chapter.revision)],
      ['updateProjectRules', () => repo.updateProjectRules(projectId, { styleRules: '新规则', chapterGoal: '新目标', forbiddenContent: '' }, rules.revision)],
      ['setProjectStylePreset', () => repo.setProjectStylePreset(projectId, 'literary-calm', style.revision)],
      ['selectPromptVersion', () => repo.selectPromptVersion(projectId, 'chapter-draft', selectedPromptVersionId)],
      ['createProjectFoundationVersion', () => repo.createProjectFoundationVersion(projectId, 'outline', { title: '归档后大纲', content: '这是一段长度足够但不应被写入的归档后大纲内容。' }, { provider: 'test', model: 'test', promptVersion: 'v1', promptHash: 'hash', outputJson: '{}' })],
      ['createFoundationGenerationRun', () => repo.createFoundationGenerationRun(projectId, 'outline', '', false, { provider: 'test', model: 'test' })],
      ['startChapterWorkflow', () => repo.startChapterWorkflow(chapter.id)],
      ['decideWorkflowApproval', () => repo.decideWorkflowApproval(workflow.id, 'rejected', '归档后拒绝')],
      ['startModelRun', () => repo.startModelRun(context, { provider: 'test', model: 'test' }, '{}')],
      ['bindSessionProject', () => repo.bindSessionProject('archived-session', projectId, chapter.id)],
      ['configureHistoricalSource', () => repo.configureHistoricalSource(projectId, sourceProject.id, true, ['structure_summary'])],
    ]
    for (const [name, operation] of writes) {
      expect(operation, name).toThrow(/已归档/)
    }

    // Archive is a write boundary, not an access boundary: authors may still
    // inspect and export a frozen project before choosing to restore it.
    expect(repo.getProjectTree(projectId).project.status).toBe('archived')
    expect(repo.exportProjectMarkdown(projectId).content).toContain('初稿。')
    expect(repo.exportProjectSnapshot(projectId).content).toContain('novel-studio-project')
    expect(repo.getChapter(chapter.id).versions).toHaveLength(beforeVersions)
    repo.close()
  })

  it('blocks archive while a model run is active and rejects stale completion after archive', () => {
    const repo = repository()
    const imported = repo.importManuscript({ format: 'txt', sourceName: '运行.txt', content: '第一章 运行\n正文。' })
    const chapterId = imported.chapterIds[0]!
    const context = modelContext(repo, imported.project.project.id, chapterId)
    const run = repo.startModelRun(context, { provider: 'test', model: 'test' }, '{}')
    expect(() => repo.archiveProject(imported.project.project.id)).toThrow(/运行中的模型生成/)

    repo.failModelRun(run.id, new Error('停止测试运行'))
    // Keep a second connection open to represent a runner holding stale in-memory
    // context while another Host connection archives the project.
    const staleRunner = new SqliteNovelRepository({ dataRoot: dirname(repo.databasePath) })
    const versionCount = repo.getChapter(chapterId).versions.length
    repo.archiveProject(imported.project.project.id)
    expect(() => staleRunner.updateModelRunStream(run.id, '迟到的流式文本')).toThrow(/已归档/)
    expect(() => staleRunner.completeGeneratedDraft(run.id, '迟到的正文', {})).toThrow(/已归档/)
    expect(repo.getChapter(chapterId).versions).toHaveLength(versionCount)
    staleRunner.close()
    repo.close()
  })

  it('imports chapters atomically with one immutable draft per chapter', () => {
    const repo = repository()
    const imported = repo.importManuscript({ format: 'markdown', sourceName: '潮声.md', content: '# 潮声\n\n## 第一章 岸边\n旧潮。\n\n## 第二章 灯塔\n新潮。', genre: '悬疑' })
    expect(imported.project.project).toMatchObject({ title: '潮声', genre: '悬疑' })
    expect(imported.chapterIds).toHaveLength(2)
    for (const chapterId of imported.chapterIds) {
      const chapter = repo.getChapter(chapterId)
      expect(chapter.currentDraftVersionId).toBeTruthy()
      expect(chapter.currentApprovedVersionId).toBeNull()
      expect(chapter.versions).toHaveLength(1)
      expect(chapter.versions[0]).toMatchObject({ status: 'draft', origin: 'user', createdBy: 'user', parentVersionId: null })
    }
    repo.close()
  })

  it('exports ordered Markdown using approved content before a newer draft', () => {
    const repo = repository()
    const imported = repo.importManuscript({ format: 'txt', sourceName: '书.txt', content: '第一章 起\n批准正文。\n第二章 承\n第二章正文。' })
    const first = repo.getChapter(imported.chapterIds[0]!)
    const approved = repo.approveVersion(first.id, first.currentDraftVersionId!, first.revision)
    repo.saveDraft(first.id, { content: '尚未批准的新草稿。', baseRevision: approved.revision })
    const exported = repo.exportProjectMarkdown(imported.project.project.id)
    expect(exported.mimeType).toBe('text/markdown; charset=utf-8')
    expect(exported.content.indexOf('第一章 起')).toBeLessThan(exported.content.indexOf('第二章 承'))
    expect(exported.content).toContain('批准正文。')
    expect(exported.content).not.toContain('尚未批准的新草稿。')
    repo.close()
  })

  it('round-trips portable snapshots with fresh IDs, rules, style, foundations, versions, and visible chapters', () => {
    const repo = repository()
    const imported = repo.importManuscript({ format: 'markdown', sourceName: '原作.md', content: '# 原作\n\n## 第一章 雾\n第一版正文。' })
    const originalProject = imported.project.project
    const originalChapter = repo.getChapter(imported.chapterIds[0]!)
    const approved = repo.approveVersion(originalChapter.id, originalChapter.currentDraftVersionId!, originalChapter.revision)
    repo.saveDraft(originalChapter.id, { content: '第二版草稿正文。', baseRevision: approved.revision })
    const rules = repo.getPromptCatalog(originalProject.id).projectRules
    repo.updateProjectRules(originalProject.id, { styleRules: '短句，克制。', chapterGoal: '推进谜团。', forbiddenContent: '不剧透。' }, rules.revision)
    const profile = repo.getProjectStyleProfile(originalProject.id)
    repo.setProjectStylePreset(originalProject.id, 'literary-calm', profile.revision)

    const trace = { provider: 'test', model: 'test-model', promptVersion: 'v1', promptHash: 'hash', outputJson: '{}' }
    for (const [kind, title] of [['outline', '大纲'], ['characters', '人物'], ['timeline', '时间线']] as const) {
      const workspace = repo.createProjectFoundationVersion(originalProject.id, kind, { title, content: `${title}内容足够长，用于验证可移植快照能够保留创作基建版本。` }, trace)
      repo.approveProjectFoundationVersion(originalProject.id, kind, workspace.stages.find(stage => stage.kind === kind)!.latestVersion!.id)
    }

    const exported = repo.exportProjectSnapshot(originalProject.id)
    expect(exported.content).not.toContain('project_root_path')
    expect(exported.content).not.toContain('input_snapshot_json')
    const snapshot = JSON.parse(exported.content) as PortableProjectSnapshotV1
    snapshot.books[0]!.chapters[0]!.volumeKey = null
    snapshot.books[0]!.chapters[0]!.versions[0]!.wordCount = 999_999
    const restored = repo.restoreProjectSnapshot(snapshot, '原作（恢复）')

    expect(restored.project.id).not.toBe(originalProject.id)
    expect(restored.project).toMatchObject({ title: '原作（恢复）', workspacePath: null, markdownSyncEnabled: false })
    expect(restored.books[0]?.volumes[0]?.chapters).toHaveLength(1)
    const restoredChapter = repo.getChapter(restored.books[0]!.volumes[0]!.chapters[0]!.id)
    expect(restoredChapter.versions).toHaveLength(2)
    expect(restoredChapter.versions.every(version => version.projectId === restored.project.id)).toBe(true)
    expect(restoredChapter.versions.find(version => version.content === '第一版正文。')?.wordCount).toBe(manuscriptWordCount('第一版正文。'))
    expect(repo.getPromptCatalog(restored.project.id).projectRules).toMatchObject({ styleRules: '短句，克制。', chapterGoal: '推进谜团。', forbiddenContent: '不剧透。' })
    expect(repo.getProjectStyleProfile(restored.project.id).presetId).toBe('literary-calm')
    expect(repo.getProjectFoundation(restored.project.id).stages.every(stage => stage.approvedVersion !== null)).toBe(true)

    const corrupted = structuredClone(snapshot)
    corrupted.books[0]!.chapters[0]!.versions[0]!.status = 'superseded'
    expect(() => normalizePortableProjectSnapshot(corrupted)).toThrow(/当前批准指针/)
    repo.close()
  })

  it('rejects extreme portable counters before they can overflow restored ordering or revisions', () => {
    const repo = repository()
    const imported = repo.importManuscript({ format: 'txt', sourceName: '数值.txt', content: '第一章 数值\n正文。' })
    repo.createProjectFoundationVersion(imported.project.project.id, 'outline', { title: '大纲', content: '这是用于极端版本号校验的足够长度创作基建内容。' }, { provider: 'test', model: 'test', promptVersion: 'v1', promptHash: 'hash', outputJson: '{}' })
    const source = JSON.parse(repo.exportProjectSnapshot(imported.project.project.id).content) as PortableProjectSnapshotV1
    const mutations: Array<(snapshot: PortableProjectSnapshotV1) => void> = [
      snapshot => { snapshot.project.revision = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.projectRules.revision = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.styleProfile.revision = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.books[0]!.position = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.books[0]!.volumes[0]!.position = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.books[0]!.chapters[0]!.chapterNumber = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.books[0]!.chapters[0]!.revision = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.books[0]!.chapters[0]!.versions[0]!.wordCount = Number.MAX_SAFE_INTEGER },
      snapshot => { snapshot.foundations[0]!.version = Number.MAX_SAFE_INTEGER },
    ]
    for (const mutate of mutations) {
      const malicious = structuredClone(source)
      mutate(malicious)
      expect(() => normalizePortableProjectSnapshot(malicious)).toThrow(DomainError)
    }
    repo.close()
  })

  it('validates a 100k-version parent chain in linear time', () => {
    const repo = repository()
    const imported = repo.importManuscript({ format: 'txt', sourceName: '长链.txt', content: '第一章 长链\n正文。' })
    const snapshot = JSON.parse(repo.exportProjectSnapshot(imported.project.project.id).content) as PortableProjectSnapshotV1
    const chapter = snapshot.books[0]!.chapters[0]!
    const contentHash = createHash('sha256').update('').digest('hex')
    chapter.versions = Array.from({ length: 100_000 }, (_, index) => ({
      key: `version-${index}`,
      parentVersionKey: index === 0 ? null : `version-${index - 1}`,
      status: index === 99_999 ? 'draft' as const : 'superseded' as const,
      content: '', contentHash, wordCount: 0, origin: 'user' as const, createdBy: 'user' as const,
      createdAt: chapter.createdAt, approvedAt: null,
    }))
    chapter.currentDraftVersionKey = 'version-99999'
    chapter.currentApprovedVersionKey = null
    const normalized = normalizePortableProjectSnapshot(snapshot)
    expect(normalized.books[0]!.chapters[0]!.versions).toHaveLength(100_000)
    repo.close()
  }, 30_000)
})

describe('project portability Host API', () => {
  it('serves import, library, export, archive, restore, and snapshot restore routes', async () => {
    const repo = repository()
    const unavailable = undefined as never
    const server = createServer((req, res) => { void handleNovelApi(req, res, repo, unavailable, unavailable, unavailable, unavailable, unavailable, '/api/novel-studio/v1') })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo
    const base = `http://127.0.0.1:${address.port}/api/novel-studio/v1`
    const request = async (path: string, init?: RequestInit): Promise<{ status: number; body: any }> => {
      const response = await fetch(`${base}${path}`, init)
      return { status: response.status, body: await response.json() }
    }
    try {
      const imported = await request('/imports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'txt', sourceName: 'api.txt', content: '第一章 API\n正文。' }) })
      expect(imported.status).toBe(201)
      const projectId = imported.body.project.project.id as string
      const library = await request('/library')
      expect(library.body.active.map((project: { id: string }) => project.id)).toContain(projectId)
      const markdown = await request(`/projects/${projectId}/exports/markdown`)
      expect(markdown.body).toMatchObject({ mimeType: 'text/markdown; charset=utf-8' })
      const snapshot = await request(`/projects/${projectId}/exports/snapshot`)
      const archived = await request(`/projects/${projectId}/archive`, { method: 'POST', body: '{}' })
      expect(archived.body.status).toBe('archived')
      const restored = await request(`/projects/${projectId}/restore`, { method: 'POST', body: '{}' })
      expect(restored.body.status).toBe('active')
      const snapshotRestored = await request('/imports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: JSON.parse(snapshot.body.content), title: 'API 副本' }) })
      expect(snapshotRestored.status).toBe(201)
      expect(snapshotRestored.body.project.title).toBe('API 副本')
      expect(snapshotRestored.body.project.id).not.toBe(projectId)
    } finally {
      await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) })
      repo.close()
    }
  })
})
