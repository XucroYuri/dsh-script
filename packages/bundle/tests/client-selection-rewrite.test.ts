import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')

describe('Novel Studio guided selection rewrite', () => {
  it('expands the lightweight rewrite tag into an instruction composer', () => {
    expect(clientSource).toContain("mode: 'trigger'")
    expect(clientSource).toContain("mode: 'composer'")
    expect(clientSource).toContain('aria-label="重写要求"')
    expect(clientSource).toContain('placeholder="例如：写少一点，保留事实，只加强动作和紧张感"')
    for (const label of ['重写', '扩写', '精简', '增加对白', '加强情绪', '增加环境细节', '自定义要求']) expect(clientSource).toContain(label)
  })

  it('makes selection rewrite visible in the editor toolbar and explains the empty state', () => {
    expect(clientSource).toContain('aria-label="选段改写"')
    expect(clientSource).toContain("'先在正文中选择一段文字'")
    expect(clientSource).toContain('选中一段文字，可重写、扩写或精简')
    expect(clientSource).toContain('openSelectionRewriteComposer')
    expect(clientSource).toContain('已选 ${formatNumber(selectionRewrite.snapshot.selectedText.length)} 字')
  })

  it('allows a waiting-approval draft to be rewritten while other active runs stay locked', () => {
    expect(clientSource).toContain("activeRun && activeRun.status !== 'waiting_approval'")
    expect(clientSource).toContain("(!activeRun || activeRun.status === 'waiting_approval')")
    expect(clientSource).toContain('chapter.currentDraftVersionId === waitingApprovalTargetId')
  })

  it('sends the trimmed instruction with the frozen selection request', () => {
    expect(clientSource).toContain('instruction: instruction.trim()')
    expect(clientSource).toContain('selectedText: action.snapshot.selectedText')
    expect(clientSource).toContain('applyManuscriptSelectionRewrite(contentRef.current, action.snapshot, result.replacementText)')
  })

  it('supports keyboard submission and preserves the popover while its textarea owns focus', () => {
    expect(clientSource).toContain('(event.metaKey || event.ctrlKey) && event.key === \'Enter\'')
    expect(clientSource).toContain('rewritePopoverRef.current?.contains(document.activeElement)')
  })

  it('repositions an open composer after both viewport and editor-shell layout changes', () => {
    expect(clientSource).toContain("new ResizeObserver(reposition)")
    expect(clientSource).toContain('resizeObserver?.observe(shell)')
    expect(clientSource).toContain('resizeObserver?.observe(rewritePopoverRef.current)')
    expect(clientSource).toContain('resizeObserver?.disconnect()')
    expect(clientSource).toContain("window.addEventListener('resize', reposition)")
    expect(clientSource).toContain("window.removeEventListener('resize', reposition)")
    expect(clientSource).toContain('const cardWidth = Math.min(360, Math.max(0, bounds.width - 24))')
    expect(clientSource).toContain('const minLeft = 8 + width / 2')
    expect(clientSource).toContain('const fallbackWidth = selectionRewrite.mode === \'composer\'')
  })

  it('keeps a failed instruction available for retry', () => {
    expect(clientSource).toContain("{ ...currentAction, status: 'error', error: message }")
    expect(clientSource).toContain("failed ? '重试' : '按要求重写'")
  })
})
