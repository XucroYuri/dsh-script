import {
  DomainError,
  type AutomationMode,
  type ChapterBatchItem,
  type ChapterBatchMode,
  type ChapterBatchStatus,
  type WorkflowRunStatus,
} from './model.js'

export type { AutomationMode, ChapterBatchItem, ChapterBatchMode, ChapterBatchStatus } from './model.js'

export const MAX_CHAPTER_BATCH_SIZE = 20
export const MIN_CHAPTER_BATCH_TARGET_WORDS = 1
export const DEFAULT_CHAPTER_BATCH_TARGET_WORDS = 3_000
export const YOLO_RELATIONSHIP_SAFETY_ERROR = '有界 YOLO 需要启用实体关系安全检查；请先将实体关系权限设为 AUTO 或 YOLO。'

const MAX_TITLE_CHARACTERS = 200
const MAX_BRIEF_CHARACTERS = 4_000

export interface ChapterBatchAutomationPolicy {
  mode: AutomationMode
  planApproval: 'required' | 'automatic'
  chapterApproval: 'required' | 'automatic'
  scheduling: 'strict_serial'
  failure: 'pause_batch'
  drift: 'require_confirmation'
  automaticRetryLimit: 0
}

/**
 * AUTO automates planning and serial dispatch while preserving both author
 * approval boundaries. YOLO is the explicit opt-in that may approve the plan
 * and generated chapters. Neither mode silently retries, skips failures or
 * accepts a changed chapter revision.
 */
export const AUTO_CHAPTER_BATCH_POLICY = Object.freeze({
  mode: 'auto',
  planApproval: 'required',
  chapterApproval: 'required',
  scheduling: 'strict_serial',
  failure: 'pause_batch',
  drift: 'require_confirmation',
  automaticRetryLimit: 0,
} satisfies ChapterBatchAutomationPolicy)

export const YOLO_CHAPTER_BATCH_POLICY = Object.freeze({
  mode: 'yolo',
  planApproval: 'automatic',
  chapterApproval: 'automatic',
  scheduling: 'strict_serial',
  failure: 'pause_batch',
  drift: 'require_confirmation',
  automaticRetryLimit: 0,
} satisfies ChapterBatchAutomationPolicy)

export const CHAPTER_BATCH_POLICIES = Object.freeze({
  auto: AUTO_CHAPTER_BATCH_POLICY,
  yolo: YOLO_CHAPTER_BATCH_POLICY,
})

export interface NormalizedChapterBatchPlanItem {
  chapterId: string | null
  plannedTitle: string
  writingGoal: string
  openingContinuity: string
  endingHook: string
  targetWords: number
}

export interface NormalizedChapterBatchPlan {
  items: NormalizedChapterBatchPlanItem[]
}

export interface NormalizeChapterBatchPlanOptions {
  mode: ChapterBatchMode
  requestedCount: number
  /** Required, in queue order, when mode is selected. */
  selectedChapterIds?: readonly string[]
  defaultTargetWords?: number
}

export type ChapterBatchEffectiveItemStatus =
  | 'planned'
  | 'queued'
  | 'dispatching'
  | 'running'
  | 'paused'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'blocked'
  | 'skipped'

function validation(message: string): never {
  throw new DomainError('validation', message)
}

function normalizedIdentifier(value: unknown, field: string, nullable = false): string | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !value.trim()) return validation(`${field} is required.`)
  return value.trim()
}

function normalizedText(value: unknown, field: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') return validation(`${field} must be text.`)
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!normalized && !allowEmpty) return validation(`${field} is required.`)
  if (normalized.length > maximum) return validation(`${field} cannot exceed ${maximum} characters.`)
  return normalized
}

function safeInteger(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return validation(`${field} must be a safe integer between ${minimum} and ${maximum}.`)
  }
  return value as number
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return validation(`${field} must be an object.`)
  return value as Record<string, unknown>
}

function planRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const object = record(value, 'chapter batch plan')
  const rows = object.items ?? object.chapters
  if (!Array.isArray(rows)) return validation('Chapter batch plan must contain an items or chapters array.')
  return rows
}

export function resolveChapterBatchPolicy(mode: AutomationMode): Readonly<ChapterBatchAutomationPolicy> {
  const policy = CHAPTER_BATCH_POLICIES[mode]
  if (!policy) return validation('Chapter batch automation mode must be auto or yolo.')
  return policy
}

