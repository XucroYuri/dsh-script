import { describe, expect, it } from 'vitest'
import { manuscriptWordCount } from '../src/domain/manuscript.js'

describe('manuscriptWordCount', () => {
  it('matches the persisted Chinese manuscript counting convention', () => {
    expect(manuscriptWordCount('')).toBe(0)
    expect(manuscriptWordCount('你好，世界。\n')).toBe(6)
    expect(manuscriptWordCount('第一段。\n\n第二段。')).toBe(8)
  })

  it('counts non-Chinese text by whitespace-delimited words', () => {
    expect(manuscriptWordCount('Hello, world! 你好')).toBe(4)
    expect(manuscriptWordCount('  one\n two\tthree  ')).toBe(3)
  })
})
