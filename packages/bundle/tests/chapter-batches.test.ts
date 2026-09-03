import { describe, expect, it } from 'vitest'
import {
  assertChapterBatchRevision,
  AUTO_CHAPTER_BATCH_POLICY,
  deriveChapterBatchStatus,
  MAX_CHAPTER_BATCH_SIZE,
  normalizeChapterBatchItems,
  normalizeChapterBatchPlan,
  reorderChapterBatchItems,
  YOLO_CHAPTER_BATCH_POLICY,
} from '../src/domain/chapter-batches.js'
import type { ChapterBatchItem, WorkflowRun, WorkflowRunStatus } from '../src/domain/model.js'

function workflow(id: string, status: WorkflowRunStatus): WorkflowRun {
  return { id, status } as WorkflowRun
}

function item(
  index: number,
  queueState: ChapterBatchItem['queueState'] = 'queued',
  workflowStatus: WorkflowRunStatus | null = null,
): ChapterBatchItem {
  const workflowRunId = workflowStatus || queueState === 'dispatched' ? `workflow-${index}` : null
  return {
    id: `item-${index}`,
    batchId: 'batch-1',
    chapterId: `chapter-${index}`,
    position: index,
    plannedTitle: `第 ${index} 章`,
    writingGoal: `推进第 ${index} 章冲突`,
    openingContinuity: '承接上一章结尾',
    endingHook: '留下新线索',
    targetWords: 3_000,
    queueState,
    workflowRunId,
    workflow: workflowRunId && workflowStatus ? workflow(workflowRunId, workflowStatus) : null,
    chapterRevisionAtEnqueue: 0,
    blockedReason: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

describe('chapter batch planning boundary', () => {
  it('defines distinct AUTO and YOLO approval boundaries without hidden retry or skip', () => {
    expect(AUTO_CHAPTER_BATCH_POLICY).toMatchObject({ mode: 'auto', planApproval: 'required', chapterApproval: 'required', automaticRetryLimit: 0 })
    expect(YOLO_CHAPTER_BATCH_POLICY).toMatchObject({ mode: 'yolo', planApproval: 'automatic', chapterApproval: 'automatic', failure: 'pause_batch', drift: 'require_confirmation' })
  })

  it('normalizes model brief fields and restores selected chapters to author queue order', () => {
    const plan = normalizeChapterBatchPlan({ items: [
      { chapterId: 'chapter-2', title: '  第二章  ', writingGoal: '推进\n冲突', targetWords: 3200 },
      { chapterId: 'chapter-1', plannedTitle: '第一章', writingGoal: '建立悬念', openingContinuity: ' 开场 ', endingHook: ' 线索 ' },
    ] }, { mode: 'selected', requestedCount: 2, selectedChapterIds: ['chapter-1', 'chapter-2'] })

    expect(plan.items.map(entry => entry.chapterId)).toEqual(['chapter-1', 'chapter-2'])
    expect(plan.items[0]).toMatchObject({ plannedTitle: '第一章', openingContinuity: '开场', endingHook: '线索', targetWords: 3000 })
    expect(plan.items[1]).toMatchObject({ plannedTitle: '第二章', writingGoal: '推进 冲突', targetWords: 3200 })
  })

  it('allows continuous plans to describe not-yet-created chapters', () => {
    const plan = normalizeChapterBatchPlan({ chapters: [
      { plannedTitle: '潮汐之前', writingGoal: '抵达港口', targetWords: 2800 },
      { chapterId: null, plannedTitle: '旧塔来信', writingGoal: '发现来信' },
    ] }, { mode: 'continuous', requestedCount: 2 })
    expect(plan.items.map(entry => entry.chapterId)).toEqual([null, null])
  })

  it('rejects wrong counts, duplicate IDs, selected drift and non-positive targets while allowing large targets', () => {
    const row = (chapterId: string) => ({ chapterId, plannedTitle: chapterId, writingGoal: '目标' })
    expect(() => normalizeChapterBatchPlan({ items: [] }, { mode: 'continuous', requestedCount: 1 })).toThrow('exactly 1')
    expect(() => normalizeChapterBatchPlan({ items: [row('a'), row('a')] }, { mode: 'continuous', requestedCount: 2 })).toThrow('more than once')
    expect(() => normalizeChapterBatchPlan({ items: [row('a')] }, { mode: 'selected', requestedCount: 1, selectedChapterIds: ['b'] })).toThrow('does not match')
    expect(normalizeChapterBatchPlan({ items: [{ ...row('a'), targetWords: 50_000 }] }, { mode: 'continuous', requestedCount: 1 }).items[0]?.targetWords).toBe(50_000)
    expect(() => normalizeChapterBatchPlan({ items: [{ ...row('a'), targetWords: 0 }] }, { mode: 'continuous', requestedCount: 1 })).toThrow('between 1 and')
    expect(() => normalizeChapterBatchPlan({ items: Array.from({ length: MAX_CHAPTER_BATCH_SIZE }, (_, index) => row(String(index))) }, { mode: 'continuous', requestedCount: MAX_CHAPTER_BATCH_SIZE + 1 })).toThrow('between 1 and 20')
  })
})

describe('chapter batch persisted queue state', () => {
  it('normalizes one-based positions and derives approval, failure, pause and completion', () => {
    expect(normalizeChapterBatchItems([item(2), item(1)]).map(entry => entry.id)).toEqual(['item-1', 'item-2'])
    expect(deriveChapterBatchStatus('running', [item(1, 'dispatched', 'waiting_approval'), item(2)])).toBe('waiting_approval')
    expect(deriveChapterBatchStatus('running', [item(1, 'dispatched', 'failed'), item(2)])).toBe('blocked')
    expect(deriveChapterBatchStatus('pause_requested', [item(1, 'dispatched', 'running'), item(2)])).toBe('pause_requested')
    expect(deriveChapterBatchStatus('pause_requested', [item(1, 'dispatched', 'paused'), item(2)])).toBe('paused')
    expect(deriveChapterBatchStatus('running', [item(1, 'dispatched', 'succeeded'), item(2, 'skipped')])).toBe('completed_with_skips')
  })

  it('reorders only planned or queued rows and keeps started rows fixed', () => {
    const items = [item(1, 'dispatched', 'succeeded'), item(2), item(3)]
    expect(reorderChapterBatchItems(items, ['item-1', 'item-3', 'item-2']).map(entry => [entry.id, entry.position])).toEqual([
      ['item-1', 1], ['item-3', 2], ['item-2', 3],
    ])
    expect(() => reorderChapterBatchItems(items, ['item-2', 'item-1', 'item-3'])).toThrow('already started')
    expect(() => reorderChapterBatchItems(items, ['item-1', 'item-2', 'item-2'])).toThrow('more than once')
  })

  it('uses optimistic revisions for reorder and control commands', () => {
    expect(() => assertChapterBatchRevision(7, 6)).toThrow('revision changed from 6 to 7')
    expect(() => assertChapterBatchRevision(7, 7)).not.toThrow()
  })
})
