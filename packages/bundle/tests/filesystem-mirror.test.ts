import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { readMemoryMarkdown, writeMemoryMarkdown } from '../src/storage/markdown-mirror.js'
import { renderGenerationPrompt } from '../src/prompt-assets/render.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('optional project filesystem Markdown mirror', () => {
  it('writes chapter Markdown only when a project folder and sync are explicitly enabled', () => {
    const databaseRoot = mkdtempSync(join(tmpdir(), 'novel-studio-files-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'novel-studio-files-project-'))
    roots.push(databaseRoot, projectRoot)
    const repo = new SqliteNovelRepository({ dataRoot: databaseRoot })
    const project = repo.createProject({ title: '本地小说', workspacePath: projectRoot, markdownSyncEnabled: true }).project
    const chapter = repo.createChapter(project.id, '雾港')
    const draft = repo.saveDraft(chapter.id, { content: '第一章正文落盘。', baseRevision: chapter.revision })
    const path = join(projectRoot, 'chapters', '001-雾港.md')
    expect(readFileSync(path, 'utf8')).toContain('第一章正文落盘。')
    repo.approveVersion(chapter.id, draft.currentDraftVersionId!, draft.revision)
    expect(readFileSync(path, 'utf8')).toContain('status: approved')
    repo.close()

    const noMirrorRoot = mkdtempSync(join(tmpdir(), 'novel-studio-files-off-'))
    roots.push(noMirrorRoot)
    const noMirror = new SqliteNovelRepository({ dataRoot: noMirrorRoot })
    const noFolderProject = noMirror.createProject({ title: '仅数据库' }).project
    expect(noFolderProject.markdownSyncEnabled).toBe(false)
    const noFolderChapter = noMirror.createChapter(noFolderProject.id, '不落盘')
    noMirror.saveDraft(noFolderChapter.id, { content: '这段只留在 SQLite。', baseRevision: noFolderChapter.revision })
    expect(() => readFileSync(join(noMirrorRoot, 'chapters', '001-不落盘.md'), 'utf8')).toThrow()
    noMirror.close()
  })

  it('preserves raw user Markdown as a discovery snapshot without injecting it into prompts', () => {
    const databaseRoot = mkdtempSync(join(tmpdir(), 'novel-studio-memory-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'novel-studio-memory-project-'))
    roots.push(databaseRoot, projectRoot)
    const repo = new SqliteNovelRepository({ dataRoot: databaseRoot })
    const project = repo.createProject({ title: '记忆文件', workspacePath: projectRoot, markdownSyncEnabled: true }).project
    approveTestFoundation(repo, project.id)
    mkdirSync(join(projectRoot, 'memory'), { recursive: true })
    const memoryPath = join(projectRoot, 'memory', 'manual.md')
    const rawMemory = '# 手工记忆\n\n主角在第九章之前不能进入北塔。'
    writeFileSync(memoryPath, rawMemory, 'utf8')
    const chapter = repo.createChapter(project.id, '第九章')
    const context = repo.getGenerationContext(chapter.id, 'scene-plan')
    expect(context.filesystemMemory).toEqual([
      expect.objectContaining({ path: memoryPath, content: '', hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ])
    const prompt = renderGenerationPrompt(context)
    expect(prompt).not.toContain('项目文件夹 memory')
    expect(prompt).not.toContain('主角在第九章之前不能进入北塔')
    expect(readFileSync(memoryPath, 'utf8')).toBe(rawMemory)
    repo.close()
  })

  it('keeps user memory files, prunes only stale mirror files, and ignores manifest path tricks', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'novel-studio-memory-managed-project-'))
    roots.push(projectRoot)
    mkdirSync(join(projectRoot, 'memory'), { recursive: true })
    writeFileSync(join(projectRoot, 'memory', 'chapter-one.md'), '# 用户同名记忆\n\n不能被覆盖。', 'utf8')
    writeMemoryMarkdown(projectRoot, [
      { name: 'chapter:one', title: '第一章', content: '旧摘要' },
      { name: 'chapter/one', title: '冲突名称', content: '碰撞摘要' },
    ])
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'memory', '.novel-studio-memory.json'), 'utf8')) as { files: string[] }
    expect(manifest.files).toHaveLength(2)
    const stale = manifest.files.find(name => name.endsWith('-2.md'))!
    const managed = join(projectRoot, 'memory', stale)
    expect(readFileSync(join(projectRoot, 'memory', 'chapter-one.md'), 'utf8')).toContain('不能被覆盖')
    writeFileSync(join(projectRoot, 'memory', 'manual.md'), '# 用户记忆\n\n只由用户维护。', 'utf8')
    writeFileSync(managed, '# stale\n', 'utf8')
    writeMemoryMarkdown(projectRoot, [{ name: 'chapter:two', title: '第二章', content: '新摘要' }])
    expect(existsSync(join(projectRoot, 'memory', 'manual.md'))).toBe(true)
    expect(existsSync(managed)).toBe(false)
    // A legacy/user-created index cannot redirect reads outside memory/.
    writeFileSync(join(projectRoot, 'memory', '.index'), '../outside.md\n', 'utf8')
    expect(readMemoryMarkdown(projectRoot).every(file => file.path.startsWith(join(projectRoot, 'memory')))).toBe(true)
  })

  it('keeps SQLite saves working when the optional mirror path is unavailable', () => {
    const databaseRoot = mkdtempSync(join(tmpdir(), 'novel-studio-files-unavailable-db-'))
    const mirrorFileRoot = join(mkdtempSync(join(tmpdir(), 'novel-studio-files-unavailable-path-')), 'not-a-directory')
    roots.push(databaseRoot, mirrorFileRoot.replace(/\/not-a-directory$/, ''))
    writeFileSync(mirrorFileRoot, 'this is a file, not a folder', 'utf8')
    const repo = new SqliteNovelRepository({ dataRoot: databaseRoot })
    const project = repo.createProject({ title: '镜像不可用', workspacePath: mirrorFileRoot, markdownSyncEnabled: true }).project
    const chapter = repo.createChapter(project.id, '第一章')
    const saved = repo.saveDraft(chapter.id, { content: 'SQLite 正式保存不应被文件夹故障阻断。', baseRevision: chapter.revision })
    expect(saved.currentDraftVersionId).toBeTruthy()
    expect(repo.getChapter(chapter.id).versions[0]?.content).toContain('SQLite 正式保存')
    const memory = repo.createUserMemory(project.id, {
      content: '即使 Markdown 路径不可写，这条作者记忆也必须保存在 SQLite。',
      scope: 'project', category: 'continuity', promptPolicy: 'auto',
    }, repo.getProjectTree(project.id).project.revision)
    expect(repo.getMemoryItem(memory.id).currentRevision.content).toContain('必须保存在 SQLite')
    repo.close()
  })
})
