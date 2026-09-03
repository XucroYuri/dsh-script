import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')

describe('Novel Studio before-leave draft flush', () => {
  it('registers the chapter flush through ProjectWorkspace at overlay scope', () => {
    expect(clientSource).toContain('type BeforeLeaveFlush = () => Promise<void>')
    expect(clientSource).toContain('type RegisterBeforeLeaveFlush = (flush: BeforeLeaveFlush | null) => void')
    expect(clientSource).toContain('beforeLeaveFlushRef.current = flush')
    expect(clientSource).toContain('registerBeforeLeaveFlush={registerBeforeLeaveFlush}')
    expect(clientSource).toContain('registerBeforeLeaveFlush(() => flushBeforeLeaveRef.current())')
    expect(clientSource).toContain('registerBeforeLeaveFlush(null)')
  })

  it('awaits in-flight or dirty saves instead of relying on the autosave timer', () => {
    expect(clientSource).toContain('if (savingPromiseRef.current) await savingPromiseRef.current')
    expect(clientSource).toContain("if (dirtyRef.current) await save('user')")
    expect(clientSource).toContain('api<ChapterDetail>(`/chapters/${encodeURIComponent(chapter.id)}/drafts`')
    expect(clientSource).toContain('baseRevision: revisionRef.current')
    expect(clientSource).toContain('revisionRef.current = savedChapter.revision')
    expect(clientSource).toContain('readOnly={readOnly || saving || rewriteBusy}')
  })

  it('keeps the current editor mounted and reports a failed flush', () => {
    expect(clientSource).toContain('正文保存失败，已留在当前页面')
    expect(clientSource).toContain('if (!await flushEditorBeforeLeave()) return')
    expect(clientSource).toContain("setLeaveError(`正文保存失败")
    expect(clientSource).toContain('role="alert"')
    expect(clientSource).toContain('保存失败：${saveError}')
  })

  it('flushes before opening the library and before archiving the active project', () => {
    const openLibrarySource = clientSource.slice(clientSource.indexOf('const openLibrary'), clientSource.indexOf('const leaveStudio'))
    const archiveSource = clientSource.slice(clientSource.indexOf('const archiveProject'), clientSource.indexOf('const restoreProject'))
    expect(openLibrarySource).toContain('await flushEditorBeforeLeave()')
    expect(openLibrarySource.indexOf('await flushEditorBeforeLeave()')).toBeLessThan(openLibrarySource.indexOf("setSurface('library')"))
    expect(archiveSource).toContain('activeProjectId === project.id && !await flushEditorBeforeLeave()')
    expect(archiveSource).toContain("setSurface('library')")
    expect(archiveSource).toContain('projectId: null, chapterId: null')
  })
})