export function normalizeChapterBatchPlanItem(
  value: unknown,
  index: number,
  defaultTargetWords = DEFAULT_CHAPTER_BATCH_TARGET_WORDS,
): NormalizedChapterBatchPlanItem {
  const input = record(value, `items[${index}]`)
  return {
    chapterId: normalizedIdentifier(input.chapterId ?? null, `items[${index}].chapterId`, true),
    plannedTitle: normalizedText(input.plannedTitle ?? input.title, `items[${index}].plannedTitle`, MAX_TITLE_CHARACTERS),
    writingGoal: normalizedText(input.writingGoal, `items[${index}].writingGoal`, MAX_BRIEF_CHARACTERS),
    openingContinuity: normalizedText(input.openingContinuity ?? '', `items[${index}].openingContinuity`, MAX_BRIEF_CHARACTERS, true),
    endingHook: normalizedText(input.endingHook ?? '', `items[${index}].endingHook`, MAX_BRIEF_CHARACTERS, true),
    targetWords: safeInteger(input.targetWords ?? defaultTargetWords, `items[${index}].targetWords`, MIN_CHAPTER_BATCH_TARGET_WORDS),
  }
}

/**
 * Normalizes an untrusted model plan. Selected batches are restored to the
 * author's requested order even if the model returns another order.
 */
export function normalizeChapterBatchPlan(value: unknown, options: NormalizeChapterBatchPlanOptions): NormalizedChapterBatchPlan {
  const requestedCount = safeInteger(options.requestedCount, 'requestedCount', 1, MAX_CHAPTER_BATCH_SIZE)
  const defaultTargetWords = safeInteger(
    options.defaultTargetWords ?? DEFAULT_CHAPTER_BATCH_TARGET_WORDS,
    'defaultTargetWords',
    MIN_CHAPTER_BATCH_TARGET_WORDS,
  )
  const rows = planRows(value)
  if (rows.length !== requestedCount) validation(`Chapter batch plan must contain exactly ${requestedCount} items.`)
  const items = rows.map((row, index) => normalizeChapterBatchPlanItem(row, index, defaultTargetWords))

  const chapterIds = new Set<string>()
  for (const item of items) {
    if (!item.chapterId) continue
    if (chapterIds.has(item.chapterId)) validation(`Chapter ${item.chapterId} appears more than once in the plan.`)
    chapterIds.add(item.chapterId)
  }

  if (options.mode === 'selected') {
    const selectedChapterIds = options.selectedChapterIds?.map((id, index) => normalizedIdentifier(id, `selectedChapterIds[${index}]`)!)
    if (!selectedChapterIds || selectedChapterIds.length !== requestedCount) validation('Selected batches need every selected chapter ID in queue order.')
    if (new Set(selectedChapterIds).size !== selectedChapterIds.length) validation('Selected chapter IDs must be unique.')
    const byChapterId = new Map(items.map(item => [item.chapterId, item]))
    if (items.some(item => !item.chapterId) || selectedChapterIds.some(id => !byChapterId.has(id)) || byChapterId.size !== selectedChapterIds.length) {
      validation('The generated plan does not match the selected chapters.')
    }
    return { items: selectedChapterIds.map(id => byChapterId.get(id)!) }
  }

  if (options.mode !== 'continuous') validation('Chapter batch mode must be selected or continuous.')
  return { items }
}

/** Sorts and validates hydrated persisted items without mutating repository data. */
export function normalizeChapterBatchItems(items: readonly ChapterBatchItem[]): ChapterBatchItem[] {
  if (!Array.isArray(items) || items.length === 0) validation('A persisted chapter batch needs at least one item.')
  if (items.length > MAX_CHAPTER_BATCH_SIZE) validation(`A persisted chapter batch cannot contain more than ${MAX_CHAPTER_BATCH_SIZE} items.`)
  const normalized = [...items].sort((left, right) => left.position - right.position)
  const ids = new Set<string>()
  const chapterIds = new Set<string>()
  const workflowRunIds = new Set<string>()
  let activeWorkflowCount = 0

  return normalized.map((item, index) => {
    const expectedPosition = index + 1
    const id = normalizedIdentifier(item.id, `items[${index}].id`)!
    if (ids.has(id)) validation(`Batch item ${id} appears more than once.`)
    ids.add(id)
    if (item.position !== expectedPosition) validation('Batch item positions must be contiguous and one-based.')
    if (item.chapterId) {
      const chapterId = normalizedIdentifier(item.chapterId, `items[${index}].chapterId`)!
      if (chapterIds.has(chapterId)) validation(`Chapter ${chapterId} appears more than once in the batch.`)
      chapterIds.add(chapterId)
    }
    if (item.workflowRunId) {
      const workflowRunId = normalizedIdentifier(item.workflowRunId, `items[${index}].workflowRunId`)!
      if (workflowRunIds.has(workflowRunId)) validation(`Workflow ${workflowRunId} appears more than once in the batch.`)
      workflowRunIds.add(workflowRunId)
      if (item.workflow && item.workflow.id !== workflowRunId) validation(`Batch item ${id} has a mismatched hydrated workflow.`)
    }
    if (['planned', 'queued'].includes(item.queueState) && (item.workflowRunId || item.workflow)) {
      validation(`${item.queueState} batch item ${id} cannot already have a workflow.`)
    }
    if (item.queueState === 'dispatched' && !item.workflowRunId) validation(`Dispatched batch item ${id} needs a workflow run.`)
    if (item.queueState === 'dispatched' && !['succeeded', 'cancelled'].includes(item.workflow?.status ?? '')) activeWorkflowCount++
    if (activeWorkflowCount > 1) validation('A strict-serial chapter batch cannot have more than one active workflow.')

    return {
      ...item,
      id,
      plannedTitle: normalizedText(item.plannedTitle, `items[${index}].plannedTitle`, MAX_TITLE_CHARACTERS),
      writingGoal: normalizedText(item.writingGoal, `items[${index}].writingGoal`, MAX_BRIEF_CHARACTERS),
      openingContinuity: normalizedText(item.openingContinuity, `items[${index}].openingContinuity`, MAX_BRIEF_CHARACTERS, true),
      endingHook: normalizedText(item.endingHook, `items[${index}].endingHook`, MAX_BRIEF_CHARACTERS, true),
      targetWords: safeInteger(item.targetWords, `items[${index}].targetWords`, MIN_CHAPTER_BATCH_TARGET_WORDS),
    }
  })
}

