import { describe, expect, it } from 'vitest'
import { extractStoryTimelineAnchors } from '../src/domain/story-timeline.js'

describe('story-world timeline presentation', () => {
  it('extracts approved story anchors without exposing manuscript-version records', () => {
    expect(extractStoryTimelineAnchors(`前文\n\n关键时间锚点汇总：\n雾港封锁事件（林舟16岁）\n北岸停战\n旧灯塔失火\n\n硬性边界：\n一、不得改写`)).toEqual([
      '雾港封锁事件（林舟16岁）',
      '北岸停战',
      '旧灯塔失火',
    ])
  })

  it('returns no invented anchors when the approved foundation lacks an anchor section', () => {
    expect(extractStoryTimelineAnchors('只有普通时间线正文。')).toEqual([])
  })
})
