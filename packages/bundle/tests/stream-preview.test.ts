import { describe, expect, it } from 'vitest'
import { createThrottledStreamWriter, extractStreamingJsonString } from '../src/generation/stream-preview.js'

describe('recoverable streaming manuscript preview', () => {
  it('extracts a growing JSON string field before the full response is valid JSON', () => {
    expect(extractStreamingJsonString('{"title":"章","manuscript":"潮声', 'manuscript')).toBe('潮声')
    expect(extractStreamingJsonString('{"manuscript":"潮声\\n继续\\u3002', 'manuscript')).toBe('潮声\n继续。')
    expect(extractStreamingJsonString('{"manuscript":"等待\\', 'manuscript')).toBe('等待')
    expect(extractStreamingJsonString('{"other":"内容"}', 'manuscript')).toBe('')
  })

  it('persists monotonic snapshots and flushes the final short tail', () => {
    const writes: string[] = []
    const writer = createThrottledStreamWriter(value => { writes.push(value) }, Number.POSITIVE_INFINITY, 4)
    writer.push('一')
    writer.push('一二三四')
    writer.push('一二三')
    writer.push('一二三四五')
    writer.flush()
    expect(writes).toEqual(['一二三四', '一二三四五'])
  })
})