export function deriveChapterBatchItemStatus(item: ChapterBatchItem): ChapterBatchEffectiveItemStatus {
  if (item.queueState === 'planned' || item.queueState === 'queued' || item.queueState === 'blocked' || item.queueState === 'skipped' || item.queueState === 'cancelled') {
    return item.queueState
  }
  return item.workflow?.status ?? 'dispatching'
}

export function deriveChapterBatchStatus(currentStatus: ChapterBatchStatus, rawItems: readonly ChapterBatchItem[]): ChapterBatchStatus {
  const items = normalizeChapterBatchItems(rawItems)
  const statuses = items.map(deriveChapterBatchItemStatus)
  const allFinished = statuses.every(status => ['succeeded', 'skipped', 'cancelled'].includes(status))
  if (currentStatus === 'cancelled') return 'cancelled'
  if (allFinished) return statuses.every(status => status === 'succeeded') ? 'succeeded' : 'completed_with_skips'
  if (currentStatus === 'planning' || currentStatus === 'awaiting_plan_approval') return currentStatus
  if (currentStatus === 'pause_requested') {
    return statuses.some(status => status === 'running' || status === 'dispatching' || status === 'cancel_requested') ? 'pause_requested' : 'paused'
  }
  if (currentStatus === 'paused') return 'paused'
  if (statuses.some(status => status === 'failed' || status === 'blocked')) return 'blocked'
  if (statuses.some(status => status === 'waiting_approval')) return 'waiting_approval'
  if (currentStatus === 'queued' && statuses.every(status => status === 'queued')) return 'queued'
  return 'running'
}

export function assertChapterBatchRevision(currentRevision: number, baseRevision: number): void {
  safeInteger(currentRevision, 'currentRevision', 0)
  safeInteger(baseRevision, 'baseRevision', 0)
  if (currentRevision !== baseRevision) throw new DomainError('revision-conflict', `Batch revision changed from ${baseRevision} to ${currentRevision}.`)
}

/** Planned/queued rows may exchange positions; started and resolved rows stay fixed. */
export function reorderChapterBatchItems(items: readonly ChapterBatchItem[], orderedItemIds: readonly string[]): ChapterBatchItem[] {
  const current = normalizeChapterBatchItems(items)
  if (!Array.isArray(orderedItemIds) || orderedItemIds.length !== current.length) validation('The reordered item list must contain every batch item exactly once.')
  const byId = new Map(current.map(item => [item.id, item]))
  const seen = new Set<string>()
  const movable = (item: ChapterBatchItem): boolean => item.queueState === 'planned' || item.queueState === 'queued'
  const reordered = orderedItemIds.map((rawId, index) => {
    const id = normalizedIdentifier(rawId, `orderedItemIds[${index}]`)!
    if (seen.has(id)) validation(`Batch item ${id} appears more than once in the reordered list.`)
    seen.add(id)
    const item = byId.get(id)
    if (!item) validation(`Batch item ${id} is not part of this batch.`)
    const fixed = current[index]!
    if (!movable(fixed) && fixed.id !== id) validation(`Batch item ${fixed.id} has already started and cannot be moved.`)
    return { ...item, position: index + 1 }
  })
  if (seen.size !== byId.size) validation('The reordered item list must contain every batch item exactly once.')
  return reordered
}

export function findActiveChapterBatchItem(items: readonly ChapterBatchItem[]): ChapterBatchItem | null {
  return normalizeChapterBatchItems(items).find(item => item.queueState === 'dispatched' && !['succeeded', 'cancelled'].includes(item.workflow?.status ?? '')) ?? null
}

export function workflowStatusForBatchItem(item: ChapterBatchItem): WorkflowRunStatus | null {
  return item.workflow?.status ?? null
}
