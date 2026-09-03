import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')

describe('Novel Studio top-bar navigation', () => {
  it('returns to the Harness surface through the overlay close callback', () => {
    expect(clientSource).toContain('aria-label="返回 DeepSeek Harness"')
    expect(clientSource).toContain('if (await flushEditorBeforeLeave()) closeStudio()')
    expect(clientSource).toContain('onClick={() => { void leaveStudio() }}')
  })

  it('keeps only project creation on the right side of the top bar', () => {
    expect(clientSource).toContain('aria-label="新建项目"')
    expect(clientSource).not.toContain('aria-label="刷新小说工作室"')
    expect(clientSource).not.toContain('aria-label="关闭小说工作室"')
    expect(clientSource).not.toContain('会话已连接')
    expect(clientSource).not.toContain('本地数据已连接')
  })

  it('exposes the library without replacing last-project startup', () => {
    expect(clientSource).toContain("useState<StudioSurface>('workspace')")
    expect(clientSource).toContain('aria-label="打开作品库"')
    expect(clientSource).toContain("setSurface('library')")
    expect(clientSource).toContain("setSurface('workspace')")
    expect(clientSource).toContain('if (!await flushEditorBeforeLeave()) return')
  })

  it('does not show redundant prose while a chapter workflow is preparing', () => {
    expect(clientSource).not.toContain('AI 正在整理本章的冲突、场景顺序和连续性')
    expect(clientSource).not.toContain('开始写正文后，文字会直接在这里实时出现')
    expect(clientSource).not.toContain('自动整理章节结构、生成正文并完成审校')
  })
})
