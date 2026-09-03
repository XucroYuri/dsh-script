import { describe, expect, it } from 'vitest'
import { diffManuscriptParagraphs, manuscriptParagraphs } from '../src/domain/manuscript-diff.js'

describe('manuscript paragraph diff', () => {
  it('normalizes line endings and ignores empty separator lines', () => {
    expect(manuscriptParagraphs(' 第一段。\r\n\r\n第二段。 \n')).toEqual(['第一段。', '第二段。'])
  })

  it('uses paragraph LCS so unchanged paragraphs remain aligned', () => {
    const diff = diffManuscriptParagraphs('开场。\n旧冲突。\n结尾。', '开场。\n新线索。\n旧冲突。\n结尾。')

    expect(diff.coarse).toBe(false)
    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(0)
    expect(diff.rows.map(row => [row.kind, row.text])).toEqual([
      ['equal', '开场。'],
      ['added', '新线索。'],
      ['equal', '旧冲突。'],
      ['equal', '结尾。'],
    ])
  })

  it('falls back to complete change blocks when the bounded LCS would be too large', () => {
    const diff = diffManuscriptParagraphs('相同开头。\n旧一。\n旧二。\n相同结尾。', '相同开头。\n新一。\n新二。\n相同结尾。', { maxLcsCells: 1 })

    expect(diff.coarse).toBe(true)
    expect(diff.rows.map(row => [row.kind, row.text])).toEqual([
      ['equal', '相同开头。'],
      ['removed', '旧一。'],
      ['removed', '旧二。'],
      ['added', '新一。'],
      ['added', '新二。'],
      ['equal', '相同结尾。'],
    ])
  })

  it('handles an empty side without losing the manuscript paragraphs', () => {
    const diff = diffManuscriptParagraphs('', '第一段。\n第二段。')
    expect(diff.rows.map(row => row.text)).toEqual(['第一段。', '第二段。'])
    expect(diff.added).toBe(2)
  })
})
