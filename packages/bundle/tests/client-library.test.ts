import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')

describe('Novel Studio project library', () => {
  it('loads active and archived projects into a searchable segmented library', () => {
    expect(clientSource).toContain("api<LibraryOverview>('/library')")
    expect(clientSource).toContain('function ProjectLibraryView')
    expect(clientSource).toContain('aria-label="搜索作品标题或题材"')
    expect(clientSource).toContain('作品库分段')
    expect(clientSource).toContain('活跃作品')
    expect(clientSource).toContain('已归档')
    expect(clientSource).toContain('project.genre')
    expect(clientSource).toContain('summary.chapterCount')
    expect(clientSource).toContain('summary.approvedChapterCount')
  })

  it('uses deterministic local text covers without remote artwork', () => {
    expect(clientSource).toContain('OFFLINE_COVER_PALETTES')
    expect(clientSource).toContain('deterministicCoverPalette(project.id)')
    expect(clientSource).toContain('data-novel-offline-cover={project.id}')
    expect(clientSource).toContain('NOVEL STUDIO · LOCAL')
    expect(clientSource).not.toMatch(/https?:\/\//)
  })

  it('archives through an inline second confirmation and supports restoring', () => {
    expect(clientSource).toContain('confirmArchiveId')
    expect(clientSource).toContain('确认归档《{project.title}》？')
    expect(clientSource).toContain('确认归档')
    expect(clientSource).toContain('/archive`')
    expect(clientSource).toContain('/restore`')
    expect(clientSource).toContain('baseRevision: project.revision')
    expect(clientSource).toContain('恢复到活跃作品')
    expect(clientSource).toContain('只读查看')
    expect(clientSource).toContain("readOnly ? 'memory' :")
    expect(clientSource).not.toContain('查看项目')
    expect(clientSource).toContain('JSON.stringify({ projectId: null, chapterId: null, sessionId })')
    expect(clientSource).toContain('setActiveProjectId(null)')
    expect(clientSource).not.toContain('window.confirm')
    expect(clientSource).not.toContain('window.alert')
  })

  it('uses separate safe preflights for manuscripts and portable snapshots', () => {
    expect(clientSource).toContain('function ImportProjectDialog')
    expect(clientSource).toContain('导入为新项目')
    expect(clientSource).toContain('MAX_CLIENT_MANUSCRIPT_IMPORT_BYTES = 32 * 1024 * 1024')
    expect(clientSource).toContain('MAX_CLIENT_SNAPSHOT_IMPORT_BYTES = 70 * 1024 * 1024')
    expect(clientSource).toContain("format === 'snapshot' ? MAX_CLIENT_SNAPSHOT_IMPORT_BYTES : MAX_CLIENT_MANUSCRIPT_IMPORT_BYTES")
    expect(clientSource).toContain('Markdown/TXT 正文超过 32 MB')
    expect(clientSource).toContain('可携带项目快照超过 70 MB')
    expect(clientSource).toContain('.md,.markdown,.txt,.novel-studio.json,.json')
    expect(clientSource).toContain("lowerName.endsWith('.json') ? 'snapshot'")
    expect(clientSource).toContain("lowerName.endsWith('.markdown') ? 'markdown'")
    expect(clientSource).toContain('aria-label="导入项目标题"')
    expect(clientSource).toContain("api<ProjectImportResult | ProjectTree>('/imports'")
    expect(clientSource).toContain('正在导入…')
    expect(clientSource).toContain('await imported(projectId)')
  })

  it('downloads Markdown and portable snapshots from project cards', () => {
    expect(clientSource).toContain("format: 'markdown' | 'snapshot'")
    expect(clientSource).toContain('/exports/${format}`')
    expect(clientSource).toContain('new Blob([file.content], { type: file.mimeType })')
    expect(clientSource).toContain('anchor.download = file.fileName')
    expect(clientSource).toContain('下载 Markdown')
    expect(clientSource).toContain('下载可携带项目快照')
    expect(clientSource).toContain('可携带项目快照（非完整备份）')
  })

  it('offers both creation and import in the zero-project state', () => {
    expect(clientSource).toContain('作品库还是空的')
    expect(clientSource).toContain('从第一个小说项目开始')
    expect(clientSource).toContain('导入已有作品')
    expect(clientSource).toContain('新建项目')
  })
})
