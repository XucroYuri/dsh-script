import { describe, expect, it } from 'vitest'
import { applyManuscriptSelectionRewrite, createManuscriptSelectionSnapshot } from '../src/domain/selection-rewrite.js'

describe('selection rewrite boundary', () => {
  it('replaces only the frozen selection range', () => {
    const content = '选区之前。需要改写的句子。选区之后。'
    const start = content.indexOf('需要改写')
    const end = start + '需要改写的句子。'.length
    const snapshot = createManuscriptSelectionSnapshot(content, start, end)
    const rewritten = applyManuscriptSelectionRewrite(content, snapshot, '改写后的句子。')

    expect(rewritten.content).toBe('选区之前。改写后的句子。选区之后。')
    expect(rewritten.content.slice(0, start)).toBe(content.slice(0, start))
    expect(rewritten.content.slice(rewritten.selectionEnd)).toBe(content.slice(end))
    expect(rewritten).toMatchObject({ selectionStart: start, selectionEnd: start + '改写后的句子。'.length })
  })

  it('refuses to apply a result after any manuscript drift', () => {
    const content = '前文。原句。后文。'
    const start = content.indexOf('原句')
    const snapshot = createManuscriptSelectionSnapshot(content, start, start + 3)
    expect(() => applyManuscriptSelectionRewrite(`${content}新增`, snapshot, '新句')).toThrow('正文在重写期间发生了变化')
  })

  it('rejects empty or invalid ranges', () => {
    expect(() => createManuscriptSelectionSnapshot('正文', 1, 1)).toThrow('Selection range is invalid')
    const snapshot = createManuscriptSelectionSnapshot('正文', 0, 1)
    expect(() => applyManuscriptSelectionRewrite('正文', snapshot, '  ')).toThrow('模型没有返回可用的重写内容')
  })
})
