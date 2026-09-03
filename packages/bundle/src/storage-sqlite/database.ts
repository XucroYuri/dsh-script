import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { DomainError, type AutomationMode, type CanonCandidate, type CanonFact, type Chapter, type ChapterBatchItem, type ChapterBatchPlan, type ChapterBatchStatus, type ChapterDetail, type ChapterGenerationBatch, type CreateProjectInput, type EntityRelationship, type EntityRelationshipEvidence, type FoundationGenerationRun, type FoundationPlannerAnswer, type FoundationPlannerQuestion, type GenerationContext, type GenerationPurpose, type GenerationSources, type GenerationStatisticsTotals, type GenerationTelemetry, type HistoricalKnowledgeScope, type HistoricalSourceSetting, type KnowledgeRefreshContext, type KnowledgeSelectionSnapshot, type KnowledgeSummary, type KnowledgeSummaryDraft, type KnowledgeWorkspace, type LibraryOverview, type ManuscriptVersion, type MemoryBrowserPage, type MemoryCategory, type MemoryConflict, type MemoryItem, type MemoryPromptPolicy, type MemoryRevision, type MemoryRevisionDiff, type MemoryRevisionHistoryEntry, type MemorySource, type MemoryUsage, type ModelRun, type ModelSelection, type ModelUsage, type PreviousChapterContinuity, type PriorChapterSummary, type Project, type ProjectFoundationKind, type ProjectFoundationVersion, type ProjectFoundationWorkspace, type ProjectGenerationStatistics, type ProjectRules, type ProjectTree, type PromptAsset, type PromptAssetVersion, type PromptCatalog, type PromptPack, type RecoveryCapsule, type RelationshipCandidate, type RelationshipCandidateBatchDecision, type RelationshipCandidateBatchResult, type RelationshipCandidateConfirmationInput, type RelationshipCategory, type RelationshipExtractionRun, type RelationshipFactLayer, type RelationshipGraph, type RelationshipListPage, type RelationshipMode, type ResumeContext, type RetrievalBundle, type RetrievalItem, type ReviewReport, type SaveDraftInput, type ScenePlan, type StoryEntity, type StoryGrowthMap, type StudioOverview, type TimelineEvent, type WorkflowApproval, type WorkflowDefinitionVersion, type WorkflowEvent, type WorkflowNodeRun, type WorkflowRun, type WorkflowRunStatus, type WorkspaceSnapshot, type WritingStyleProfile, type WritingStyleProfileDraft, type WritingStylePreset } from '../domain/model.js'
import { normalizePortableProjectSnapshot, parseManuscriptImport, PORTABLE_PROJECT_FORMAT, PORTABLE_PROJECT_SCHEMA_VERSION, renderProjectMarkdown, safeExportFileStem, type ManuscriptImportInput, type PortableProjectSnapshotV2, type ProjectExportFile, type ProjectImportResult } from '../domain/project-portability.js'
import type { LegacyLengthDraftRecovery, NovelRepository, StorageHealth } from '../storage/repository.js'
import { BUILTIN_PROMPT_PACK, BUILTIN_PROMPTS, BUILTIN_PROMPT_UPGRADES, BUILTIN_PROMPT_VERSIONS } from '../prompt-assets/builtin.js'
import { EXPECTED_SCHEMA_VERSION, migrations } from './migrations.js'
import { emptyGenerationTelemetry } from '../generation/tokens.js'
import { chapterDraftLengthAdvisory, DEFAULT_CHAPTER_TARGET_WORDS } from '../generation/chapter-budget.js'
import { manuscriptWordCount } from '../domain/manuscript.js'
import { DEFAULT_STYLE_PRESET_ID, BUILTIN_STYLE_PRESETS, getBuiltinStylePreset } from '../style/presets.js'
import { memoryItemMarkdownPath, normalizeWorkspacePath, readMemoryItemMarkdown, readMemoryMarkdown, writeChapterMarkdown, writeFoundationMarkdown, writeMemoryItemMarkdown, writeMemoryMarkdown } from '../storage/markdown-mirror.js'
import { canonicalizeRelationshipEndpoints, normalizeRelationshipPredicateKey, normalizeRelationshipText, relationshipFingerprint, validateRelationshipTimeRange } from '../domain/entity-relationships.js'
import { reorderChapterBatchItems, YOLO_RELATIONSHIP_SAFETY_ERROR } from '../domain/chapter-batches.js'
import type { MemoryUsagePage } from '../domain/model.js'

type Row = Record<string, unknown>

export const CHAPTER_WORKFLOW_NODES = [
  'freeze_input_snapshot', 'retrieve_context', 'plan_scenes', 'validate_scene_plan', 'generate_draft',
  'plot_review', 'character_review', 'timeline_review', 'style_review', 'aggregate_review',
  'conditional_revision_loop', 'wait_chapter_approval', 'commit_approved_version',
  'extract_canon_candidates', 'validate_canon_candidates', 'commit_canon', 'refresh_summaries_and_indexes',
] as const

const CHAPTER_WORKFLOW_DEFINITION_ID = 'workflow-chapter-production'
const CHAPTER_WORKFLOW_VERSION_ID = 'workflow-chapter-production-v1'

const FOUNDATION_DEFINITIONS: Array<{ kind: ProjectFoundationKind; title: string; description: string; dependencies: ProjectFoundationKind[] }> = [
  { kind: 'outline', title: '全书大纲', description: '确定主线、阶段转折、结局方向和叙事边界。', dependencies: [] },
  { kind: 'characters', title: '人物体系', description: '基于大纲建立人物目标、关系、弧光和行为约束。', dependencies: ['outline'] },
  { kind: 'timeline', title: '故事时间线', description: '基于大纲和人物，把关键事件排入稳定的故事顺序与时间因果。', dependencies: ['outline', 'characters'] },
]

const FOUNDATION_LABELS: Record<ProjectFoundationKind, string> = {
  outline: '全书大纲', characters: '人物体系', worldbuilding: '世界观与规则', timeline: '故事时间线', foreshadowing: '伏笔与回收',
}

function now(): string {
  return new Date().toISOString()
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u001f')).digest('hex')}`
}

function slugify(title: string): string {
  const ascii = title.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '')
  return `${ascii || 'novel'}-${randomUUID().slice(0, 8)}`
}

function projectFrom(row: Row): Project {
  return {
    id: String(row.id), title: String(row.title), slug: String(row.slug), language: String(row.language),
    genre: row.genre === null ? null : String(row.genre), audience: row.audience === null ? null : String(row.audience),
    status: row.status as Project['status'], targetWordCount: row.target_word_count === null ? null : Number(row.target_word_count),
    chapterTargetWords: row.chapter_target_words === null ? null : Number(row.chapter_target_words), currentBookId: String(row.current_book_id),
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    archivedAt: row.archived_at === null || row.archived_at === undefined ? null : String(row.archived_at),
    workspacePath: row.project_root_path === null || row.project_root_path === undefined ? null : String(row.project_root_path),
    markdownSyncEnabled: Number(row.markdown_sync_enabled ?? 0) === 1,
    memoryUpdatedAt: row.memory_updated_at === null || row.memory_updated_at === undefined ? null : String(row.memory_updated_at),
  }
}

function chapterFrom(row: Row): Chapter {
  return {
    id: String(row.id), projectId: String(row.project_id), bookId: String(row.book_id), volumeId: row.volume_id === null ? null : String(row.volume_id),
    chapterNumber: Number(row.chapter_number), title: String(row.title), status: row.status as Chapter['status'],
    currentDraftVersionId: row.current_draft_version_id === null ? null : String(row.current_draft_version_id),
    currentApprovedVersionId: row.current_approved_version_id === null ? null : String(row.current_approved_version_id),
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function versionFrom(row: Row): ManuscriptVersion {
  return {
    id: String(row.id), projectId: String(row.project_id), chapterId: String(row.chapter_id),
    parentVersionId: row.parent_version_id === null ? null : String(row.parent_version_id), status: row.status as ManuscriptVersion['status'],
    content: String(row.content), contentHash: String(row.content_hash), wordCount: Number(row.word_count), origin: row.origin as ManuscriptVersion['origin'],
    createdBy: row.created_by as ManuscriptVersion['createdBy'],
    promptAssetVersionId: row.prompt_asset_version_id === null ? null : String(row.prompt_asset_version_id),
    modelRunId: row.model_run_id === null ? null : String(row.model_run_id),
    workflowRunId: row.workflow_run_id === null ? null : String(row.workflow_run_id),
    workflowNodeRunId: row.workflow_node_run_id === null ? null : String(row.workflow_node_run_id),
    createdAt: String(row.created_at), approvedAt: row.approved_at === null ? null : String(row.approved_at),
  }
}

function memoryRevisionFrom(row: Row): MemoryRevision {
  return {
    id: String(row.id), itemId: String(row.item_id), revision: Number(row.revision), content: String(row.content),
    structuredJson: String(row.structured_json ?? '{}'), contentHash: String(row.content_hash),
    actor: row.actor as MemoryRevision['actor'], parentRevisionId: row.parent_revision_id === null ? null : String(row.parent_revision_id),
    provider: row.provider === null ? null : String(row.provider), model: row.model === null ? null : String(row.model),
    promptHash: row.prompt_hash === null ? null : String(row.prompt_hash), createdAt: String(row.created_at),
  }
}

function memorySourceFrom(row: Row): MemorySource {
  return {
    id: String(row.id), revisionId: String(row.revision_id), sourceType: String(row.source_type), sourceId: String(row.source_id),
    sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), label: String(row.label), createdAt: String(row.created_at),
  }
}

function memoryUsageFrom(row: Row): MemoryUsage {
  return {
    id: String(row.id), itemId: String(row.item_id), revisionId: String(row.revision_id), modelRunId: String(row.model_run_id),
    sectionKey: String(row.section_key ?? ''), included: Number(row.included) === 1, truncated: Number(row.truncated ?? 0) === 1,
    estimatedTokens: Number(row.estimated_tokens), reason: String(row.reason), createdAt: String(row.created_at),
  }
}

function memoryConflictFrom(row: Row): MemoryConflict {
  const baseContent = String(row.base_content ?? '')
  const databaseContent = String(row.database_content ?? '')
  return {
    id: String(row.id), itemId: String(row.item_id),
    baseRevisionId: row.base_revision_id === null || row.base_revision_id === undefined ? null : String(row.base_revision_id),
    baseContent, databaseRevisionId: String(row.database_revision_id), databaseContent,
    fileContent: String(row.file_content), fileHash: String(row.file_hash),
    baseToDatabaseDiff: lineDiff(baseContent, databaseContent), baseToFileDiff: lineDiff(baseContent, String(row.file_content)),
    status: row.status as MemoryConflict['status'],
    resolution: row.resolution === null ? null : String(row.resolution), createdAt: String(row.created_at), resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
  }
}

function lineDiff(from: string, to: string): MemoryRevisionDiff['lines'] {
  const left = from.split(/\r?\n/), right = to.split(/\r?\n/)
  if (left.length * right.length > 160_000) return [
    ...left.map(text => ({ kind: 'removed' as const, text })),
    ...right.map(text => ({ kind: 'added' as const, text })),
  ]
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i]![j] = left[i] === right[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const result: MemoryRevisionDiff['lines'] = []
  let i = 0, j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { result.push({ kind: 'same', text: left[i]! }); i++; j++ }
    else if (j < right.length && (i >= left.length || table[i]![j + 1]! >= table[i + 1]![j]!)) result.push({ kind: 'added', text: right[j++]! })
    else result.push({ kind: 'removed', text: left[i++]! })
  }
  return result
}

function relationshipFrom(row: Row): EntityRelationship {
  return {
    id: String(row.id), projectId: String(row.project_id), sourceEntityId: String(row.source_entity_id), targetEntityId: String(row.target_entity_id),
    sourceEntityName: row.source_entity_name === undefined || row.source_entity_name === null ? String(row.source_entity_id) : String(row.source_entity_name),
    targetEntityName: row.target_entity_name === undefined || row.target_entity_name === null ? String(row.target_entity_id) : String(row.target_entity_name),
    predicateKey: String(row.predicate_key), label: String(row.label), category: row.category as RelationshipCategory,
    directionality: row.directionality as EntityRelationship['directionality'], factLayer: row.fact_layer as RelationshipFactLayer,
    validFromStoryOrder: row.valid_from_story_order === null ? null : Number(row.valid_from_story_order),
    validToStoryOrder: row.valid_to_story_order === null ? null : Number(row.valid_to_story_order), status: row.status as EntityRelationship['status'],
    supersedesRelationshipId: row.supersedes_relationship_id === null ? null : String(row.supersedes_relationship_id),
    createdBy: row.created_by as EntityRelationship['createdBy'], fingerprint: String(row.fingerprint), revision: Number(row.revision),
    evidenceCount: Number(row.evidence_count ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function relationshipCandidateFrom(row: Row): RelationshipCandidate {
  return {
    id: String(row.id), runId: String(row.run_id), sourceEntityId: row.source_entity_id === null ? null : String(row.source_entity_id),
    targetEntityId: row.target_entity_id === null ? null : String(row.target_entity_id), sourceLabel: String(row.source_label),
    targetLabel: String(row.target_label), predicateKey: String(row.predicate_key), label: String(row.label),
    category: row.category as RelationshipCategory, directionality: row.directionality as RelationshipCandidate['directionality'],
    factLayer: row.fact_layer as RelationshipFactLayer, validFromStoryOrder: row.valid_from_story_order === null ? null : Number(row.valid_from_story_order),
    validToStoryOrder: row.valid_to_story_order === null ? null : Number(row.valid_to_story_order), confidence: Number(row.confidence),
    status: row.status as RelationshipCandidate['status'], evidenceJson: String(row.evidence_json), fingerprint: String(row.fingerprint),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function relationshipExtractionRunFrom(row: Row): RelationshipExtractionRun {
  return {
    id: String(row.id), projectId: String(row.project_id), automationMode: row.automation_mode as AutomationMode,
    status: row.status as RelationshipExtractionRun['status'], provider: String(row.provider), model: String(row.model),
    promptHash: String(row.prompt_hash), errorJson: row.error_json === null ? null : String(row.error_json),
    candidateCount: Number(row.candidate_count ?? 0), pendingCount: Number(row.pending_count ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), finishedAt: row.finished_at === null ? null : String(row.finished_at),
  }
}

function nodeRunFrom(row: Row): WorkflowNodeRun {
  return { id: String(row.id), workflowRunId: String(row.workflow_run_id), nodeKey: String(row.node_key), nodeVersion: Number(row.node_version), status: row.status as WorkflowNodeRun['status'], attempt: Number(row.attempt), idempotencyKey: String(row.idempotency_key), inputJson: String(row.input_json), outputJson: row.output_json === null ? null : String(row.output_json), startedAt: row.started_at === null ? null : String(row.started_at), finishedAt: row.finished_at === null ? null : String(row.finished_at), errorJson: row.error_json === null ? null : String(row.error_json) }
}

function eventFrom(row: Row): WorkflowEvent {
  return { id: String(row.id), workflowRunId: String(row.workflow_run_id), nodeRunId: row.node_run_id === null ? null : String(row.node_run_id), type: String(row.event_type), payloadJson: String(row.payload_json), createdAt: String(row.created_at) }
}

function approvalFrom(row: Row): WorkflowApproval {
  return { id: String(row.id), workflowRunId: String(row.workflow_run_id), manuscriptVersionId: String(row.manuscript_version_id), status: row.status as WorkflowApproval['status'], decisionNote: String(row.decision_note), decidedAt: row.decided_at === null ? null : String(row.decided_at), createdAt: String(row.created_at) }
}

function reviewFrom(row: Row): ReviewReport {
  return { id: String(row.id), workflowRunId: String(row.workflow_run_id), nodeRunId: String(row.node_run_id), manuscriptVersionId: String(row.manuscript_version_id), kind: row.review_kind as ReviewReport['kind'], verdict: row.verdict as ReviewReport['verdict'], reportJson: String(row.report_json), createdAt: String(row.created_at) }
}

function candidateFrom(row: Row): CanonCandidate {
  return { id: String(row.id), workflowRunId: String(row.workflow_run_id), manuscriptVersionId: String(row.manuscript_version_id), subject: String(row.subject), predicate: String(row.predicate), valueJson: String(row.value_json), status: row.status as CanonCandidate['status'], createdAt: String(row.created_at) }
}

const MIN_CANON_EVIDENCE_CHARACTERS = 6
const MAX_CANON_EVIDENCE_CHARACTERS = 300

function canonCandidateValueWithEvidence(candidate: CanonCandidate, version: ManuscriptVersion, candidateIndex: number): string {
  let detail: Record<string, unknown>
  try {
    const parsed = JSON.parse(candidate.valueJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    detail = parsed as Record<string, unknown>
  } catch {
    throw new DomainError('validation', `第 ${candidateIndex + 1} 条 Canon 候选结构损坏，未提交任何故事事实；请返修正文或重新生成本章。`)
  }

  const rawValue = detail.value
  const metadataValue = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
    ? rawValue as Record<string, unknown>
    : null
  if (
    detail.systemDerived === 'approved-version-metadata'
    && candidate.predicate === 'chapter.approved_content'
    && metadataValue?.contentHash === version.contentHash
    && metadataValue.wordCount === version.wordCount
  ) {
    return JSON.stringify({
      ...detail,
      evidence: {
        sourceType: 'manuscript-version', sourceVersionId: version.id,
        contentHash: version.contentHash, verification: 'full-content-hash',
      },
    })
  }

  const evidenceExcerpt = typeof detail.evidenceExcerpt === 'string' ? detail.evidenceExcerpt.trim() : ''
  const evidenceCharacters = [...evidenceExcerpt].length
  if (evidenceCharacters < MIN_CANON_EVIDENCE_CHARACTERS || evidenceCharacters > MAX_CANON_EVIDENCE_CHARACTERS) {
    throw new DomainError('validation', `第 ${candidateIndex + 1} 条 Canon 候选缺少 6–300 字符的正文逐字证据，未提交任何故事事实；请返修正文或重新生成本章。`)
  }
  const excerptStart = version.content.indexOf(evidenceExcerpt)
  if (excerptStart < 0 || version.content.lastIndexOf(evidenceExcerpt) !== excerptStart) {
    throw new DomainError('validation', `第 ${candidateIndex + 1} 条 Canon 候选的逐字证据无法在当前批准正文中唯一定位，未提交任何故事事实；请返修正文或重新生成本章。`)
  }
  return JSON.stringify({
    ...detail,
    evidenceExcerpt,
    evidence: {
      sourceType: 'manuscript-version', sourceVersionId: version.id,
      excerptStart, excerptEnd: excerptStart + evidenceExcerpt.length,
      contentHash: version.contentHash, verification: 'unique-exact-excerpt',
    },
  })
}

function factFrom(row: Row): CanonFact {
  return { id: String(row.id), projectId: String(row.project_id), chapterId: String(row.chapter_id), sourceManuscriptVersionId: String(row.source_manuscript_version_id), candidateId: String(row.candidate_id), subject: String(row.subject), predicate: String(row.predicate), valueJson: String(row.value_json), createdAt: String(row.created_at) }
}

function jsonArray<T extends string>(value: unknown): T[] {
  try { const parsed = JSON.parse(String(value)) as unknown; return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') as T[] : [] } catch { return [] }
}

function styleProfileFromRow(projectId: string, row: Row): WritingStyleProfile {
  const stored = typeof row.style_profile_json === 'string' ? (() => {
    try { return JSON.parse(String(row.style_profile_json)) as Partial<WritingStyleProfile> } catch { return null }
  })() : null
  const fallback = getBuiltinStylePreset(DEFAULT_STYLE_PRESET_ID)
  const attributes = stored?.attributes && typeof stored.attributes === 'object'
    ? stored.attributes as WritingStyleProfile['attributes']
    : fallback.attributes
  const source = stored && (stored.source === 'extracted' || stored.source === 'user') ? stored.source : 'builtin'
  return {
    projectId,
    profileId: typeof stored?.profileId === 'string' ? stored.profileId : `builtin:${DEFAULT_STYLE_PRESET_ID}`,
    presetId: typeof stored?.presetId === 'string' ? stored.presetId : DEFAULT_STYLE_PRESET_ID,
    source,
    name: typeof stored?.name === 'string' ? stored.name : fallback.name,
    summary: typeof stored?.summary === 'string' ? stored.summary : fallback.summary,
    attributes,
    sampleHash: typeof stored?.sampleHash === 'string' ? stored.sampleHash : null,
    revision: Number(row.style_profile_version ?? 0),
    updatedAt: String(row.updated_at),
  }
}

function telemetryFrom(value: unknown): GenerationTelemetry {
  const empty = emptyGenerationTelemetry()
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as Partial<GenerationTelemetry>
    return {
      firstVisibleTokenAt: typeof parsed.firstVisibleTokenAt === 'string' ? parsed.firstVisibleTokenAt : null,
      lastVisibleTokenAt: typeof parsed.lastVisibleTokenAt === 'string' ? parsed.lastVisibleTokenAt : null,
      visibleCharacters: Number.isFinite(parsed.visibleCharacters) ? Math.max(0, Number(parsed.visibleCharacters)) : 0,
      estimatedOutputTokens: Number.isFinite(parsed.estimatedOutputTokens) ? Math.max(0, Number(parsed.estimatedOutputTokens)) : 0,
      estimatedTokensPerSecond: Number.isFinite(parsed.estimatedTokensPerSecond) ? Math.max(0, Number(parsed.estimatedTokensPerSecond)) : null,
      finalOutputTokens: Number.isFinite(parsed.finalOutputTokens) ? Math.max(0, Number(parsed.finalOutputTokens)) : null,
      finalReasoningTokens: Number.isFinite(parsed.finalReasoningTokens) ? Math.max(0, Number(parsed.finalReasoningTokens)) : null,
      decodeSeconds: Number.isFinite(parsed.decodeSeconds) ? Math.max(0, Number(parsed.decodeSeconds)) : null,
      finalTokensPerSecond: Number.isFinite(parsed.finalTokensPerSecond) ? Math.max(0, Number(parsed.finalTokensPerSecond)) : null,
    }
  } catch { return empty }
}

function summaryFrom(row: Row): KnowledgeSummary {
  return {
    id: String(row.id), projectId: String(row.project_id), scope: row.summary_scope as KnowledgeSummary['scope'], sourceId: String(row.source_id),
    sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), content: String(row.content),
    structuredJson: String(row.structured_json ?? '{}'), compactNarrative: String(row.compact_narrative || row.content),
    sourceStartChapter: row.source_start_chapter === null || row.source_start_chapter === undefined ? null : Number(row.source_start_chapter),
    sourceEndChapter: row.source_end_chapter === null || row.source_end_chapter === undefined ? null : Number(row.source_end_chapter),
    sourceVersionIds: jsonArray<string>(row.source_version_ids_json ?? '[]'), contentHash: String(row.content_hash ?? ''),
    provider: row.provider === null || row.provider === undefined ? null : String(row.provider), model: row.model === null || row.model === undefined ? null : String(row.model),
    promptHash: row.prompt_hash === null || row.prompt_hash === undefined ? null : String(row.prompt_hash), status: row.status as KnowledgeSummary['status'], updatedAt: String(row.updated_at),
  }
}

function retrievalItemFrom(row: Row): RetrievalItem {
  return { id: String(row.id), kind: row.item_kind as RetrievalItem['kind'], content: String(row.content), sourceId: String(row.source_id), sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), sourceProjectId: String(row.source_project_id), sourceProjectTitle: String(row.source_project_title), authority: row.authority as RetrievalItem['authority'], citationLabel: String(row.citation_label), rank: Number(row.rank) }
}

function promptVersionFrom(row: Row): PromptAssetVersion {
  return {
    id: String(row.id), promptAssetId: String(row.prompt_asset_id), version: Number(row.version), locale: String(row.locale), template: String(row.template),
    inputSchemaJson: String(row.input_schema_json), outputSchemaJson: String(row.output_schema_json), source: row.source as PromptAssetVersion['source'],
    contentHash: String(row.content_hash), createdAt: String(row.created_at),
  }
}

function modelRunFrom(row: Row): ModelRun {
  return {
    id: String(row.id), projectId: String(row.project_id), chapterId: String(row.chapter_id), purpose: row.purpose as GenerationPurpose,
    provider: String(row.provider), model: String(row.model), promptAssetVersionId: String(row.prompt_asset_version_id),
    inputManuscriptVersionId: row.input_manuscript_version_id === null ? null : String(row.input_manuscript_version_id),
    projectRevision: Number(row.project_revision), chapterRevision: Number(row.chapter_revision), status: row.status as ModelRun['status'],
    inputSnapshotJson: String(row.input_snapshot_json), streamedText: String(row.streamed_text),
    streamedTextUpdatedAt: row.streamed_text_updated_at === null ? null : String(row.streamed_text_updated_at),
    generationTelemetry: telemetryFrom(row.generation_telemetry_json),
    outputJson: row.output_json === null ? null : String(row.output_json),
    usageJson: row.usage_json === null ? null : String(row.usage_json), errorJson: row.error_json === null ? null : String(row.error_json),
    createdAt: String(row.created_at), finishedAt: row.finished_at === null ? null : String(row.finished_at),
  }
}

function scenePlanFrom(row: Row): ScenePlan {
  return {
    id: String(row.id), projectId: String(row.project_id), chapterId: String(row.chapter_id), modelRunId: String(row.model_run_id),
    promptAssetVersionId: String(row.prompt_asset_version_id), inputManuscriptVersionId: row.input_manuscript_version_id === null ? null : String(row.input_manuscript_version_id),
    contentJson: String(row.content_json), createdAt: String(row.created_at),
  }
}

function foundationVersionFrom(row: Row): ProjectFoundationVersion {
  return {
    id: String(row.id), projectId: String(row.project_id), kind: row.foundation_kind as ProjectFoundationKind, version: Number(row.version),
    title: String(row.title), content: String(row.content), contentHash: String(row.content_hash), status: row.status as ProjectFoundationVersion['status'],
    provider: String(row.provider), model: String(row.model), promptVersion: String(row.prompt_version), promptHash: String(row.prompt_hash),
    dependencyVersionIds: JSON.parse(String(row.dependency_version_ids_json)) as string[],
    generationRunId: row.generation_run_id === null ? null : String(row.generation_run_id),
    createdAt: String(row.created_at), approvedAt: row.approved_at === null ? null : String(row.approved_at),
  }
}

function foundationGenerationRunFrom(row: Row): FoundationGenerationRun {
  let error: string | null = null
  if (row.error_json !== null) {
    try {
      const parsed = JSON.parse(String(row.error_json)) as { message?: unknown }
      error = typeof parsed.message === 'string' ? parsed.message : String(row.error_json)
    } catch { error = String(row.error_json) }
  }
  return {
    id: String(row.id), projectId: String(row.project_id), kind: row.foundation_kind as ProjectFoundationKind,
    guided: Number(row.guided) === 1, status: row.status as FoundationGenerationRun['status'], phase: String(row.phase), progress: Number(row.progress),
    brief: String(row.brief), questions: JSON.parse(String(row.questions_json)) as FoundationPlannerQuestion[], answers: JSON.parse(String(row.answers_json)) as FoundationPlannerAnswer[],
    planningRound: Number(row.planning_round), informationReady: Number(row.information_ready) === 1, readinessSummary: String(row.readiness_summary),
    interactionSessionId: row.interaction_session_id === null || row.interaction_session_id === undefined ? null : String(row.interaction_session_id),
    dependencyVersionIds: JSON.parse(String(row.dependency_version_ids_json)) as string[], provider: String(row.provider), model: String(row.model),
    streamedCharacters: Number(row.streamed_characters), streamedText: String(row.streamed_text),
    streamedTextUpdatedAt: row.streamed_text_updated_at === null ? null : String(row.streamed_text_updated_at),
    generationTelemetry: telemetryFrom(row.generation_telemetry_json),
    resultVersionId: row.result_version_id === null ? null : String(row.result_version_id), error,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), startedAt: String(row.started_at), finishedAt: row.finished_at === null ? null : String(row.finished_at),
  }
}

export interface SqliteRepositoryOptions {
  dataRoot: string
  markdownMirror?: boolean
}

export class SqliteNovelRepository implements NovelRepository {
  readonly databasePath: string
  private readonly db: DatabaseSync
  private closed = false

  constructor(options: SqliteRepositoryOptions) {
    mkdirSync(options.dataRoot, { recursive: true })
    for (const name of ['artifacts', 'exports', 'backups', 'logs']) mkdirSync(join(options.dataRoot, name), { recursive: true })
    this.databasePath = join(options.dataRoot, 'novel-studio.db')
    this.db = new DatabaseSync(this.databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
    this.ensureAuthorControlCompatibility()
    this.repairLegacyFoundationIntake()
    this.seedBuiltinPrompts()
    this.seedBuiltinWorkflow()
    this.backfillKnowledgeIndexes()
    this.backfillDerivedMemoryItems()
  }

  private migrate(): void {
    const exists = this.db.prepare("SELECT 1 value FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() as Row | undefined
    let current = exists ? Number((this.db.prepare('SELECT COALESCE(MAX(version), 0) version FROM schema_migrations').get() as Row).version) : 0
    for (const migration of migrations.filter(item => item.version > current)) {
      if (migration.disableForeignKeys) this.db.exec('PRAGMA foreign_keys = OFF')
      try {
        this.transaction(() => {
          this.db.exec(migration.sql)
          this.db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, now())
        })
      } finally {
        if (migration.disableForeignKeys) this.db.exec('PRAGMA foreign_keys = ON')
      }
      current = migration.version
    }
    if (current > EXPECTED_SCHEMA_VERSION) throw new Error(`Novel Studio database schema ${current} is newer than supported ${EXPECTED_SCHEMA_VERSION}`)
    const violations = this.db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length > 0) throw new Error(`Novel Studio migration left ${violations.length} foreign key violation(s)`)
  }

  private ensureAuthorControlCompatibility(): void {
    const columns = new Set((this.db.prepare('PRAGMA table_info(memory_conflicts)').all() as Row[]).map(row => String(row.name)))
    if (!columns.has('base_revision_id') || !columns.has('base_content')) {
      this.transaction(() => {
        if (!columns.has('base_revision_id')) this.db.exec('ALTER TABLE memory_conflicts ADD COLUMN base_revision_id TEXT')
        if (!columns.has('base_content')) this.db.exec("ALTER TABLE memory_conflicts ADD COLUMN base_content TEXT NOT NULL DEFAULT ''")
      })
    }
    this.db.prepare(`UPDATE memory_conflicts
      SET base_revision_id=COALESCE(base_revision_id,
        (SELECT mr.id FROM memory_file_bindings b JOIN memory_revisions mr ON mr.item_id=memory_conflicts.item_id AND mr.content_hash=b.base_hash
          WHERE b.item_id=memory_conflicts.item_id ORDER BY mr.revision DESC LIMIT 1),
        database_revision_id)
      WHERE base_revision_id IS NULL`).run()
    this.db.prepare(`UPDATE memory_conflicts
      SET base_content=COALESCE((SELECT content FROM memory_revisions WHERE id=base_revision_id),base_content,'')
      WHERE base_content=''`).run()
  }

  private repairLegacyFoundationIntake(): void {
    this.db.prepare(`UPDATE project_foundation_generation_runs
      SET planning_round=1,
          readiness_summary=CASE WHEN readiness_summary='' THEN '已恢复旧版本规划问题；请完成当前回答后继续检查信息充分性。' ELSE readiness_summary END
      WHERE planning_round=0 AND questions_json<>'[]'
        AND project_id IN (SELECT id FROM projects WHERE status='active')`).run()
  }

  private seedBuiltinPrompts(): void {
    const timestamp = now()
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO prompt_packs(id,name,locale,source,created_at) VALUES (?,?,?,\'builtin\',?)').run(BUILTIN_PROMPT_PACK.id, BUILTIN_PROMPT_PACK.name, BUILTIN_PROMPT_PACK.locale, timestamp)
      for (const prompt of BUILTIN_PROMPTS) {
        this.db.prepare(`INSERT OR IGNORE INTO prompt_assets(id,prompt_pack_id,asset_key,name,purpose,active_version_id,created_at)
          VALUES (?,?,?,?,?,?,?)`).run(prompt.assetId, BUILTIN_PROMPT_PACK.id, prompt.key, prompt.name, prompt.purpose, prompt.versionId, timestamp)
      }
      for (const prompt of BUILTIN_PROMPT_VERSIONS) {
        const existing = this.db.prepare('SELECT id FROM prompt_asset_versions WHERE id=?').get(prompt.versionId)
        if (existing) continue
        const occupiedPreferredVersion = this.db.prepare('SELECT id FROM prompt_asset_versions WHERE prompt_asset_id=? AND version=?').get(prompt.assetId, prompt.version)
        const storedVersion = occupiedPreferredVersion
          ? Number((this.db.prepare('SELECT COALESCE(MAX(version),0)+1 next_version FROM prompt_asset_versions WHERE prompt_asset_id=?').get(prompt.assetId) as Row).next_version)
          : prompt.version
        this.db.prepare(`INSERT INTO prompt_asset_versions(id,prompt_asset_id,version,locale,template,input_schema_json,output_schema_json,source,content_hash,created_at)
          VALUES (?,?,?,?,?,?,?,'builtin',?,?)`).run(prompt.versionId, prompt.assetId, storedVersion, BUILTIN_PROMPT_PACK.locale, prompt.template, JSON.stringify(prompt.inputSchema), JSON.stringify(prompt.outputSchema), createHash('sha256').update(prompt.template).digest('hex'), timestamp)
      }
      for (const upgrade of BUILTIN_PROMPT_UPGRADES) {
        const versionsAreOfficial = this.db.prepare(`SELECT COUNT(*) count FROM prompt_asset_versions
          WHERE id IN (?,?) AND prompt_asset_id=? AND source='builtin'`).get(upgrade.previousVersionId, upgrade.currentVersionId, upgrade.assetId) as Row
        if (Number(versionsAreOfficial.count) !== 2) continue
        this.db.prepare('UPDATE prompt_assets SET active_version_id=? WHERE id=? AND active_version_id=?')
          .run(upgrade.currentVersionId, upgrade.assetId, upgrade.previousVersionId)
        this.db.prepare('UPDATE project_prompt_overrides SET prompt_asset_version_id=?,updated_at=? WHERE purpose=? AND prompt_asset_version_id=?')
          .run(upgrade.currentVersionId, timestamp, upgrade.purpose, upgrade.previousVersionId)
      }
    })
  }

  private seedBuiltinWorkflow(): void {
    const timestamp = now()
    const definition = { key: 'chapter-production-v1', name: '章节生产 v1', nodes: CHAPTER_WORKFLOW_NODES }
    const definitionJson = JSON.stringify(definition)
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO workflow_definitions(id,definition_key,name,active_version_id,created_at) VALUES (?,?,?,?,?)').run(CHAPTER_WORKFLOW_DEFINITION_ID, definition.key, definition.name, CHAPTER_WORKFLOW_VERSION_ID, timestamp)
      this.db.prepare('INSERT OR IGNORE INTO workflow_definition_versions(id,workflow_definition_id,version,definition_json,content_hash,created_at) VALUES (?,?,1,?,?,?)').run(CHAPTER_WORKFLOW_VERSION_ID, CHAPTER_WORKFLOW_DEFINITION_ID, definitionJson, createHash('sha256').update(definitionJson).digest('hex'), timestamp)
    })
  }

  private backfillKnowledgeIndexes(): void {
    const approved = this.db.prepare(`SELECT m.*,c.title,c.chapter_number,b.position book_position FROM manuscript_versions m
      JOIN chapters c ON c.id=m.chapter_id
      JOIN books b ON b.id=c.book_id
      JOIN projects p ON p.id=m.project_id
      WHERE m.status='approved' AND p.status='active'
      ORDER BY m.project_id,c.chapter_number`).all() as Row[]
    if (approved.length === 0) return
    const timestamp = now()
    this.transaction(() => {
      for (const row of approved) {
        const projectId = String(row.project_id), chapterId = String(row.chapter_id), versionId = String(row.id), title = String(row.title)
        const summary = String(row.content).replace(/\s+/g, ' ').trim().slice(0, 360) || title
        this.db.prepare(`INSERT INTO knowledge_summaries(id,project_id,summary_scope,source_id,source_version_id,content,status,updated_at) VALUES (?,?,?,?,?,?,'current',?)
          ON CONFLICT(project_id,summary_scope,source_id) DO UPDATE SET source_version_id=excluded.source_version_id,content=excluded.content,status='current',updated_at=excluded.updated_at`).run(id('knowledge-summary'), projectId, 'chapter', chapterId, versionId, summary, timestamp)
        const entityRow = this.db.prepare("SELECT id FROM story_entities WHERE project_id=? AND entity_type='concept' AND name=?").get(projectId, title) as Row | undefined
        const entityId = entityRow ? String(entityRow.id) : id('story-entity')
        if (!entityRow) this.db.prepare("INSERT INTO story_entities(id,project_id,entity_type,name,description,source_manuscript_version_id,created_at,updated_at) VALUES (?,?,'concept',?,?,?,?,?)").run(entityId, projectId, title, summary, versionId, timestamp, timestamp)
        const storyOrder = Math.max(0, Number(row.book_position) - 1) * 1_000_000 + Number(row.chapter_number) * 1000
        this.db.prepare("INSERT OR IGNORE INTO timeline_events(id,project_id,chapter_id,source_manuscript_version_id,title,summary,story_order,status,created_at) VALUES (?,?,?,?,?,?,?,'canon',?)").run(id('timeline-event'), projectId, chapterId, versionId, title, summary, storyOrder, timestamp)
        const timeline = this.db.prepare('SELECT id FROM timeline_events WHERE source_manuscript_version_id=?').get(versionId) as Row
        this.db.prepare('INSERT OR IGNORE INTO timeline_event_entities(timeline_event_id,entity_id) VALUES (?,?)').run(String(timeline.id), entityId)
        this.db.prepare("DELETE FROM knowledge_fts WHERE project_id=? AND source_id IN (?,?)").run(projectId, versionId, chapterId)
        this.db.prepare("INSERT INTO knowledge_fts(project_id,source_type,source_id,source_version_id,content) VALUES (?,'approved_manuscript',?,?,?)").run(projectId, versionId, versionId, String(row.content))
        this.db.prepare("INSERT INTO knowledge_fts(project_id,source_type,source_id,source_version_id,content) VALUES (?,'chapter_summary',?,?,?)").run(projectId, chapterId, versionId, summary)
      }
      const projectIds = [...new Set(approved.map(row => String(row.project_id)))]
      for (const projectId of projectIds) {
        const content = (this.db.prepare("SELECT content FROM knowledge_summaries WHERE project_id=? AND summary_scope='chapter' AND status='current' ORDER BY updated_at").all(projectId) as Row[]).map(row => String(row.content)).join('\n').slice(0, 1800)
        const latestVersion = approved.filter(row => String(row.project_id) === projectId).at(-1)
        this.db.prepare(`INSERT INTO knowledge_summaries(id,project_id,summary_scope,source_id,source_version_id,content,status,updated_at) VALUES (?,?,?,?,?,?,'current',?)
          ON CONFLICT(project_id,summary_scope,source_id) DO UPDATE SET source_version_id=excluded.source_version_id,content=excluded.content,status='current',updated_at=excluded.updated_at`).run(id('knowledge-summary'), projectId, 'project', projectId, latestVersion ? String(latestVersion.id) : null, content, timestamp)
      }
    })
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.db.exec('COMMIT')
      return value
    } catch (cause) {
      this.db.exec('ROLLBACK')
      throw cause
    }
  }

  private syncChapterMarkdown(chapterId: string, content: string, status: 'draft' | 'approved'): void {
    const chapter = this.getChapter(chapterId)
    const project = this.getProjectTree(chapter.projectId).project
    if (project.status !== 'active' || !project.markdownSyncEnabled || !project.workspacePath) return
    try {
      this.activeProjectTransaction(project.id, () => {
        writeChapterMarkdown(project.workspacePath!, chapter.chapterNumber, chapter.title, content, status)
      })
    } catch { /* SQLite remains authoritative when the optional mirror is unavailable or the project was archived concurrently. */ }
  }

  private backfillDerivedMemoryItems(): void {
    const rows = this.db.prepare('SELECT * FROM knowledge_summaries ORDER BY project_id,updated_at').all() as Row[]
    if (rows.length === 0) return
    this.transaction(() => {
      for (const row of rows) this.syncDerivedMemorySummaryUnchecked(String(row.project_id), row)
    })
  }

  private syncDerivedMemorySummaryUnchecked(projectId: string, summary: Row): void {
    const sourceKey = String(summary.id)
    const content = String(summary.compact_narrative ?? '').trim() || String(summary.content)
    const contentHash = createHash('sha256').update(content).digest('hex')
    const existing = this.db.prepare("SELECT mi.*,mr.content current_content,mr.content_hash current_hash,mr.revision current_content_revision FROM memory_items mi LEFT JOIN memory_revisions mr ON mr.id=mi.current_revision_id WHERE mi.project_id=? AND mi.origin='derived' AND mi.source_key=?").get(projectId, sourceKey) as Row | undefined
    const timestamp = String(summary.updated_at ?? now())
    const category: MemoryCategory = String(summary.summary_scope) === 'foundation' ? 'constraint' : ['chapter', 'arc'].includes(String(summary.summary_scope)) ? 'continuity' : 'other'
    const sourceVersionIds = [...new Set([
      ...jsonArray<string>(String(summary.source_version_ids_json ?? '[]')),
      ...(summary.source_version_id === null || summary.source_version_id === undefined ? [] : [String(summary.source_version_id)]),
    ])].sort()
    const insertSources = (revisionId: string): void => {
      const versions: Array<string | null> = sourceVersionIds.length > 0 ? sourceVersionIds : [null]
      for (const sourceVersionId of versions) this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id('memory-source'), revisionId, 'knowledge-summary', String(summary.source_id), sourceVersionId, `${String(summary.summary_scope)} summary`, timestamp)
    }
    if (!existing) {
      const itemId = id('memory-derived'), revisionId = id('memory-revision')
      this.db.prepare(`INSERT INTO memory_items(id,project_id,origin,storage,scope,category,state,prompt_policy,source_key,current_revision_id,revision,created_at,updated_at)
        VALUES (?,?,'derived','database',?,?,'active','auto',?,?,1,?,?)`).run(itemId, projectId, String(summary.summary_scope), category, sourceKey, revisionId, timestamp, timestamp)
      const provider = summary.provider === null || summary.provider === undefined ? null : String(summary.provider)
      const model = summary.model === null || summary.model === undefined ? null : String(summary.model)
      const promptHash = summary.prompt_hash === null || summary.prompt_hash === undefined ? null : String(summary.prompt_hash)
      this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,provider,model,prompt_hash,created_at)
        VALUES (?,?,1,?,?,?,'model',NULL,?,?,?,?)`).run(revisionId, itemId, content, String(summary.structured_json ?? '{}'), contentHash, provider, model, promptHash, timestamp)
      insertSources(revisionId)
      this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(itemId, projectId, content)
      return
    }
    const itemId = String(existing.id)
    const existingSourceVersionIds = (this.db.prepare('SELECT source_version_id FROM memory_revision_sources WHERE revision_id=? AND source_version_id IS NOT NULL ORDER BY source_version_id').all(String(existing.current_revision_id)) as Row[]).map(row => String(row.source_version_id))
    const sourcesChanged = JSON.stringify(existingSourceVersionIds) !== JSON.stringify(sourceVersionIds)
    if (String(existing.current_content ?? '') === content && !sourcesChanged) {
      if (String(existing.current_hash ?? '') !== contentHash) this.db.prepare('UPDATE memory_revisions SET content_hash=? WHERE id=?').run(contentHash, String(existing.current_revision_id))
      return
    }
    if (String(existing.current_hash ?? '') === contentHash && !sourcesChanged) return
    const contentRevision = Number(existing.current_content_revision) + 1
    const itemRevision = Number(existing.revision) + 1
    const revisionId = id('memory-revision')
    const provider = summary.provider === null || summary.provider === undefined ? null : String(summary.provider)
    const model = summary.model === null || summary.model === undefined ? null : String(summary.model)
    const promptHash = summary.prompt_hash === null || summary.prompt_hash === undefined ? null : String(summary.prompt_hash)
    this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,provider,model,prompt_hash,created_at)
      VALUES (?,?,?,?,?,?,'model',?,?,?,?,?)`).run(revisionId, itemId, contentRevision, content, String(summary.structured_json ?? '{}'), contentHash, String(existing.current_revision_id), provider, model, promptHash, timestamp)
    insertSources(revisionId)
    this.db.prepare('UPDATE memory_items SET scope=?,category=?,current_revision_id=?,revision=?,updated_at=? WHERE id=?')
      .run(String(summary.summary_scope), category, revisionId, itemRevision, timestamp, itemId)
    this.db.prepare('DELETE FROM memory_browser_fts WHERE item_id=?').run(itemId)
    this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(itemId, projectId, content)
  }

  private syncProjectMemory(projectId: string): void {
    const project = this.getProjectTree(projectId).project
    if (project.status !== 'active' || !project.markdownSyncEnabled || !project.workspacePath) return
    const knowledge = this.getKnowledgeWorkspace(projectId)
    const style = this.getProjectStyleProfile(projectId)
    const files = [
      { name: 'project-context', title: '项目上下文', content: [`题材：${project.genre ?? '未指定'}`, `受众：${project.audience ?? '未指定'}`, `项目文风：${style.name}`, style.summary].join('\n') },
      ...knowledge.summaries.map(summary => ({ name: `${summary.scope}-${summary.sourceId}`, title: `${summary.scope} memory`, content: summary.compactNarrative || summary.content })),
    ]
    try {
      this.activeProjectTransaction(projectId, () => {
        const updatedAt = writeMemoryMarkdown(project.workspacePath!, files)
        if (updatedAt) this.db.prepare('UPDATE projects SET memory_updated_at=? WHERE id=?').run(updatedAt, projectId)
      })
    } catch { /* SQLite remains authoritative; a later refresh retries the optional mirror. */ }
    this.syncMemoryItemMirrors(projectId)
  }

  private syncMemoryItemMirrors(projectId: string): void {
    const project = this.getProjectTree(projectId).project
    if (project.status !== 'active' || !project.markdownSyncEnabled || !project.workspacePath) return
    const itemIds = (this.db.prepare("SELECT id FROM memory_items WHERE project_id=? AND state<>'archived' ORDER BY origin,created_at").all(projectId) as Row[]).map(row => String(row.id))
    for (const itemId of itemIds) {
      const item = this.getMemoryItem(itemId)
      const binding = this.db.prepare('SELECT * FROM memory_file_bindings WHERE item_id=?').get(itemId) as Row | undefined
      const relativePath = binding ? String(binding.relative_path) : memoryItemMarkdownPath(item.id, item.origin)
      const file = readMemoryItemMarkdown(project.workspacePath, relativePath)
      if (!binding) {
        let written: ReturnType<typeof writeMemoryItemMarkdown> = null
        try {
          written = writeMemoryItemMarkdown(project.workspacePath, relativePath, { itemId: item.id, origin: item.origin, revision: item.revision, category: item.category, content: item.currentRevision.content })
        } catch { /* SQLite is authoritative; a later refresh retries the optional item mirror. */ }
        if (!written) continue
        try { this.activeProjectTransaction(projectId, () => this.db.prepare("INSERT OR REPLACE INTO memory_file_bindings(item_id,relative_path,base_hash,file_hash,state,updated_at) VALUES (?,?,?,?, 'clean',?)").run(item.id, relativePath, item.currentRevision.contentHash, written.hash, now())) } catch { /* The next scan repairs an interrupted mirror registration. */ }
        continue
      }
      if (!file) {
        this.activeProjectTransaction(projectId, () => this.db.prepare("UPDATE memory_file_bindings SET state='missing',updated_at=? WHERE item_id=?").run(now(), item.id))
        continue
      }
      const databaseChanged = item.currentRevision.contentHash !== String(binding.base_hash)
      const filesystemChanged = file.hash !== String(binding.file_hash)
      if (databaseChanged && filesystemChanged) {
        this.activeProjectTransaction(projectId, () => {
          const open = this.db.prepare("SELECT id FROM memory_conflicts WHERE item_id=? AND status='open' AND database_revision_id=? AND file_hash=?").get(item.id, item.currentRevision.id, file.hash)
          if (!open) {
            const baseline = this.db.prepare('SELECT id,content FROM memory_revisions WHERE item_id=? AND content_hash=? ORDER BY revision DESC LIMIT 1').get(item.id, String(binding.base_hash)) as Row | undefined
            this.db.prepare(`INSERT INTO memory_conflicts(id,item_id,base_revision_id,base_content,database_revision_id,file_content,file_hash,status,created_at)
              VALUES (?,?,?,?,?,?,?,'open',?)`).run(id('memory-conflict'), item.id, baseline ? String(baseline.id) : item.currentRevision.id, baseline ? String(baseline.content) : item.currentRevision.content, item.currentRevision.id, file.body, file.hash, now())
          }
          this.db.prepare("UPDATE memory_items SET state='conflicted',updated_at=? WHERE id=?").run(now(), item.id)
          this.db.prepare("UPDATE memory_file_bindings SET state='conflicted',updated_at=? WHERE item_id=?").run(now(), item.id)
        })
      } else if (databaseChanged) {
        let written: ReturnType<typeof writeMemoryItemMarkdown> = null
        try {
          written = writeMemoryItemMarkdown(project.workspacePath, relativePath, { itemId: item.id, origin: item.origin, revision: item.revision, category: item.category, content: item.currentRevision.content })
        } catch { /* SQLite is authoritative; a later refresh retries the optional item mirror. */ }
        if (written) this.activeProjectTransaction(projectId, () => this.db.prepare("UPDATE memory_file_bindings SET base_hash=?,file_hash=?,state='clean',updated_at=? WHERE item_id=?").run(item.currentRevision.contentHash, written.hash, now(), item.id))
      } else if (filesystemChanged) {
        this.activeProjectTransaction(projectId, () => this.db.prepare("UPDATE memory_file_bindings SET state='changed',updated_at=? WHERE item_id=?").run(now(), item.id))
      } else if (String(binding.state) !== 'clean') {
        this.activeProjectTransaction(projectId, () => this.db.prepare("UPDATE memory_file_bindings SET state='clean',updated_at=? WHERE item_id=? AND state<>'conflicted'").run(now(), item.id))
      }
    }
  }

  private one(statement: StatementSync, ...values: Array<string | number | null>): Row {
    const row = statement.get(...values) as Row | undefined
    if (!row) throw new DomainError('not-found', 'Requested Novel Studio record was not found.')
    return row
  }

  private assertProjectActive(projectId: string): Project {
    const project = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
    if (project.status !== 'active') throw new DomainError('invalid-state', '项目已归档，当前为只读状态；请先恢复项目再修改。')
    return project
  }

  private assertProjectRevision(projectId: string, baseRevision: number): Project {
    const project = this.assertProjectActive(projectId)
    if (project.revision !== baseRevision) throw new DomainError('revision-conflict', `项目已从版本 ${baseRevision} 更新到 ${project.revision}。`)
    return project
  }

  private bumpProjectRevision(projectId: string, baseRevision: number, timestamp: string): void {
    const changed = this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status=\'active\'').run(timestamp, projectId, baseRevision)
    if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '项目已由其他操作更新。')
  }

  private activeProjectTransaction<T>(projectId: string, operation: () => T): T {
    return this.transaction(() => {
      // Acquire the write lock before checking status so another connection cannot
      // archive the project between validation and the durable mutation.
      this.assertProjectActive(projectId)
      return operation()
    })
  }

  private workflowBatchId(workflowRunId: string): string | null {
    const row = this.db.prepare('SELECT batch_id FROM chapter_generation_batch_items WHERE workflow_run_id=? LIMIT 1').get(workflowRunId) as Row | undefined
    return row ? String(row.batch_id) : null
  }

  /** Must be called while the caller owns the write transaction. */
  private assertWorkflowRelationshipSafetyUnchecked(_workflowRunId: string): void {
    // Relationship extraction is optional enrichment. OFF means "do not
    // extract"; it must never invalidate or stop an otherwise safe chapter.
  }

  private workflowGuardFromSnapshot(inputSnapshotJson: string): { workflowRunId: string; workflowNodeRunId: string } | null {
    try {
      const snapshot = JSON.parse(inputSnapshotJson) as { workflowGuard?: unknown }
      const guard = snapshot.workflowGuard
      if (!guard || typeof guard !== 'object' || Array.isArray(guard)) return null
      const value = guard as Record<string, unknown>
      return typeof value.workflowRunId === 'string' && typeof value.workflowNodeRunId === 'string'
        ? { workflowRunId: value.workflowRunId, workflowNodeRunId: value.workflowNodeRunId }
        : null
    } catch {
      return null
    }
  }

  /** Must be called while the owning project write transaction is held. */
  private isWorkflowModelGuardActiveUnchecked(projectId: string, chapterId: string, inputSnapshotJson: string): boolean {
    const guard = this.workflowGuardFromSnapshot(inputSnapshotJson)
    if (!guard) return true
    const row = this.db.prepare(`SELECT w.status workflow_status,w.current_node_key,n.status node_status,n.node_key
      FROM workflow_runs w JOIN workflow_node_runs n ON n.workflow_run_id=w.id
      WHERE w.id=? AND n.id=? AND w.project_id=? AND w.chapter_id=?`).get(guard.workflowRunId, guard.workflowNodeRunId, projectId, chapterId) as Row | undefined
    return Boolean(row && row.workflow_status === 'running' && row.node_status === 'running' && row.current_node_key === row.node_key)
  }

  /**
   * Revalidates every mutable authority input that does not necessarily bump
   * projects.revision. The caller must hold the owning project write
   * transaction so these reads and the following artifact insert are atomic
   * with respect to another Host changing Foundation, style, rules, or Prompt
   * selection.
   */
  private assertModelRunAuthoritySnapshotUnchecked(run: ModelRun): void {
    let snapshot: Record<string, unknown>
    try {
      const parsed = JSON.parse(run.inputSnapshotJson) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid snapshot')
      snapshot = parsed as Record<string, unknown>
    } catch {
      throw new DomainError('revision-conflict', '模型运行的权威输入快照损坏，生成结果未写入；请重新生成。')
    }

    const styleSnapshot = snapshot.styleProfile
    const foundationVersionIds = Array.isArray(snapshot.foundationVersionIds)
      && snapshot.foundationVersionIds.every(value => typeof value === 'string')
      ? snapshot.foundationVersionIds as string[]
      : null
    const foundationAssemblyHash = typeof snapshot.foundationAssemblyHash === 'string' && snapshot.foundationAssemblyHash
      ? snapshot.foundationAssemblyHash
      : null
    const styleRevision = styleSnapshot && typeof styleSnapshot === 'object' && !Array.isArray(styleSnapshot)
      && Number.isInteger((styleSnapshot as Record<string, unknown>).revision)
      ? Number((styleSnapshot as Record<string, unknown>).revision)
      : null
    const projectRulesRevision = Number.isInteger(snapshot.projectRulesRevision) ? Number(snapshot.projectRulesRevision) : null
    const promptAssetVersionId = typeof snapshot.promptAssetVersionId === 'string' && snapshot.promptAssetVersionId
      ? snapshot.promptAssetVersionId
      : null
    const promptContentHash = typeof snapshot.promptContentHash === 'string' && snapshot.promptContentHash
      ? snapshot.promptContentHash
      : null
    if (!foundationVersionIds || !foundationAssemblyHash || styleRevision === null || projectRulesRevision === null || !promptAssetVersionId || !promptContentHash) {
      throw new DomainError('revision-conflict', '模型运行缺少完整的 Foundation、文风、项目规则或 Prompt 权威快照，生成结果未写入；请重新生成。')
    }

    const foundation = this.getProjectFoundation(run.projectId)
    if (foundation.assemblyHash !== foundationAssemblyHash
      || foundation.approvedVersionIds.length !== foundationVersionIds.length
      || foundation.approvedVersionIds.some((value, index) => value !== foundationVersionIds[index])) {
      throw new DomainError('revision-conflict', '创作基建在模型生成期间发生变化，生成结果未写入；请重新生成。')
    }

    const rules = this.projectRules(run.projectId)
    if (!rules.styleProfile || rules.styleProfile.revision !== styleRevision) {
      throw new DomainError('revision-conflict', '项目文风在模型生成期间发生变化，生成结果未写入；请重新生成。')
    }
    if (rules.revision !== projectRulesRevision) {
      throw new DomainError('revision-conflict', '项目写作规则在模型生成期间发生变化，生成结果未写入；请重新生成。')
    }

    const promptRow = this.db.prepare(`SELECT v.content_hash,a.purpose
      FROM prompt_asset_versions v JOIN prompt_assets a ON a.id=v.prompt_asset_id
      WHERE v.id=?`).get(promptAssetVersionId) as Row | undefined
    const override = this.db.prepare('SELECT prompt_asset_version_id FROM project_prompt_overrides WHERE project_id=? AND purpose=?')
      .get(run.projectId, run.purpose) as Row | undefined
    const fallback = this.db.prepare('SELECT active_version_id FROM prompt_assets WHERE purpose=? ORDER BY asset_key LIMIT 1')
      .get(run.purpose) as Row | undefined
    const selectedPromptVersionId = override
      ? String(override.prompt_asset_version_id)
      : fallback ? String(fallback.active_version_id) : null
    if (run.promptAssetVersionId !== promptAssetVersionId
      || selectedPromptVersionId !== promptAssetVersionId
      || !promptRow
      || String(promptRow.purpose) !== run.purpose
      || String(promptRow.content_hash) !== promptContentHash) {
      throw new DomainError('revision-conflict', 'Prompt 版本在模型生成期间发生变化，生成结果未写入；请重新生成。')
    }
  }

  /** Must be called while the owning project write transaction is held. */
  private isModelRunOwnedByWorkflowUnchecked(projectId: string, chapterId: string, inputSnapshotJson: string, workflowRunId: string): boolean {
    const guard = this.workflowGuardFromSnapshot(inputSnapshotJson)
    if (!guard || guard.workflowRunId !== workflowRunId) return false
    const row = this.db.prepare(`SELECT 1 value
      FROM workflow_runs w JOIN workflow_node_runs n ON n.workflow_run_id=w.id
      WHERE w.id=? AND n.id=? AND w.project_id=? AND w.chapter_id=? AND w.current_node_key=n.node_key`).get(
      guard.workflowRunId,
      guard.workflowNodeRunId,
      projectId,
      chapterId,
    ) as Row | undefined
    return Boolean(row)
  }

  private failRunningModelRunsForWorkflowUnchecked(workflowRunId: string, timestamp: string, code: string, message: string): void {
    const workflow = this.one(this.db.prepare('SELECT project_id FROM workflow_runs WHERE id=?'), workflowRunId)
    const rows = this.db.prepare("SELECT id,input_snapshot_json FROM model_runs WHERE project_id=? AND status='running'").all(String(workflow.project_id)) as Row[]
    const errorJson = JSON.stringify({ code, message })
    for (const row of rows) {
      if (this.workflowGuardFromSnapshot(String(row.input_snapshot_json))?.workflowRunId !== workflowRunId) continue
      this.db.prepare("UPDATE model_runs SET status='failed',error_json=?,finished_at=? WHERE id=? AND status='running'").run(errorJson, timestamp, String(row.id))
    }
  }

  /**
   * Enforces the durable project-level chapter-workflow mutex. Call this only
   * from an activeProjectTransaction so the check and the following activation
   * are serialized across Host processes that share the SQLite database.
   */
  private assertProjectWorkflowSlot(projectId: string, currentWorkflowRunId: string | null = null, currentBatchId: string | null = null): void {
    const activeWorkflow = currentWorkflowRunId
      ? this.db.prepare("SELECT id FROM workflow_runs WHERE project_id=? AND id<>? AND status IN ('running','paused','waiting_approval','cancel_requested') ORDER BY created_at LIMIT 1").get(projectId, currentWorkflowRunId) as Row | undefined
      : this.db.prepare("SELECT id FROM workflow_runs WHERE project_id=? AND status IN ('running','paused','waiting_approval','cancel_requested') ORDER BY created_at LIMIT 1").get(projectId) as Row | undefined
    if (activeWorkflow) throw new DomainError('invalid-state', '项目已有进行中、暂停中或待审的章节工作流，请先处理该运行后再生成本章。')

    const activeBatch = currentBatchId
      ? this.db.prepare("SELECT id FROM chapter_generation_batches WHERE project_id=? AND id<>? AND status IN ('running','waiting_approval','pause_requested') ORDER BY created_at LIMIT 1").get(projectId, currentBatchId) as Row | undefined
      : this.db.prepare("SELECT id FROM chapter_generation_batches WHERE project_id=? AND status IN ('running','waiting_approval','pause_requested') ORDER BY created_at LIMIT 1").get(projectId) as Row | undefined
    if (activeBatch) throw new DomainError('invalid-state', '项目已有运行中或待审的章节批次，请先暂停或完成批次后再生成本章。')

    const runningModels = this.db.prepare("SELECT id,chapter_id,input_snapshot_json FROM model_runs WHERE project_id=? AND status='running' ORDER BY created_at").all(projectId) as Row[]
    const foreignModel = runningModels.find(row => !currentWorkflowRunId || !this.isModelRunOwnedByWorkflowUnchecked(
      projectId,
      String(row.chapter_id),
      String(row.input_snapshot_json),
      currentWorkflowRunId,
    ))
    if (foreignModel) throw new DomainError('invalid-state', '项目已有不属于当前工作流的模型生成，请等待生成完成或失败后再启动章节工作流。')
  }

  health(): StorageHealth {
    const schemaVersion = Number((this.db.prepare('SELECT COALESCE(MAX(version), 0) version FROM schema_migrations').get() as Row).version)
    const journalMode = String((this.db.prepare('PRAGMA journal_mode').get() as Row).journal_mode)
    const foreignKeys = Number((this.db.prepare('PRAGMA foreign_keys').get() as Row).foreign_keys) === 1
    return { ready: !this.closed && schemaVersion === EXPECTED_SCHEMA_VERSION && foreignKeys, schemaVersion, expectedSchemaVersion: EXPECTED_SCHEMA_VERSION, journalMode, foreignKeys, dataHome: '$DSH_HOME/data/novel-studio' }
  }

  listProjects(): Project[] {
    return (this.db.prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY updated_at DESC").all() as Row[]).map(projectFrom)
  }

  getLibraryOverview(): LibraryOverview {
    return {
      active: (this.db.prepare("SELECT * FROM projects WHERE status='active' ORDER BY updated_at DESC").all() as Row[]).map(projectFrom),
      archived: (this.db.prepare("SELECT * FROM projects WHERE status='archived' ORDER BY archived_at DESC,updated_at DESC").all() as Row[]).map(projectFrom),
    }
  }

  archiveProject(projectId: string, baseRevision?: number): Project {
    const before = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
    if (before.status === 'archived') return before
    if (baseRevision !== undefined && before.revision !== baseRevision) throw new DomainError('revision-conflict', `项目已从版本 ${baseRevision} 更新到 ${before.revision}。`)
    const timestamp = now()
    this.transaction(() => {
      const activeWorkflow = this.db.prepare("SELECT id FROM workflow_runs WHERE project_id=? AND status IN ('running','paused','waiting_approval','cancel_requested') LIMIT 1").get(projectId) as Row | undefined
      if (activeWorkflow) throw new DomainError('invalid-state', '项目仍有活动中的章节工作流，请先完成或取消后再归档。')
      const activeFoundation = this.db.prepare("SELECT id FROM project_foundation_generation_runs WHERE project_id=? AND status IN ('planning','waiting_input','generating') LIMIT 1").get(projectId) as Row | undefined
      if (activeFoundation) throw new DomainError('invalid-state', '项目仍有活动中的创作基建生成，请先完成或取消后再归档。')
      const activeModelRun = this.db.prepare("SELECT id FROM model_runs WHERE project_id=? AND status='running' LIMIT 1").get(projectId) as Row | undefined
      if (activeModelRun) throw new DomainError('invalid-state', '项目仍有运行中的模型生成，请等待生成完成或失败后再归档。')
      const activeBatch = this.db.prepare("SELECT id FROM chapter_generation_batches WHERE project_id=? AND status IN ('planning','awaiting_plan_approval','queued','running','waiting_approval','pause_requested','paused','blocked') LIMIT 1").get(projectId) as Row | undefined
      if (activeBatch) throw new DomainError('invalid-state', '项目仍有未结束的章节批次，请先取消或完成批次再归档。')
      this.db.prepare("UPDATE projects SET status='archived',archived_at=?,revision=revision+1,updated_at=? WHERE id=? AND status='active'").run(timestamp, timestamp, projectId)
      this.db.prepare(`UPDATE workspace_states SET selected_project_id=NULL,selected_chapter_id=NULL,updated_at=?
        WHERE selected_project_id=? OR selected_chapter_id IN (SELECT id FROM chapters WHERE project_id=?)`).run(timestamp, projectId, projectId)
      // Session bindings and recovery capsules are navigation state. Removing the
      // binding cascades its capsule so an archived project cannot be resumed into.
      this.db.prepare('DELETE FROM session_project_bindings WHERE project_id=?').run(projectId)
    })
    return projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
  }

  restoreProject(projectId: string, baseRevision?: number): Project {
    const before = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
    if (before.status === 'active') return before
    if (baseRevision !== undefined && before.revision !== baseRevision) throw new DomainError('revision-conflict', `项目已从版本 ${baseRevision} 更新到 ${before.revision}。`)
    const timestamp = now()
    this.db.prepare("UPDATE projects SET status='active',archived_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND status='archived'").run(timestamp, projectId)
    return projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
  }

  createProject(input: CreateProjectInput): ProjectTree {
    const title = input.title.trim()
    if (!title) throw new DomainError('validation', 'Project title is required.')
    const timestamp = now()
    const projectId = id('project')
    const bookId = id('book')
    const volumeId = id('volume')
    const workspacePath = normalizeWorkspacePath(input.workspacePath)
    const markdownSyncEnabled = workspacePath !== null && input.markdownSyncEnabled === true
    const stylePreset = getBuiltinStylePreset(input.stylePresetId ?? DEFAULT_STYLE_PRESET_ID)
    const initialStyleProfile: WritingStyleProfile = {
      projectId,
      profileId: `style-${projectId}`,
      presetId: stylePreset.id,
      source: 'builtin',
      name: stylePreset.name,
      summary: stylePreset.summary,
      attributes: stylePreset.attributes,
      sampleHash: null,
      revision: 1,
      updatedAt: timestamp,
    }
    this.transaction(() => {
      this.db.prepare(`INSERT INTO projects(id,title,slug,language,genre,audience,status,target_word_count,chapter_target_words,current_book_id,revision,created_at,updated_at,project_root_path,markdown_sync_enabled)
        VALUES (?,?,?,?,?,?,'active',?,?,?,0,?,?,?,?)`).run(projectId, title, slugify(title), input.language?.trim() || 'zh-CN', input.genre?.trim() || null, input.audience?.trim() || null, input.targetWordCount ?? null, input.chapterTargetWords ?? null, bookId, timestamp, timestamp, workspacePath, markdownSyncEnabled ? 1 : 0)
      this.db.prepare('INSERT INTO books(id,project_id,title,position,created_at) VALUES (?,?,?,?,?)').run(bookId, projectId, title, 1, timestamp)
      this.db.prepare('INSERT INTO volumes(id,project_id,book_id,title,position,created_at) VALUES (?,?,?,?,?,?)').run(volumeId, projectId, bookId, '第一卷', 1, timestamp)
      this.db.prepare(`INSERT INTO project_rules(project_id,style_rules,chapter_goal,forbidden_content,style_profile_json,style_profile_version,revision,updated_at)
        VALUES (?,?,?,?,?,?,0,?)`).run(projectId, '语言清晰，保持人物视角稳定，避免模板化表达。', '推进当前章节冲突并形成明确变化。', '', JSON.stringify(initialStyleProfile), 1, timestamp)
      this.db.prepare(`INSERT INTO workspace_states(id,selected_project_id,selected_chapter_id,updated_at) VALUES ('default',?,?,?)
        ON CONFLICT(id) DO UPDATE SET selected_project_id=excluded.selected_project_id, selected_chapter_id=NULL, updated_at=excluded.updated_at`).run(projectId, null, timestamp)
    })
    return this.getProjectTree(projectId)
  }

  importManuscript(input: ManuscriptImportInput): ProjectImportResult {
    const parsed = parseManuscriptImport(input)
    const timestamp = now(), projectId = id('project'), bookId = id('book'), volumeId = id('volume')
    const stylePreset = getBuiltinStylePreset(DEFAULT_STYLE_PRESET_ID)
    const initialStyleProfile: WritingStyleProfile = {
      projectId, profileId: `style-${projectId}`, presetId: stylePreset.id, source: 'builtin', name: stylePreset.name,
      summary: stylePreset.summary, attributes: stylePreset.attributes, sampleHash: null, revision: 1, updatedAt: timestamp,
    }
    const chapterIds: string[] = []
    this.transaction(() => {
      this.db.prepare(`INSERT INTO projects(id,title,slug,language,genre,audience,status,target_word_count,chapter_target_words,current_book_id,revision,created_at,updated_at,project_root_path,markdown_sync_enabled)
        VALUES (?,?,?,?,?,?,'active',?,?,?,?,?,?,NULL,0)`).run(
        projectId, parsed.title, slugify(parsed.title), input.language?.trim() || 'zh-CN', input.genre?.trim() || null, input.audience?.trim() || null,
        input.targetWordCount ?? null, input.chapterTargetWords ?? null, bookId, parsed.chapters.length, timestamp, timestamp,
      )
      this.db.prepare('INSERT INTO books(id,project_id,title,position,created_at) VALUES (?,?,?,?,?)').run(bookId, projectId, parsed.title, 1, timestamp)
      this.db.prepare('INSERT INTO volumes(id,project_id,book_id,title,position,created_at) VALUES (?,?,?,?,?,?)').run(volumeId, projectId, bookId, '第一卷', 1, timestamp)
      this.db.prepare(`INSERT INTO project_rules(project_id,style_rules,chapter_goal,forbidden_content,style_profile_json,style_profile_version,revision,updated_at)
        VALUES (?,?,?,?,?,?,0,?)`).run(projectId, '语言清晰，保持人物视角稳定，避免模板化表达。', '推进当前章节冲突并形成明确变化。', '', JSON.stringify(initialStyleProfile), 1, timestamp)
      for (let index = 0; index < parsed.chapters.length; index += 1) {
        const source = parsed.chapters[index]!, chapterId = id('chapter'), versionId = id('version')
        chapterIds.push(chapterId)
        this.db.prepare(`INSERT INTO chapters(id,project_id,book_id,volume_id,chapter_number,title,status,current_draft_version_id,revision,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'draft',?,1,?,?)`).run(chapterId, projectId, bookId, volumeId, index + 1, source.title, versionId, timestamp, timestamp)
        this.db.prepare(`INSERT INTO manuscript_versions(id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,created_at)
          VALUES (?,?,?,NULL,'draft',?,?,?,'user','user',?)`).run(versionId, projectId, chapterId, source.content, createHash('sha256').update(source.content).digest('hex'), manuscriptWordCount(source.content), timestamp)
      }
      this.db.prepare(`INSERT INTO workspace_states(id,selected_project_id,selected_chapter_id,updated_at) VALUES ('default',?,?,?)
        ON CONFLICT(id) DO UPDATE SET selected_project_id=excluded.selected_project_id,selected_chapter_id=excluded.selected_chapter_id,updated_at=excluded.updated_at`).run(projectId, chapterIds[0] ?? null, timestamp)
    })
    return { project: this.getProjectTree(projectId), chapterIds, sourceName: parsed.sourceName, sourceHash: parsed.sourceHash, importedAt: timestamp, warnings: parsed.warnings }
  }

  exportProjectMarkdown(projectId: string): ProjectExportFile {
    const project = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
    const rows = this.db.prepare(`SELECT c.chapter_number,c.title,COALESCE(approved.content,draft.content,'') content
      FROM chapters c
      JOIN books b ON b.id=c.book_id
      LEFT JOIN volumes v ON v.id=c.volume_id
      LEFT JOIN manuscript_versions approved ON approved.id=c.current_approved_version_id
      LEFT JOIN manuscript_versions draft ON draft.id=c.current_draft_version_id
      WHERE c.project_id=?
      ORDER BY b.position,CASE WHEN v.position IS NULL THEN 2147483647 ELSE v.position END,c.chapter_number,c.created_at`).all(projectId) as Row[]
    const content = renderProjectMarkdown(project.title, rows.map(row => ({ chapterNumber: Number(row.chapter_number), title: String(row.title), content: String(row.content) })))
    return { fileName: `${safeExportFileStem(project.title)}.md`, mimeType: 'text/markdown; charset=utf-8', content }
  }

  exportProjectSnapshot(projectId: string): ProjectExportFile {
    const project = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
    const rules = this.projectRules(projectId)
    const bookRows = this.db.prepare('SELECT * FROM books WHERE project_id=? ORDER BY position,id').all(projectId) as Row[]
    const bookKeyById = new Map(bookRows.map((row, index) => [String(row.id), `book-${index + 1}`]))
    let volumeIndex = 0, chapterIndex = 0
    const chapterKeyById = new Map<string, string>()
    const manuscriptReferenceById = new Map<string, { chapterKey: string; versionKey: string }>()
    const books: PortableProjectSnapshotV2['books'] = bookRows.map(bookRow => {
      const bookId = String(bookRow.id), bookKey = bookKeyById.get(bookId)!
      const volumeRows = this.db.prepare('SELECT * FROM volumes WHERE book_id=? ORDER BY position,id').all(bookId) as Row[]
      const volumeKeyById = new Map(volumeRows.map(row => [String(row.id), `volume-${++volumeIndex}`]))
      const chapterRows = this.db.prepare('SELECT * FROM chapters WHERE book_id=? ORDER BY chapter_number,created_at,id').all(bookId) as Row[]
      return {
        key: bookKey, title: String(bookRow.title), position: Number(bookRow.position), createdAt: String(bookRow.created_at),
        volumes: volumeRows.map(row => ({ key: volumeKeyById.get(String(row.id))!, title: String(row.title), position: Number(row.position), createdAt: String(row.created_at) })),
        chapters: chapterRows.map(chapterRow => {
          const chapterId = String(chapterRow.id), chapterKey = `chapter-${++chapterIndex}`
          chapterKeyById.set(chapterId, chapterKey)
          const versionRows = this.db.prepare('SELECT * FROM manuscript_versions WHERE chapter_id=? ORDER BY created_at,id').all(chapterId) as Row[]
          const versionKeyById = new Map(versionRows.map((row, index) => [String(row.id), `version-${index + 1}`]))
          for (const row of versionRows) manuscriptReferenceById.set(String(row.id), { chapterKey, versionKey: versionKeyById.get(String(row.id))! })
          return {
            key: chapterKey,
            volumeKey: chapterRow.volume_id === null ? null : volumeKeyById.get(String(chapterRow.volume_id)) ?? null,
            chapterNumber: Number(chapterRow.chapter_number), title: String(chapterRow.title), status: chapterRow.status as Chapter['status'],
            currentDraftVersionKey: chapterRow.current_draft_version_id === null ? null : versionKeyById.get(String(chapterRow.current_draft_version_id)) ?? null,
            currentApprovedVersionKey: chapterRow.current_approved_version_id === null ? null : versionKeyById.get(String(chapterRow.current_approved_version_id)) ?? null,
            revision: Number(chapterRow.revision), createdAt: String(chapterRow.created_at), updatedAt: String(chapterRow.updated_at),
            versions: versionRows.map(row => ({
              key: versionKeyById.get(String(row.id))!, parentVersionKey: row.parent_version_id === null ? null : versionKeyById.get(String(row.parent_version_id)) ?? null,
              status: row.status as ManuscriptVersion['status'], content: String(row.content), contentHash: createHash('sha256').update(String(row.content)).digest('hex'), wordCount: manuscriptWordCount(String(row.content)),
              origin: row.origin as ManuscriptVersion['origin'], createdBy: row.created_by as ManuscriptVersion['createdBy'], createdAt: String(row.created_at),
              approvedAt: row.approved_at === null ? null : String(row.approved_at),
            })),
          }
        }),
      }
    })
    if (books.length === 0) throw new DomainError('invalid-state', '项目没有可导出的书册。')
    const foundationRows = this.db.prepare("SELECT * FROM project_foundation_versions WHERE project_id=? AND foundation_kind IN ('outline','characters','timeline') ORDER BY CASE foundation_kind WHEN 'outline' THEN 1 WHEN 'characters' THEN 2 ELSE 3 END,version,id").all(projectId) as Row[]
    const foundationKeyById = new Map(foundationRows.map((row, index) => [String(row.id), `foundation-${index + 1}`]))
    const memoryRows = this.db.prepare("SELECT * FROM memory_items WHERE project_id=? AND origin='user' ORDER BY created_at,id").all(projectId) as Row[]
    if (memoryRows.some(row => String(row.state) === 'conflicted')) throw new DomainError('invalid-state', '项目存在未解决的 Memory Markdown 冲突，请处理后再导出快照。')
    const memoryKeyById = new Map(memoryRows.map((row, index) => [String(row.id), `author-memory-${index + 1}`]))
    const revisionKeyById = new Map<string, string>()
    for (const memory of memoryRows) for (const [index, revision] of (this.db.prepare('SELECT id FROM memory_revisions WHERE item_id=? ORDER BY revision,id').all(String(memory.id)) as Row[]).entries()) revisionKeyById.set(String(revision.id), `${memoryKeyById.get(String(memory.id))}-revision-${index + 1}`)
    const authorMemories: PortableProjectSnapshotV2['authorMemories'] = memoryRows.map(memory => {
      const memoryId = String(memory.id), revisions = this.db.prepare('SELECT * FROM memory_revisions WHERE item_id=? ORDER BY revision,id').all(memoryId) as Row[]
      return {
        key: memoryKeyById.get(memoryId)!, origin: 'user', scope: memory.scope as MemoryItem['scope'], category: memory.category as MemoryCategory,
        state: String(memory.state) === 'archived' ? 'archived' : 'active', promptPolicy: memory.prompt_policy as MemoryPromptPolicy,
        sourceKey: memoryKeyById.get(memoryId)!, revision: Number(memory.revision), currentRevisionKey: revisionKeyById.get(String(memory.current_revision_id))!,
        createdAt: String(memory.created_at), updatedAt: String(memory.updated_at),
        revisions: revisions.map(revision => ({
          key: revisionKeyById.get(String(revision.id))!, revision: Number(revision.revision), content: String(revision.content), structuredJson: String(revision.structured_json),
          contentHash: createHash('sha256').update(String(revision.content)).digest('hex'), actor: revision.actor as MemoryRevision['actor'],
          parentRevisionKey: revision.parent_revision_id === null ? null : revisionKeyById.get(String(revision.parent_revision_id)) ?? null,
          provider: revision.provider === null ? null : String(revision.provider), model: revision.model === null ? null : String(revision.model),
          promptHash: revision.prompt_hash === null ? null : String(revision.prompt_hash), createdAt: String(revision.created_at),
          sources: (this.db.prepare('SELECT * FROM memory_revision_sources WHERE revision_id=? ORDER BY created_at,id').all(String(revision.id)) as Row[]).map((source, sourceIndex) => ({
            key: `${revisionKeyById.get(String(revision.id))}-source-${sourceIndex + 1}`, sourceType: String(source.source_type),
            sourceKey: String(source.source_type) === 'memory-item' ? memoryKeyById.get(String(source.source_id)) ?? String(source.source_id) : String(source.source_type) === 'memory-revision' ? revisionKeyById.get(String(source.source_version_id ?? source.source_id)) ?? String(source.source_id) : String(source.source_type) === 'manuscript-version' && manuscriptReferenceById.has(String(source.source_id)) ? `${manuscriptReferenceById.get(String(source.source_id))!.chapterKey}:${manuscriptReferenceById.get(String(source.source_id))!.versionKey}` : String(source.source_id),
            sourceVersionKey: source.source_version_id === null ? null : revisionKeyById.get(String(source.source_version_id)) ?? (manuscriptReferenceById.has(String(source.source_version_id)) ? `${manuscriptReferenceById.get(String(source.source_version_id))!.chapterKey}:${manuscriptReferenceById.get(String(source.source_version_id))!.versionKey}` : String(source.source_version_id)),
            label: String(source.label), createdAt: String(source.created_at),
          })),
        })),
      }
    })
    const relationshipRows = this.db.prepare('SELECT * FROM entity_relationships WHERE project_id=? ORDER BY created_at,id').all(projectId) as Row[]
    const referencedEntityIds = [...new Set(relationshipRows.flatMap(row => [String(row.source_entity_id), String(row.target_entity_id)]))]
    const relationshipEntityRows = referencedEntityIds.map(entityId => this.one(this.db.prepare('SELECT * FROM story_entities WHERE id=? AND project_id=?'), entityId, projectId))
    const entityKeyById = new Map(relationshipEntityRows.map((row, index) => [String(row.id), `relationship-entity-${index + 1}`]))
    const relationshipKeyById = new Map(relationshipRows.map((row, index) => [String(row.id), `relationship-${index + 1}`]))
    const relationshipEntities: PortableProjectSnapshotV2['relationshipEntities'] = relationshipEntityRows.map(row => ({
      key: entityKeyById.get(String(row.id))!, type: row.entity_type as StoryEntity['type'], name: String(row.name),
      aliases: (this.db.prepare('SELECT alias FROM entity_aliases WHERE entity_id=? ORDER BY alias').all(String(row.id)) as Row[]).map(alias => String(alias.alias)),
      description: String(row.description), sourceManuscriptVersion: row.source_manuscript_version_id === null ? null : manuscriptReferenceById.get(String(row.source_manuscript_version_id)) ?? null,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
    const relationships: PortableProjectSnapshotV2['relationships'] = relationshipRows.map(row => ({
      key: relationshipKeyById.get(String(row.id))!, sourceEntityKey: entityKeyById.get(String(row.source_entity_id))!, targetEntityKey: entityKeyById.get(String(row.target_entity_id))!,
      predicateKey: String(row.predicate_key), label: String(row.label), category: row.category as RelationshipCategory, directionality: row.directionality as EntityRelationship['directionality'],
      factLayer: row.fact_layer as RelationshipFactLayer, validFromStoryOrder: row.valid_from_story_order === null ? null : Number(row.valid_from_story_order), validToStoryOrder: row.valid_to_story_order === null ? null : Number(row.valid_to_story_order),
      status: row.status as EntityRelationship['status'], supersedesRelationshipKey: row.supersedes_relationship_id === null ? null : relationshipKeyById.get(String(row.supersedes_relationship_id)) ?? null,
      createdBy: row.created_by as EntityRelationship['createdBy'], revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      evidence: (this.db.prepare('SELECT * FROM entity_relationship_evidence WHERE relationship_id=? ORDER BY created_at,id').all(String(row.id)) as Row[]).map((evidence, evidenceIndex) => ({
        key: `${relationshipKeyById.get(String(row.id))}-evidence-${evidenceIndex + 1}`, sourceType: String(evidence.source_type), sourceKey: String(evidence.source_type) === 'manuscript-version' && manuscriptReferenceById.has(String(evidence.source_id)) ? `${manuscriptReferenceById.get(String(evidence.source_id))!.chapterKey}:${manuscriptReferenceById.get(String(evidence.source_id))!.versionKey}` : String(evidence.source_id),
        sourceVersionKey: evidence.source_version_id === null ? null : manuscriptReferenceById.has(String(evidence.source_version_id)) ? `${manuscriptReferenceById.get(String(evidence.source_version_id))!.chapterKey}:${manuscriptReferenceById.get(String(evidence.source_version_id))!.versionKey}` : String(evidence.source_version_id), label: String(evidence.label), excerptStart: evidence.excerpt_start === null ? null : Number(evidence.excerpt_start),
        excerptEnd: evidence.excerpt_end === null ? null : Number(evidence.excerpt_end), contentHash: String(evidence.content_hash), createdAt: String(evidence.created_at),
      })),
    }))
    const snapshot: PortableProjectSnapshotV2 = {
      format: PORTABLE_PROJECT_FORMAT,
      schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION,
      exportedAt: now(),
      project: {
        title: project.title, language: project.language, genre: project.genre, audience: project.audience, targetWordCount: project.targetWordCount,
        chapterTargetWords: project.chapterTargetWords, revision: project.revision, currentBookKey: bookKeyById.get(project.currentBookId) ?? books[0]!.key,
      },
      projectRules: { styleRules: rules.styleRules, chapterGoal: rules.chapterGoal, forbiddenContent: rules.forbiddenContent, revision: rules.revision },
      styleProfile: {
        presetId: rules.styleProfile?.presetId ?? null, source: rules.styleProfile?.source ?? 'builtin', name: rules.styleProfile?.name ?? '默认文风',
        summary: rules.styleProfile?.summary ?? '', attributes: rules.styleProfile?.attributes ?? getBuiltinStylePreset(DEFAULT_STYLE_PRESET_ID).attributes,
        sampleHash: rules.styleProfile?.sampleHash ?? null, revision: rules.styleProfile?.revision ?? 0,
      },
      books,
      foundations: foundationRows.map(row => ({
        key: foundationKeyById.get(String(row.id))!, kind: row.foundation_kind as 'outline' | 'characters' | 'timeline', version: Number(row.version),
        title: String(row.title), content: String(row.content), contentHash: createHash('sha256').update(String(row.content)).digest('hex'), status: row.status as 'draft' | 'approved' | 'superseded',
        provider: String(row.provider), model: String(row.model), promptVersion: String(row.prompt_version), promptHash: String(row.prompt_hash),
        dependencyVersionKeys: jsonArray<string>(row.dependency_version_ids_json).map(value => foundationKeyById.get(value)).filter((value): value is string => Boolean(value)),
        createdAt: String(row.created_at), approvedAt: row.approved_at === null ? null : String(row.approved_at),
      })),
      authorMemories,
      relationshipEntities,
      relationships,
    }
    const normalized = normalizePortableProjectSnapshot(snapshot)
    return { fileName: `${safeExportFileStem(project.title)}.novel-studio.json`, mimeType: 'application/json; charset=utf-8', content: `${JSON.stringify(normalized, null, 2)}\n` }
  }

  restoreProjectSnapshot(value: unknown, title?: string): ProjectTree {
    const snapshot = normalizePortableProjectSnapshot(value)
    const restoredTitle = title?.trim() || snapshot.project.title
    if (!restoredTitle || restoredTitle.length > 500) throw new DomainError('validation', '恢复后的作品名不能为空且不能超过 500 个字符。')
    const timestamp = now(), projectId = id('project')
    const bookIds = new Map(snapshot.books.map(book => [book.key, id('book')]))
    const volumeIds = new Map(snapshot.books.flatMap(book => book.volumes).map(volume => [volume.key, id('volume')]))
    const chapterIds = new Map(snapshot.books.flatMap(book => book.chapters).map(chapter => [chapter.key, id('chapter')]))
    const versionIds = new Map<string, string>()
    for (const book of snapshot.books) for (const chapter of book.chapters) for (const version of chapter.versions) versionIds.set(`${chapter.key}:${version.key}`, id('version'))
    const foundationIds = new Map(snapshot.foundations.map(foundation => [foundation.key, id('foundation-version')]))
    const extensions = snapshot.schemaVersion === 2 ? snapshot : null
    const memoryIds = new Map(extensions?.authorMemories.map(memory => [memory.key, id('memory-item')]) ?? [])
    const memoryRevisionIds = new Map(extensions?.authorMemories.flatMap(memory => memory.revisions.map(revision => [revision.key, id('memory-revision')] as const)) ?? [])
    const relationshipEntityIds = new Map(extensions?.relationshipEntities.map(entity => [entity.key, id('story-entity')]) ?? [])
    const relationshipIds = new Map(extensions?.relationships.map(relationship => [relationship.key, id('entity-relationship')]) ?? [])
    const portableSourceId = (sourceKey: string): string => memoryIds.get(sourceKey) ?? memoryRevisionIds.get(sourceKey) ?? versionIds.get(sourceKey) ?? sourceKey
    const styleProfile: WritingStyleProfile = {
      projectId, profileId: `style-${projectId}`, presetId: snapshot.styleProfile.presetId, source: snapshot.styleProfile.source,
      name: snapshot.styleProfile.name, summary: snapshot.styleProfile.summary, attributes: snapshot.styleProfile.attributes,
      sampleHash: snapshot.styleProfile.sampleHash, revision: snapshot.styleProfile.revision, updatedAt: timestamp,
    }
    const firstChapterId = snapshot.books.flatMap(book => book.chapters).map(chapter => chapterIds.get(chapter.key)!).at(0) ?? null
    this.transaction(() => {
      this.db.prepare(`INSERT INTO projects(id,title,slug,language,genre,audience,status,target_word_count,chapter_target_words,current_book_id,revision,created_at,updated_at,project_root_path,markdown_sync_enabled)
        VALUES (?,?,?,?,?,?,'active',?,?,?,?,?,?,NULL,0)`).run(
        projectId, restoredTitle, slugify(restoredTitle), snapshot.project.language, snapshot.project.genre, snapshot.project.audience,
        snapshot.project.targetWordCount, snapshot.project.chapterTargetWords, bookIds.get(snapshot.project.currentBookKey)!, snapshot.project.revision, timestamp, timestamp,
      )
      this.db.prepare(`INSERT INTO project_rules(project_id,style_rules,chapter_goal,forbidden_content,style_profile_json,style_profile_version,revision,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(projectId, snapshot.projectRules.styleRules, snapshot.projectRules.chapterGoal, snapshot.projectRules.forbiddenContent, JSON.stringify(styleProfile), styleProfile.revision, snapshot.projectRules.revision, timestamp)
      for (const book of snapshot.books) {
        const bookId = bookIds.get(book.key)!
        this.db.prepare('INSERT INTO books(id,project_id,title,position,created_at) VALUES (?,?,?,?,?)').run(bookId, projectId, book.title, book.position, book.createdAt)
        for (const volume of book.volumes) this.db.prepare('INSERT INTO volumes(id,project_id,book_id,title,position,created_at) VALUES (?,?,?,?,?,?)').run(volumeIds.get(volume.key)!, projectId, bookId, volume.title, volume.position, volume.createdAt)
        for (const chapter of book.chapters) {
          const chapterId = chapterIds.get(chapter.key)!
          const restoredVolumeId = chapter.volumeKey === null ? volumeIds.get(book.volumes[0]!.key)! : volumeIds.get(chapter.volumeKey)!
          this.db.prepare(`INSERT INTO chapters(id,project_id,book_id,volume_id,chapter_number,title,status,current_draft_version_id,current_approved_version_id,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,?)`).run(chapterId, projectId, bookId, restoredVolumeId, chapter.chapterNumber, chapter.title, chapter.status, chapter.revision, chapter.createdAt, chapter.updatedAt)
          for (const version of chapter.versions) {
            const versionId = versionIds.get(`${chapter.key}:${version.key}`)!
            this.db.prepare(`INSERT INTO manuscript_versions(id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,created_at,approved_at)
              VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?)`).run(
              versionId, projectId, chapterId, version.status, version.content, createHash('sha256').update(version.content).digest('hex'), manuscriptWordCount(version.content),
              version.origin, version.createdBy, version.createdAt, version.approvedAt,
            )
          }
          for (const version of chapter.versions) if (version.parentVersionKey !== null) this.db.prepare('UPDATE manuscript_versions SET parent_version_id=? WHERE id=?').run(versionIds.get(`${chapter.key}:${version.parentVersionKey}`)!, versionIds.get(`${chapter.key}:${version.key}`)!)
          const draftId = chapter.currentDraftVersionKey === null ? null : versionIds.get(`${chapter.key}:${chapter.currentDraftVersionKey}`)!
          const approvedId = chapter.currentApprovedVersionKey === null ? null : versionIds.get(`${chapter.key}:${chapter.currentApprovedVersionKey}`)!
          this.db.prepare('UPDATE chapters SET current_draft_version_id=?,current_approved_version_id=? WHERE id=?').run(draftId, approvedId, chapterId)
          if (approvedId) this.db.prepare("INSERT INTO approvals(id,project_id,chapter_id,manuscript_version_id,decision,actor,created_at) VALUES (?,?,?,?,'approved','snapshot-restore',?)").run(id('approval'), projectId, chapterId, approvedId, timestamp)
        }
      }
      for (const foundation of snapshot.foundations) {
        this.db.prepare(`INSERT INTO project_foundation_versions(id,project_id,foundation_kind,version,title,content,content_hash,status,provider,model,prompt_version,prompt_hash,dependency_version_ids_json,output_json,generation_run_id,created_at,approved_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,? ,NULL,?,?)`).run(
          foundationIds.get(foundation.key)!, projectId, foundation.kind, foundation.version, foundation.title, foundation.content,
          createHash('sha256').update(foundation.content).digest('hex'), foundation.status, foundation.provider, foundation.model, foundation.promptVersion, foundation.promptHash,
          JSON.stringify(foundation.dependencyVersionKeys.map(dependency => foundationIds.get(dependency)!)), JSON.stringify({ restoredFromPortableSnapshot: true }), foundation.createdAt, foundation.approvedAt,
        )
      }
      if (extensions) {
        for (const memory of extensions.authorMemories) {
          const memoryId = memoryIds.get(memory.key)!, currentRevisionId = memoryRevisionIds.get(memory.currentRevisionKey)!
          this.db.prepare(`INSERT INTO memory_items(id,project_id,origin,storage,scope,category,state,prompt_policy,source_key,current_revision_id,revision,created_at,updated_at)
            VALUES (?,?,'user','database',?,?,?,?,?,?,?, ?,?)`).run(memoryId, projectId, memory.scope, memory.category, memory.state, memory.promptPolicy, `portable:${memory.key}`, currentRevisionId, memory.revision, memory.createdAt, memory.updatedAt)
          for (const revision of memory.revisions) this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,provider,model,prompt_hash,created_at)
            VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?)`).run(memoryRevisionIds.get(revision.key)!, memoryId, revision.revision, revision.content, revision.structuredJson, createHash('sha256').update(revision.content).digest('hex'), revision.actor, revision.provider, revision.model, revision.promptHash, revision.createdAt)
          for (const revision of memory.revisions) {
            if (revision.parentRevisionKey) this.db.prepare('UPDATE memory_revisions SET parent_revision_id=? WHERE id=?').run(memoryRevisionIds.get(revision.parentRevisionKey)!, memoryRevisionIds.get(revision.key)!)
            for (const source of revision.sources) this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)').run(id('memory-source'), memoryRevisionIds.get(revision.key)!, source.sourceType, portableSourceId(source.sourceKey), source.sourceVersionKey === null ? null : portableSourceId(source.sourceVersionKey), source.label, source.createdAt)
          }
          const current = memory.revisions.find(revision => revision.key === memory.currentRevisionKey)!
          this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(memoryId, projectId, current.content)
        }
        for (const entity of extensions.relationshipEntities) {
          const sourceVersionId = entity.sourceManuscriptVersion ? versionIds.get(`${entity.sourceManuscriptVersion.chapterKey}:${entity.sourceManuscriptVersion.versionKey}`) ?? null : null
          const entityId = relationshipEntityIds.get(entity.key)!
          this.db.prepare('INSERT INTO story_entities(id,project_id,entity_type,name,description,source_manuscript_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(entityId, projectId, entity.type, entity.name, entity.description, sourceVersionId, entity.createdAt, entity.updatedAt)
          for (const alias of entity.aliases) this.db.prepare('INSERT INTO entity_aliases(id,entity_id,alias,created_at) VALUES (?,?,?,?)').run(id('entity-alias'), entityId, alias, entity.createdAt)
        }
        for (const relationship of extensions.relationships) {
          const relationshipId = relationshipIds.get(relationship.key)!, sourceEntityId = relationshipEntityIds.get(relationship.sourceEntityKey)!, targetEntityId = relationshipEntityIds.get(relationship.targetEntityKey)!
          const normalized = this.normalizedRelationship({ sourceEntityId, targetEntityId, predicateKey: relationship.predicateKey, label: relationship.label, category: relationship.category, directionality: relationship.directionality, factLayer: relationship.factLayer, validFromStoryOrder: relationship.validFromStoryOrder, validToStoryOrder: relationship.validToStoryOrder })
          this.db.prepare(`INSERT INTO entity_relationships(id,project_id,source_entity_id,target_entity_id,predicate_key,label,category,directionality,fact_layer,valid_from_story_order,valid_to_story_order,status,supersedes_relationship_id,created_by,fingerprint,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`).run(relationshipId, projectId, normalized.sourceEntityId, normalized.targetEntityId, normalized.predicateKey, normalized.label, normalized.category, normalized.directionality, normalized.factLayer, normalized.validFromStoryOrder, normalized.validToStoryOrder, relationship.status, relationship.createdBy, normalized.fingerprint, relationship.revision, relationship.createdAt, relationship.updatedAt)
        }
        for (const relationship of extensions.relationships) {
          const relationshipId = relationshipIds.get(relationship.key)!
          if (relationship.supersedesRelationshipKey) this.db.prepare('UPDATE entity_relationships SET supersedes_relationship_id=? WHERE id=?').run(relationshipIds.get(relationship.supersedesRelationshipKey)!, relationshipId)
          for (const evidence of relationship.evidence) this.db.prepare(`INSERT INTO entity_relationship_evidence(id,relationship_id,source_type,source_id,source_version_id,label,excerpt_start,excerpt_end,content_hash,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('relationship-evidence'), relationshipId, evidence.sourceType, portableSourceId(evidence.sourceKey), evidence.sourceVersionKey === null ? null : portableSourceId(evidence.sourceVersionKey), evidence.label, evidence.excerptStart, evidence.excerptEnd, evidence.contentHash, evidence.createdAt)
        }
      }
      this.db.prepare(`INSERT INTO workspace_states(id,selected_project_id,selected_chapter_id,updated_at) VALUES ('default',?,?,?)
        ON CONFLICT(id) DO UPDATE SET selected_project_id=excluded.selected_project_id,selected_chapter_id=excluded.selected_chapter_id,updated_at=excluded.updated_at`).run(projectId, firstChapterId, timestamp)
    })
    this.backfillKnowledgeIndexes()
    this.backfillDerivedMemoryItems()
    return this.getProjectTree(projectId)
  }

  getProjectTree(projectId: string): ProjectTree {
    const project = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), projectId))
    const books = (this.db.prepare('SELECT * FROM books WHERE project_id=? ORDER BY position').all(projectId) as Row[]).map(book => ({
      id: String(book.id), projectId: String(book.project_id), title: String(book.title), position: Number(book.position), createdAt: String(book.created_at),
      volumes: (this.db.prepare('SELECT * FROM volumes WHERE book_id=? ORDER BY position').all(String(book.id)) as Row[]).map(volume => ({
        id: String(volume.id), projectId: String(volume.project_id), bookId: String(volume.book_id), title: String(volume.title), position: Number(volume.position), createdAt: String(volume.created_at),
        chapters: (this.db.prepare('SELECT * FROM chapters WHERE volume_id=? ORDER BY chapter_number').all(String(volume.id)) as Row[]).map(chapterFrom),
      })),
    }))
    return { project, books }
  }

  createChapter(projectId: string, title?: string): Chapter {
    this.assertProjectActive(projectId)
    const project = this.getProjectTree(projectId)
    const book = project.books[0]
    const volume = book?.volumes[0]
    if (!book || !volume) throw new DomainError('invalid-state', 'Project has no writable book and volume.')
    const next = Number((this.db.prepare('SELECT COALESCE(MAX(chapter_number), 0) + 1 value FROM chapters WHERE book_id=?').get(book.id) as Row).value)
    const timestamp = now()
    const chapterId = id('chapter')
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`INSERT INTO chapters(id,project_id,book_id,volume_id,chapter_number,title,status,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'draft',0,?,?)`).run(chapterId, projectId, book.id, volume.id, next, title?.trim() || `第 ${next} 章`, timestamp, timestamp)
      this.db.prepare('UPDATE projects SET revision=revision+1, updated_at=? WHERE id=?').run(timestamp, projectId)
      this.db.prepare(`INSERT INTO workspace_states(id,selected_project_id,selected_chapter_id,updated_at) VALUES ('default',?,?,?)
        ON CONFLICT(id) DO UPDATE SET selected_project_id=excluded.selected_project_id, selected_chapter_id=excluded.selected_chapter_id, updated_at=excluded.updated_at`).run(projectId, chapterId, timestamp)
    })
    return chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), chapterId))
  }

  getChapter(chapterId: string): ChapterDetail {
    const chapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), chapterId))
    const versions = (this.db.prepare('SELECT * FROM manuscript_versions WHERE chapter_id=? ORDER BY created_at DESC').all(chapterId) as Row[]).map(versionFrom)
    return { ...chapter, versions }
  }

  saveDraft(chapterId: string, input: SaveDraftInput): ChapterDetail {
    if (typeof input.content !== 'string') throw new DomainError('validation', 'Draft content must be text.')
    const before = this.getChapter(chapterId)
    this.assertProjectActive(before.projectId)
    if (before.revision !== input.baseRevision) throw new DomainError('revision-conflict', `Chapter changed from revision ${input.baseRevision} to ${before.revision}.`)
    const hash = createHash('sha256').update(input.content).digest('hex')
    const current = before.versions.find(version => version.id === before.currentDraftVersionId)
    if (current?.contentHash === hash) return before
    const timestamp = now()
    const versionId = id('version')
    this.activeProjectTransaction(before.projectId, () => {
      this.db.prepare(`INSERT INTO manuscript_versions(id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,created_at)
        VALUES (?,?,?,?,'draft',?,?,?,?, 'user',?)`).run(versionId, before.projectId, chapterId, before.currentDraftVersionId, input.content, hash, manuscriptWordCount(input.content), input.origin ?? 'user', timestamp)
      const chapterChanged = this.db.prepare('UPDATE chapters SET current_draft_version_id=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?').run(versionId, timestamp, chapterId, input.baseRevision)
      if (Number(chapterChanged.changes) !== 1) throw new DomainError('revision-conflict', `Chapter changed from revision ${input.baseRevision} while saving.`)
      this.db.prepare('UPDATE projects SET revision=revision+1, updated_at=? WHERE id=?').run(timestamp, before.projectId)
      const pendingApprovals = this.db.prepare(`SELECT a.id approval_id,a.workflow_run_id,a.manuscript_version_id previous_version_id,
          (SELECT n.id FROM workflow_node_runs n
            WHERE n.workflow_run_id=a.workflow_run_id AND n.node_key='wait_chapter_approval' AND n.status='waiting_approval'
            ORDER BY n.attempt DESC LIMIT 1) node_run_id
        FROM workflow_approvals a
        JOIN workflow_runs w ON w.id=a.workflow_run_id
        WHERE w.chapter_id=? AND w.status='waiting_approval' AND w.current_node_key='wait_chapter_approval' AND a.status='pending'`).all(chapterId) as Row[]
      for (const approval of pendingApprovals) {
        if (approval.node_run_id === null) throw new DomainError('invalid-state', 'Pending workflow approval is missing its waiting node.')
        const approvalChanged = this.db.prepare("UPDATE workflow_approvals SET manuscript_version_id=? WHERE id=? AND status='pending'")
          .run(versionId, String(approval.approval_id))
        const nodeChanged = this.db.prepare("UPDATE workflow_node_runs SET output_json=? WHERE id=? AND workflow_run_id=? AND node_key='wait_chapter_approval' AND status='waiting_approval'")
          .run(JSON.stringify({ manuscriptVersionId: versionId }), String(approval.node_run_id), String(approval.workflow_run_id))
        if (Number(approvalChanged.changes) !== 1 || Number(nodeChanged.changes) !== 1) throw new DomainError('invalid-state', 'Pending workflow approval changed while saving the draft.')
        this.addWorkflowEvent(String(approval.workflow_run_id), String(approval.node_run_id), 'workflow.approval.draft_retargeted', {
          chapterId,
          previousManuscriptVersionId: String(approval.previous_version_id),
          manuscriptVersionId: versionId,
        })
      }
    })
    this.refreshProjectRecoveryCapsules(before.projectId)
    this.syncChapterMarkdown(chapterId, input.content, 'draft')
    return this.getChapter(chapterId)
  }

  approveVersion(chapterId: string, versionId: string, baseRevision: number): ChapterDetail {
    const before = this.getChapter(chapterId)
    this.assertProjectActive(before.projectId)
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `Chapter changed from revision ${baseRevision} to ${before.revision}.`)
    const version = before.versions.find(item => item.id === versionId)
    if (!version) throw new DomainError('not-found', 'Manuscript version does not belong to this chapter.')
    const timestamp = now()
    this.activeProjectTransaction(before.projectId, () => {
      this.db.prepare("UPDATE manuscript_versions SET status='superseded' WHERE chapter_id=? AND status='approved' AND id != ?").run(chapterId, versionId)
      this.db.prepare("UPDATE manuscript_versions SET status='approved', approved_at=? WHERE id=?").run(timestamp, versionId)
      this.db.prepare("UPDATE chapters SET current_approved_version_id=?, status='approved', revision=revision+1, updated_at=? WHERE id=? AND revision=?").run(versionId, timestamp, chapterId, baseRevision)
      this.db.prepare("INSERT INTO approvals(id,project_id,chapter_id,manuscript_version_id,decision,actor,created_at) VALUES (?,?,?,?,'approved','user',?)").run(id('approval'), before.projectId, chapterId, versionId, timestamp)
      this.db.prepare('UPDATE projects SET revision=revision+1, updated_at=? WHERE id=?').run(timestamp, before.projectId)
    })
    this.refreshProjectRecoveryCapsules(before.projectId)
    this.syncChapterMarkdown(chapterId, version.content, 'approved')
    return this.getChapter(chapterId)
  }

  approveVersionAndStartPostProcessing(chapterId: string, versionId: string, baseRevision: number): { chapter: ChapterDetail; workflow: WorkflowRun } {
    const before = this.getChapter(chapterId)
    this.assertProjectActive(before.projectId)
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `Chapter changed from revision ${baseRevision} to ${before.revision}.`)
    const version = before.versions.find(item => item.id === versionId)
    if (!version) throw new DomainError('not-found', 'Manuscript version does not belong to this chapter.')
    if (before.currentApprovedVersionId === versionId && version.status === 'approved') throw new DomainError('invalid-state', '这个正文版本已经批准，无需重复提交知识更新。')

    const project = this.getProjectTree(before.projectId).project
    const foundation = this.getProjectFoundation(before.projectId)
    const style = this.getProjectStyleProfile(before.projectId)
    const timestamp = now()
    const workflowRunId = id('workflow-run')
    const projectRevisionAfterApproval = project.revision + 1
    const chapterRevisionAfterApproval = before.revision + 1
    const snapshot = {
      entryPoint: 'manual-approval',
      projectId: project.id,
      projectRevision: projectRevisionAfterApproval,
      chapterId,
      chapterRevision: chapterRevisionAfterApproval,
      inputManuscriptVersionId: versionId,
      foundationAssemblyHash: foundation.assemblyHash,
      styleRevision: style.revision,
      workflowDefinitionVersionId: CHAPTER_WORKFLOW_VERSION_ID,
      knowledgeSelectionSnapshotId: null,
    }

    this.activeProjectTransaction(before.projectId, () => {
      this.assertProjectWorkflowSlot(before.projectId)
      this.db.prepare("UPDATE manuscript_versions SET status='superseded' WHERE chapter_id=? AND status='approved' AND id != ?").run(chapterId, versionId)
      this.db.prepare("UPDATE manuscript_versions SET status='approved', approved_at=? WHERE id=?").run(timestamp, versionId)
      const changed = this.db.prepare("UPDATE chapters SET current_approved_version_id=?, status='approved', revision=revision+1, updated_at=? WHERE id=? AND revision=?").run(versionId, timestamp, chapterId, baseRevision)
      if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '章节在批准时发生变化，请刷新后重试。')
      this.db.prepare("INSERT INTO approvals(id,project_id,chapter_id,manuscript_version_id,decision,actor,created_at) VALUES (?,?,?,?,'approved','user',?)").run(id('approval'), before.projectId, chapterId, versionId, timestamp)
      this.db.prepare('UPDATE projects SET revision=revision+1, updated_at=? WHERE id=?').run(timestamp, before.projectId)
      this.db.prepare(`INSERT INTO workflow_runs(
        id,project_id,chapter_id,definition_version_id,status,current_node_key,input_snapshot_json,
        project_revision_at_start,chapter_revision_at_start,approved_version_id,revision_round,
        created_at,started_at,knowledge_selection_snapshot_id
      ) VALUES (?,?,?,?,'running',?,?,?,?,?,0,?,?,NULL)`).run(
        workflowRunId, before.projectId, chapterId, CHAPTER_WORKFLOW_VERSION_ID,
        'extract_canon_candidates', JSON.stringify(snapshot), projectRevisionAfterApproval,
        chapterRevisionAfterApproval, versionId, timestamp, timestamp,
      )
      this.addWorkflowEvent(workflowRunId, null, 'workflow.started', snapshot)
      this.addWorkflowEvent(workflowRunId, null, 'workflow.manual_approval.post_processing_started', { manuscriptVersionId: versionId })
    })

    this.refreshProjectRecoveryCapsules(before.projectId)
    this.syncChapterMarkdown(chapterId, version.content, 'approved')
    return { chapter: this.getChapter(chapterId), workflow: this.getWorkflowRun(workflowRunId) }
  }

  selectWorkspace(projectId: string | null, chapterId: string | null, sessionId = 'workspace:default'): WorkspaceSnapshot {
    if (chapterId) {
      const chapter = this.getChapter(chapterId)
      if (projectId && chapter.projectId !== projectId) throw new DomainError('validation', 'Chapter does not belong to selected project.')
      projectId = chapter.projectId
    }
    const selectedProject = projectId ? this.getProjectTree(projectId).project : null
    const select = (): void => {
      this.db.prepare(`INSERT INTO workspace_states(id,selected_project_id,selected_chapter_id,updated_at) VALUES ('default',?,?,?)
        ON CONFLICT(id) DO UPDATE SET selected_project_id=excluded.selected_project_id, selected_chapter_id=excluded.selected_chapter_id, updated_at=excluded.updated_at`).run(projectId, chapterId, now())
    }
    this.transaction(select)
    // Archived projects are intentionally selectable for the read-only author
    // control views, but are never rebound as an active generation session.
    if (projectId && selectedProject?.status === 'active') this.bindSessionProject(sessionId, projectId, chapterId)
    return this.getWorkspace()
  }

  getWorkspace(): WorkspaceSnapshot {
    const projects = this.listProjects()
    const state = this.db.prepare("SELECT * FROM workspace_states WHERE id='default'").get() as Row | undefined
    let selectedProjectId: string | null = state?.selected_project_id ? String(state.selected_project_id) : projects[0]?.id ?? null
    let selectedChapterId: string | null = state?.selected_chapter_id ? String(state.selected_chapter_id) : null
    let selectedProject: ProjectTree | null = null
    let selectedChapter: ChapterDetail | null = null
    try { if (selectedProjectId) selectedProject = this.getProjectTree(selectedProjectId) } catch { selectedProjectId = projects[0]?.id ?? null; selectedChapterId = null; selectedProject = selectedProjectId ? this.getProjectTree(selectedProjectId) : null }
    try { if (selectedChapterId) selectedChapter = this.getChapter(selectedChapterId) } catch { selectedChapterId = null }
    return { projects, selectedProjectId, selectedChapterId, selectedProject, selectedChapter }
  }

  bindSessionProject(sessionId: string, projectId: string, chapterId: string | null = null): ResumeContext {
    if (!sessionId.trim()) throw new DomainError('validation', 'Session id is required.')
    const project = this.assertProjectActive(projectId)
    if (chapterId) {
      const chapter = this.getChapter(chapterId)
      if (chapter.projectId !== projectId) throw new DomainError('validation', 'Chapter does not belong to the selected project.')
    }
    const timestamp = now()
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`INSERT INTO session_project_bindings(session_id,project_id,chapter_id,created_at,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET project_id=excluded.project_id,chapter_id=excluded.chapter_id,updated_at=excluded.updated_at`)
        .run(sessionId, project.id, chapterId, timestamp, timestamp)
    })
    this.writeRecoveryCapsule(sessionId)
    return this.getResumeContext(sessionId)
  }

  getResumeContext(sessionId: string, projectId?: string): ResumeContext {
    if (projectId) return this.bindSessionProject(sessionId, projectId, null)
    const binding = this.db.prepare('SELECT * FROM session_project_bindings WHERE session_id=?').get(sessionId) as Row | undefined
    if (!binding) throw new DomainError('not-found', 'This Session is not bound to a Novel Studio project. Call novel_resume_context with projectId to select one.')
    const stored = this.db.prepare('SELECT * FROM recovery_capsules WHERE session_id=?').get(sessionId) as Row | undefined
    const currentProject = this.assertProjectActive(String(binding.project_id))
    const previousRevision = stored ? Number(stored.last_approved_project_revision) : null
    const staleRevisionDetected = previousRevision !== null && previousRevision !== currentProject.revision
    if (!stored || staleRevisionDetected) this.writeRecoveryCapsule(sessionId)
    const capsule = this.readRecoveryCapsule(sessionId)
    const chapter = capsule.chapterId ? this.getChapter(capsule.chapterId) : null
    const workflow = capsule.workflowRunId ? this.getWorkflowRun(capsule.workflowRunId) : null
    const pendingApprovals = workflow?.status === 'waiting_approval' && workflow.approval?.status === 'pending'
      ? [{ workflowRunId: workflow.id, manuscriptVersionId: workflow.approval.manuscriptVersionId }]
      : []
    const latestApproved = chapter?.versions.find(item => item.id === chapter.currentApprovedVersionId) ?? null
    const suggestedNextAction = pendingApprovals.length > 0
      ? `Review and approve or reject manuscript version ${pendingApprovals[0]!.manuscriptVersionId}.`
      : workflow?.status === 'running' ? `Continue workflow ${workflow.id} from ${workflow.currentNodeKey ?? 'its next durable node'}.`
      : chapter ? `Continue editing chapter ${chapter.title} or start its next workflow.`
      : `Select a chapter in project ${currentProject.title}.`
    return {
      sessionId,
      capsule,
      project: { id: currentProject.id, title: currentProject.title, revision: currentProject.revision },
      chapter: chapter ? { id: chapter.id, title: chapter.title, revision: chapter.revision } : null,
      workflow: workflow ? { id: workflow.id, status: workflow.status, currentNodeKey: workflow.currentNodeKey } : null,
      pendingApprovals,
      latestApprovedVersion: latestApproved ? { id: latestApproved.id, chapterId: latestApproved.chapterId, approvedAt: latestApproved.approvedAt } : null,
      staleRevisionDetected,
      previousCapsuleRevision: staleRevisionDetected ? previousRevision : null,
      suggestedNextAction,
      furtherTools: ['novel_knowledge_search', 'novel_knowledge_sources_list'],
    }
  }

  private readRecoveryCapsule(sessionId: string): RecoveryCapsule {
    const row = this.one(this.db.prepare('SELECT * FROM recovery_capsules WHERE session_id=?'), sessionId)
    return {
      schemaVersion: 1,
      sessionId,
      projectId: String(row.project_id),
      bookId: row.book_id === null ? null : String(row.book_id),
      chapterId: row.chapter_id === null ? null : String(row.chapter_id),
      activeDraftVersionId: row.active_draft_version_id === null ? null : String(row.active_draft_version_id),
      workflowRunId: row.workflow_run_id === null ? null : String(row.workflow_run_id),
      workflowNode: row.workflow_node === null ? null : String(row.workflow_node),
      knowledgeSelectionSnapshotId: row.knowledge_selection_snapshot_id === null ? null : String(row.knowledge_selection_snapshot_id),
      promptPackId: String(row.prompt_pack_id),
      lastApprovedProjectRevision: Number(row.last_approved_project_revision),
      pendingUserDecisions: jsonArray<string>(row.pending_user_decisions_json),
      recoveryGeneratedAt: String(row.recovery_generated_at),
    }
  }

  private writeRecoveryCapsule(sessionId: string): void {
    const binding = this.one(this.db.prepare('SELECT * FROM session_project_bindings WHERE session_id=?'), sessionId)
    const project = this.assertProjectActive(String(binding.project_id))
    let chapter: ChapterDetail | null = null
    if (binding.chapter_id) {
      try { chapter = this.getChapter(String(binding.chapter_id)) } catch { chapter = null }
    }
    const runRow = this.db.prepare(`SELECT id FROM workflow_runs WHERE project_id=?
      ORDER BY CASE status WHEN 'waiting_approval' THEN 0 WHEN 'running' THEN 1 WHEN 'paused' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END, created_at DESC LIMIT 1`)
      .get(project.id) as Row | undefined
    const run = runRow ? this.getWorkflowRun(String(runRow.id)) : null
    // A new Session that explicitly selects only a project must not inherit a
    // chapter from another Session's latest workflow. Keep the selection boundary explicit.
    const effectiveChapter = chapter
    const decisions = run?.status === 'waiting_approval' && run.approval?.status === 'pending'
      ? [`Approve or reject chapter version ${run.approval.manuscriptVersionId}`]
      : []
    const timestamp = now()
    this.activeProjectTransaction(project.id, () => {
      this.db.prepare(`INSERT INTO recovery_capsules(session_id,schema_version,project_id,book_id,chapter_id,active_draft_version_id,workflow_run_id,workflow_node,knowledge_selection_snapshot_id,prompt_pack_id,last_approved_project_revision,pending_user_decisions_json,recovery_generated_at)
        VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET project_id=excluded.project_id,book_id=excluded.book_id,chapter_id=excluded.chapter_id,active_draft_version_id=excluded.active_draft_version_id,workflow_run_id=excluded.workflow_run_id,workflow_node=excluded.workflow_node,knowledge_selection_snapshot_id=excluded.knowledge_selection_snapshot_id,prompt_pack_id=excluded.prompt_pack_id,last_approved_project_revision=excluded.last_approved_project_revision,pending_user_decisions_json=excluded.pending_user_decisions_json,recovery_generated_at=excluded.recovery_generated_at`)
        .run(sessionId, project.id, effectiveChapter?.bookId ?? null, effectiveChapter?.id ?? null, effectiveChapter?.currentDraftVersionId ?? null, run?.id ?? null, run?.currentNodeKey ?? null, run?.knowledgeSelectionSnapshotId ?? null, BUILTIN_PROMPT_PACK.id, project.revision, JSON.stringify(decisions), timestamp)
    })
  }

  private refreshProjectRecoveryCapsules(projectId: string): void {
    const rows = this.db.prepare('SELECT session_id FROM session_project_bindings WHERE project_id=?').all(projectId) as Row[]
    for (const row of rows) this.writeRecoveryCapsule(String(row.session_id))
  }

  private projectRules(projectId: string): ProjectRules {
    const timestamp = now()
    let row = this.db.prepare('SELECT * FROM project_rules WHERE project_id=?').get(projectId) as Row | undefined
    if (!row) {
      this.activeProjectTransaction(projectId, () => {
        this.db.prepare(`INSERT OR IGNORE INTO project_rules(project_id,style_rules,chapter_goal,forbidden_content,style_profile_json,style_profile_version,revision,updated_at)
          VALUES (?,?,?,?,?,?,0,?)`).run(projectId, '语言清晰，保持人物视角稳定，避免模板化表达。', '推进当前章节冲突并形成明确变化。', '', JSON.stringify({}), 0, timestamp)
      })
      row = this.one(this.db.prepare('SELECT * FROM project_rules WHERE project_id=?'), projectId)
    }
    return { projectId: String(row.project_id), styleRules: String(row.style_rules), chapterGoal: String(row.chapter_goal), forbiddenContent: String(row.forbidden_content), styleProfile: styleProfileFromRow(projectId, row), revision: Number(row.revision), updatedAt: String(row.updated_at) }
  }

  getPromptCatalog(projectId: string): PromptCatalog {
    this.getProjectTree(projectId)
    const packs = (this.db.prepare('SELECT * FROM prompt_packs ORDER BY created_at').all() as Row[]).map((row): PromptPack => ({ id: String(row.id), name: String(row.name), locale: String(row.locale), source: row.source as PromptPack['source'], createdAt: String(row.created_at) }))
    const assets = (this.db.prepare('SELECT * FROM prompt_assets ORDER BY purpose, asset_key').all() as Row[]).map((row): PromptAsset => ({
      id: String(row.id), promptPackId: String(row.prompt_pack_id), key: String(row.asset_key), name: String(row.name), purpose: row.purpose as GenerationPurpose,
      activeVersionId: String(row.active_version_id), versions: (this.db.prepare('SELECT * FROM prompt_asset_versions WHERE prompt_asset_id=? ORDER BY version DESC').all(String(row.id)) as Row[]).map(promptVersionFrom),
    }))
    const selections = {} as Record<GenerationPurpose, string>
    for (const purpose of ['scene-plan', 'chapter-draft'] as const) {
      const override = this.db.prepare('SELECT prompt_asset_version_id FROM project_prompt_overrides WHERE project_id=? AND purpose=?').get(projectId, purpose) as Row | undefined
      const fallback = assets.find(asset => asset.purpose === purpose)?.activeVersionId
      if (!fallback && !override) throw new DomainError('invalid-state', `No Prompt Asset is available for ${purpose}.`)
      selections[purpose] = override ? String(override.prompt_asset_version_id) : fallback!
    }
    return { packs, assets, projectRules: this.projectRules(projectId), selections }
  }

  updateProjectRules(projectId: string, rules: Pick<ProjectRules, 'styleRules' | 'chapterGoal' | 'forbiddenContent'>, baseRevision: number): PromptCatalog {
    this.assertProjectActive(projectId)
    const before = this.projectRules(projectId)
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `Project rules changed from revision ${baseRevision} to ${before.revision}.`)
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`UPDATE project_rules SET style_rules=?,chapter_goal=?,forbidden_content=?,revision=revision+1,updated_at=? WHERE project_id=? AND revision=?`)
        .run(rules.styleRules.trim(), rules.chapterGoal.trim(), rules.forbiddenContent.trim(), now(), projectId, baseRevision)
    })
    return this.getPromptCatalog(projectId)
  }

  listStylePresets(): WritingStylePreset[] {
    return BUILTIN_STYLE_PRESETS.map(preset => ({ ...preset, attributes: { ...preset.attributes, expansionRules: [...preset.attributes.expansionRules], avoid: [...preset.attributes.avoid] } }))
  }

  getProjectStyleProfile(projectId: string): WritingStyleProfile {
    this.getProjectTree(projectId)
    return this.projectRules(projectId).styleProfile!
  }

  setProjectStylePreset(projectId: string, presetId: string, baseRevision: number): WritingStyleProfile {
    this.assertProjectActive(projectId)
    const before = this.getProjectStyleProfile(projectId)
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `Style profile changed from revision ${baseRevision} to ${before.revision}.`)
    const preset = getBuiltinStylePreset(presetId)
    const profile: WritingStyleProfile = {
      projectId,
      profileId: `style-${projectId}`,
      presetId: preset.id,
      source: 'builtin',
      name: preset.name,
      summary: preset.summary,
      attributes: preset.attributes,
      sampleHash: null,
      revision: before.revision + 1,
      updatedAt: now(),
    }
    const timestamp = profile.updatedAt
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare('UPDATE project_rules SET style_profile_json=?,style_profile_version=?,updated_at=? WHERE project_id=? AND style_profile_version=?')
        .run(JSON.stringify(profile), profile.revision, timestamp, projectId, baseRevision)
    })
    return this.getProjectStyleProfile(projectId)
  }

  saveWritingStyleProfile(projectId: string, draft: WritingStyleProfileDraft, baseRevision: number): WritingStyleProfile {
    this.assertProjectActive(projectId)
    const before = this.getProjectStyleProfile(projectId)
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `Style profile changed from revision ${baseRevision} to ${before.revision}.`)
    const name = draft.name.trim()
    const summary = draft.summary.trim()
    if (!name || !summary) throw new DomainError('validation', '文风名称和定位不能为空。')
    const profile: WritingStyleProfile = {
      projectId,
      profileId: draft.profileId ?? `style-${projectId}`,
      presetId: draft.presetId ?? null,
      source: draft.source,
      name,
      summary,
      attributes: draft.attributes,
      sampleHash: draft.sampleHash ?? null,
      revision: before.revision + 1,
      updatedAt: now(),
    }
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare('UPDATE project_rules SET style_profile_json=?,style_profile_version=?,updated_at=? WHERE project_id=? AND style_profile_version=?')
        .run(JSON.stringify(profile), profile.revision, profile.updatedAt, projectId, baseRevision)
    })
    return this.getProjectStyleProfile(projectId)
  }

  createPromptVersion(promptAssetId: string, template: string): PromptAssetVersion {
    if (!template.trim()) throw new DomainError('validation', 'Prompt template cannot be empty.')
    const asset = this.one(this.db.prepare('SELECT * FROM prompt_assets WHERE id=?'), promptAssetId)
    const latest = this.one(this.db.prepare('SELECT * FROM prompt_asset_versions WHERE prompt_asset_id=? ORDER BY version DESC LIMIT 1'), promptAssetId)
    const version = Number(latest.version) + 1
    const versionId = id('prompt-version')
    const timestamp = now()
    this.transaction(() => {
      this.db.prepare(`INSERT INTO prompt_asset_versions(id,prompt_asset_id,version,locale,template,input_schema_json,output_schema_json,source,content_hash,created_at)
        VALUES (?,?,?,?,?,?,?,'user',?,?)`).run(versionId, promptAssetId, version, String(latest.locale), template, String(latest.input_schema_json), String(latest.output_schema_json), createHash('sha256').update(template).digest('hex'), timestamp)
      this.db.prepare('UPDATE prompt_assets SET active_version_id=? WHERE id=?').run(versionId, String(asset.id))
    })
    return promptVersionFrom(this.one(this.db.prepare('SELECT * FROM prompt_asset_versions WHERE id=?'), versionId))
  }

  selectPromptVersion(projectId: string, purpose: GenerationPurpose, promptAssetVersionId: string): PromptCatalog {
    this.assertProjectActive(projectId)
    const version = this.one(this.db.prepare(`SELECT v.id FROM prompt_asset_versions v JOIN prompt_assets a ON a.id=v.prompt_asset_id WHERE v.id=? AND a.purpose=?`), promptAssetVersionId, purpose)
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`INSERT INTO project_prompt_overrides(project_id,purpose,prompt_asset_version_id,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(project_id,purpose) DO UPDATE SET prompt_asset_version_id=excluded.prompt_asset_version_id,updated_at=excluded.updated_at`).run(projectId, purpose, String(version.id), now())
    })
    return this.getPromptCatalog(projectId)
  }

  private summaryDependenciesAreCurrent(summary: KnowledgeSummary): boolean {
    if (summary.scope === 'foundation') return true
    const dependencyIds = [...new Set(summary.sourceVersionIds.length > 0
      ? summary.sourceVersionIds
      : summary.sourceVersionId ? [summary.sourceVersionId] : [])]
    if (dependencyIds.length === 0) return false
    const rows = this.db.prepare(`SELECT current_approved_version_id FROM chapters
      WHERE project_id=? AND current_approved_version_id IN (${dependencyIds.map(() => '?').join(',')})`).all(summary.projectId, ...dependencyIds) as Row[]
    return new Set(rows.map(row => String(row.current_approved_version_id))).size === dependencyIds.length
  }

  private summaryIsUsableBeforeChapter(summary: KnowledgeSummary, bookPosition: number, chapterNumber: number): boolean {
    if (summary.scope === 'foundation') return true
    if (!summary.sourceVersionId || !this.summaryDependenciesAreCurrent(summary)) return false
    const source = this.db.prepare(`SELECT b.position book_position,c.chapter_number,c.current_approved_version_id
      FROM manuscript_versions m JOIN chapters c ON c.id=m.chapter_id JOIN books b ON b.id=c.book_id
      WHERE m.id=? AND c.project_id=?`).get(summary.sourceVersionId, summary.projectId) as Row | undefined
    if (!source || String(source.current_approved_version_id ?? '') !== summary.sourceVersionId) return false
    return Number(source.book_position) < bookPosition
      || (Number(source.book_position) === bookPosition && Number(source.chapter_number) < chapterNumber)
  }

  getGenerationContext(chapterId: string, purpose: GenerationPurpose): GenerationContext {
    const chapter = this.getChapter(chapterId)
    const project = this.getProjectTree(chapter.projectId).project
    const foundation = this.getProjectFoundation(project.id)
    const foundationVersions = this.getApprovedProjectFoundationVersions(project.id)
    const catalog = this.getPromptCatalog(project.id)
    const selectedId = catalog.selections[purpose]
    const promptVersion = catalog.assets.flatMap(asset => asset.versions).find(version => version.id === selectedId)
    if (!promptVersion) throw new DomainError('invalid-state', 'Selected Prompt Asset version is unavailable.')
    const inputVersionId = chapter.currentDraftVersionId ?? chapter.currentApprovedVersionId
    const inputVersion = inputVersionId ? chapter.versions.find(version => version.id === inputVersionId) : undefined
    const latestPlanRow = this.db.prepare('SELECT * FROM scene_plans WHERE chapter_id=? ORDER BY created_at DESC LIMIT 1').get(chapterId) as Row | undefined
    const retrievalRow = this.db.prepare(`SELECT r.id FROM retrieval_runs r JOIN workflow_runs w ON w.id=r.workflow_run_id WHERE w.chapter_id=? ORDER BY r.created_at DESC LIMIT 1`).get(chapterId) as Row | undefined
    const arcSourceId = `${chapter.volumeId ?? chapter.bookId}:arc:${Math.floor(Math.max(0, chapter.chapterNumber - 1) / 8) + 1}`
    const currentBookPosition = Number(this.one(this.db.prepare('SELECT position FROM books WHERE id=?'), chapter.bookId).position)
    const globalMemory = (this.db.prepare(`SELECT ks.* FROM knowledge_summaries ks
      JOIN memory_items mi ON mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id
        AND mi.state='active' AND mi.prompt_policy='auto'
      WHERE ks.project_id=? AND ks.status='current' AND (
      (summary_scope='foundation' AND source_id=?) OR (summary_scope='project' AND source_id=?) OR
      (summary_scope='book' AND source_id=?) OR (summary_scope='volume' AND source_id=?) OR (summary_scope='arc' AND source_id=?))
      ORDER BY CASE summary_scope WHEN 'foundation' THEN 1 WHEN 'project' THEN 2 WHEN 'book' THEN 3 WHEN 'volume' THEN 4 ELSE 5 END`).all(
      project.id, foundation.assemblyHash, project.id, chapter.bookId, chapter.volumeId ?? chapter.bookId, arcSourceId,
    ) as Row[]).map(summaryFrom).filter(summary => summary.scope === 'foundation' || this.summaryIsUsableBeforeChapter(summary, currentBookPosition, chapter.chapterNumber))
    const recentChapterRows = this.db.prepare(`SELECT ks.*,c.id chapter_id,c.chapter_number,c.title chapter_title,m.id approved_version_id,m.content approved_content,m.approved_at,b.position book_position
      FROM chapters c
      JOIN books b ON b.id=c.book_id
      JOIN manuscript_versions m ON m.id=c.current_approved_version_id AND m.status='approved'
      LEFT JOIN knowledge_summaries ks ON ks.project_id=c.project_id AND ks.status='current' AND ks.summary_scope='chapter' AND ks.source_id=c.id
        AND ks.source_version_id=m.id
        AND EXISTS (SELECT 1 FROM memory_items mi WHERE mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id AND mi.state='active' AND mi.prompt_policy='auto')
      WHERE c.project_id=?
        AND (b.position<? OR (b.position=? AND c.chapter_number<?))
      ORDER BY b.position DESC,c.chapter_number DESC,ks.updated_at DESC LIMIT 5`).all(
      project.id, currentBookPosition, currentBookPosition, chapter.chapterNumber,
    ) as Row[]
    const continuitySummary = (row: Row): KnowledgeSummary => {
      if (row.id !== null && row.id !== undefined) return summaryFrom(row)
      const approvedContent = String(row.approved_content).replace(/\s+/g, ' ').trim()
      const compactNarrative = approvedContent.slice(0, 600) || String(row.chapter_title)
      return {
        id: `approved-fallback:${String(row.approved_version_id)}`,
        projectId: project.id,
        scope: 'chapter',
        sourceId: String(row.chapter_id),
        sourceVersionId: String(row.approved_version_id),
        content: compactNarrative,
        structuredJson: '{}',
        compactNarrative,
        sourceStartChapter: Number(row.chapter_number),
        sourceEndChapter: Number(row.chapter_number),
        sourceVersionIds: [String(row.approved_version_id)],
        contentHash: createHash('sha256').update(compactNarrative).digest('hex'),
        provider: null,
        model: null,
        promptHash: null,
        status: 'current',
        updatedAt: String(row.approved_at ?? row.updated_at ?? row.created_at ?? now()),
      }
    }
    const recentChapterMemory = recentChapterRows.map(continuitySummary)
    const priorChapterSummaries: PriorChapterSummary[] = recentChapterRows.slice().reverse().map(row => ({
      chapterId: String(row.chapter_id),
      chapterNumber: Number(row.chapter_number),
      chapterTitle: String(row.chapter_title),
      approvedVersionId: String(row.approved_version_id),
      summary: continuitySummary(row),
    }))
    const previousRow = recentChapterRows[0]
    const previousChapterContinuity: PreviousChapterContinuity | null = previousRow ? (() => {
      const approvedContent = String(previousRow.approved_content)
      const previousSummary = priorChapterSummaries.find(item => item.chapterId === String(previousRow.chapter_id))?.summary ?? null
      return {
        chapterId: String(previousRow.chapter_id),
        chapterNumber: Number(previousRow.chapter_number),
        chapterTitle: String(previousRow.chapter_title),
        approvedVersionId: String(previousRow.approved_version_id),
        summary: previousSummary,
        approvedEndingExcerpt: approvedContent.slice(Math.max(0, approvedContent.length - 2400)).trim(),
      }
    })() : null
    const rawRetrievalBundle = retrievalRow ? this.getRetrievalBundle(String(retrievalRow.id)) : null
    const retrievalBundle = rawRetrievalBundle ? {
      ...rawRetrievalBundle,
      items: rawRetrievalBundle.items.filter(item => {
        if (item.kind === 'summary' || item.kind === 'historical_summary') {
          const summaryRow = this.db.prepare(`SELECT ks.* FROM knowledge_summaries ks
            JOIN memory_items mi ON mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id
              AND mi.state='active' AND mi.prompt_policy='auto'
            WHERE ks.id=?`).get(item.sourceId) as Row | undefined
          if (!summaryRow) return false
          if (item.authority === 'historical_reference') return true
          const summary = summaryFrom(summaryRow)
          const currentSummaryVersionId = summary.sourceVersionId
          if (currentSummaryVersionId !== item.sourceVersionId) return false
          return summary.scope === 'foundation' || this.summaryIsUsableBeforeChapter(summary, currentBookPosition, chapter.chapterNumber)
        }
        if (item.authority === 'historical_reference') return true
        if (!item.sourceVersionId) return false
        const source = this.db.prepare(`SELECT b.position book_position,c.chapter_number,c.current_approved_version_id FROM manuscript_versions m
          JOIN chapters c ON c.id=m.chapter_id JOIN books b ON b.id=c.book_id WHERE m.id=?`).get(item.sourceVersionId) as Row | undefined
        if (source && ['current_project_canon', 'current_project_approved'].includes(item.authority) && String(source.current_approved_version_id ?? '') !== item.sourceVersionId) return false
        return !!source && (Number(source.book_position) < currentBookPosition || (Number(source.book_position) === currentBookPosition && Number(source.chapter_number) < chapter.chapterNumber))
      }),
    } : null
    const seen = new Set<string>()
    const longMemory = [...globalMemory, ...recentChapterMemory].filter(summary => !seen.has(summary.id) && seen.add(summary.id))
    const filesystemMemory = project.markdownSyncEnabled && project.workspacePath ? readMemoryMarkdown(project.workspacePath) : []
    const briefRow = this.db.prepare('SELECT * FROM chapter_writing_briefs WHERE chapter_id=?').get(chapterId) as Row | undefined
    const chapterBrief = briefRow ? {
      chapterId: String(briefRow.chapter_id), writingGoal: String(briefRow.writing_goal), openingContinuity: String(briefRow.opening_continuity),
      endingHook: String(briefRow.ending_hook), targetWords: Number(briefRow.target_words), source: briefRow.source as 'user' | 'batch-plan',
      revision: Number(briefRow.revision), batchItemId: briefRow.batch_item_id === null ? null : String(briefRow.batch_item_id),
      provider: briefRow.provider === null ? null : String(briefRow.provider), model: briefRow.model === null ? null : String(briefRow.model),
      promptHash: briefRow.prompt_hash === null ? null : String(briefRow.prompt_hash), updatedAt: String(briefRow.updated_at),
    } : null
    const authorMemory = (this.db.prepare("SELECT id FROM memory_items WHERE project_id=? AND origin='user' AND state<>'archived' ORDER BY CASE category WHEN 'constraint' THEN 1 WHEN 'continuity' THEN 2 ELSE 3 END,updated_at DESC").all(project.id) as Row[])
      .map(row => this.getMemoryItem(String(row.id)))
    const storyOrder = Math.max(0, currentBookPosition - 1) * 1_000_000 + chapter.chapterNumber * 1000
    const confirmedRelationships = (this.db.prepare(`SELECT r.*,source.name source_entity_name,target.name target_entity_name,(SELECT COUNT(*) FROM entity_relationship_evidence e WHERE e.relationship_id=r.id) evidence_count
      FROM entity_relationships r JOIN story_entities source ON source.id=r.source_entity_id JOIN story_entities target ON target.id=r.target_entity_id
      WHERE r.project_id=? AND r.status='active'
        AND (r.valid_from_story_order IS NULL OR r.valid_from_story_order<=?)
        AND (r.valid_to_story_order IS NULL OR r.valid_to_story_order>=?)
      ORDER BY CASE r.fact_layer WHEN 'canon' THEN 1 WHEN 'author_asserted' THEN 2 ELSE 3 END,r.updated_at DESC LIMIT 180`).all(project.id, storyOrder, storyOrder) as Row[]).map(relationshipFrom)
    return {
      purpose, project, chapter, rules: catalog.projectRules, styleProfile: catalog.projectRules.styleProfile, promptVersion,
      inputManuscriptVersionId: inputVersionId, inputManuscript: inputVersion?.content ?? '',
      latestScenePlan: latestPlanRow ? scenePlanFrom(latestPlanRow) : null,
      retrievalBundle,
      foundationVersions, foundationAssemblyHash: foundation.assemblyHash!, longMemory,
      priorChapterSummaries, previousChapterContinuity,
      chapterBrief, authorMemory, confirmedRelationships,
      filesystemMemory,
    }
  }

  startModelRun(context: GenerationContext, selection: ModelSelection, inputSnapshotJson: string): ModelRun {
    const project = this.assertProjectActive(context.project.id)
    const chapter = this.getChapter(context.chapter.id)
    if (chapter.projectId !== project.id) throw new DomainError('validation', '模型运行章节不属于当前项目。')
    if (project.revision !== context.project.revision || chapter.revision !== context.chapter.revision) {
      throw new DomainError('revision-conflict', '生成上下文已发生变化，请重试以采用最新输入。')
    }
    const runId = id('model-run')
    this.activeProjectTransaction(project.id, () => {
      const currentProject = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), project.id))
      const currentChapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), chapter.id))
      if (currentChapter.projectId !== currentProject.id) throw new DomainError('validation', '模型运行章节不属于当前项目。')
      if (currentProject.revision !== context.project.revision || currentChapter.revision !== context.chapter.revision) {
        throw new DomainError('revision-conflict', '生成上下文已发生变化，请重试以采用最新输入。')
      }
      const workflowGuard = this.workflowGuardFromSnapshot(inputSnapshotJson)
      if (!workflowGuard) this.assertProjectWorkflowSlot(project.id)
      else if (!this.isWorkflowModelGuardActiveUnchecked(project.id, chapter.id, inputSnapshotJson)) {
        throw new DomainError('invalid-state', '工作流已暂停、取消或离开当前节点，模型运行未启动。')
      }
      this.db.prepare(`INSERT INTO model_runs(id,project_id,chapter_id,purpose,provider,model,prompt_asset_version_id,input_manuscript_version_id,project_revision,chapter_revision,status,input_snapshot_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'running',?,?)`).run(runId, project.id, chapter.id, context.purpose, selection.provider, selection.model, context.promptVersion.id, context.inputManuscriptVersionId, context.project.revision, context.chapter.revision, inputSnapshotJson, now())
      let sections: Array<{ key?: unknown; sourceIds?: unknown; included?: unknown; truncated?: unknown; estimatedTokens?: unknown; reason?: unknown }> = []
      try {
        const snapshot = JSON.parse(inputSnapshotJson) as { promptAssemblyTrace?: { sections?: unknown } }
        if (Array.isArray(snapshot.promptAssemblyTrace?.sections)) sections = snapshot.promptAssemblyTrace.sections as typeof sections
      } catch { sections = [] }
      const memoryRows = this.db.prepare(`SELECT mi.id,mi.source_key,mi.current_revision_id,mi.state,mi.prompt_policy,mr.content
        FROM memory_items mi JOIN memory_revisions mr ON mr.id=mi.current_revision_id WHERE mi.project_id=?`).all(project.id) as Row[]
      const timestamp = now()
      for (const memory of memoryRows) {
        const section = sections.find(value => {
          const sourceIds = Array.isArray(value.sourceIds) ? value.sourceIds.filter(item => typeof item === 'string') as string[] : []
          return value.key === `memory:${String(memory.id)}` || sourceIds.includes(String(memory.id)) || sourceIds.includes(String(memory.current_revision_id)) || sourceIds.includes(String(memory.source_key))
        })
        const included = section?.included === true
        const reason = typeof section?.reason === 'string' ? section.reason
          : String(memory.state) === 'conflicted' ? '记忆存在未解决冲突'
            : String(memory.state) !== 'active' ? '记忆不是活动状态'
              : String(memory.prompt_policy) !== 'auto' ? 'Prompt 开关未启用'
                : '未进入本章上下文'
        this.db.prepare(`INSERT OR IGNORE INTO memory_usage_events(id,item_id,revision_id,model_run_id,section_key,included,truncated,estimated_tokens,reason,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('memory-usage'), String(memory.id), String(memory.current_revision_id), runId, typeof section?.key === 'string' ? section.key : '', included ? 1 : 0, section?.truncated === true ? 1 : 0, typeof section?.estimatedTokens === 'number' ? Math.max(0, Math.trunc(section.estimatedTokens)) : 0, reason, timestamp)
      }
    })
    return modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), runId))
  }

  updateModelRunStream(modelRunId: string, streamedText: string, telemetry?: GenerationTelemetry): ModelRun {
    const run = modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
    this.assertProjectActive(run.projectId)
    if (run.status !== 'running' || streamedText.length < run.streamedText.length || streamedText === run.streamedText) return run
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      const current = modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
      if (current.status !== 'running' || !this.isWorkflowModelGuardActiveUnchecked(current.projectId, current.chapterId, current.inputSnapshotJson)) return
      this.db.prepare('UPDATE model_runs SET streamed_text=?,streamed_text_updated_at=?,generation_telemetry_json=? WHERE id=? AND status=\'running\'').run(streamedText, timestamp, JSON.stringify(telemetry ?? run.generationTelemetry), modelRunId)
    })
    return modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
  }

  failModelRun(modelRunId: string, error: unknown): ModelRun {
    const run = modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
    this.assertProjectActive(run.projectId)
    const detail = error && typeof error === 'object' ? error as { code?: unknown; requestedMaxTokens?: unknown; partialResponse?: { text?: unknown; usage?: unknown; telemetry?: unknown } } : {}
    const errorCode = typeof detail.code === 'string' ? detail.code : undefined
    const partialResponse = detail.partialResponse && typeof detail.partialResponse === 'object' ? detail.partialResponse : undefined
    const message = {
      ...(error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) }),
      ...(errorCode ? { code: errorCode } : {}),
      ...(errorCode === 'model-output-limit' ? {
        finishReason: 'max-tokens',
        requestedMaxTokens: typeof detail.requestedMaxTokens === 'number' ? detail.requestedMaxTokens : null,
        partialOutputCharacters: typeof partialResponse?.text === 'string' ? partialResponse.text.length : run.streamedText.length,
      } : {}),
    }
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare("UPDATE model_runs SET status='failed',error_json=?,usage_json=COALESCE(?,usage_json),generation_telemetry_json=COALESCE(?,generation_telemetry_json),finished_at=? WHERE id=? AND status='running'")
        .run(JSON.stringify(message), partialResponse?.usage ? JSON.stringify(partialResponse.usage) : null, partialResponse?.telemetry ? JSON.stringify(partialResponse.telemetry) : null, now(), modelRunId)
    })
    return modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
  }

  completeScenePlan(modelRunId: string, output: unknown, usage?: ModelUsage, telemetry?: GenerationTelemetry): ScenePlan {
    const run = modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
    this.assertProjectActive(run.projectId)
    if (run.status !== 'running' || run.purpose !== 'scene-plan') throw new DomainError('invalid-state', 'Model run cannot accept a scene plan.')
    const planId = id('scene-plan')
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      const current = modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
      if (current.status !== 'running' || !this.isWorkflowModelGuardActiveUnchecked(current.projectId, current.chapterId, current.inputSnapshotJson)) {
        throw new DomainError('invalid-state', '工作流已暂停、取消或离开当前节点，迟到的场景规划未写入。')
      }
      const project = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), current.projectId))
      const chapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), current.chapterId))
      if (project.revision !== current.projectRevision || chapter.revision !== current.chapterRevision) {
        throw new DomainError('revision-conflict', '项目或章节在场景规划期间发生变化，生成结果未写入。')
      }
      this.assertModelRunAuthoritySnapshotUnchecked(current)
      this.db.prepare(`INSERT INTO scene_plans(id,project_id,chapter_id,model_run_id,prompt_asset_version_id,input_manuscript_version_id,content_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(planId, run.projectId, run.chapterId, run.id, run.promptAssetVersionId, run.inputManuscriptVersionId, JSON.stringify(output), timestamp)
      const scenes = output && typeof output === 'object' && Array.isArray((output as Record<string, unknown>).scenes) ? (output as Record<string, unknown>).scenes as unknown[] : []
      scenes.forEach((scene, index) => {
        const value = scene && typeof scene === 'object' ? scene as Record<string, unknown> : {}
        const label = String(value.scenePurpose ?? value.title ?? `场景 ${index + 1}`).trim() || `场景 ${index + 1}`
        const estimatedWords = typeof value.estimatedWords === 'number' && Number.isFinite(value.estimatedWords) ? Math.max(0, Math.round(value.estimatedWords)) : 0
        this.db.prepare(`INSERT INTO scenes(id,project_id,chapter_id,scene_plan_id,scene_key,label,position,estimated_words,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(id('scene'), run.projectId, run.chapterId, planId, `scene-${index + 1}`, label, index + 1, estimatedWords, timestamp)
      })
      const changed = this.db.prepare("UPDATE model_runs SET status='succeeded',output_json=?,usage_json=?,generation_telemetry_json=?,finished_at=? WHERE id=? AND status='running'").run(JSON.stringify(output), usage ? JSON.stringify(usage) : null, JSON.stringify(telemetry ?? run.generationTelemetry), timestamp, run.id)
      if (Number(changed.changes) !== 1) throw new DomainError('invalid-state', 'Model run is no longer running.')
    })
    return scenePlanFrom(this.one(this.db.prepare('SELECT * FROM scene_plans WHERE id=?'), planId))
  }

  completeGeneratedDraft(modelRunId: string, manuscript: string, output: unknown, usage?: ModelUsage, telemetry?: GenerationTelemetry): ChapterDetail {
    const run = modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
    this.assertProjectActive(run.projectId)
    if (run.status !== 'running' || run.purpose !== 'chapter-draft') throw new DomainError('invalid-state', 'Model run cannot accept a chapter draft.')
    const versionId = id('version')
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      const current = modelRunFrom(this.one(this.db.prepare('SELECT * FROM model_runs WHERE id=?'), modelRunId))
      if (current.status !== 'running' || !this.isWorkflowModelGuardActiveUnchecked(current.projectId, current.chapterId, current.inputSnapshotJson)) {
        throw new DomainError('invalid-state', '工作流已暂停、取消或离开当前节点，迟到的正文未写入。')
      }
      const project = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), current.projectId))
      const chapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), current.chapterId))
      if (project.revision !== current.projectRevision || chapter.revision !== current.chapterRevision) {
        throw new DomainError('revision-conflict', '项目或章节在正文生成期间发生变化，生成结果未写入。')
      }
      this.assertModelRunAuthoritySnapshotUnchecked(current)
      this.db.prepare(`INSERT INTO manuscript_versions(id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,prompt_asset_version_id,model_run_id,created_at)
        VALUES (?,?,?,?,'draft',?,?,?,'model','model',?,?,?)`).run(versionId, run.projectId, run.chapterId, run.inputManuscriptVersionId, manuscript, createHash('sha256').update(manuscript).digest('hex'), manuscriptWordCount(manuscript), run.promptAssetVersionId, run.id, timestamp)
      const chapterChanged = this.db.prepare('UPDATE chapters SET current_draft_version_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(versionId, timestamp, run.chapterId, run.chapterRevision)
      const projectChanged = this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(timestamp, run.projectId, run.projectRevision)
      const modelChanged = this.db.prepare("UPDATE model_runs SET status='succeeded',streamed_text=?,streamed_text_updated_at=?,output_json=?,usage_json=?,generation_telemetry_json=?,finished_at=? WHERE id=? AND status='running'").run(manuscript, timestamp, JSON.stringify(output), usage ? JSON.stringify(usage) : null, JSON.stringify(telemetry ?? run.generationTelemetry), timestamp, run.id)
      if (Number(chapterChanged.changes) !== 1 || Number(projectChanged.changes) !== 1 || Number(modelChanged.changes) !== 1) {
        throw new DomainError('revision-conflict', '正文写入时检测到并发变更，生成结果未应用。')
      }
    })
    this.refreshProjectRecoveryCapsules(run.projectId)
    this.syncChapterMarkdown(run.chapterId, manuscript, 'draft')
    return this.getChapter(run.chapterId)
  }

  private assertLegacyDraftRecoveryAuthority(run: WorkflowRun, workflow: Row, model: ModelRun, existingVersion: Row | null): { modelSnapshot: Record<string, unknown>; workflowSnapshot: Record<string, unknown> } {
    let modelSnapshot: Record<string, unknown>
    let workflowSnapshot: Record<string, unknown>
    try {
      const parsedModel = JSON.parse(model.inputSnapshotJson) as unknown
      const parsedWorkflow = JSON.parse(String(workflow.input_snapshot_json)) as unknown
      if (!parsedModel || typeof parsedModel !== 'object' || Array.isArray(parsedModel) || !parsedWorkflow || typeof parsedWorkflow !== 'object' || Array.isArray(parsedWorkflow)) throw new Error('invalid snapshot')
      modelSnapshot = parsedModel as Record<string, unknown>
      workflowSnapshot = parsedWorkflow as Record<string, unknown>
    } catch {
      throw new DomainError('invalid-state', '旧版正文的权威输入快照损坏，不能安全恢复。')
    }

    const currentProject = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), run.projectId))
    const currentChapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), run.chapterId))
    const recovered = existingVersion !== null
    const expectedProjectRevision = model.projectRevision + (recovered ? 1 : 0)
    const expectedChapterRevision = model.chapterRevision + (recovered ? 1 : 0)
    const liveInputVersionId = recovered ? existingVersion.parent_version_id : currentChapter.currentDraftVersionId ?? currentChapter.currentApprovedVersionId
    const recoveredPointerMatches = !recovered || currentChapter.currentDraftVersionId === String(existingVersion.id)
    const frozenWorkflowInputVersionId = typeof workflowSnapshot.inputManuscriptVersionId === 'string' ? workflowSnapshot.inputManuscriptVersionId : null
    const frozenModelInputVersionId = typeof modelSnapshot.inputManuscriptVersionId === 'string' ? modelSnapshot.inputManuscriptVersionId : null
    const revisionsMatch = currentProject.revision === expectedProjectRevision
      && currentChapter.revision === expectedChapterRevision
      && Number(workflow.project_revision_at_start) === model.projectRevision
      && Number(workflow.chapter_revision_at_start) === model.chapterRevision
      && modelSnapshot.projectRevision === model.projectRevision
      && modelSnapshot.chapterRevision === model.chapterRevision
      && workflowSnapshot.projectRevision === model.projectRevision
      && workflowSnapshot.chapterRevision === model.chapterRevision
      && liveInputVersionId === model.inputManuscriptVersionId
      && frozenWorkflowInputVersionId === model.inputManuscriptVersionId
      && frozenModelInputVersionId === model.inputManuscriptVersionId
      && recoveredPointerMatches
    if (!revisionsMatch) throw new DomainError('revision-conflict', '项目或章节已在旧版正文失败后发生变化，旧输出未恢复。')

    const liveFoundationHash = this.getProjectFoundation(run.projectId).assemblyHash
    const workflowFoundationHash = typeof workflowSnapshot.foundationAssemblyHash === 'string' ? workflowSnapshot.foundationAssemblyHash : null
    const modelFoundationHash = typeof modelSnapshot.foundationAssemblyHash === 'string' ? modelSnapshot.foundationAssemblyHash : null
    if (!workflowFoundationHash || !modelFoundationHash || workflowFoundationHash !== modelFoundationHash || liveFoundationHash !== modelFoundationHash) {
      throw new DomainError('revision-conflict', '创作基建已发生变化，旧输出未恢复。')
    }
    const liveStyleRevision = this.getProjectStyleProfile(run.projectId).revision
    const workflowStyleRevision = typeof workflowSnapshot.styleRevision === 'number' ? workflowSnapshot.styleRevision : null
    const modelStyleRevision = modelSnapshot.styleProfile && typeof modelSnapshot.styleProfile === 'object' && !Array.isArray(modelSnapshot.styleProfile)
      ? (modelSnapshot.styleProfile as Record<string, unknown>).revision : null
    if (workflowStyleRevision === null || typeof modelStyleRevision !== 'number' || workflowStyleRevision !== modelStyleRevision || liveStyleRevision !== modelStyleRevision) {
      throw new DomainError('revision-conflict', '项目文风已发生变化，旧输出未恢复。')
    }
    return { modelSnapshot, workflowSnapshot }
  }

  tryRecoverLegacyLengthRejectedDraft(workflowRunId: string, nodeRunId: string): LegacyLengthDraftRecovery | null {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    let manuscriptToMirror: string | null = null
    const recovery = this.activeProjectTransaction<LegacyLengthDraftRecovery | null>(run.projectId, () => {
      const workflow = this.one(this.db.prepare('SELECT * FROM workflow_runs WHERE id=? AND project_id=? AND chapter_id=?'), workflowRunId, run.projectId, run.chapterId)
      const node = this.one(this.db.prepare('SELECT * FROM workflow_node_runs WHERE id=? AND workflow_run_id=?'), nodeRunId, workflowRunId)
      if (workflow.status !== 'running' || workflow.current_node_key !== 'generate_draft' || node.status !== 'running' || node.node_key !== 'generate_draft') {
        throw new DomainError('invalid-state', '工作流已暂停、取消或离开正文节点，旧版正文未恢复。')
      }
      this.assertWorkflowRelationshipSafetyUnchecked(workflowRunId)
      this.assertProjectWorkflowSlot(run.projectId, workflowRunId, this.workflowBatchId(workflowRunId))

      const guardedModel = (this.db.prepare("SELECT * FROM model_runs WHERE project_id=? AND chapter_id=? AND purpose='chapter-draft' ORDER BY created_at DESC").all(run.projectId, run.chapterId) as Row[])
        .map(modelRunFrom)
        .find(candidate => {
          const guard = this.workflowGuardFromSnapshot(candidate.inputSnapshotJson)
          return guard?.workflowRunId === workflowRunId && guard.workflowNodeRunId === nodeRunId
        })
      if (!guardedModel) return null

      const existingVersion = this.db.prepare('SELECT id,parent_version_id,workflow_run_id,workflow_node_run_id FROM manuscript_versions WHERE model_run_id=? ORDER BY created_at DESC LIMIT 1').get(guardedModel.id) as Row | undefined
      if (existingVersion) {
        if (guardedModel.status !== 'succeeded' || existingVersion.workflow_run_id !== workflowRunId || existingVersion.workflow_node_run_id !== nodeRunId) {
          throw new DomainError('invalid-state', '旧版正文已经属于另一运行，不能重复恢复。')
        }
        let persisted: Record<string, unknown> = {}
        try {
          const parsed = guardedModel.outputJson ? JSON.parse(guardedModel.outputJson) as unknown : null
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) persisted = parsed as Record<string, unknown>
        } catch { persisted = {} }
        const manuscript = typeof persisted.manuscript === 'string' && persisted.manuscript.trim() ? persisted.manuscript : guardedModel.streamedText
        if (!manuscript.trim()) throw new DomainError('invalid-state', '已恢复的旧版正文为空，不能继续。')
        manuscriptToMirror = manuscript
        const marker = persisted._novelStudioLegacyRecovery && typeof persisted._novelStudioLegacyRecovery === 'object' && !Array.isArray(persisted._novelStudioLegacyRecovery)
          ? persisted._novelStudioLegacyRecovery as Record<string, unknown> : {}
        if (marker.recovered !== true || marker.originalModelRunId !== guardedModel.id) throw new DomainError('invalid-state', '已恢复正文缺少可信恢复标记，不能继续。')
        this.assertLegacyDraftRecoveryAuthority(run, workflow, guardedModel, existingVersion)
        const originalErrorCode: LegacyLengthDraftRecovery['originalErrorCode'] = marker.originalErrorCode === 'chapter-draft-too-short' ? 'chapter-draft-too-short' : 'chapter-draft-too-long'
        return {
          modelRunId: guardedModel.id,
          manuscriptVersionId: String(existingVersion.id),
          originalErrorCode,
          source: marker.source === 'output-json' ? 'output-json' : 'streamed-text',
          lengthAdvisory: persisted._novelStudioLengthAdvisory ?? null,
        }
      }
      if (guardedModel.status !== 'failed') return null

      let error: Record<string, unknown> = {}
      try {
        const parsed = guardedModel.errorJson ? JSON.parse(guardedModel.errorJson) as unknown : null
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) error = parsed as Record<string, unknown>
      } catch { return null }
      const errorCode = error.code
      if (errorCode !== 'chapter-draft-too-long' && errorCode !== 'chapter-draft-too-short') return null
      const legacyErrorCode: LegacyLengthDraftRecovery['originalErrorCode'] = errorCode

      let parsedOutput: Record<string, unknown> | null = null
      try {
        const parsed = guardedModel.outputJson ? JSON.parse(guardedModel.outputJson) as unknown : null
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsedOutput = parsed as Record<string, unknown>
      } catch { parsedOutput = null }
      const outputManuscript = typeof parsedOutput?.manuscript === 'string' && parsedOutput.manuscript.trim() ? parsedOutput.manuscript : null
      const source: LegacyLengthDraftRecovery['source'] = outputManuscript ? 'output-json' : 'streamed-text'
      const manuscript = outputManuscript ?? guardedModel.streamedText
      if (!manuscript.trim()) return null

      const { modelSnapshot } = this.assertLegacyDraftRecoveryAuthority(run, workflow, guardedModel, null)

      const rawTargetWords = typeof modelSnapshot.effectiveTargetWords === 'number' ? modelSnapshot.effectiveTargetWords
        : typeof error.targetWords === 'number' ? error.targetWords : DEFAULT_CHAPTER_TARGET_WORDS
      const targetWords = Number.isFinite(rawTargetWords) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(rawTargetWords))) : DEFAULT_CHAPTER_TARGET_WORDS
      const actualWords = manuscriptWordCount(manuscript)
      const lengthAdvisory = chapterDraftLengthAdvisory(targetWords, actualWords)
      const recoveredOutput = {
        manuscript,
        canonCandidates: [],
        _novelStudioLegacyRecovery: {
          recovered: true,
          source,
          originalErrorCode: legacyErrorCode,
          originalModelRunId: guardedModel.id,
          canonCandidatesDiscarded: true,
        },
        _novelStudioLengthAdvisory: lengthAdvisory,
      }
      const versionId = id('version')
      const timestamp = now()
      this.db.prepare(`INSERT INTO manuscript_versions(id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,prompt_asset_version_id,model_run_id,workflow_run_id,workflow_node_run_id,created_at)
        VALUES (?,?,?,?,'draft',?,?,?,'model','model',?,?,?,?,?)`).run(versionId, run.projectId, run.chapterId, guardedModel.inputManuscriptVersionId, manuscript, createHash('sha256').update(manuscript).digest('hex'), actualWords, guardedModel.promptAssetVersionId, guardedModel.id, workflowRunId, nodeRunId, timestamp)
      const chapterChanged = this.db.prepare('UPDATE chapters SET current_draft_version_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(versionId, timestamp, run.chapterId, guardedModel.chapterRevision)
      const projectChanged = this.db.prepare("UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='active'").run(timestamp, run.projectId, guardedModel.projectRevision)
      const modelChanged = this.db.prepare("UPDATE model_runs SET status='succeeded',streamed_text=?,streamed_text_updated_at=?,output_json=?,error_json=NULL WHERE id=? AND status='failed'").run(manuscript, timestamp, JSON.stringify(recoveredOutput), guardedModel.id)
      if (Number(chapterChanged.changes) !== 1 || Number(projectChanged.changes) !== 1 || Number(modelChanged.changes) !== 1) {
        throw new DomainError('revision-conflict', '恢复旧版正文时检测到并发变更，旧输出未应用。')
      }
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.legacy_draft.recovered', {
        modelRunId: guardedModel.id, manuscriptVersionId: versionId, originalErrorCode: legacyErrorCode, source, targetWords, actualWords,
      })
      manuscriptToMirror = manuscript
      return { modelRunId: guardedModel.id, manuscriptVersionId: versionId, originalErrorCode: legacyErrorCode, source, lengthAdvisory }
    })
    if (recovery && manuscriptToMirror) this.syncChapterMarkdown(run.chapterId, manuscriptToMirror, 'draft')
    if (recovery) this.refreshProjectRecoveryCapsules(run.projectId)
    return recovery
  }

  listModelRuns(chapterId: string): ModelRun[] {
    return (this.db.prepare('SELECT * FROM model_runs WHERE chapter_id=? ORDER BY created_at DESC').all(chapterId) as Row[]).map(modelRunFrom)
  }

  getChapterGenerationSources(chapterId: string): GenerationSources {
    this.getChapter(chapterId)
    const row = this.db.prepare("SELECT * FROM model_runs WHERE chapter_id=? AND purpose='chapter-draft' ORDER BY created_at DESC LIMIT 1").get(chapterId) as Row | undefined
    if (!row) return { modelRunId: null, purpose: 'chapter-draft', status: 'unavailable', createdAt: null, items: [], truncated: false }

    const run = modelRunFrom(row)
    const snapshot = (() => {
      try {
        const value = JSON.parse(run.inputSnapshotJson) as unknown
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      } catch { return {} }
    })()
    const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') as string[] : []
    const trace = snapshot.promptAssemblyTrace && typeof snapshot.promptAssemblyTrace === 'object' && !Array.isArray(snapshot.promptAssemblyTrace)
      ? snapshot.promptAssemblyTrace as Record<string, unknown> : null
    const traceSections = Array.isArray(trace?.sections) ? trace.sections.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>> : []
    const includedSourceIds = new Set(traceSections.filter(section => section.included === true).flatMap(section => stringArray(section.sourceIds)))
    const hasTrace = traceSections.length > 0
    const wasIncluded = (sourceIds: string[]): boolean => !hasTrace || sourceIds.some(sourceId => includedSourceIds.has(sourceId))
    const exclusionReason = (sourceIds: string[]): string | undefined => {
      const section = traceSections.find(value => value.included !== true && stringArray(value.sourceIds).some(sourceId => sourceIds.includes(sourceId)))
      return typeof section?.reason === 'string' ? section.reason : undefined
    }
    const items: GenerationSources['items'] = []
    const itemIndexById = new Map<string, number>()
    const labelCounts = new Map<string, number>()
    const add = (sourceId: string, label: string, kind: GenerationSources['items'][number]['kind'], detail?: string, used = true): void => {
      const normalizedLabel = label.trim()
      if (!normalizedLabel) return
      const existingIndex = itemIndexById.get(sourceId)
      if (existingIndex !== undefined) {
        const existing = items[existingIndex]!
        if (used && !existing.used) items[existingIndex] = { ...existing, used: true, ...(detail ? { detail } : {}) }
        return
      }
      const duplicateIndex = labelCounts.get(normalizedLabel) ?? 0
      labelCounts.set(normalizedLabel, duplicateIndex + 1)
      const displayLabel = duplicateIndex === 0 ? normalizedLabel : `${normalizedLabel} · ${sourceId.slice(-8)}`
      itemIndexById.set(sourceId, items.length)
      items.push({ id: sourceId, label: displayLabel, ...(detail ? { detail } : {}), kind, used })
    }

    const foundationLabels: Record<string, string> = { outline: '全书大纲', characters: '人物体系', worldbuilding: '世界观与规则', timeline: '故事时间线', foreshadowing: '伏笔与回收计划' }
    const foundationIds = stringArray(snapshot.foundationVersionIds)
    if (foundationIds.length) {
      const rows = this.db.prepare(`SELECT * FROM project_foundation_versions WHERE id IN (${foundationIds.map(() => '?').join(',')})`).all(...foundationIds) as Row[]
      const byId = new Map(rows.map(value => [String(value.id), value]))
      for (const foundationId of foundationIds) {
        const foundation = byId.get(foundationId)
        if (!foundation) continue
        const kind = String(foundation.foundation_kind)
        const foundationSourceIds = [foundationId]
        const used = wasIncluded(foundationSourceIds)
        add(
          `foundation:${foundationId}`,
          `${foundationLabels[kind] ?? '创作基建'} v${Number(foundation.version)}`,
          'foundation',
          used ? '已批准版本' : `已批准版本 · ${exclusionReason(foundationSourceIds) ?? '未进入本次 Prompt'}`,
          used,
        )
      }
    }

    const summaryIds = stringArray((snapshot.continuity && typeof snapshot.continuity === 'object' && !Array.isArray(snapshot.continuity))
      ? (snapshot.continuity as Record<string, unknown>).priorChapterSummaryIds : undefined)
    const approvedVersionIds = stringArray((snapshot.continuity && typeof snapshot.continuity === 'object' && !Array.isArray(snapshot.continuity))
      ? (snapshot.continuity as Record<string, unknown>).priorApprovedVersionIds : undefined)
    const summaryChapterIds = new Set<string>()
    for (const summaryId of summaryIds) {
      const summary = this.db.prepare(`SELECT ks.id,ks.source_id,ks.source_version_id,c.chapter_number,c.title FROM knowledge_summaries ks LEFT JOIN chapters c ON c.id=ks.source_id WHERE ks.id=?`).get(summaryId) as Row | undefined
      if (!summary) continue
      const chapterNumber = summary.chapter_number === null || summary.chapter_number === undefined ? null : Number(summary.chapter_number)
      const label = chapterNumber === null ? '前文摘要' : `第 ${chapterNumber} 章摘要`
      const sourceIds = [summaryId, String(summary.source_id), ...(summary.source_version_id ? [String(summary.source_version_id)] : [])]
      if (chapterNumber !== null) summaryChapterIds.add(String(summary.source_id))
      add(`summary:${summaryId}`, label, 'chapter-summary', summary.title ? String(summary.title) : undefined, wasIncluded(sourceIds))
    }
    for (const versionId of approvedVersionIds) {
      const version = this.db.prepare('SELECT m.id,c.id chapter_id,c.chapter_number,c.title FROM manuscript_versions m JOIN chapters c ON c.id=m.chapter_id WHERE m.id=?').get(versionId) as Row | undefined
      if (!version || summaryChapterIds.has(String(version.chapter_id))) continue
      add(`summary-version:${versionId}`, `第 ${Number(version.chapter_number)} 章摘要`, 'chapter-summary', String(version.title), wasIncluded([versionId, String(version.chapter_id)]))
    }

    const retrievalBundleId = typeof snapshot.retrievalBundleId === 'string' ? snapshot.retrievalBundleId : null
    let truncated = false
    if (retrievalBundleId) {
      try {
        const retrieval = this.getRetrievalBundle(retrievalBundleId)
        truncated = retrieval.truncated
        for (const item of retrieval.items) {
          const sourceIds = [item.id, item.sourceId, ...(item.sourceVersionId ? [item.sourceVersionId] : [])]
          const traceKey = `retrieval:${item.id}`
          const exactTrace = traceSections.find(section => section.key === traceKey)
          const used = exactTrace ? exactTrace.included === true : wasIncluded(sourceIds)
          const exactExclusionReason = typeof exactTrace?.reason === 'string' ? exactTrace.reason : exclusionReason(sourceIds)
          const kind = item.kind === 'canon_fact' ? 'canon' : item.kind === 'approved_excerpt' ? 'approved-excerpt' : item.kind === 'historical_summary' ? 'historical' : 'long-memory'
          let label = item.citationLabel
          let detail = item.sourceProjectTitle
          if (item.kind === 'summary') {
            const summary = this.db.prepare(`SELECT ks.summary_scope,c.chapter_number,c.title FROM knowledge_summaries ks LEFT JOIN chapters c ON c.id=ks.source_id WHERE ks.id=?`).get(item.sourceId) as Row | undefined
            if (summary?.summary_scope === 'chapter' && summary.chapter_number !== null && summary.chapter_number !== undefined) {
              label = `第 ${Number(summary.chapter_number)} 章摘要`
              detail = summary.title ? String(summary.title) : item.sourceProjectTitle
            } else if (summary?.summary_scope) {
              const scopeLabel: Record<string, string> = { foundation: '创作基建精炼摘要', project: '全书滚动摘要', book: '全书摘要', volume: '当前卷摘要', arc: '当前阶段摘要' }
              label = scopeLabel[String(summary.summary_scope)] ?? item.citationLabel
            }
          } else if (item.kind === 'approved_excerpt') {
            const version = this.db.prepare('SELECT c.chapter_number,c.title FROM manuscript_versions m JOIN chapters c ON c.id=m.chapter_id WHERE m.id=?').get(item.sourceVersionId ?? item.sourceId) as Row | undefined
            if (version) { label = `批准正文 · 第 ${Number(version.chapter_number)} 章`; detail = version.title ? String(version.title) : item.sourceProjectTitle }
          }
          add(traceKey, label, kind, used ? detail : [detail, exactExclusionReason ?? '未进入本次 Prompt'].filter(Boolean).join(' · '), used)
        }
      } catch {
        // A legacy run may point at a removed or incomplete retrieval bundle. Keep the run trace visible.
      }
    }

    const memoryCategoryLabels: Record<string, string> = {
      continuity: '连续性', constraint: '硬约束', character: '人物', world: '世界规则', timeline: '时间线',
      foreshadowing: '伏笔', idea: '灵感', research: '研究', other: '其他',
    }
    const memoryScopeLabels: Record<string, string> = {
      foundation: '创作基建', chapter: '章节', arc: '阶段', volume: '卷', book: '全书', project: '项目',
    }
    const memoryUsages = this.db.prepare(`SELECT mu.*,mi.origin,mi.scope,mi.category,mr.revision memory_revision
      FROM memory_usage_events mu JOIN memory_items mi ON mi.id=mu.item_id JOIN memory_revisions mr ON mr.id=mu.revision_id
      WHERE mu.model_run_id=? AND (mu.included=1 OR mu.section_key<>'') ORDER BY mu.created_at,mu.id`).all(run.id) as Row[]
    for (const usage of memoryUsages) {
      const origin = String(usage.origin)
      const scope = String(usage.scope)
      const category = String(usage.category)
      const included = Number(usage.included) === 1
      const truncatedMemory = Number(usage.truncated) === 1
      const label = origin === 'derived'
        ? `${memoryScopeLabels[scope] ?? scope}精炼记忆`
        : category === 'constraint' ? '作者硬约束 · constraint' : `作者记忆 · ${memoryCategoryLabels[category] ?? category}`
      const detail = [
        `v${Number(usage.memory_revision)}`,
        `${Number(usage.estimated_tokens)} tokens`,
        truncatedMemory ? '已截断' : null,
        String(usage.reason || (included ? '已进入本次 Prompt' : '未进入本次 Prompt')),
      ].filter(Boolean).join(' · ')
      add(`memory:${String(usage.item_id)}:${String(usage.revision_id)}`, label, 'memory', detail, included)
    }

    const style = snapshot.styleProfile && typeof snapshot.styleProfile === 'object' && !Array.isArray(snapshot.styleProfile) ? snapshot.styleProfile as Record<string, unknown> : null
    if (style) {
      const name = typeof style.name === 'string' && style.name.trim() ? style.name.trim() : null
      const profileId = typeof style.profileId === 'string' ? style.profileId : 'unknown'
      const revision = typeof style.revision === 'number' ? `v${style.revision}` : undefined
      add(`style:${profileId}`, name ? `项目文风：${name}` : '项目文风（生成时配置）', 'style', revision)
    }

    const filesystemMemory = Array.isArray(snapshot.filesystemMemory) ? snapshot.filesystemMemory.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>> : []
    for (const file of filesystemMemory) {
      const name = typeof file.name === 'string' ? file.name : 'memory.md'
      add(`filesystem:${name}`, `项目 memory：${name}`, 'filesystem-memory', `${typeof file.hash === 'string' ? `hash ${file.hash.slice(0, 8)} · ` : ''}只检测文件变化；原始 Markdown 不会绕过 Memory Browser 直接进入 Prompt`, false)
    }

    for (const section of traceSections) {
      if (section.included !== true && typeof section.reason === 'string' && section.reason.includes('预算')) truncated = true
      const key = typeof section.key === 'string' ? section.key : ''
      if (key.startsWith('foundation') || key.startsWith('continuity:') || key.startsWith('retrieval:') || key.startsWith('memory:') || key.startsWith('filesystem:')) continue
      const label = typeof section.label === 'string' ? section.label : ''
      if (label) add(`trace:${key}`, label, 'long-memory', typeof section.reason === 'string' ? section.reason : undefined, section.included === true)
    }

    return { modelRunId: run.id, purpose: 'chapter-draft', status: run.status, createdAt: run.createdAt, items, truncated }
  }

  private chapterBatchItemFrom(row: Row): ChapterBatchItem {
    const workflowRunId = row.workflow_run_id === null ? null : String(row.workflow_run_id)
    return {
      id: String(row.id), batchId: String(row.batch_id), chapterId: row.chapter_id === null ? null : String(row.chapter_id),
      position: Number(row.position), plannedTitle: String(row.planned_title), writingGoal: String(row.writing_goal),
      openingContinuity: String(row.opening_continuity), endingHook: String(row.ending_hook), targetWords: Number(row.target_words),
      queueState: row.queue_state as ChapterBatchItem['queueState'], workflowRunId,
      workflow: workflowRunId ? this.getWorkflowRun(workflowRunId) : null,
      chapterRevisionAtEnqueue: row.chapter_revision_at_enqueue === null ? null : Number(row.chapter_revision_at_enqueue),
      blockedReason: row.blocked_reason === null ? null : String(row.blocked_reason), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  private chapterBatchPlanFrom(row: Row): ChapterBatchPlan {
    return {
      id: String(row.id), batchId: String(row.batch_id), status: row.status as ChapterBatchPlan['status'],
      provider: String(row.provider), model: String(row.model), promptHash: String(row.prompt_hash), inputSnapshotJson: String(row.input_snapshot_json),
      outputJson: row.output_json === null ? null : String(row.output_json), streamedText: String(row.streamed_text),
      errorJson: row.error_json === null ? null : String(row.error_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at),
    }
  }

  getChapterBatch(batchId: string): ChapterGenerationBatch {
    const row = this.one(this.db.prepare('SELECT * FROM chapter_generation_batches WHERE id=?'), batchId)
    const planRow = this.db.prepare('SELECT * FROM chapter_generation_batch_plans WHERE batch_id=?').get(batchId) as Row | undefined
    return {
      id: String(row.id), projectId: String(row.project_id), mode: row.mode as ChapterGenerationBatch['mode'],
      automationMode: row.automation_mode as AutomationMode, status: row.status as ChapterGenerationBatch['status'],
      requestedCount: Number(row.requested_count), policyJson: String(row.policy_json), revision: Number(row.revision),
      errorJson: row.error_json === null ? null : String(row.error_json), plan: planRow ? this.chapterBatchPlanFrom(planRow) : null,
      items: (this.db.prepare('SELECT * FROM chapter_generation_batch_items WHERE batch_id=? ORDER BY position').all(batchId) as Row[]).map(item => this.chapterBatchItemFrom(item)),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), startedAt: row.started_at === null ? null : String(row.started_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at),
    }
  }

  listChapterBatches(projectId: string): ChapterGenerationBatch[] {
    this.getProjectTree(projectId)
    return (this.db.prepare('SELECT id FROM chapter_generation_batches WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Row[])
      .map(row => this.getChapterBatch(String(row.id)))
  }

  createChapterBatch(projectId: string, input: { mode: 'selected' | 'continuous'; automationMode: AutomationMode; chapterIds?: string[]; startChapterId?: string; count: number }, selection: ModelSelection, projectRevision: number): ChapterGenerationBatch {
    const project = this.assertProjectRevision(projectId, projectRevision)
    const count = Math.trunc(input.count)
    if (count < 1 || count > 20) throw new DomainError('validation', '单批章节数量必须在 1 到 20 之间。')
    if (!['auto', 'yolo'].includes(input.automationMode)) throw new DomainError('validation', '批次自动化模式无效。')
    const selectedChapterIds = [...new Set(input.chapterIds ?? [])]
    if (input.mode === 'selected') {
      if (selectedChapterIds.length !== count) throw new DomainError('validation', '选章模式的章节数必须与批次数量一致，且不能重复。')
      for (const chapterId of selectedChapterIds) if (this.getChapter(chapterId).projectId !== projectId) throw new DomainError('validation', '所选章节必须属于同一项目。')
    } else {
      if (!input.startChapterId) throw new DomainError('validation', '连续生成必须指定起始章节。')
      if (this.getChapter(input.startChapterId).projectId !== projectId) throw new DomainError('validation', '起始章节不属于当前项目。')
    }
    if (!selection.provider.trim() || !selection.model.trim()) throw new DomainError('validation', '批次规划需要有效的模型选择。')
    const foundation = this.getProjectFoundation(projectId)
    const style = this.getProjectStyleProfile(projectId)
    const batchId = id('chapter-batch'), planId = id('chapter-batch-plan'), timestamp = now()
    const policy = {
      selectedChapterIds, startChapterId: input.startChapterId ?? null, createdProjectRevision: project.revision,
      foundationAssemblyHash: foundation.assemblyHash, styleRevision: style.revision,
      requiresSecondConfirmation: count >= 10 || input.automationMode === 'yolo', selection,
    }
    const inputSnapshot = { projectId, mode: input.mode, count, automationMode: input.automationMode, policy }
    this.activeProjectTransaction(projectId, () => {
      this.assertProjectWorkflowSlot(projectId)
      this.db.prepare(`INSERT INTO chapter_generation_batches(id,project_id,mode,automation_mode,status,requested_count,policy_json,revision,created_at,updated_at)
        VALUES (?,?,?,?,'planning',?,?,0,?,?)`).run(batchId, projectId, input.mode, input.automationMode, count, JSON.stringify(policy), timestamp, timestamp)
      this.db.prepare(`INSERT INTO chapter_generation_batch_plans(id,batch_id,status,provider,model,prompt_hash,input_snapshot_json,streamed_text,created_at,updated_at)
        VALUES (?,?,'planning',?,?,?,?,'',?,?)`).run(planId, batchId, selection.provider, selection.model, '', JSON.stringify(inputSnapshot), timestamp, timestamp)
      this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)')
        .run(id('chapter-batch-event'), batchId, 'batch.created', JSON.stringify({ mode: input.mode, count, automationMode: input.automationMode }), timestamp)
      this.bumpProjectRevision(projectId, projectRevision, timestamp)
    })
    return this.getChapterBatch(batchId)
  }

  completeChapterBatchPlan(batchId: string, items: Array<Pick<ChapterBatchItem, 'chapterId' | 'plannedTitle' | 'writingGoal' | 'openingContinuity' | 'endingHook' | 'targetWords'>>, trace: { promptHash: string; outputJson: string; streamedText?: string; inputSnapshotJson?: string }): ChapterGenerationBatch {
    const batch = this.getChapterBatch(batchId)
    this.assertProjectActive(batch.projectId)
    if (batch.status !== 'planning' || batch.plan?.status !== 'planning') throw new DomainError('invalid-state', '批次规划已结束，不能重复写入。')
    if (items.length !== batch.requestedCount) throw new DomainError('validation', `批次规划必须返回 ${batch.requestedCount} 章。`)
    const policy = JSON.parse(batch.policyJson) as { selectedChapterIds?: string[] }
    const normalized = items.map((item, index) => {
      const chapterId = batch.mode === 'selected' ? (item.chapterId ?? policy.selectedChapterIds?.[index] ?? null) : null
      if (chapterId && this.getChapter(chapterId).projectId !== batch.projectId) throw new DomainError('validation', '规划章节不属于当前项目。')
      const title = item.plannedTitle.trim()
      if (!title) throw new DomainError('validation', `第 ${index + 1} 章标题不能为空。`)
      const targetWords = item.targetWords
      if (!Number.isSafeInteger(targetWords) || targetWords < 1) throw new DomainError('validation', '目标字数必须是正整数。')
      return { ...item, chapterId, plannedTitle: title, targetWords }
    })
    const timestamp = now()
    this.activeProjectTransaction(batch.projectId, () => {
      const current = this.one(this.db.prepare(`SELECT b.status batch_status,p.status plan_status
        FROM chapter_generation_batches b JOIN chapter_generation_batch_plans p ON p.batch_id=b.id WHERE b.id=?`), batchId)
      if (current.batch_status !== 'planning' || current.plan_status !== 'planning') {
        throw new DomainError('invalid-state', '批次规划状态已变化，迟到的模型结果不会写入。')
      }
      this.db.prepare('DELETE FROM chapter_generation_batch_items WHERE batch_id=?').run(batchId)
      normalized.forEach((item, index) => this.db.prepare(`INSERT INTO chapter_generation_batch_items(
        id,batch_id,chapter_id,position,planned_title,writing_goal,opening_continuity,ending_hook,target_words,queue_state,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'planned',?,?)`).run(
        id('chapter-batch-item'), batchId, item.chapterId, index + 1, item.plannedTitle, item.writingGoal.trim(), item.openingContinuity.trim(), item.endingHook.trim(), item.targetWords, timestamp, timestamp,
      ))
      const planChanged = this.db.prepare("UPDATE chapter_generation_batch_plans SET status='succeeded',prompt_hash=?,input_snapshot_json=COALESCE(?,input_snapshot_json),output_json=?,streamed_text=?,error_json=NULL,updated_at=?,finished_at=? WHERE batch_id=? AND status='planning'")
        .run(trace.promptHash, trace.inputSnapshotJson ?? null, trace.outputJson, trace.streamedText ?? '', timestamp, timestamp, batchId)
      const batchChanged = this.db.prepare("UPDATE chapter_generation_batches SET status='awaiting_plan_approval',revision=revision+1,error_json=NULL,updated_at=? WHERE id=? AND status='planning'").run(timestamp, batchId)
      if (Number(planChanged.changes) !== 1 || Number(batchChanged.changes) !== 1) throw new DomainError('invalid-state', '批次规划状态已变化，迟到的模型结果不会写入。')
      this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)')
        .run(id('chapter-batch-event'), batchId, 'plan.succeeded', JSON.stringify({ itemCount: normalized.length }), timestamp)
    })
    return this.getChapterBatch(batchId)
  }

  failChapterBatchPlan(batchId: string, error: unknown): ChapterGenerationBatch {
    const batch = this.getChapterBatch(batchId)
    this.assertProjectActive(batch.projectId)
    const errorJson = JSON.stringify(error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) })
    const timestamp = now()
    this.activeProjectTransaction(batch.projectId, () => {
      const current = this.one(this.db.prepare(`SELECT b.status batch_status,p.status plan_status
        FROM chapter_generation_batches b JOIN chapter_generation_batch_plans p ON p.batch_id=b.id WHERE b.id=?`), batchId)
      if (current.batch_status !== 'planning' || current.plan_status !== 'planning') return
      const planChanged = this.db.prepare("UPDATE chapter_generation_batch_plans SET status='failed',error_json=?,updated_at=?,finished_at=? WHERE batch_id=? AND status='planning'").run(errorJson, timestamp, timestamp, batchId)
      const batchChanged = this.db.prepare("UPDATE chapter_generation_batches SET status='blocked',revision=revision+1,error_json=?,updated_at=? WHERE id=? AND status='planning'").run(errorJson, timestamp, batchId)
      if (Number(planChanged.changes) !== 1 || Number(batchChanged.changes) !== 1) throw new DomainError('invalid-state', '批次规划失败状态未能原子写入。')
      this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)').run(id('chapter-batch-event'), batchId, 'plan.failed', errorJson, timestamp)
    })
    return this.getChapterBatch(batchId)
  }

  approveChapterBatchPlan(batchId: string, items: Array<Pick<ChapterBatchItem, 'id' | 'plannedTitle' | 'writingGoal' | 'openingContinuity' | 'endingHook' | 'targetWords'>>, baseRevision: number): ChapterGenerationBatch {
    const batch = this.getChapterBatch(batchId)
    this.assertProjectRevision(batch.projectId, baseRevision)
    if (batch.status !== 'awaiting_plan_approval' || batch.plan?.status !== 'succeeded') throw new DomainError('invalid-state', '批次计划当前不可批准。')
    let frozenSnapshot: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(batch.plan.inputSnapshotJson) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frozenSnapshot = parsed as Record<string, unknown>
    } catch { frozenSnapshot = null }
    if (frozenSnapshot?.schemaVersion === 2 && frozenSnapshot.purpose === 'chapter-batch-plan') {
      const foundation = this.getProjectFoundation(batch.projectId)
      const style = this.getProjectStyleProfile(batch.projectId)
      if (foundation.assemblyHash !== frozenSnapshot.foundationAssemblyHash || style.revision !== frozenSnapshot.styleRevision) {
        throw new DomainError('revision-conflict', '批次规划后创作基建或项目文风已变化，请重新规划。')
      }
      const targets = Array.isArray(frozenSnapshot.targets) ? frozenSnapshot.targets : []
      if (targets.length !== (batch.mode === 'selected' ? batch.requestedCount : 1)) throw new DomainError('invalid-state', '批次规划输入快照缺少目标章节。')
      const tree = this.getProjectTree(batch.projectId)
      const storyOrder = new Map<string, number>()
      tree.books.forEach((book, bookIndex) => book.volumes.forEach(volume => volume.chapters.forEach(chapter => {
        storyOrder.set(chapter.id, bookIndex * 1_000_000 + chapter.chapterNumber * 1000)
      })))
      const knowledge = this.getKnowledgeWorkspace(batch.projectId)
      const stable = (values: string[]) => JSON.stringify([...values].sort())
      for (const rawTarget of targets) {
        if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) throw new DomainError('invalid-state', '批次规划目标快照损坏。')
        const target = rawTarget as Record<string, unknown>
        const chapterId = typeof target.chapterId === 'string' ? target.chapterId : ''
        const context = this.getGenerationContext(chapterId, 'scene-plan')
        const currentStoryOrder = storyOrder.get(chapterId) ?? context.chapter.chapterNumber * 1000
        if (context.chapter.revision !== target.chapterRevision || context.chapter.currentApprovedVersionId !== (target.currentApprovedVersionId ?? null) || currentStoryOrder !== target.storyOrder) {
          throw new DomainError('revision-conflict', '批次规划后目标章节或批准正文已变化，请重新规划。')
        }
        const authority = target.authoritySnapshot && typeof target.authoritySnapshot === 'object' && !Array.isArray(target.authoritySnapshot)
          ? target.authoritySnapshot as Record<string, unknown> : null
        const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') as string[] : []
        if (!authority) throw new DomainError('invalid-state', '批次规划缺少权威来源快照。')
        const boundary = batch.mode === 'continuous' ? currentStoryOrder : currentStoryOrder - 1
        const currentCanon = knowledge.canonFacts.filter(fact => (storyOrder.get(fact.chapterId) ?? Number.MAX_SAFE_INTEGER) <= boundary).map(fact => fact.id)
        const currentMemory = (context.authorMemory ?? []).filter(memory => memory.state === 'active' && memory.promptPolicy === 'auto').map(memory => `${memory.id}:${memory.currentRevision.id}`)
        const currentLongMemory = context.longMemory.map(summary => `${summary.id}:${summary.contentHash}`)
        const currentRelationships = (context.confirmedRelationships ?? []).filter(relation => relation.status === 'active').map(relation => relation.id)
        const currentPriorVersions = context.priorChapterSummaries.map(summary => summary.approvedVersionId)
        if (
          stable(currentCanon) !== stable(strings(authority.canonFactIds))
          || stable(currentMemory) !== stable(strings(authority.authorMemoryRevisions))
          || stable(currentLongMemory) !== stable(strings(authority.longMemoryRevisions))
          || stable(currentRelationships) !== stable(strings(authority.confirmedRelationshipIds))
          || stable(currentPriorVersions) !== stable(strings(authority.priorApprovedVersionIds))
        ) throw new DomainError('revision-conflict', '批次规划后 Canon、记忆或确认关系已变化，请重新规划。')
      }
    }
    if (items.length !== batch.items.length || new Set(items.map(item => item.id)).size !== batch.items.length) throw new DomainError('validation', '批准内容必须覆盖批次中的全部章节。')
    const edits = new Map(items.map(item => [item.id, item]))
    if (batch.items.some(item => !edits.has(item.id))) throw new DomainError('validation', '批准内容缺少批次章节。')
    const policy = JSON.parse(batch.policyJson) as { startChapterId?: string | null }
    const start = batch.mode === 'continuous' && policy.startChapterId ? this.getChapter(policy.startChapterId) : null
    const timestamp = now()
    this.activeProjectTransaction(batch.projectId, () => {
      let nextChapterNumber = start ? Number((this.db.prepare('SELECT COALESCE(MAX(chapter_number),0)+1 value FROM chapters WHERE book_id=?').get(start.bookId) as Row).value) : 0
      for (const item of batch.items) {
        const edit = edits.get(item.id)!
        const title = edit.plannedTitle.trim()
        const targetWords = edit.targetWords
        if (!title || !Number.isSafeInteger(targetWords) || targetWords < 1) throw new DomainError('validation', '批次标题或目标字数无效。')
        let chapterId = item.chapterId
        if (!chapterId) {
          if (!start) throw new DomainError('invalid-state', '连续批次缺少有效起始章节。')
          chapterId = id('chapter')
          this.db.prepare(`INSERT INTO chapters(id,project_id,book_id,volume_id,chapter_number,title,status,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,?,'draft',0,?,?)`).run(chapterId, batch.projectId, start.bookId, start.volumeId, nextChapterNumber++, title, timestamp, timestamp)
        } else {
          const chapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), chapterId))
          if (chapter.projectId !== batch.projectId) throw new DomainError('validation', '批次章节不属于当前项目。')
          this.db.prepare('UPDATE chapters SET title=?,revision=revision+1,updated_at=? WHERE id=?').run(title, timestamp, chapterId)
        }
        const chapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), chapterId))
        this.db.prepare(`UPDATE chapter_generation_batch_items SET chapter_id=?,planned_title=?,writing_goal=?,opening_continuity=?,ending_hook=?,target_words=?,queue_state='queued',chapter_revision_at_enqueue=?,blocked_reason=NULL,updated_at=? WHERE id=?`)
          .run(chapterId, title, edit.writingGoal.trim(), edit.openingContinuity.trim(), edit.endingHook.trim(), targetWords, chapter.revision, timestamp, item.id)
        this.db.prepare(`INSERT INTO chapter_writing_briefs(chapter_id,writing_goal,opening_continuity,ending_hook,target_words,source,revision,batch_item_id,provider,model,prompt_hash,updated_at)
          VALUES (?,?,?,?,?,'batch-plan',1,?,?,?,?,?) ON CONFLICT(chapter_id) DO UPDATE SET writing_goal=excluded.writing_goal,opening_continuity=excluded.opening_continuity,ending_hook=excluded.ending_hook,target_words=excluded.target_words,source='batch-plan',revision=chapter_writing_briefs.revision+1,batch_item_id=excluded.batch_item_id,provider=excluded.provider,model=excluded.model,prompt_hash=excluded.prompt_hash,updated_at=excluded.updated_at`)
          .run(chapterId, edit.writingGoal.trim(), edit.openingContinuity.trim(), edit.endingHook.trim(), targetWords, item.id, batch.plan!.provider, batch.plan!.model, batch.plan!.promptHash, timestamp)
      }
      this.db.prepare("UPDATE chapter_generation_batches SET status='queued',revision=revision+1,error_json=NULL,updated_at=? WHERE id=?").run(timestamp, batchId)
      this.bumpProjectRevision(batch.projectId, baseRevision, timestamp)
      this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)').run(id('chapter-batch-event'), batchId, 'plan.approved', '{}', timestamp)
    })
    return this.getChapterBatch(batchId)
  }

  reorderChapterBatch(batchId: string, itemIds: string[], baseRevision: number): ChapterGenerationBatch {
    const batch = this.getChapterBatch(batchId)
    this.assertProjectRevision(batch.projectId, baseRevision)
    if (batch.mode !== 'selected') throw new DomainError('invalid-state', '连续生成锁定故事顺序，不能调整队列。')
    const reordered = reorderChapterBatchItems(batch.items, itemIds)
    const timestamp = now()
    this.activeProjectTransaction(batch.projectId, () => {
      // v17 reserves 21..40 as an in-transaction staging range so the
      // UNIQUE(batch_id, position) constraint remains valid during a reorder.
      for (const item of batch.items) this.db.prepare('UPDATE chapter_generation_batch_items SET position=position+20 WHERE id=?').run(item.id)
      for (const item of reordered) this.db.prepare('UPDATE chapter_generation_batch_items SET position=?,updated_at=? WHERE id=?').run(item.position, timestamp, item.id)
      this.db.prepare('UPDATE chapter_generation_batches SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, batchId)
      this.bumpProjectRevision(batch.projectId, baseRevision, timestamp)
    })
    return this.getChapterBatch(batchId)
  }

  setChapterBatchStatus(batchId: string, action: 'start' | 'pause' | 'resume' | 'cancel', projectRevision: number): ChapterGenerationBatch {
    const batch = this.getChapterBatch(batchId)
    this.assertProjectRevision(batch.projectId, projectRevision)
    if (action === 'cancel' && ['succeeded', 'completed_with_skips', 'cancelled'].includes(batch.status)) return batch
    const timestamp = now()
    const changed = this.activeProjectTransaction(batch.projectId, () => {
      const currentBatch = this.one(this.db.prepare('SELECT status FROM chapter_generation_batches WHERE id=? AND project_id=?'), batchId, batch.projectId)
      if (action === 'cancel' && ['succeeded', 'completed_with_skips', 'cancelled'].includes(String(currentBatch.status))) return false
      if (action === 'start' || action === 'resume') {
        if (!['queued', 'paused', 'blocked', 'waiting_approval'].includes(batch.status)) throw new DomainError('invalid-state', '批次当前不能启动或继续。')
        const other = this.db.prepare("SELECT id FROM chapter_generation_batches WHERE project_id=? AND id<>? AND status IN ('running','waiting_approval','pause_requested') LIMIT 1").get(batch.projectId, batchId) as Row | undefined
        if (other) throw new DomainError('invalid-state', '同一项目已有运行中的章节批次。')
        const waitingApproval = action === 'resume' && batch.items.some(item => item.workflow?.status === 'waiting_approval')
        this.db.prepare("UPDATE chapter_generation_batches SET status=?,started_at=COALESCE(started_at,?),error_json=NULL,revision=revision+1,updated_at=? WHERE id=?").run(waitingApproval ? 'waiting_approval' : 'running', timestamp, timestamp, batchId)
      } else if (action === 'pause') {
        if (!['running', 'waiting_approval'].includes(batch.status)) throw new DomainError('invalid-state', '批次当前不能暂停。')
        const waitingApproval = batch.items.some(item => item.workflow?.status === 'waiting_approval')
        const running = batch.items.some(item => item.workflow?.status === 'running')
        this.db.prepare('UPDATE chapter_generation_batches SET status=?,revision=revision+1,updated_at=? WHERE id=?').run(waitingApproval || !running ? 'paused' : 'pause_requested', timestamp, batchId)
      } else {
        const activeWorkflowRows = this.db.prepare(`SELECT w.id
          FROM chapter_generation_batch_items i JOIN workflow_runs w ON w.id=i.workflow_run_id
          WHERE i.batch_id=? AND w.status IN ('running','paused','waiting_approval','cancel_requested')
          ORDER BY w.created_at`).all(batchId) as Row[]
        this.db.prepare("UPDATE chapter_generation_batches SET status='cancelled',revision=revision+1,updated_at=?,finished_at=? WHERE id=?").run(timestamp, timestamp, batchId)
        this.db.prepare("UPDATE chapter_generation_batch_plans SET status='cancelled',updated_at=?,finished_at=COALESCE(finished_at,?) WHERE batch_id=? AND status='planning'").run(timestamp, timestamp, batchId)
        this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='cancelled',updated_at=? WHERE batch_id=? AND queue_state IN ('planned','queued','blocked','dispatched')").run(timestamp, batchId)
        for (const row of activeWorkflowRows) {
          const workflowId = String(row.id)
          this.db.prepare("UPDATE workflow_node_runs SET status='cancelled',error_json=?,finished_at=? WHERE workflow_run_id=? AND status IN ('running','waiting_approval','failed_retryable')").run(JSON.stringify({ code: 'workflow-cancelled', message: '章节批次已取消。' }), timestamp, workflowId)
          this.db.prepare("UPDATE workflow_approvals SET status='rejected',decision_note='章节批次已取消。',decided_at=? WHERE workflow_run_id=? AND status='pending'").run(timestamp, workflowId)
          this.failRunningModelRunsForWorkflowUnchecked(workflowId, timestamp, 'workflow-cancelled', '章节批次已取消，模型结果不会写入。')
          this.db.prepare("UPDATE workflow_runs SET status='cancelled',current_node_key=NULL,error_json=NULL,finished_at=? WHERE id=? AND status IN ('running','paused','waiting_approval','cancel_requested')").run(timestamp, workflowId)
          this.addWorkflowEvent(workflowId, null, 'workflow.cancelled', { source: 'chapter-batch', batchId })
        }
      }
      this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)').run(id('chapter-batch-event'), batchId, `batch.${action}`, '{}', timestamp)
      this.bumpProjectRevision(batch.projectId, projectRevision, timestamp)
      return true
    })
    if (!changed) return this.getChapterBatch(batchId)
    return this.getChapterBatch(batchId)
  }

  setChapterBatchRuntimeStatus(batchId: string, status: ChapterBatchStatus): ChapterGenerationBatch {
    const batch = this.getChapterBatch(batchId)
    this.assertProjectActive(batch.projectId)
    const allowed: ChapterBatchStatus[] = ['planning', 'awaiting_plan_approval', 'queued', 'running', 'waiting_approval', 'pause_requested', 'paused', 'blocked', 'succeeded', 'completed_with_skips', 'cancelled']
    if (!allowed.includes(status)) throw new DomainError('validation', '批次运行状态无效。')
    if (status === 'planning' && batch.status === 'blocked' && batch.plan?.status === 'failed' && batch.items.length === 0) {
      const timestamp = now()
      this.activeProjectTransaction(batch.projectId, () => {
        this.db.prepare("UPDATE chapter_generation_batch_plans SET status='planning',prompt_hash='',output_json=NULL,streamed_text='',error_json=NULL,updated_at=?,finished_at=NULL WHERE batch_id=? AND status='failed'").run(timestamp, batchId)
        this.db.prepare("UPDATE chapter_generation_batches SET status='planning',error_json=NULL,revision=revision+1,updated_at=?,finished_at=NULL WHERE id=? AND status='blocked'").run(timestamp, batchId)
        this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)').run(id('chapter-batch-event'), batchId, 'plan.retry.requested', '{}', timestamp)
      })
      return this.getChapterBatch(batchId)
    }
    if (status === 'planning' && batch.status !== 'planning') throw new DomainError('invalid-state', '只有无章节项的失败规划可以重新进入规划。')
    if (batch.status === status) return batch
    if (['succeeded', 'completed_with_skips', 'cancelled'].includes(batch.status)) return batch
    const timestamp = now(), terminal = ['succeeded', 'completed_with_skips', 'cancelled'].includes(status)
    this.activeProjectTransaction(batch.projectId, () => this.db.prepare('UPDATE chapter_generation_batches SET status=?,revision=revision+1,updated_at=?,finished_at=CASE WHEN ?=1 THEN ? ELSE finished_at END WHERE id=?').run(status, timestamp, terminal ? 1 : 0, timestamp, batchId))
    return this.getChapterBatch(batchId)
  }

  dispatchNextBatchItem(batchId: string): { batch: ChapterGenerationBatch; workflow: WorkflowRun | null } {
    const batch = this.getChapterBatch(batchId)
    this.assertProjectActive(batch.projectId)
    if (batch.status !== 'running') return { batch, workflow: null }
    const active = batch.items.find(item => item.workflow && ['running', 'paused', 'waiting_approval', 'cancel_requested'].includes(item.workflow.status))
    if (active) return { batch, workflow: null }
    const next = batch.items.find(item => item.queueState === 'queued')
    if (!next?.chapterId) {
      const terminal = batch.items.every(item => item.queueState === 'skipped' || item.queueState === 'cancelled' || (item.workflow?.status === 'succeeded'))
      if (terminal) {
        const timestamp = now(), hasSkips = batch.items.some(item => item.queueState === 'skipped')
        this.activeProjectTransaction(batch.projectId, () => this.db.prepare('UPDATE chapter_generation_batches SET status=?,revision=revision+1,updated_at=?,finished_at=? WHERE id=?').run(hasSkips ? 'completed_with_skips' : 'succeeded', timestamp, timestamp, batchId))
      }
      return { batch: this.getChapterBatch(batchId), workflow: null }
    }
    const chapter = this.getChapter(next.chapterId)
    if (chapter.revision !== next.chapterRevisionAtEnqueue) {
      const timestamp = now(), reason = '章节已在入队后发生变化，请重新确认计划。'
      this.activeProjectTransaction(batch.projectId, () => {
        this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='blocked',blocked_reason=?,updated_at=? WHERE id=?").run(reason, timestamp, next.id)
        this.db.prepare("UPDATE chapter_generation_batches SET status='blocked',error_json=?,revision=revision+1,updated_at=? WHERE id=?").run(JSON.stringify({ message: reason }), timestamp, batchId)
      })
      return { batch: this.getChapterBatch(batchId), workflow: null }
    }
    const policy = JSON.parse(batch.policyJson) as { foundationAssemblyHash?: string; styleRevision?: number }
    const foundation = this.getProjectFoundation(batch.projectId), style = this.getProjectStyleProfile(batch.projectId)
    let driftReason: string | null = null
    if (foundation.assemblyHash !== policy.foundationAssemblyHash) driftReason = '创作基建已改变，批次快照失效。'
    else if (style.revision !== policy.styleRevision) driftReason = '写作风格已改变，批次快照失效。'
    if (driftReason) {
      const timestamp = now()
      this.activeProjectTransaction(batch.projectId, () => {
        this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='blocked',blocked_reason=?,updated_at=? WHERE id=?").run(driftReason, timestamp, next.id)
        this.db.prepare("UPDATE chapter_generation_batches SET status='blocked',error_json=?,revision=revision+1,updated_at=? WHERE id=?").run(JSON.stringify({ message: driftReason }), timestamp, batchId)
      })
      return { batch: this.getChapterBatch(batchId), workflow: null }
    }
    const project = this.getProjectTree(batch.projectId).project
    const timestamp = now(), workflowRunId = id('workflow-run'), selectionSnapshotId = id('knowledge-selection')
    const snapshot = {
      projectId: project.id, projectRevision: project.revision, chapterId: chapter.id, chapterRevision: chapter.revision,
      inputManuscriptVersionId: chapter.currentDraftVersionId ?? chapter.currentApprovedVersionId,
      foundationAssemblyHash: foundation.assemblyHash, styleRevision: style.revision,
      workflowDefinitionVersionId: CHAPTER_WORKFLOW_VERSION_ID, knowledgeSelectionSnapshotId: selectionSnapshotId, batchId, batchItemId: next.id,
    }
    const dispatchState = this.activeProjectTransaction(batch.projectId, () => {
      const currentBatch = this.one(this.db.prepare('SELECT status FROM chapter_generation_batches WHERE id=?'), batchId)
      if (String(currentBatch.status) !== 'running') return 'noop' as const
      const currentItem = this.one(this.db.prepare('SELECT queue_state,chapter_id FROM chapter_generation_batch_items WHERE id=? AND batch_id=?'), next.id, batchId)
      if (String(currentItem.queue_state) !== 'queued' || String(currentItem.chapter_id) !== chapter.id) return 'noop' as const

      const activeWorkflows = this.db.prepare(`SELECT w.id,i.batch_id
        FROM workflow_runs w
        LEFT JOIN chapter_generation_batch_items i ON i.workflow_run_id=w.id
        WHERE w.project_id=? AND w.status IN ('running','paused','waiting_approval','cancel_requested')
        ORDER BY w.created_at`).all(batch.projectId) as Row[]
      const foreignWorkflow = activeWorkflows.find(row => row.batch_id === null || String(row.batch_id) !== batchId)
      if (foreignWorkflow) {
        const reason = '项目已有非本批次的进行中、暂停中或待审章节工作流；批次已安全暂停，请处理该运行后继续。'
        const payload = JSON.stringify({ code: 'project-workflow-conflict', message: reason, workflowRunId: String(foreignWorkflow.id) })
        this.db.prepare("UPDATE chapter_generation_batches SET status='paused',error_json=?,revision=revision+1,updated_at=? WHERE id=? AND status='running'").run(payload, timestamp, batchId)
        this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)').run(id('chapter-batch-event'), batchId, 'batch.paused_for_project_workflow', payload, timestamp)
        return 'paused' as const
      }
      // A concurrent dispatcher may already have bound this batch's workflow.
      // It owns the project slot and must be allowed to continue unchanged.
      if (activeWorkflows.length > 0) return 'noop' as const
      this.assertProjectWorkflowSlot(batch.projectId, null, batchId)

      this.db.prepare('INSERT INTO knowledge_selection_snapshots(id,project_id,project_revision,excluded_source_ids_json,created_at) VALUES (?,?,?,?,?)').run(selectionSnapshotId, project.id, project.revision, '[]', timestamp)
      const settings = this.db.prepare(`SELECT s.source_project_id,p.title,s.scopes_json FROM historical_source_settings s JOIN projects p ON p.id=s.source_project_id WHERE s.project_id=? AND s.enabled=1`).all(project.id) as Row[]
      for (const setting of settings) this.db.prepare('INSERT INTO knowledge_selection_items(id,snapshot_id,source_project_id,source_project_title,scopes_json) VALUES (?,?,?,?,?)').run(id('knowledge-selection-item'), selectionSnapshotId, String(setting.source_project_id), String(setting.title), String(setting.scopes_json))
      this.db.prepare(`INSERT INTO workflow_runs(id,project_id,chapter_id,definition_version_id,status,current_node_key,input_snapshot_json,project_revision_at_start,chapter_revision_at_start,revision_round,created_at,started_at,knowledge_selection_snapshot_id)
        VALUES (?,?,?,?,'running',?,?,?,?,0,?,?,?)`).run(workflowRunId, project.id, chapter.id, CHAPTER_WORKFLOW_VERSION_ID, CHAPTER_WORKFLOW_NODES[0], JSON.stringify(snapshot), project.revision, chapter.revision, timestamp, timestamp, selectionSnapshotId)
      this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='dispatched',workflow_run_id=?,updated_at=? WHERE id=? AND queue_state='queued'").run(workflowRunId, timestamp, next.id)
      this.db.prepare('UPDATE chapter_generation_batches SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, batchId)
      this.addWorkflowEvent(workflowRunId, null, 'workflow.started', snapshot)
      this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,item_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)').run(id('chapter-batch-event'), batchId, next.id, 'item.dispatched', JSON.stringify({ workflowRunId }), timestamp)
      return 'dispatched' as const
    })
    if (dispatchState !== 'dispatched') return { batch: this.getChapterBatch(batchId), workflow: null }
    this.refreshProjectRecoveryCapsules(batch.projectId)
    return { batch: this.getChapterBatch(batchId), workflow: this.getWorkflowRun(workflowRunId) }
  }

  reconcileChapterBatch(workflowRunId: string): ChapterGenerationBatch | null {
    const itemRow = this.db.prepare('SELECT i.*,b.project_id,b.automation_mode,b.status batch_status FROM chapter_generation_batch_items i JOIN chapter_generation_batches b ON b.id=i.batch_id WHERE i.workflow_run_id=?').get(workflowRunId) as Row | undefined
    if (!itemRow) return null
    const batchId = String(itemRow.batch_id), projectId = String(itemRow.project_id), timestamp = now()
    this.activeProjectTransaction(projectId, () => {
      const current = this.db.prepare(`SELECT b.status batch_status,w.status workflow_status,w.error_json workflow_error_json
        FROM chapter_generation_batch_items i
        JOIN chapter_generation_batches b ON b.id=i.batch_id
        JOIN workflow_runs w ON w.id=i.workflow_run_id
        WHERE i.batch_id=? AND i.workflow_run_id=? AND b.project_id=?`).get(batchId, workflowRunId, projectId) as Row | undefined
      if (!current) return
      const batchStatus = String(current.batch_status)
      if (['cancelled', 'succeeded', 'completed_with_skips'].includes(batchStatus)) return
      const workflowStatus = String(current.workflow_status)
      if (workflowStatus === 'waiting_approval') {
        this.db.prepare("UPDATE chapter_generation_batches SET status='waiting_approval',revision=revision+1,updated_at=? WHERE id=? AND status NOT IN ('pause_requested','cancelled','succeeded','completed_with_skips')").run(timestamp, batchId)
      } else if (workflowStatus === 'succeeded') {
        if (batchStatus === 'pause_requested') this.db.prepare("UPDATE chapter_generation_batches SET status='paused',revision=revision+1,updated_at=? WHERE id=? AND status='pause_requested'").run(timestamp, batchId)
        else {
          const remaining = Number((this.db.prepare("SELECT COUNT(*) value FROM chapter_generation_batch_items WHERE batch_id=? AND queue_state='queued'").get(batchId) as Row).value)
          if (remaining === 0) {
            const skipped = Number((this.db.prepare("SELECT COUNT(*) value FROM chapter_generation_batch_items WHERE batch_id=? AND queue_state='skipped'").get(batchId) as Row).value) > 0
            this.db.prepare("UPDATE chapter_generation_batches SET status=?,revision=revision+1,updated_at=?,finished_at=? WHERE id=? AND status NOT IN ('cancelled','succeeded','completed_with_skips')").run(skipped ? 'completed_with_skips' : 'succeeded', timestamp, timestamp, batchId)
          } else this.db.prepare("UPDATE chapter_generation_batches SET status='running',revision=revision+1,error_json=NULL,updated_at=? WHERE id=? AND status NOT IN ('cancelled','succeeded','completed_with_skips')").run(timestamp, batchId)
        }
      } else if (workflowStatus === 'failed') {
        let blockedReason = '章节工作流失败，请重试或跳过。'
        try {
          const workflowError = JSON.parse(current.workflow_error_json === null ? '{}' : String(current.workflow_error_json)) as { code?: unknown; message?: unknown }
          if (workflowError.code === 'yolo-relationship-safety' && typeof workflowError.message === 'string') blockedReason = workflowError.message
        } catch { /* Keep the generic durable failure message for malformed legacy errors. */ }
        this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='blocked',blocked_reason=?,updated_at=? WHERE workflow_run_id=?").run(blockedReason, timestamp, workflowRunId)
        this.db.prepare("UPDATE chapter_generation_batches SET status='blocked',error_json=?,revision=revision+1,updated_at=? WHERE id=? AND status NOT IN ('cancelled','succeeded','completed_with_skips')").run(current.workflow_error_json === null ? JSON.stringify({ message: 'workflow failed' }) : String(current.workflow_error_json), timestamp, batchId)
      } else if (workflowStatus === 'cancelled') {
        this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='cancelled',updated_at=? WHERE workflow_run_id=?").run(timestamp, workflowRunId)
        this.db.prepare("UPDATE chapter_generation_batches SET status='cancelled',revision=revision+1,updated_at=?,finished_at=? WHERE id=? AND status NOT IN ('cancelled','succeeded','completed_with_skips')").run(timestamp, timestamp, batchId)
      }
    })
    return this.getChapterBatch(batchId)
  }

  getWorkflowBatchAutomationMode(workflowRunId: string): AutomationMode | null {
    const row = this.db.prepare(`SELECT b.automation_mode
      FROM chapter_generation_batch_items i
      JOIN chapter_generation_batches b ON b.id=i.batch_id
      WHERE i.workflow_run_id=? LIMIT 1`).get(workflowRunId) as Row | undefined
    return row ? row.automation_mode as AutomationMode : null
  }

  /** Compatibility hook retained for older runners. Relationship enrichment is
   * advisory now, so an OFF mode or ambiguous candidate never fails a chapter. */
  enforceWorkflowRelationshipSafety(_workflowRunId: string): boolean {
    return true
  }

  retryChapterBatchItem(batchId: string, itemId: string, projectRevision: number): { batch: ChapterGenerationBatch; workflow: WorkflowRun | null } {
    const batch = this.getChapterBatch(batchId), item = batch.items.find(value => value.id === itemId)
    this.assertProjectRevision(batch.projectId, projectRevision)
    if (!item) throw new DomainError('not-found', '批次章节不存在。')
    if (item.queueState !== 'blocked') throw new DomainError('invalid-state', '只有失败或被阻断的批次章节可以重试。')
    const timestamp = now()
    if (item.workflowRunId && item.workflow?.status === 'failed') {
      const failed = [...item.workflow.nodes].reverse().find(node => node.status === 'failed_retryable' || node.status === 'failed_terminal')
      if (!failed || failed.status !== 'failed_retryable') throw new DomainError('invalid-state', '失败节点不可重试。')
      this.activeProjectTransaction(batch.projectId, () => {
        this.assertWorkflowRelationshipSafetyUnchecked(item.workflowRunId!)
        this.assertProjectWorkflowSlot(batch.projectId, item.workflowRunId!, batchId)
        const currentWorkflow = this.one(this.db.prepare('SELECT status,error_json FROM workflow_runs WHERE id=? AND project_id=?'), item.workflowRunId!, batch.projectId)
        if (String(currentWorkflow.status) !== 'failed') throw new DomainError('invalid-state', '该章节工作流当前不可重试。')
        const currentFailed = this.db.prepare("SELECT id,node_key,status FROM workflow_node_runs WHERE workflow_run_id=? AND status IN ('failed_retryable','failed_terminal') ORDER BY started_at DESC,attempt DESC LIMIT 1").get(item.workflowRunId!) as Row | undefined
        if (!currentFailed || String(currentFailed.status) !== 'failed_retryable') throw new DomainError('invalid-state', '失败节点不可重试。')
        let failureCode = ''
        try { failureCode = String((JSON.parse(currentWorkflow.error_json === null ? '{}' : String(currentWorkflow.error_json)) as { code?: unknown }).code ?? '') } catch { failureCode = '' }
        const preservesLegacyRecoveryRevision = failureCode === 'chapter-draft-too-long' || failureCode === 'chapter-draft-too-short'
        if (preservesLegacyRecoveryRevision) this.assertProjectRevision(batch.projectId, projectRevision)
        else this.bumpProjectRevision(batch.projectId, projectRevision, timestamp)
        if (failureCode === 'revision-conflict') this.refreshWorkflowInputSnapshotUnchecked(item.workflowRunId!)
        else if (!preservesLegacyRecoveryRevision) {
          const currentProject = this.one(this.db.prepare('SELECT revision FROM projects WHERE id=?'), batch.projectId)
          this.advanceWorkflowProjectRevisionUnchecked(item.workflowRunId!, Number(currentProject.revision))
        }
        const retryNodeKey = failureCode === 'revision-conflict' ? CHAPTER_WORKFLOW_NODES[0] : String(currentFailed.node_key)
        this.db.prepare("UPDATE workflow_runs SET status='running',current_node_key=?,error_json=NULL,finished_at=NULL WHERE id=? AND status='failed'").run(retryNodeKey, item.workflowRunId!)
        this.addWorkflowEvent(item.workflowRunId!, String(currentFailed.id), 'workflow.retry.requested', { nodeKey: retryNodeKey, previousNodeKey: String(currentFailed.node_key), batchId, batchItemId: itemId, refreshedSnapshot: failureCode === 'revision-conflict', preservedLegacyRecoveryRevision: preservesLegacyRecoveryRevision })
        this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='dispatched',blocked_reason=NULL,updated_at=? WHERE id=?").run(timestamp, itemId)
        this.db.prepare("UPDATE chapter_generation_batches SET status='running',error_json=NULL,revision=revision+1,updated_at=? WHERE id=?").run(timestamp, batchId)
      })
      this.refreshProjectRecoveryCapsules(batch.projectId)
      const workflow = this.getWorkflowRun(item.workflowRunId)
      return { batch: this.getChapterBatch(batchId), workflow }
    }
    if (item.workflowRunId) throw new DomainError('invalid-state', '该章节工作流当前不可重试。')
    if (!item.chapterId) throw new DomainError('invalid-state', '批次章节尚未创建。')
    const chapter = this.getChapter(item.chapterId), foundation = this.getProjectFoundation(batch.projectId), style = this.getProjectStyleProfile(batch.projectId)
    const policy = JSON.parse(batch.policyJson) as Record<string, unknown>
    policy.foundationAssemblyHash = foundation.assemblyHash
    policy.styleRevision = style.revision
    this.activeProjectTransaction(batch.projectId, () => {
      this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='queued',chapter_revision_at_enqueue=?,blocked_reason=NULL,updated_at=? WHERE id=?").run(chapter.revision, timestamp, itemId)
      this.db.prepare("UPDATE chapter_generation_batches SET status='running',policy_json=?,error_json=NULL,revision=revision+1,updated_at=? WHERE id=?").run(JSON.stringify(policy), timestamp, batchId)
      this.bumpProjectRevision(batch.projectId, projectRevision, timestamp)
    })
    return { batch: this.getChapterBatch(batchId), workflow: null }
  }

  skipChapterBatchItem(batchId: string, itemId: string, projectRevision: number): ChapterGenerationBatch {
    const batch = this.getChapterBatch(batchId), item = batch.items.find(value => value.id === itemId)
    this.assertProjectRevision(batch.projectId, projectRevision)
    if (!item) throw new DomainError('not-found', '批次章节不存在。')
    if (!['queued', 'blocked'].includes(item.queueState)) throw new DomainError('invalid-state', '只有未启动或失败的批次章节可以跳过。')
    const timestamp = now()
    this.activeProjectTransaction(batch.projectId, () => {
      this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='skipped',blocked_reason='作者跳过；后续生成存在连续性缺口。',updated_at=? WHERE id=?").run(timestamp, itemId)
      this.db.prepare("UPDATE chapter_generation_batches SET status='paused',revision=revision+1,error_json=?,updated_at=? WHERE id=?").run(JSON.stringify({ warning: 'continuity-gap' }), timestamp, batchId)
      this.db.prepare('INSERT INTO chapter_generation_batch_events(id,batch_id,item_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)').run(id('chapter-batch-event'), batchId, itemId, 'item.skipped', JSON.stringify({ continuityGap: true }), timestamp)
      this.bumpProjectRevision(batch.projectId, projectRevision, timestamp)
    })
    return this.getChapterBatch(batchId)
  }

  listRecoverableChapterBatches(): ChapterGenerationBatch[] {
    return (this.db.prepare("SELECT id FROM chapter_generation_batches WHERE status IN ('planning','awaiting_plan_approval','queued','running','waiting_approval','pause_requested','paused','blocked') ORDER BY created_at").all() as Row[])
      .map(row => this.getChapterBatch(String(row.id)))
  }

  getMemoryItem(itemId: string): MemoryItem {
    const row = this.one(this.db.prepare('SELECT * FROM memory_items WHERE id=?'), itemId)
    if (row.current_revision_id === null) throw new DomainError('invalid-state', '记忆条目缺少当前版本。')
    const revision = memoryRevisionFrom(this.one(this.db.prepare('SELECT * FROM memory_revisions WHERE id=?'), String(row.current_revision_id)))
    return {
      id: String(row.id), projectId: String(row.project_id), origin: row.origin as MemoryItem['origin'], storage: row.storage as MemoryItem['storage'],
      scope: row.scope as MemoryItem['scope'], category: row.category as MemoryCategory, state: row.state as MemoryItem['state'],
      promptPolicy: row.prompt_policy as MemoryPromptPolicy, sourceKey: String(row.source_key), revision: Number(row.revision), currentRevision: revision,
      sources: (this.db.prepare('SELECT * FROM memory_revision_sources WHERE revision_id=? ORDER BY created_at,id').all(revision.id) as Row[]).map(memorySourceFrom),
      recentUsages: (this.db.prepare('SELECT * FROM memory_usage_events WHERE item_id=? ORDER BY created_at DESC LIMIT 30').all(itemId) as Row[]).map(memoryUsageFrom),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  listMemoryRevisions(itemId: string): MemoryRevisionHistoryEntry[] {
    this.getMemoryItem(itemId)
    return (this.db.prepare('SELECT * FROM memory_revisions WHERE item_id=? ORDER BY revision DESC').all(itemId) as Row[]).map(row => {
      const revision = memoryRevisionFrom(row)
      return { ...revision, sources: (this.db.prepare('SELECT * FROM memory_revision_sources WHERE revision_id=? ORDER BY created_at,id').all(revision.id) as Row[]).map(memorySourceFrom) }
    })
  }

  getMemoryRevisionDiff(itemId: string, fromRevisionId: string, toRevisionId: string): MemoryRevisionDiff {
    this.getMemoryItem(itemId)
    const from = memoryRevisionFrom(this.one(this.db.prepare('SELECT * FROM memory_revisions WHERE id=? AND item_id=?'), fromRevisionId, itemId))
    const to = memoryRevisionFrom(this.one(this.db.prepare('SELECT * FROM memory_revisions WHERE id=? AND item_id=?'), toRevisionId, itemId))
    return { from, to, lines: lineDiff(from.content, to.content) }
  }

  listMemoryUsages(itemId: string, input: { cursor?: string; limit?: number } = {}): MemoryUsagePage {
    this.getMemoryItem(itemId)
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 30)))
    const offset = Math.max(0, Number.parseInt(input.cursor ?? '0', 10) || 0)
    const total = Number((this.db.prepare('SELECT COUNT(*) value FROM memory_usage_events WHERE item_id=?').get(itemId) as Row).value)
    const rows = this.db.prepare('SELECT * FROM memory_usage_events WHERE item_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(itemId, limit, offset) as Row[]
    return { items: rows.map(memoryUsageFrom), total, nextCursor: offset + limit < total ? String(offset + limit) : null }
  }

  searchMemory(projectId: string, query: { q?: string; origin?: string; scope?: string; category?: string; state?: string; storage?: string; promptPolicy?: string; used?: string; cursor?: string; limit?: number } = {}): MemoryBrowserPage {
    this.getProjectTree(projectId)
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 30)))
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0)
    const clauses = ['mi.project_id=?'], values: Array<string | number> = [projectId]
    const allowed: Array<[string, string | undefined, readonly string[]]> = [
      ['mi.origin', query.origin, ['derived', 'user']], ['mi.scope', query.scope, ['foundation', 'chapter', 'arc', 'volume', 'book', 'project']],
      ['mi.category', query.category, ['continuity', 'constraint', 'character', 'world', 'timeline', 'foreshadowing', 'idea', 'research', 'other']],
      ['mi.state', query.state, ['active', 'archived', 'conflicted']], ['mi.storage', query.storage, ['database', 'markdown']],
      ['mi.prompt_policy', query.promptPolicy, ['auto', 'manual', 'excluded']],
    ]
    for (const [column, value, choices] of allowed) if (value !== undefined) {
      if (!choices.includes(value)) throw new DomainError('validation', `Memory filter ${column} is invalid.`)
      clauses.push(`${column}=?`); values.push(value)
    }
    if (query.used !== undefined) {
      if (!['used', 'unused'].includes(query.used)) throw new DomainError('validation', 'Memory used filter must be used or unused.')
      clauses.push(`${query.used === 'used' ? '' : 'NOT '}EXISTS (SELECT 1 FROM memory_usage_events mu WHERE mu.item_id=mi.id AND mu.included=1)`)
    }
    const term = query.q?.trim().slice(0, 256) ?? ''
    let fts = false
    if (term) {
      const tokens = term.split(/\s+/).filter(Boolean).slice(0, 16).map(value => `"${value.replaceAll('"', '""').slice(0, 64)}"`)
      clauses.push('mi.id IN (SELECT item_id FROM memory_browser_fts WHERE memory_browser_fts MATCH ?)')
      values.push(tokens.join(' AND ')); fts = true
    }
    const run = () => {
      const where = clauses.join(' AND ')
      const total = Number((this.db.prepare(`SELECT COUNT(*) value FROM memory_items mi WHERE ${where}`).get(...values) as Row).value)
      const rows = this.db.prepare(`SELECT mi.id FROM memory_items mi WHERE ${where} ORDER BY mi.updated_at DESC,mi.id LIMIT ? OFFSET ?`).all(...values, limit, offset) as Row[]
      return { total, rows }
    }
    let result: { total: number; rows: Row[] }
    const useLikeFallback = () => {
      clauses.pop(); values.pop()
      clauses.push("EXISTS (SELECT 1 FROM memory_revisions mr WHERE mr.id=mi.current_revision_id AND mr.content LIKE ? ESCAPE '\\')")
      values.push(`%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`)
      return run()
    }
    try {
      result = run()
      // unicode61 treats an uninterrupted Chinese sentence as one token. A
      // shorter author query therefore needs the bounded LIKE fallback even
      // when MATCH is syntactically valid but returns no row.
      if (fts && result.total === 0) result = useLikeFallback()
    } catch (cause) {
      if (!fts) throw cause
      result = useLikeFallback()
    }
    const facetRows = this.db.prepare(`SELECT origin,storage,scope,category,state,prompt_policy,COUNT(*) count FROM memory_items WHERE project_id=? GROUP BY origin,storage,scope,category,state,prompt_policy`).all(projectId) as Row[]
    const facets: Record<string, Record<string, number>> = { origin: {}, storage: {}, scope: {}, category: {}, state: {}, promptPolicy: {}, used: {} }
    for (const row of facetRows) for (const [key, column] of [['origin', 'origin'], ['storage', 'storage'], ['scope', 'scope'], ['category', 'category'], ['state', 'state'], ['promptPolicy', 'prompt_policy']] as const) facets[key]![String(row[column])] = (facets[key]![String(row[column])] ?? 0) + Number(row.count)
    const usedCount = Number((this.db.prepare('SELECT COUNT(DISTINCT item_id) value FROM memory_usage_events WHERE item_id IN (SELECT id FROM memory_items WHERE project_id=?) AND included=1').get(projectId) as Row).value)
    const projectCount = Number((this.db.prepare('SELECT COUNT(*) value FROM memory_items WHERE project_id=?').get(projectId) as Row).value)
    facets.used = { used: usedCount, unused: Math.max(0, projectCount - usedCount) }
    return { items: result.rows.map(row => this.getMemoryItem(String(row.id))), total: result.total, nextCursor: offset + limit < result.total ? String(offset + limit) : null, facets }
  }

  createUserMemory(projectId: string, input: { content: string; scope: MemoryItem['scope']; category: MemoryCategory; promptPolicy?: MemoryPromptPolicy; sourceItemId?: string }, projectRevision: number): MemoryItem {
    this.assertProjectRevision(projectId, projectRevision)
    const content = input.content.trim()
    if (!content || content.length > 256_000) throw new DomainError('validation', '作者记忆必须包含 1 到 256000 个字符。')
    const scopes: MemoryItem['scope'][] = ['foundation', 'chapter', 'arc', 'volume', 'book', 'project']
    const categories: MemoryCategory[] = ['continuity', 'constraint', 'character', 'world', 'timeline', 'foreshadowing', 'idea', 'research', 'other']
    if (!scopes.includes(input.scope) || !categories.includes(input.category)) throw new DomainError('validation', '作者记忆的范围或类别无效。')
    const promptPolicy = input.promptPolicy ?? (['continuity', 'constraint'].includes(input.category) ? 'auto' : 'manual')
    if (!['auto', 'manual', 'excluded'].includes(promptPolicy)) throw new DomainError('validation', 'Prompt 开关无效。')
    const source = input.sourceItemId ? this.getMemoryItem(input.sourceItemId) : null
    if (source && source.projectId !== projectId) throw new DomainError('validation', '覆盖来源必须属于当前项目。')
    const itemId = id('memory-item'), revisionId = id('memory-revision'), timestamp = now(), hash = createHash('sha256').update(content).digest('hex')
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`INSERT INTO memory_items(id,project_id,origin,storage,scope,category,state,prompt_policy,source_key,current_revision_id,revision,created_at,updated_at)
        VALUES (?,?,'user','database',?,?,'active',?,?,?,1,?,?)`).run(itemId, projectId, input.scope, input.category, promptPolicy, source ? `override:${source.id}:${itemId}` : `user:${itemId}`, revisionId, timestamp, timestamp)
      this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,created_at)
        VALUES (?,?,1,?,'{}',?,'user',NULL,?)`).run(revisionId, itemId, content, hash, timestamp)
      if (source) this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id('memory-source'), revisionId, 'memory-item', source.id, source.currentRevision.id, '作者覆盖来源', timestamp)
      this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(itemId, projectId, content)
      this.bumpProjectRevision(projectId, projectRevision, timestamp)
    })
    this.syncProjectMemory(projectId)
    return this.getMemoryItem(itemId)
  }

  updateUserMemory(itemId: string, input: { content?: string; category?: MemoryCategory; promptPolicy?: MemoryPromptPolicy; baseRevision: number; projectRevision: number }): MemoryItem {
    const before = this.getMemoryItem(itemId)
    this.assertProjectRevision(before.projectId, input.projectRevision)
    if (before.state === 'conflicted') throw new DomainError('invalid-state', '记忆存在 Markdown 三方冲突，请先完成冲突处理。')
    if (before.origin === 'derived') {
      if (input.content === undefined) throw new DomainError('invalid-state', '派生摘要只读；编辑正文时会创建作者覆盖记忆。')
      return this.createUserMemory(before.projectId, { content: input.content, scope: before.scope, category: input.category ?? (before.category === 'constraint' ? 'constraint' : 'continuity'), promptPolicy: input.promptPolicy, sourceItemId: before.id }, input.projectRevision)
    }
    if (before.revision !== input.baseRevision) throw new DomainError('revision-conflict', `记忆已从版本 ${input.baseRevision} 更新到 ${before.revision}。`)
    const content = (input.content ?? before.currentRevision.content).trim()
    if (!content || content.length > 256_000) throw new DomainError('validation', '作者记忆必须包含 1 到 256000 个字符。')
    const category = input.category ?? before.category, promptPolicy = input.promptPolicy ?? before.promptPolicy
    if (!['continuity', 'constraint', 'character', 'world', 'timeline', 'foreshadowing', 'idea', 'research', 'other'].includes(category)) throw new DomainError('validation', '记忆类别无效。')
    if (!['auto', 'manual', 'excluded'].includes(promptPolicy)) throw new DomainError('validation', 'Prompt 开关无效。')
    const itemRevision = before.revision + 1, contentRevision = before.currentRevision.revision + 1
    const revisionId = id('memory-revision'), timestamp = now(), hash = createHash('sha256').update(content).digest('hex')
    this.activeProjectTransaction(before.projectId, () => {
      this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,created_at)
        VALUES (?,?,?,?,'{}',?,'user',?,?)`).run(revisionId, itemId, contentRevision, content, hash, before.currentRevision.id, timestamp)
      for (const source of before.sources) this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id('memory-source'), revisionId, source.sourceType, source.sourceId, source.sourceVersionId, source.label, timestamp)
      const changed = this.db.prepare('UPDATE memory_items SET category=?,prompt_policy=?,current_revision_id=?,revision=?,updated_at=? WHERE id=? AND revision=?').run(category, promptPolicy, revisionId, itemRevision, timestamp, itemId, input.baseRevision)
      if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '记忆已由其他操作更新。')
      this.db.prepare('DELETE FROM memory_browser_fts WHERE item_id=?').run(itemId)
      this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(itemId, before.projectId, content)
      this.bumpProjectRevision(before.projectId, input.projectRevision, timestamp)
    })
    this.syncProjectMemory(before.projectId)
    return this.getMemoryItem(itemId)
  }

  restoreMemoryRevision(itemId: string, revisionId: string, baseRevision: number, projectRevision: number): MemoryItem {
    const before = this.getMemoryItem(itemId)
    this.assertProjectRevision(before.projectId, projectRevision)
    if (before.origin !== 'user') throw new DomainError('invalid-state', '派生记忆不能恢复；请创建作者覆盖记忆。')
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `记忆已从版本 ${baseRevision} 更新到 ${before.revision}。`)
    const target = memoryRevisionFrom(this.one(this.db.prepare('SELECT * FROM memory_revisions WHERE id=? AND item_id=?'), revisionId, itemId))
    const nextId = id('memory-revision'), itemRevision = before.revision + 1, contentRevision = before.currentRevision.revision + 1, timestamp = now()
    this.activeProjectTransaction(before.projectId, () => {
      this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,provider,model,prompt_hash,created_at)
        VALUES (?,?,?,?,?,?,'user',?,?,?,?,?)`).run(nextId, itemId, contentRevision, target.content, target.structuredJson, target.contentHash, before.currentRevision.id, target.provider, target.model, target.promptHash, timestamp)
      this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id('memory-source'), nextId, 'memory-revision', itemId, target.id, `恢复自版本 ${target.revision}`, timestamp)
      const changed = this.db.prepare('UPDATE memory_items SET current_revision_id=?,revision=?,updated_at=? WHERE id=? AND revision=?').run(nextId, itemRevision, timestamp, itemId, baseRevision)
      if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '记忆已由其他操作更新。')
      this.db.prepare('DELETE FROM memory_browser_fts WHERE item_id=?').run(itemId)
      this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(itemId, before.projectId, target.content)
      this.bumpProjectRevision(before.projectId, projectRevision, timestamp)
    })
    this.syncProjectMemory(before.projectId)
    return this.getMemoryItem(itemId)
  }

  setMemoryItemArchived(itemId: string, archived: boolean, baseRevision: number, projectRevision: number): MemoryItem {
    const before = this.getMemoryItem(itemId)
    this.assertProjectRevision(before.projectId, projectRevision)
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `记忆已从版本 ${baseRevision} 更新到 ${before.revision}。`)
    const timestamp = now(), nextRevision = before.revision + 1
    this.activeProjectTransaction(before.projectId, () => {
      const changed = this.db.prepare('UPDATE memory_items SET state=?,revision=?,updated_at=? WHERE id=? AND revision=?').run(archived ? 'archived' : 'active', nextRevision, timestamp, itemId, baseRevision)
      if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '记忆已由其他操作更新。')
      this.bumpProjectRevision(before.projectId, projectRevision, timestamp)
    })
    this.syncProjectMemory(before.projectId)
    return this.getMemoryItem(itemId)
  }

  listMemoryConflicts(projectId: string): MemoryConflict[] {
    this.getProjectTree(projectId)
    return (this.db.prepare(`SELECT c.*,dr.content database_content FROM memory_conflicts c
      JOIN memory_items i ON i.id=c.item_id JOIN memory_revisions dr ON dr.id=c.database_revision_id
      WHERE i.project_id=? ORDER BY CASE c.status WHEN 'open' THEN 1 ELSE 2 END,c.created_at DESC`).all(projectId) as Row[]).map(memoryConflictFrom)
  }

  rescanMemoryMarkdown(projectId: string, projectRevision: number): { changed: number; conflicts: MemoryConflict[] } {
    const project = this.assertProjectRevision(projectId, projectRevision)
    if (!project.markdownSyncEnabled || !project.workspacePath) return { changed: 0, conflicts: this.listMemoryConflicts(projectId).filter(conflict => conflict.status === 'open') }
    this.syncMemoryItemMirrors(projectId)
    const bindings = this.db.prepare("SELECT b.* FROM memory_file_bindings b JOIN memory_items i ON i.id=b.item_id WHERE i.project_id=? AND b.state='changed'").all(projectId) as Row[]
    let changed = 0, expectedProjectRevision = projectRevision
    for (const binding of bindings) {
      const item = this.getMemoryItem(String(binding.item_id)), relativePath = String(binding.relative_path)
      const file = readMemoryItemMarkdown(project.workspacePath, relativePath)
      if (!file || file.hash === String(binding.file_hash)) continue
      if (item.currentRevision.contentHash !== String(binding.base_hash)) continue
      const timestamp = now()
      if (item.origin === 'derived') {
        const authorItemId = id('memory-item'), revisionId = id('memory-revision'), contentHash = createHash('sha256').update(file.body).digest('hex')
        this.activeProjectTransaction(projectId, () => {
          this.db.prepare(`INSERT INTO memory_items(id,project_id,origin,storage,scope,category,state,prompt_policy,source_key,current_revision_id,revision,created_at,updated_at)
            VALUES (?,?,'user','markdown',?,?,'active',?, ?,?,1,?,?)`).run(authorItemId, projectId, item.scope, item.category === 'constraint' ? 'constraint' : 'continuity', ['constraint', 'continuity'].includes(item.category) ? 'auto' : 'manual', `override:${item.id}:${authorItemId}`, revisionId, timestamp, timestamp)
          this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,created_at)
            VALUES (?,?,1,?,'{}',?,'filesystem',NULL,?)`).run(revisionId, authorItemId, file.body, contentHash, timestamp)
          this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)').run(id('memory-source'), revisionId, 'memory-item', item.id, item.currentRevision.id, '派生镜像的作者覆盖', timestamp)
          this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)').run(id('memory-source'), revisionId, 'markdown-file', relativePath, null, 'Markdown 文件修改', timestamp)
          this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(authorItemId, projectId, file.body)
          this.bumpProjectRevision(projectId, expectedProjectRevision, timestamp)
        })
        const restored = writeMemoryItemMarkdown(project.workspacePath, relativePath, { itemId: item.id, origin: item.origin, revision: item.revision, category: item.category, content: item.currentRevision.content })
        if (restored) this.activeProjectTransaction(projectId, () => this.db.prepare("UPDATE memory_file_bindings SET base_hash=?,file_hash=?,state='clean',updated_at=? WHERE item_id=?").run(item.currentRevision.contentHash, restored.hash, timestamp, item.id))
      } else {
        const itemRevision = item.revision + 1, contentRevision = item.currentRevision.revision + 1
        const revisionId = id('memory-revision'), contentHash = createHash('sha256').update(file.body).digest('hex')
        this.activeProjectTransaction(projectId, () => {
          this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,created_at)
            VALUES (?,?,?,?,'{}',?,'filesystem',?,?)`).run(revisionId, item.id, contentRevision, file.body, contentHash, item.currentRevision.id, timestamp)
          for (const source of item.sources) this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)').run(id('memory-source'), revisionId, source.sourceType, source.sourceId, source.sourceVersionId, source.label, timestamp)
          this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)').run(id('memory-source'), revisionId, 'markdown-file', relativePath, null, 'Markdown 文件修改', timestamp)
          const itemChanged = this.db.prepare("UPDATE memory_items SET storage='markdown',current_revision_id=?,revision=?,state='active',updated_at=? WHERE id=? AND revision=?").run(revisionId, itemRevision, timestamp, item.id, item.revision)
          if (Number(itemChanged.changes) !== 1) throw new DomainError('revision-conflict', '记忆已由其他操作更新。')
          this.db.prepare('DELETE FROM memory_browser_fts WHERE item_id=?').run(item.id)
          this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(item.id, projectId, file.body)
          this.db.prepare("UPDATE memory_file_bindings SET base_hash=?,file_hash=?,state='clean',updated_at=? WHERE item_id=?").run(contentHash, file.hash, timestamp, item.id)
          this.bumpProjectRevision(projectId, expectedProjectRevision, timestamp)
        })
        const normalizedFile = writeMemoryItemMarkdown(project.workspacePath, relativePath, { itemId: item.id, origin: item.origin, revision: itemRevision, category: item.category, content: file.body })
        if (normalizedFile) this.activeProjectTransaction(projectId, () => this.db.prepare("UPDATE memory_file_bindings SET file_hash=?,updated_at=? WHERE item_id=?").run(normalizedFile.hash, timestamp, item.id))
      }
      changed++
      expectedProjectRevision++
    }
    this.syncMemoryItemMirrors(projectId)
    return { changed, conflicts: this.listMemoryConflicts(projectId).filter(conflict => conflict.status === 'open') }
  }

  resolveMemoryConflict(itemId: string, conflictId: string, resolution: 'database' | 'file' | 'merged' | 'both', baseRevision: number, projectRevision: number, mergedContent?: string): MemoryItem {
    const before = this.getMemoryItem(itemId), project = this.assertProjectRevision(before.projectId, projectRevision)
    if (before.revision !== baseRevision) throw new DomainError('revision-conflict', `记忆已从版本 ${baseRevision} 更新到 ${before.revision}。`)
    if (!['database', 'file', 'merged', 'both'].includes(resolution)) throw new DomainError('validation', 'Markdown 冲突处理方式无效。')
    const conflict = memoryConflictFrom(this.one(this.db.prepare(`SELECT c.*,dr.content database_content FROM memory_conflicts c
      JOIN memory_revisions dr ON dr.id=c.database_revision_id WHERE c.id=? AND c.item_id=? AND c.status='open'`), conflictId, itemId))
    const binding = this.one(this.db.prepare('SELECT * FROM memory_file_bindings WHERE item_id=?'), itemId)
    const normalizedResolution = resolution === 'both' ? 'merged' : resolution
    const authoredMerge = mergedContent?.trim() ?? ''
    if (normalizedResolution === 'merged' && (!authoredMerge || authoredMerge.length > 256_000)) throw new DomainError('validation', '合并正文必须包含 1 到 256000 个字符。')
    const content = normalizedResolution === 'database' ? before.currentRevision.content : normalizedResolution === 'file' ? conflict.fileContent : authoredMerge
    const timestamp = now(), itemRevision = before.revision + 1, contentRevision = before.currentRevision.revision + 1
    this.activeProjectTransaction(before.projectId, () => {
      let currentRevisionId = before.currentRevision.id
      if (normalizedResolution !== 'database') {
        currentRevisionId = id('memory-revision')
        const contentHash = createHash('sha256').update(content).digest('hex')
        this.db.prepare(`INSERT INTO memory_revisions(id,item_id,revision,content,structured_json,content_hash,actor,parent_revision_id,created_at)
          VALUES (?,?,?,?,'{}',?,?,?,?)`).run(currentRevisionId, itemId, contentRevision, content, contentHash, normalizedResolution === 'merged' ? 'user' : 'filesystem', before.currentRevision.id, timestamp)
        for (const source of before.sources) this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(id('memory-source'), currentRevisionId, source.sourceType, source.sourceId, source.sourceVersionId, source.label, timestamp)
        this.db.prepare('INSERT INTO memory_revision_sources(id,revision_id,source_type,source_id,source_version_id,label,created_at) VALUES (?,?,?,?,?,?,?)').run(id('memory-source'), currentRevisionId, 'markdown-file', String(binding.relative_path), conflict.baseRevisionId, `三方冲突处理：${normalizedResolution}`, timestamp)
        this.db.prepare('DELETE FROM memory_browser_fts WHERE item_id=?').run(itemId)
        this.db.prepare('INSERT INTO memory_browser_fts(item_id,project_id,content) VALUES (?,?,?)').run(itemId, before.projectId, content)
      }
      this.db.prepare("UPDATE memory_items SET current_revision_id=?,revision=?,state='active',updated_at=? WHERE id=? AND revision=?").run(currentRevisionId, itemRevision, timestamp, itemId, baseRevision)
      this.db.prepare("UPDATE memory_conflicts SET status='resolved',resolution=?,resolved_at=? WHERE id=?").run(normalizedResolution, timestamp, conflictId)
      this.bumpProjectRevision(before.projectId, projectRevision, timestamp)
    })
    if (project.workspacePath) {
      const after = this.getMemoryItem(itemId)
      const written = writeMemoryItemMarkdown(project.workspacePath, String(binding.relative_path), { itemId, origin: after.origin, revision: after.revision, category: after.category, content })
      if (written) this.activeProjectTransaction(before.projectId, () => this.db.prepare("UPDATE memory_file_bindings SET base_hash=?,file_hash=?,state='clean',updated_at=? WHERE item_id=?").run(after.currentRevision.contentHash, written.hash, timestamp, itemId))
    }
    return this.getMemoryItem(itemId)
  }

  getRelationshipMode(projectId: string): RelationshipMode {
    this.getProjectTree(projectId)
    const row = this.db.prepare('SELECT relationship_mode FROM project_automation_policies WHERE project_id=?').get(projectId) as Row | undefined
    return row ? row.relationship_mode as RelationshipMode : 'off'
  }

  setRelationshipMode(projectId: string, mode: RelationshipMode, baseRevision: number): RelationshipMode {
    const project = this.assertProjectActive(projectId)
    if (!['off', 'auto', 'yolo'].includes(mode)) throw new DomainError('validation', '关系自动化权限必须是 OFF、AUTO 或 YOLO。')
    if (project.revision !== baseRevision) throw new DomainError('revision-conflict', `项目已从版本 ${baseRevision} 更新到 ${project.revision}。`)
    const timestamp = now()
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`INSERT INTO project_automation_policies(project_id,relationship_mode,revision,updated_at) VALUES (?,?,1,?)
        ON CONFLICT(project_id) DO UPDATE SET relationship_mode=excluded.relationship_mode,revision=project_automation_policies.revision+1,updated_at=excluded.updated_at`).run(projectId, mode, timestamp)
      const changed = this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(timestamp, projectId, baseRevision)
      if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '项目已由其他操作更新。')
    })
    if (mode === 'off') {
      const activeWorkflowIds = this.db.prepare(`SELECT w.id FROM workflow_runs w
        JOIN chapter_generation_batch_items i ON i.workflow_run_id=w.id
        JOIN chapter_generation_batches b ON b.id=i.batch_id
        WHERE b.project_id=? AND b.automation_mode='yolo' AND w.status IN ('running','paused','waiting_approval')`).all(projectId) as Row[]
      for (const row of activeWorkflowIds) this.enforceWorkflowRelationshipSafety(String(row.id))
    }
    return this.getRelationshipMode(projectId)
  }

  private storyEntityFrom(row: Row): StoryEntity {
    return {
      id: String(row.id), projectId: String(row.project_id), type: row.entity_type as StoryEntity['type'], name: String(row.name),
      aliases: (this.db.prepare('SELECT alias FROM entity_aliases WHERE entity_id=? ORDER BY alias').all(String(row.id)) as Row[]).map(alias => String(alias.alias)),
      description: String(row.description), sourceManuscriptVersionId: row.source_manuscript_version_id === null ? null : String(row.source_manuscript_version_id),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  getRelationshipGraph(projectId: string, input: { rootEntityId?: string; depth?: 1 | 2; categories?: RelationshipCategory[]; factLayers?: RelationshipFactLayer[]; atStoryOrder?: number; limitNodes?: number; limitEdges?: number } = {}): RelationshipGraph {
    this.getProjectTree(projectId)
    const depth = input.depth === 2 ? 2 : 1, limitNodes = Math.max(1, Math.min(80, Math.trunc(input.limitNodes ?? (depth === 1 ? 60 : 80))))
    const limitEdges = Math.max(1, Math.min(180, Math.trunc(input.limitEdges ?? (depth === 1 ? 120 : 180))))
    const categories = input.categories?.filter((value, index, values) => values.indexOf(value) === index) ?? []
    const factLayers = input.factLayers?.filter((value, index, values) => values.indexOf(value) === index) ?? []
    if (categories.some(value => !['family', 'emotion', 'alliance', 'conflict', 'membership', 'possession', 'location', 'knowledge', 'causality', 'other'].includes(value))) throw new DomainError('validation', '关系类别过滤无效。')
    if (factLayers.some(value => !['planned', 'canon', 'author_asserted'].includes(value))) throw new DomainError('validation', '事实层过滤无效。')
    const clauses = ["r.project_id=?", "r.status='active'"], values: Array<string | number> = [projectId]
    if (categories.length > 0) { clauses.push(`r.category IN (${categories.map(() => '?').join(',')})`); values.push(...categories) }
    if (factLayers.length > 0) { clauses.push(`r.fact_layer IN (${factLayers.map(() => '?').join(',')})`); values.push(...factLayers) }
    if (input.atStoryOrder !== undefined) {
      const order = Math.trunc(input.atStoryOrder)
      clauses.push('(r.valid_from_story_order IS NULL OR r.valid_from_story_order<=?)', '(r.valid_to_story_order IS NULL OR r.valid_to_story_order>=?)'); values.push(order, order)
    }
    const allEdges = (this.db.prepare(`SELECT r.*,(SELECT COUNT(*) FROM entity_relationship_evidence e WHERE e.relationship_id=r.id) evidence_count FROM entity_relationships r WHERE ${clauses.join(' AND ')} ORDER BY r.updated_at DESC,r.id`).all(...values) as Row[]).map(relationshipFrom)
    const entityRows = this.db.prepare('SELECT * FROM story_entities WHERE project_id=? ORDER BY entity_type,name,id').all(projectId) as Row[]
    const entityMap = new Map(entityRows.map(row => [String(row.id), row]))
    if (input.rootEntityId && !entityMap.has(input.rootEntityId)) throw new DomainError('not-found', '关系图根实体不存在。')
    const selectedNodeIds = new Set<string>(), selectedEdges: EntityRelationship[] = []
    if (input.rootEntityId) {
      selectedNodeIds.add(input.rootEntityId)
      let frontier = new Set([input.rootEntityId])
      for (let step = 0; step < depth && frontier.size > 0; step++) {
        const nextFrontier = new Set<string>()
        for (const edge of allEdges) {
          if (!frontier.has(edge.sourceEntityId) && !frontier.has(edge.targetEntityId)) continue
          if (!selectedEdges.some(item => item.id === edge.id) && selectedEdges.length < limitEdges) selectedEdges.push(edge)
          for (const endpoint of [edge.sourceEntityId, edge.targetEntityId]) if (!selectedNodeIds.has(endpoint) && selectedNodeIds.size < limitNodes) { selectedNodeIds.add(endpoint); nextFrontier.add(endpoint) }
        }
        frontier = nextFrontier
      }
    } else {
      for (const edge of allEdges) {
        if (selectedEdges.length >= limitEdges) break
        if ((!selectedNodeIds.has(edge.sourceEntityId) && selectedNodeIds.size >= limitNodes) || (!selectedNodeIds.has(edge.targetEntityId) && selectedNodeIds.size >= limitNodes)) continue
        selectedNodeIds.add(edge.sourceEntityId); selectedNodeIds.add(edge.targetEntityId); selectedEdges.push(edge)
      }
      for (const row of entityRows) if (selectedNodeIds.size < limitNodes) selectedNodeIds.add(String(row.id))
    }
    const pendingCount = Number((this.db.prepare(`SELECT COUNT(*) value FROM relationship_candidates c JOIN relationship_extraction_runs r ON r.id=c.run_id WHERE r.project_id=? AND c.status IN ('pending','ambiguous')`).get(projectId) as Row).value)
    const reachableEdgeCount = input.rootEntityId ? allEdges.filter(edge => selectedNodeIds.has(edge.sourceEntityId) || selectedNodeIds.has(edge.targetEntityId)).length : allEdges.length
    return {
      projectId, mode: this.getRelationshipMode(projectId), nodes: [...selectedNodeIds].map(entityId => this.storyEntityFrom(entityMap.get(entityId)!)),
      edges: selectedEdges, pendingCount, truncated: selectedNodeIds.size >= limitNodes && entityRows.length > selectedNodeIds.size || reachableEdgeCount > selectedEdges.length,
    }
  }

  listEntityRelationships(projectId: string, query: { q?: string; categories?: RelationshipCategory[]; factLayers?: RelationshipFactLayer[]; atStoryOrder?: number; cursor?: string; limit?: number } = {}): RelationshipListPage {
    this.getProjectTree(projectId)
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 30)))
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0)
    const categories = query.categories?.filter((value, index, values) => values.indexOf(value) === index) ?? []
    const factLayers = query.factLayers?.filter((value, index, values) => values.indexOf(value) === index) ?? []
    if (categories.some(value => !['family', 'emotion', 'alliance', 'conflict', 'membership', 'possession', 'location', 'knowledge', 'causality', 'other'].includes(value))) throw new DomainError('validation', '关系类别过滤无效。')
    if (factLayers.some(value => !['planned', 'canon', 'author_asserted'].includes(value))) throw new DomainError('validation', '事实层过滤无效。')
    const clauses = ["r.project_id=?", "r.status='active'"], values: Array<string | number> = [projectId]
    if (categories.length > 0) { clauses.push(`r.category IN (${categories.map(() => '?').join(',')})`); values.push(...categories) }
    if (factLayers.length > 0) { clauses.push(`r.fact_layer IN (${factLayers.map(() => '?').join(',')})`); values.push(...factLayers) }
    if (query.atStoryOrder !== undefined) {
      const order = Math.trunc(query.atStoryOrder)
      clauses.push('(r.valid_from_story_order IS NULL OR r.valid_from_story_order<=?)', '(r.valid_to_story_order IS NULL OR r.valid_to_story_order>=?)')
      values.push(order, order)
    }
    const term = query.q?.trim().slice(0, 200) ?? ''
    if (term) {
      const escaped = `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      clauses.push(`(r.label LIKE ? ESCAPE '\\' OR r.predicate_key LIKE ? ESCAPE '\\' OR source.name LIKE ? ESCAPE '\\' OR target.name LIKE ? ESCAPE '\\')`)
      values.push(escaped, escaped, escaped, escaped)
    }
    const from = `FROM entity_relationships r JOIN story_entities source ON source.id=r.source_entity_id JOIN story_entities target ON target.id=r.target_entity_id WHERE ${clauses.join(' AND ')}`
    const total = Number((this.db.prepare(`SELECT COUNT(*) value ${from}`).get(...values) as Row).value)
    const rows = this.db.prepare(`SELECT r.*,source.name source_entity_name,target.name target_entity_name,(SELECT COUNT(*) FROM entity_relationship_evidence e WHERE e.relationship_id=r.id) evidence_count ${from} ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?`).all(...values, limit, offset) as Row[]
    return { items: rows.map(relationshipFrom), total, nextCursor: offset + limit < total ? String(offset + limit) : null }
  }

  listRelationshipCandidates(projectId: string, status?: RelationshipCandidate['status']): RelationshipCandidate[] {
    this.getProjectTree(projectId)
    if (status !== undefined && !['pending', 'ambiguous', 'confirmed', 'rejected'].includes(status)) throw new DomainError('validation', '候选关系状态无效。')
    const rows = status
      ? this.db.prepare('SELECT c.* FROM relationship_candidates c JOIN relationship_extraction_runs r ON r.id=c.run_id WHERE r.project_id=? AND c.status=? ORDER BY c.created_at DESC').all(projectId, status)
      : this.db.prepare('SELECT c.* FROM relationship_candidates c JOIN relationship_extraction_runs r ON r.id=c.run_id WHERE r.project_id=? ORDER BY c.created_at DESC').all(projectId)
    return (rows as Row[]).map(relationshipCandidateFrom)
  }

  listRelationshipExtractionRuns(projectId: string, limit = 30): RelationshipExtractionRun[] {
    this.getProjectTree(projectId)
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    return (this.db.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM relationship_candidates c WHERE c.run_id=r.id) candidate_count,
      (SELECT COUNT(*) FROM relationship_candidates c WHERE c.run_id=r.id AND c.status IN ('pending','ambiguous')) pending_count
      FROM relationship_extraction_runs r WHERE r.project_id=? ORDER BY r.created_at DESC,r.id LIMIT ?`).all(projectId, boundedLimit) as Row[]).map(relationshipExtractionRunFrom)
  }

  createRelationshipExtractionRun(projectId: string, mode: AutomationMode, selection: ModelSelection, sourceSnapshotJson: string, promptHash: string): string {
    this.assertProjectActive(projectId)
    if (!['auto', 'yolo'].includes(mode)) throw new DomainError('validation', '关系提取模式无效。')
    if (!selection.provider.trim() || !selection.model.trim()) throw new DomainError('validation', '关系提取需要有效的模型选择。')
    try { JSON.parse(sourceSnapshotJson) } catch { throw new DomainError('validation', '关系提取来源快照必须是 JSON。') }
    const runId = id('relationship-run'), timestamp = now()
    this.activeProjectTransaction(projectId, () => this.db.prepare(`INSERT INTO relationship_extraction_runs(
      id,project_id,automation_mode,status,provider,model,prompt_hash,source_snapshot_json,created_at,updated_at
    ) VALUES (?,?,?,'running',?,?,?,?,?,?)`).run(runId, projectId, mode, selection.provider, selection.model, promptHash, sourceSnapshotJson, timestamp, timestamp))
    return runId
  }

  private findRelationshipEntity(projectId: string, entityId: string | null, label: string): { id: string | null; ambiguous: boolean } {
    if (entityId) {
      const row = this.db.prepare('SELECT id FROM story_entities WHERE id=? AND project_id=?').get(entityId, projectId) as Row | undefined
      return { id: row ? String(row.id) : null, ambiguous: !row }
    }
    const exact = this.db.prepare(`SELECT DISTINCT e.id FROM story_entities e LEFT JOIN entity_aliases a ON a.entity_id=e.id
      WHERE e.project_id=? AND (lower(e.name)=lower(?) OR lower(a.alias)=lower(?)) LIMIT 3`).all(projectId, label.trim(), label.trim()) as Row[]
    return { id: exact.length === 1 ? String(exact[0]!.id) : null, ambiguous: exact.length !== 1 }
  }

  private normalizedRelationship(input: { sourceEntityId: string; targetEntityId: string; predicateKey: string; label: string; category: RelationshipCategory; directionality: 'directed' | 'symmetric'; factLayer: RelationshipFactLayer; validFromStoryOrder?: number | null; validToStoryOrder?: number | null }): typeof input & { validFromStoryOrder: number | null; validToStoryOrder: number | null; fingerprint: string } {
    const predicateKey = normalizeRelationshipPredicateKey(input.predicateKey), label = normalizeRelationshipText(input.label)
    if (!predicateKey || !label) throw new DomainError('validation', '关系谓词和显示名称不能为空。')
    if (input.sourceEntityId === input.targetEntityId) throw new DomainError('validation', '关系两端不能是同一实体。')
    let endpoints
    try { endpoints = canonicalizeRelationshipEndpoints({ sourceEntityId: input.sourceEntityId, targetEntityId: input.targetEntityId, directionality: input.directionality }) } catch (cause) { throw new DomainError('validation', cause instanceof Error ? cause.message : String(cause)) }
    let range
    try { range = validateRelationshipTimeRange({ validFromStoryOrder: input.validFromStoryOrder ?? null, validToStoryOrder: input.validToStoryOrder ?? null }) } catch (cause) { throw new DomainError('validation', cause instanceof Error ? cause.message : String(cause)) }
    const normalized = { ...input, sourceEntityId: endpoints.sourceEntityId!, targetEntityId: endpoints.targetEntityId!, predicateKey, label, ...range }
    let fingerprint: string
    try { fingerprint = relationshipFingerprint(normalized) } catch (cause) { throw new DomainError('validation', cause instanceof Error ? cause.message : String(cause)) }
    return { ...normalized, fingerprint }
  }

  private insertRelationshipUnchecked(projectId: string, input: { sourceEntityId: string; targetEntityId: string; predicateKey: string; label: string; category: RelationshipCategory; directionality: 'directed' | 'symmetric'; factLayer: RelationshipFactLayer; validFromStoryOrder?: number | null; validToStoryOrder?: number | null }, createdBy: EntityRelationship['createdBy'], supersedesRelationshipId: string | null = null, revision = 1): EntityRelationship {
    for (const entityId of [input.sourceEntityId, input.targetEntityId]) if (!this.db.prepare('SELECT 1 value FROM story_entities WHERE id=? AND project_id=?').get(entityId, projectId)) throw new DomainError('validation', '关系实体不属于当前项目。')
    const normalized = this.normalizedRelationship(input), relationshipId = id('entity-relationship'), timestamp = now()
    const duplicate = this.db.prepare("SELECT r.*,(SELECT COUNT(*) FROM entity_relationship_evidence e WHERE e.relationship_id=r.id) evidence_count FROM entity_relationships r WHERE r.project_id=? AND r.fingerprint=? AND r.status='active'").get(projectId, normalized.fingerprint) as Row | undefined
    if (duplicate) return relationshipFrom(duplicate)
    this.db.prepare(`INSERT INTO entity_relationships(
      id,project_id,source_entity_id,target_entity_id,predicate_key,label,category,directionality,fact_layer,valid_from_story_order,valid_to_story_order,status,supersedes_relationship_id,created_by,fingerprint,revision,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?)`).run(
      relationshipId, projectId, normalized.sourceEntityId, normalized.targetEntityId, normalized.predicateKey, normalized.label, normalized.category,
      normalized.directionality, normalized.factLayer, normalized.validFromStoryOrder, normalized.validToStoryOrder, supersedesRelationshipId, createdBy, normalized.fingerprint, revision, timestamp, timestamp,
    )
    return relationshipFrom(this.one(this.db.prepare("SELECT r.*,(SELECT COUNT(*) FROM entity_relationship_evidence e WHERE e.relationship_id=r.id) evidence_count FROM entity_relationships r WHERE r.id=?"), relationshipId))
  }

  private validatedRelationshipEvidence(projectId: string, evidenceJson: string): Array<{
    sourceType: string
    sourceId: string
    sourceVersionId: string | null
    label: string
    excerptStart: number | null
    excerptEnd: number | null
    contentHash: string
  }> {
    let parsed: unknown
    try { parsed = JSON.parse(evidenceJson) } catch { return [] }
    if (!Array.isArray(parsed)) return []
    const result: Array<{
      sourceType: string; sourceId: string; sourceVersionId: string | null; label: string
      excerptStart: number | null; excerptEnd: number | null; contentHash: string
    }> = []
    for (const raw of parsed.slice(0, 50)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const value = raw as Record<string, unknown>
      const sourceType = typeof value.sourceType === 'string' ? value.sourceType : ''
      const sourceId = typeof value.sourceId === 'string' ? value.sourceId.trim() : ''
      if (!sourceId || !['manuscript-version', 'foundation-version', 'canon-fact', 'timeline-event', 'foreshadowing'].includes(sourceType)) continue
      let content: string | null = null
      if (sourceType === 'manuscript-version') {
        const row = this.db.prepare('SELECT content FROM manuscript_versions WHERE id=? AND project_id=?').get(sourceId, projectId) as Row | undefined
        content = row ? String(row.content) : null
      } else if (sourceType === 'foundation-version') {
        const row = this.db.prepare('SELECT content FROM project_foundation_versions WHERE id=? AND project_id=?').get(sourceId, projectId) as Row | undefined
        content = row ? String(row.content) : null
      } else if (sourceType === 'canon-fact') {
        const row = this.db.prepare('SELECT subject,predicate,value_json FROM canon_facts WHERE id=? AND project_id=?').get(sourceId, projectId) as Row | undefined
        content = row ? `${String(row.subject)} ${String(row.predicate)} ${String(row.value_json)}` : null
      } else if (sourceType === 'timeline-event') {
        const row = this.db.prepare('SELECT title,summary FROM timeline_events WHERE id=? AND project_id=?').get(sourceId, projectId) as Row | undefined
        content = row ? `${String(row.title)}：${String(row.summary)}` : null
      } else if (sourceType === 'foreshadowing') {
        const row = this.db.prepare('SELECT title,description FROM foreshadowing_items WHERE id=? AND project_id=?').get(sourceId, projectId) as Row | undefined
        content = row ? `${String(row.title)}：${String(row.description)}` : null
      }
      if (content === null) continue
      const actualHash = createHash('sha256').update(content).digest('hex')
      if (typeof value.contentHash === 'string' && value.contentHash !== actualHash) continue
      const sourceVersionId = value.sourceVersionId === undefined || value.sourceVersionId === null ? null : String(value.sourceVersionId)
      if ((sourceType === 'manuscript-version' || sourceType === 'foundation-version') && sourceVersionId !== null && sourceVersionId !== sourceId) continue
      const hasStart = Number.isInteger(value.excerptStart)
      const hasEnd = Number.isInteger(value.excerptEnd)
      if (hasStart !== hasEnd) continue
      const excerptStart = hasStart ? Number(value.excerptStart) : null
      const excerptEnd = hasEnd ? Number(value.excerptEnd) : null
      if (excerptStart !== null && excerptEnd !== null && (excerptStart < 0 || excerptEnd <= excerptStart || excerptEnd > content.length)) continue
      result.push({
        sourceType, sourceId, sourceVersionId,
        label: String(value.label ?? sourceType).trim().slice(0, 300) || sourceType,
        excerptStart, excerptEnd, contentHash: actualHash,
      })
    }
    return result
  }

  completeRelationshipExtractionRun(runId: string, candidates: Array<Omit<RelationshipCandidate, 'id' | 'runId' | 'status' | 'createdAt' | 'updatedAt'>>): RelationshipCandidate[] {
    const run = this.one(this.db.prepare('SELECT * FROM relationship_extraction_runs WHERE id=?'), runId), projectId = String(run.project_id)
    this.assertProjectActive(projectId)
    if (!['running', 'queued'].includes(String(run.status))) throw new DomainError('invalid-state', '关系提取运行已结束。')
    if (candidates.length > 500) throw new DomainError('validation', '单次关系候选不能超过 500 条。')
    const timestamp = now(), insertedIds: string[] = [], automation = String(run.automation_mode) as AutomationMode
    let yoloConfirmed = false
    this.activeProjectTransaction(projectId, () => {
      for (const candidate of candidates) {
        const source = this.findRelationshipEntity(projectId, candidate.sourceEntityId, candidate.sourceLabel)
        const target = this.findRelationshipEntity(projectId, candidate.targetEntityId, candidate.targetLabel)
        const sourceId = source.id, targetId = target.id
        let status: RelationshipCandidate['status'] = sourceId && targetId && sourceId !== targetId && !source.ambiguous && !target.ambiguous ? 'pending' : 'ambiguous'
        const evidence = this.validatedRelationshipEvidence(projectId, candidate.evidenceJson)
        if (!evidence.some(item => item.excerptStart !== null && item.excerptEnd !== null)) status = 'ambiguous'
        const predicateKey = normalizeRelationshipPredicateKey(candidate.predicateKey), label = normalizeRelationshipText(candidate.label)
        let fingerprint = candidate.fingerprint
        if (sourceId && targetId && predicateKey) {
          try { fingerprint = relationshipFingerprint({ ...candidate, sourceEntityId: sourceId, targetEntityId: targetId, predicateKey }) } catch { status = 'ambiguous' }
        } else status = 'ambiguous'
        const candidateId = id('relationship-candidate')
        this.db.prepare(`INSERT INTO relationship_candidates(
          id,run_id,source_entity_id,target_entity_id,source_label,target_label,predicate_key,label,category,directionality,fact_layer,valid_from_story_order,valid_to_story_order,confidence,status,evidence_json,fingerprint,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(candidateId, runId, sourceId, targetId, candidate.sourceLabel.trim(), candidate.targetLabel.trim(), predicateKey, label, candidate.category, candidate.directionality, candidate.factLayer, candidate.validFromStoryOrder, candidate.validToStoryOrder, Math.max(0, Math.min(1, candidate.confidence)), status, JSON.stringify(evidence), fingerprint, timestamp, timestamp)
        insertedIds.push(candidateId)
        if (automation === 'yolo' && status === 'pending' && sourceId && targetId) {
          const relation = this.insertRelationshipUnchecked(projectId, { sourceEntityId: sourceId, targetEntityId: targetId, predicateKey, label, category: candidate.category, directionality: candidate.directionality, factLayer: candidate.factLayer, validFromStoryOrder: candidate.validFromStoryOrder, validToStoryOrder: candidate.validToStoryOrder }, 'ai_yolo')
          this.persistRelationshipEvidenceUnchecked(relation.id, candidate.evidenceJson, relation.createdAt)
          this.db.prepare("UPDATE relationship_candidates SET status='confirmed',updated_at=? WHERE id=?").run(timestamp, candidateId)
          yoloConfirmed = true
        }
      }
      const ambiguous = Number((this.db.prepare("SELECT COUNT(*) value FROM relationship_candidates WHERE run_id=? AND status='ambiguous'").get(runId) as Row).value)
      const pending = Number((this.db.prepare("SELECT COUNT(*) value FROM relationship_candidates WHERE run_id=? AND status='pending'").get(runId) as Row).value)
      const status = automation === 'yolo' && ambiguous > 0 ? 'blocked' : pending + ambiguous > 0 ? 'waiting_review' : 'succeeded'
      this.db.prepare('UPDATE relationship_extraction_runs SET status=?,updated_at=?,finished_at=? WHERE id=?').run(status, timestamp, status === 'succeeded' ? timestamp : null, runId)
      if (yoloConfirmed) this.db.prepare("UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND status='active'").run(timestamp, projectId)
    })
    return insertedIds.map(candidateId => relationshipCandidateFrom(this.one(this.db.prepare('SELECT * FROM relationship_candidates WHERE id=?'), candidateId)))
  }

  private persistRelationshipEvidenceUnchecked(relationshipId: string, evidenceJson: string, timestamp: string): void {
    const relationship = this.one(this.db.prepare('SELECT project_id FROM entity_relationships WHERE id=?'), relationshipId)
    for (const value of this.validatedRelationshipEvidence(String(relationship.project_id), evidenceJson)) {
      const duplicate = this.db.prepare(`SELECT 1 value FROM entity_relationship_evidence
        WHERE relationship_id=? AND source_type=? AND source_id=? AND source_version_id IS ?
          AND excerpt_start IS ? AND excerpt_end IS ? AND content_hash=? LIMIT 1`).get(
        relationshipId, value.sourceType, value.sourceId, value.sourceVersionId, value.excerptStart, value.excerptEnd, value.contentHash,
      )
      if (duplicate) continue
      this.db.prepare(`INSERT INTO entity_relationship_evidence(id,relationship_id,source_type,source_id,source_version_id,label,excerpt_start,excerpt_end,content_hash,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('relationship-evidence'), relationshipId, value.sourceType, value.sourceId, value.sourceVersionId, value.label, value.excerptStart, value.excerptEnd, value.contentHash, timestamp)
    }
  }

  failRelationshipExtractionRun(runId: string, error: unknown): void {
    const run = this.one(this.db.prepare('SELECT * FROM relationship_extraction_runs WHERE id=?'), runId), projectId = String(run.project_id)
    this.assertProjectActive(projectId)
    const timestamp = now(), errorJson = JSON.stringify(error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) })
    this.activeProjectTransaction(projectId, () => this.db.prepare("UPDATE relationship_extraction_runs SET status='failed',error_json=?,updated_at=?,finished_at=? WHERE id=? AND status IN ('queued','running')").run(errorJson, timestamp, timestamp, runId))
  }

  decideRelationshipCandidate(projectId: string, candidateId: string, decision: 'confirm' | 'reject', input: RelationshipCandidateConfirmationInput | undefined, projectRevision: number): EntityRelationship | null {
    return this.decideRelationshipCandidates(projectId, [{ candidateId, decision, input }], projectRevision)[0]!.relationship
  }

  decideRelationshipCandidates(projectId: string, decisions: RelationshipCandidateBatchDecision[], projectRevision: number): RelationshipCandidateBatchResult[] {
    this.assertProjectRevision(projectId, projectRevision)
    if (decisions.length < 1 || decisions.length > 100) throw new DomainError('validation', '一次必须处理 1 到 100 条候选关系。')
    if (new Set(decisions.map(item => item.candidateId)).size !== decisions.length) throw new DomainError('validation', '批量候选关系不能重复。')
    const rows = new Map<string, Row>()
    for (const item of decisions) {
      if (!['confirm', 'reject'].includes(item.decision)) throw new DomainError('validation', '候选关系决定无效。')
      const row = this.one(this.db.prepare('SELECT c.*,r.project_id,r.automation_mode FROM relationship_candidates c JOIN relationship_extraction_runs r ON r.id=c.run_id WHERE c.id=?'), item.candidateId)
      if (String(row.project_id) !== projectId) throw new DomainError('not-found', '候选关系不属于当前项目。')
      if (!['pending', 'ambiguous'].includes(String(row.status))) throw new DomainError('invalid-state', '候选关系已经处理。')
      rows.set(item.candidateId, row)
    }
    const timestamp = now(), relationshipIds = new Map<string, string | null>(), runIds = new Set<string>()
    this.activeProjectTransaction(projectId, () => {
      for (const item of decisions) {
        const row = rows.get(item.candidateId)!, runId = String(row.run_id)
        runIds.add(runId)
        if (item.decision === 'reject') {
          this.db.prepare("UPDATE relationship_candidates SET status='rejected',updated_at=? WHERE id=?").run(timestamp, item.candidateId)
          relationshipIds.set(item.candidateId, null)
          continue
        }
        const overrides = item.input ?? {}
        const sourceId = overrides.sourceEntityId ?? (row.source_entity_id === null ? null : String(row.source_entity_id))
        const targetId = overrides.targetEntityId ?? (row.target_entity_id === null ? null : String(row.target_entity_id))
        if (!sourceId || !targetId) throw new DomainError('validation', '确认关系前必须映射两个实体。')
        const relationship = this.insertRelationshipUnchecked(projectId, {
          sourceEntityId: sourceId,
          targetEntityId: targetId,
          predicateKey: overrides.predicateKey ?? String(row.predicate_key),
          label: overrides.label ?? String(row.label),
          category: overrides.category ?? row.category as RelationshipCategory,
          directionality: overrides.directionality ?? row.directionality as EntityRelationship['directionality'],
          factLayer: overrides.factLayer ?? row.fact_layer as RelationshipFactLayer,
          validFromStoryOrder: overrides.validFromStoryOrder !== undefined ? overrides.validFromStoryOrder : row.valid_from_story_order === null ? null : Number(row.valid_from_story_order),
          validToStoryOrder: overrides.validToStoryOrder !== undefined ? overrides.validToStoryOrder : row.valid_to_story_order === null ? null : Number(row.valid_to_story_order),
        }, 'ai_confirmed')
        this.persistRelationshipEvidenceUnchecked(relationship.id, String(row.evidence_json), relationship.createdAt)
        this.db.prepare(`UPDATE relationship_candidates SET source_entity_id=?,target_entity_id=?,predicate_key=?,label=?,category=?,directionality=?,fact_layer=?,valid_from_story_order=?,valid_to_story_order=?,status='confirmed',fingerprint=?,updated_at=? WHERE id=?`).run(
          relationship.sourceEntityId, relationship.targetEntityId, relationship.predicateKey, relationship.label, relationship.category, relationship.directionality,
          relationship.factLayer, relationship.validFromStoryOrder, relationship.validToStoryOrder, relationship.fingerprint, timestamp, item.candidateId,
        )
        relationshipIds.set(item.candidateId, relationship.id)
      }
      for (const runId of runIds) {
        const pending = Number((this.db.prepare("SELECT COUNT(*) value FROM relationship_candidates WHERE run_id=? AND status IN ('pending','ambiguous')").get(runId) as Row).value)
        if (pending === 0) this.db.prepare("UPDATE relationship_extraction_runs SET status='succeeded',updated_at=?,finished_at=? WHERE id=?").run(timestamp, timestamp, runId)
      }
      this.bumpProjectRevision(projectId, projectRevision, timestamp)
    })
    return decisions.map(item => {
      const relationshipId = relationshipIds.get(item.candidateId) ?? null
      const relationship = relationshipId ? relationshipFrom(this.one(this.db.prepare(`SELECT r.*,source.name source_entity_name,target.name target_entity_name,(SELECT COUNT(*) FROM entity_relationship_evidence e WHERE e.relationship_id=r.id) evidence_count FROM entity_relationships r JOIN story_entities source ON source.id=r.source_entity_id JOIN story_entities target ON target.id=r.target_entity_id WHERE r.id=?`), relationshipId)) : null
      return { candidateId: item.candidateId, decision: item.decision, relationship }
    })
  }

  createEntityRelationship(projectId: string, input: { sourceEntityId: string; targetEntityId: string; predicateKey: string; label: string; category: RelationshipCategory; directionality: 'directed' | 'symmetric'; factLayer: RelationshipFactLayer; validFromStoryOrder?: number | null; validToStoryOrder?: number | null }, baseRevision: number): EntityRelationship {
    const project = this.assertProjectActive(projectId)
    if (project.revision !== baseRevision) throw new DomainError('revision-conflict', `项目已从版本 ${baseRevision} 更新到 ${project.revision}。`)
    let relationship: EntityRelationship | null = null
    this.activeProjectTransaction(projectId, () => {
      relationship = this.insertRelationshipUnchecked(projectId, input, 'user')
      const changed = this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(now(), projectId, baseRevision)
      if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '项目已由其他操作更新。')
    })
    return relationship!
  }

  reviseEntityRelationship(projectId: string, relationshipId: string, input: { label: string; predicateKey: string; category: RelationshipCategory; directionality: 'directed' | 'symmetric'; factLayer: RelationshipFactLayer; validFromStoryOrder?: number | null; validToStoryOrder?: number | null }, baseRevision: number): EntityRelationship {
    const project = this.assertProjectActive(projectId)
    if (project.revision !== baseRevision) throw new DomainError('revision-conflict', `项目已从版本 ${baseRevision} 更新到 ${project.revision}。`)
    const before = relationshipFrom(this.one(this.db.prepare("SELECT r.*,(SELECT COUNT(*) FROM entity_relationship_evidence e WHERE e.relationship_id=r.id) evidence_count FROM entity_relationships r WHERE r.id=? AND r.project_id=? AND r.status='active'"), relationshipId, projectId))
    let relationship: EntityRelationship | null = null
    const timestamp = now()
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare("UPDATE entity_relationships SET status='superseded',updated_at=? WHERE id=? AND status='active'").run(timestamp, relationshipId)
      relationship = this.insertRelationshipUnchecked(projectId, { sourceEntityId: before.sourceEntityId, targetEntityId: before.targetEntityId, ...input }, 'user', relationshipId, before.revision + 1)
      const evidenceRows = this.db.prepare('SELECT * FROM entity_relationship_evidence WHERE relationship_id=? ORDER BY created_at,id').all(relationshipId) as Row[]
      for (const evidence of evidenceRows) this.db.prepare(`INSERT INTO entity_relationship_evidence(id,relationship_id,source_type,source_id,source_version_id,label,excerpt_start,excerpt_end,content_hash,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('relationship-evidence'), relationship.id, String(evidence.source_type), String(evidence.source_id), evidence.source_version_id === null ? null : String(evidence.source_version_id), String(evidence.label), evidence.excerpt_start === null ? null : Number(evidence.excerpt_start), evidence.excerpt_end === null ? null : Number(evidence.excerpt_end), String(evidence.content_hash), relationship.createdAt)
      const changed = this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(timestamp, projectId, baseRevision)
      if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', '项目已由其他操作更新。')
    })
    return relationship!
  }

  getRelationshipEvidence(projectId: string, relationshipId: string): EntityRelationshipEvidence[] {
    this.getProjectTree(projectId)
    this.one(this.db.prepare('SELECT id FROM entity_relationships WHERE id=? AND project_id=?'), relationshipId, projectId)
    return (this.db.prepare('SELECT * FROM entity_relationship_evidence WHERE relationship_id=? ORDER BY created_at,id').all(relationshipId) as Row[]).map(row => {
      let sourceContent: string | null = null
      if (String(row.source_type) === 'manuscript-version') {
        const source = this.db.prepare('SELECT content FROM manuscript_versions WHERE id=? AND project_id=?').get(String(row.source_id), projectId) as Row | undefined
        sourceContent = source ? String(source.content) : null
      } else if (String(row.source_type) === 'foundation-version') {
        const source = this.db.prepare('SELECT content FROM project_foundation_versions WHERE id=? AND project_id=?').get(String(row.source_id), projectId) as Row | undefined
        sourceContent = source ? String(source.content) : null
      } else if (String(row.source_type) === 'canon-fact') {
        const source = this.db.prepare('SELECT subject,predicate,value_json FROM canon_facts WHERE id=? AND project_id=?').get(String(row.source_id), projectId) as Row | undefined
        sourceContent = source ? `${String(source.subject)} ${String(source.predicate)} ${String(source.value_json)}` : null
      } else if (String(row.source_type) === 'timeline-event') {
        const source = this.db.prepare('SELECT title,summary FROM timeline_events WHERE id=? AND project_id=?').get(String(row.source_id), projectId) as Row | undefined
        sourceContent = source ? `${String(source.title)}：${String(source.summary)}` : null
      } else if (String(row.source_type) === 'foreshadowing') {
        const source = this.db.prepare('SELECT title,description FROM foreshadowing_items WHERE id=? AND project_id=?').get(String(row.source_id), projectId) as Row | undefined
        sourceContent = source ? `${String(source.title)}：${String(source.description)}` : null
      }
      const hasExactExcerpt = row.excerpt_start !== null && row.excerpt_end !== null
      const start = hasExactExcerpt ? Math.max(0, Number(row.excerpt_start)) : 0
      const end = hasExactExcerpt ? Math.max(start, Number(row.excerpt_end)) : 0
      return {
        id: String(row.id), relationshipId: String(row.relationship_id), sourceType: String(row.source_type), sourceId: String(row.source_id),
        sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), label: String(row.label),
        excerptStart: row.excerpt_start === null ? null : Number(row.excerpt_start), excerptEnd: row.excerpt_end === null ? null : Number(row.excerpt_end),
        contentHash: String(row.content_hash), excerpt: sourceContent === null || !hasExactExcerpt ? null : sourceContent.slice(start, end), createdAt: String(row.created_at),
      }
    })
  }

  private addWorkflowEvent(workflowRunId: string, nodeRunId: string | null, type: string, payload: unknown = {}): void {
    this.db.prepare('INSERT INTO workflow_events(id,workflow_run_id,node_run_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(id('workflow-event'), workflowRunId, nodeRunId, type, JSON.stringify(payload), now())
  }

  startChapterWorkflow(chapterId: string, excludedSourceIds: string[] = []): WorkflowRun {
    const chapter = this.getChapter(chapterId)
    this.assertProjectActive(chapter.projectId)
    const project = this.getProjectTree(chapter.projectId).project
    const timestamp = now()
    const workflowRunId = id('workflow-run')
    const selectionSnapshotId = id('knowledge-selection')
    const foundation = this.getProjectFoundation(project.id), style = this.getProjectStyleProfile(project.id)
    const snapshot = {
      projectId: project.id, projectRevision: project.revision, chapterId, chapterRevision: chapter.revision,
      inputManuscriptVersionId: chapter.currentDraftVersionId ?? chapter.currentApprovedVersionId,
      foundationAssemblyHash: foundation.assemblyHash, styleRevision: style.revision,
      workflowDefinitionVersionId: CHAPTER_WORKFLOW_VERSION_ID, knowledgeSelectionSnapshotId: selectionSnapshotId,
    }
    this.activeProjectTransaction(project.id, () => {
      this.assertProjectWorkflowSlot(project.id)
      this.db.prepare('INSERT INTO knowledge_selection_snapshots(id,project_id,project_revision,excluded_source_ids_json,created_at) VALUES (?,?,?,?,?)').run(selectionSnapshotId, project.id, project.revision, JSON.stringify([...new Set(excludedSourceIds)]), timestamp)
      const settings = this.db.prepare(`SELECT s.source_project_id,p.title,s.scopes_json FROM historical_source_settings s JOIN projects p ON p.id=s.source_project_id WHERE s.project_id=? AND s.enabled=1`).all(project.id) as Row[]
      for (const setting of settings) {
        if (excludedSourceIds.includes(String(setting.source_project_id))) continue
        this.db.prepare('INSERT INTO knowledge_selection_items(id,snapshot_id,source_project_id,source_project_title,scopes_json) VALUES (?,?,?,?,?)').run(id('knowledge-selection-item'), selectionSnapshotId, String(setting.source_project_id), String(setting.title), String(setting.scopes_json))
      }
      this.db.prepare(`INSERT INTO workflow_runs(id,project_id,chapter_id,definition_version_id,status,current_node_key,input_snapshot_json,project_revision_at_start,chapter_revision_at_start,revision_round,created_at,started_at,knowledge_selection_snapshot_id)
        VALUES (?,?,?,?,'running',?,?,?,?,0,?,?,?)`).run(workflowRunId, project.id, chapterId, CHAPTER_WORKFLOW_VERSION_ID, CHAPTER_WORKFLOW_NODES[0], JSON.stringify(snapshot), project.revision, chapter.revision, timestamp, timestamp, selectionSnapshotId)
      this.addWorkflowEvent(workflowRunId, null, 'workflow.started', snapshot)
    })
    this.refreshProjectRecoveryCapsules(project.id)
    return this.getWorkflowRun(workflowRunId)
  }

  getWorkflowRun(workflowRunId: string): WorkflowRun {
    const row = this.one(this.db.prepare('SELECT * FROM workflow_runs WHERE id=?'), workflowRunId)
    const definitionRow = this.one(this.db.prepare(`SELECT v.*,d.definition_key,d.name FROM workflow_definition_versions v JOIN workflow_definitions d ON d.id=v.workflow_definition_id WHERE v.id=?`), String(row.definition_version_id))
    const parsed = JSON.parse(String(definitionRow.definition_json)) as { nodes: string[] }
    const definition: WorkflowDefinitionVersion = { id: String(definitionRow.id), definitionId: String(definitionRow.workflow_definition_id), key: String(definitionRow.definition_key), name: String(definitionRow.name), version: Number(definitionRow.version), nodes: parsed.nodes, contentHash: String(definitionRow.content_hash), createdAt: String(definitionRow.created_at) }
    const approvalRow = this.db.prepare('SELECT * FROM workflow_approvals WHERE workflow_run_id=? ORDER BY created_at DESC LIMIT 1').get(workflowRunId) as Row | undefined
    return {
      id: String(row.id), projectId: String(row.project_id), chapterId: String(row.chapter_id), definitionVersionId: String(row.definition_version_id), status: row.status as WorkflowRunStatus,
      currentNodeKey: row.current_node_key === null ? null : String(row.current_node_key), inputSnapshotJson: String(row.input_snapshot_json), projectRevisionAtStart: Number(row.project_revision_at_start), chapterRevisionAtStart: Number(row.chapter_revision_at_start),
      approvedVersionId: row.approved_version_id === null ? null : String(row.approved_version_id), revisionRound: Number(row.revision_round), createdAt: String(row.created_at), startedAt: String(row.started_at), finishedAt: row.finished_at === null ? null : String(row.finished_at), errorJson: row.error_json === null ? null : String(row.error_json),
      knowledgeSelectionSnapshotId: row.knowledge_selection_snapshot_id === null ? null : String(row.knowledge_selection_snapshot_id),
      knowledgeSelectionSnapshot: row.knowledge_selection_snapshot_id === null ? null : this.getKnowledgeSelectionSnapshot(String(row.knowledge_selection_snapshot_id)),
      retrievalBundle: this.getRetrievalBundleForWorkflow(workflowRunId),
      definition,
      nodes: (this.db.prepare('SELECT * FROM workflow_node_runs WHERE workflow_run_id=? ORDER BY started_at, attempt').all(workflowRunId) as Row[]).map(nodeRunFrom),
      events: (this.db.prepare('SELECT * FROM workflow_events WHERE workflow_run_id=? ORDER BY created_at').all(workflowRunId) as Row[]).map(eventFrom),
      approval: approvalRow ? approvalFrom(approvalRow) : null,
      reviews: (this.db.prepare('SELECT * FROM review_reports WHERE workflow_run_id=? ORDER BY created_at').all(workflowRunId) as Row[]).map(reviewFrom),
      canonCandidates: (this.db.prepare('SELECT * FROM canon_candidates WHERE workflow_run_id=? ORDER BY created_at').all(workflowRunId) as Row[]).map(candidateFrom),
      canonFacts: (this.db.prepare(`SELECT f.* FROM canon_facts f JOIN canon_candidates c ON c.id=f.candidate_id WHERE c.workflow_run_id=? ORDER BY f.created_at`).all(workflowRunId) as Row[]).map(factFrom),
    }
  }

  listChapterWorkflows(chapterId: string): WorkflowRun[] {
    return (this.db.prepare('SELECT id FROM workflow_runs WHERE chapter_id=? ORDER BY created_at DESC').all(chapterId) as Row[]).map(row => this.getWorkflowRun(String(row.id)))
  }

  getStudioOverview(): StudioOverview {
    const projects = this.listProjects().map(project => {
      const counts = this.db.prepare(`SELECT
        (SELECT COUNT(*) FROM books WHERE project_id=?) book_count,
        (SELECT COUNT(*) FROM volumes WHERE project_id=?) volume_count,
        (SELECT COUNT(*) FROM chapters WHERE project_id=?) chapter_count,
        (SELECT COUNT(*) FROM chapters WHERE project_id=? AND status='approved') approved_chapter_count,
        (SELECT COUNT(*) FROM workflow_runs WHERE project_id=? AND status IN ('running','paused','waiting_approval','cancel_requested')) active_workflow_count,
        (SELECT COUNT(*) FROM workflow_runs WHERE project_id=? AND status='waiting_approval') waiting_approval_count`).get(project.id, project.id, project.id, project.id, project.id, project.id) as Row
      const latest = this.db.prepare('SELECT id FROM workflow_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 1').get(project.id) as Row | undefined
      return { project, bookCount: Number(counts.book_count), volumeCount: Number(counts.volume_count), chapterCount: Number(counts.chapter_count), approvedChapterCount: Number(counts.approved_chapter_count), latestWorkflow: latest ? this.getWorkflowRun(String(latest.id)) : null, activeWorkflowCount: Number(counts.active_workflow_count), waitingApprovalCount: Number(counts.waiting_approval_count) }
    })
    const runs = (where: string, limit = 20) => (this.db.prepare(`SELECT id FROM workflow_runs ${where} ORDER BY created_at DESC LIMIT ?`).all(limit) as Row[]).map(row => this.getWorkflowRun(String(row.id)))
    return {
      projects,
      activeRuns: runs("WHERE status IN ('running','paused','cancel_requested')"),
      waitingApprovalRuns: runs("WHERE status='waiting_approval'"),
      failedRuns: runs("WHERE status='failed'"),
      recentRuns: runs("WHERE status IN ('succeeded','cancelled')", 12),
    }
  }

  getProjectGenerationStatistics(projectId: string): ProjectGenerationStatistics {
    const tree = this.getProjectTree(projectId)
    const emptyTotals = (): GenerationStatisticsTotals => ({
      runs: 0,
      succeededRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      usageReportedRuns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      generatedDrafts: 0,
      generatedWords: 0,
    })
    const totals = emptyTotals()
    const purposes: ProjectGenerationStatistics['purposes'] = (['scene-plan', 'chapter-draft'] as const).map(purpose => ({ purpose, ...emptyTotals() }))
    const purposeByKey = new Map(purposes.map(value => [value.purpose, value]))
    const chapters: ProjectGenerationStatistics['chapters'] = tree.books.flatMap(book => book.volumes.flatMap(volume => volume.chapters.map(chapter => ({
      chapterId: chapter.id,
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title,
      bookTitle: book.title,
      volumeTitle: volume.title,
      status: chapter.status,
      lastRunAt: null,
      ...emptyTotals(),
    }))))
    const chapterById = new Map(chapters.map(value => [value.chapterId, value]))
    const addRun = (target: GenerationStatisticsTotals, status: ModelRun['status'], usage: ModelUsage | null) => {
      target.runs += 1
      if (status === 'succeeded') target.succeededRuns += 1
      else if (status === 'failed') target.failedRuns += 1
      else target.runningRuns += 1
      if (!usage) return
      target.usageReportedRuns += 1
      target.inputTokens += usage.inputTokens
      target.outputTokens += usage.outputTokens
      target.cacheReadTokens += usage.cacheReadTokens ?? 0
      target.cacheWriteTokens += usage.cacheWriteTokens ?? 0
      target.reasoningTokens += usage.reasoningTokens ?? 0
    }
    const readUsage = (value: unknown): ModelUsage | null => {
      if (typeof value !== 'string' || !value) return null
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>
        if (typeof parsed.inputTokens !== 'number' || !Number.isFinite(parsed.inputTokens) || parsed.inputTokens < 0
          || typeof parsed.outputTokens !== 'number' || !Number.isFinite(parsed.outputTokens) || parsed.outputTokens < 0) return null
        const optional = (key: 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens') => {
          const item = parsed[key]
          return typeof item === 'number' && Number.isFinite(item) && item >= 0 ? Math.trunc(item) : undefined
        }
        const cacheReadTokens = optional('cacheReadTokens')
        const cacheWriteTokens = optional('cacheWriteTokens')
        const reasoningTokens = optional('reasoningTokens')
        return {
          inputTokens: Math.trunc(parsed.inputTokens),
          outputTokens: Math.trunc(parsed.outputTokens),
          ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
          ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
          ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
        }
      } catch { return null }
    }
    const runRows = this.db.prepare(`SELECT chapter_id,purpose,status,usage_json,created_at
      FROM model_runs WHERE project_id=? ORDER BY created_at,id`).all(projectId) as Row[]
    for (const row of runRows) {
      const purpose = row.purpose as GenerationPurpose
      const status = row.status as ModelRun['status']
      const usage = readUsage(row.usage_json)
      const purposeTotals = purposeByKey.get(purpose)
      const chapterTotals = chapterById.get(String(row.chapter_id))
      addRun(totals, status, usage)
      if (purposeTotals) addRun(purposeTotals, status, usage)
      if (chapterTotals) {
        addRun(chapterTotals, status, usage)
        const createdAt = String(row.created_at)
        if (!chapterTotals.lastRunAt || createdAt > chapterTotals.lastRunAt) chapterTotals.lastRunAt = createdAt
      }
    }
    const generatedRows = this.db.prepare(`SELECT chapter_id,word_count FROM (
        SELECT m.chapter_id,m.word_count,
          ROW_NUMBER() OVER (PARTITION BY m.model_run_id ORDER BY m.created_at,m.id) generated_ordinal
        FROM manuscript_versions m
        JOIN model_runs r ON r.id=m.model_run_id AND r.project_id=m.project_id
        WHERE m.project_id=? AND m.origin='model' AND r.purpose='chapter-draft' AND r.status='succeeded'
      ) WHERE generated_ordinal=1`).all(projectId) as Row[]
    const draftTotals = purposeByKey.get('chapter-draft')!
    for (const row of generatedRows) {
      const words = Math.max(0, Number(row.word_count) || 0)
      for (const target of [totals, draftTotals, chapterById.get(String(row.chapter_id))]) {
        if (!target) continue
        target.generatedDrafts += 1
        target.generatedWords += words
      }
    }
    return {
      project: { id: tree.project.id, title: tree.project.title, status: tree.project.status },
      totals,
      purposes,
      chapters,
      generatedAt: now(),
    }
  }

  getStoryGrowthMap(projectId: string): StoryGrowthMap {
    const tree = this.getProjectTree(projectId)
    const anchors = tree.books.flatMap(book =>
      book.volumes.flatMap(volume =>
        volume.chapters.map(chapter => {
          const detail = this.getChapter(chapter.id)
          const branches = detail.versions.slice().reverse().map(version => ({
            versionId: version.id,
            status: version.status,
            wordCount: version.wordCount,
            origin: version.origin,
            createdAt: version.createdAt,
          }))
          return {
            chapterId: chapter.id,
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.title,
            bookTitle: book.title,
            volumeTitle: volume.title,
            status: chapter.status,
            totalWordCount: branches.reduce((sum, branch) => sum + branch.wordCount, 0),
            approvedWordCount: branches.filter(branch => branch.status === 'approved').reduce((sum, branch) => sum + branch.wordCount, 0),
            branches,
          }
        })
      )
    )
    return {
      project: tree.project,
      anchors,
      totalWordCount: anchors.reduce((sum, anchor) => sum + anchor.totalWordCount, 0),
      approvedWordCount: anchors.reduce((sum, anchor) => sum + anchor.approvedWordCount, 0),
      generatedAt: now(),
    }
  }

  getApprovedProjectFoundationVersions(projectId: string): ProjectFoundationVersion[] {
    this.getProjectTree(projectId)
    const rows = this.db.prepare(`SELECT * FROM project_foundation_versions
      WHERE project_id=? AND status='approved' AND foundation_kind IN ('outline','characters','timeline') ORDER BY CASE foundation_kind
      WHEN 'outline' THEN 1 WHEN 'characters' THEN 2 WHEN 'timeline' THEN 3 END`).all(projectId) as Row[]
    return rows.map(foundationVersionFrom)
  }

  getProjectFoundation(projectId: string): ProjectFoundationWorkspace {
    const project = this.getProjectTree(projectId).project
    const rows = this.db.prepare('SELECT * FROM project_foundation_versions WHERE project_id=? ORDER BY foundation_kind,version DESC').all(projectId) as Row[]
    const versions = rows.map(foundationVersionFrom)
    const approved = new Map(this.getApprovedProjectFoundationVersions(projectId).map(version => [version.kind, version]))
    const generationRuns = (this.db.prepare('SELECT * FROM project_foundation_generation_runs WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Row[]).map(foundationGenerationRunFrom)
    const latestRuns = new Map<ProjectFoundationKind, FoundationGenerationRun>()
    const activeRuns = new Map<ProjectFoundationKind, FoundationGenerationRun>()
    for (const run of generationRuns) {
      if (!latestRuns.has(run.kind)) latestRuns.set(run.kind, run)
      if (['planning','waiting_input','generating'].includes(run.status) && !activeRuns.has(run.kind)) activeRuns.set(run.kind, run)
    }
    const stages = FOUNDATION_DEFINITIONS.map((definition, index) => {
      const kindVersions = versions.filter(version => version.kind === definition.kind).sort((a, b) => b.version - a.version)
      const latestVersion = kindVersions[0] ?? null
      const approvedVersion = approved.get(definition.kind) ?? null
      const dependenciesReady = definition.dependencies.every(kind => approved.has(kind))
      const pendingDraft = kindVersions.find(version => version.status === 'draft') ?? null
      const status = !dependenciesReady ? 'locked' : pendingDraft ? 'draft' : approvedVersion ? 'approved' : 'ready'
      return {
        ...definition,
        position: index + 1,
        status: status as 'locked' | 'ready' | 'draft' | 'approved',
        latestVersion,
        approvedVersion,
        versionCount: kindVersions.length,
        canGenerate: dependenciesReady,
        canApprove: dependenciesReady && Boolean(pendingDraft),
        activeGenerationRun: activeRuns.get(definition.kind) ?? null,
        latestGenerationRun: latestRuns.get(definition.kind) ?? null,
      }
    })
    const approvedVersions = FOUNDATION_DEFINITIONS.map(item => approved.get(item.kind)).filter((value): value is ProjectFoundationVersion => Boolean(value))
    return {
      project,
      stages,
      readyForChapterGeneration: approvedVersions.length === FOUNDATION_DEFINITIONS.length,
      approvedVersionIds: approvedVersions.map(version => version.id),
      // The hash represents the currently approved subset. Readiness remains a
      // separate recommendation, so zero/partial Foundation can still freeze a
      // stable generation snapshot without becoming a chapter-writing gate.
      assemblyHash: createHash('sha256').update(approvedVersions.length
        ? approvedVersions.map(version => `${version.id}:${version.contentHash}`).join('|')
        : `project:${project.id}:no-approved-foundation`).digest('hex'),
    }
  }

  createProjectFoundationVersion(projectId: string, kind: ProjectFoundationKind, output: { title: string; content: string }, trace: { provider: string; model: string; promptVersion: string; promptHash: string; outputJson: string; generationRunId?: string }): ProjectFoundationWorkspace {
    this.assertProjectActive(projectId)
    if (trace.generationRunId) {
      const existing = this.db.prepare('SELECT id FROM project_foundation_versions WHERE generation_run_id=?').get(trace.generationRunId) as Row | undefined
      if (existing) return this.getProjectFoundation(projectId)
    }
    const workspace = this.getProjectFoundation(projectId)
    const stage = workspace.stages.find(item => item.kind === kind)
    if (!stage) throw new DomainError('validation', `Unknown project foundation kind ${kind}.`)
    if (!stage.canGenerate) throw new DomainError('invalid-state', `Approve ${stage.dependencies.join(', ')} before generating ${kind}.`)
    const title = output.title.trim(), content = output.content.trim()
    if (!title || content.length < 20) throw new DomainError('validation', 'Project foundation generation needs a title and at least 20 characters of content.')
    const dependencyVersionIds = stage.dependencies.map(dependency => {
      const approvedVersion = workspace.stages.find(item => item.kind === dependency)?.approvedVersion
      if (!approvedVersion) throw new DomainError('invalid-state', `Approved dependency ${dependency} is missing.`)
      return approvedVersion.id
    })
    const timestamp = now(), versionId = id('foundation-version')
    const version = Number((this.db.prepare('SELECT COALESCE(MAX(version),0)+1 value FROM project_foundation_versions WHERE project_id=? AND foundation_kind=?').get(projectId, kind) as Row).value)
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare("UPDATE project_foundation_versions SET status='superseded' WHERE project_id=? AND foundation_kind=? AND status='draft'").run(projectId, kind)
      this.db.prepare(`INSERT INTO project_foundation_versions(id,project_id,foundation_kind,version,title,content,content_hash,status,provider,model,prompt_version,prompt_hash,dependency_version_ids_json,output_json,generation_run_id,created_at)
        VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?)`).run(versionId, projectId, kind, version, title, content, createHash('sha256').update(content).digest('hex'), trace.provider, trace.model, trace.promptVersion, trace.promptHash, JSON.stringify(dependencyVersionIds), trace.outputJson, trace.generationRunId ?? null, timestamp)
      this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, projectId)
    })
    this.refreshProjectRecoveryCapsules(projectId)
    const project = this.getProjectTree(projectId).project
    if (project.status === 'active' && project.markdownSyncEnabled && project.workspacePath) {
      try {
        this.activeProjectTransaction(projectId, () => {
          writeFoundationMarkdown(project.workspacePath!, kind, title, content, 'draft')
        })
      } catch { /* Optional mirror failure or concurrent archive does not roll back the SQLite draft. */ }
    }
    return this.getProjectFoundation(projectId)
  }

  approveProjectFoundationVersion(projectId: string, kind: ProjectFoundationKind, versionId: string): ProjectFoundationWorkspace {
    this.assertProjectActive(projectId)
    const workspace = this.getProjectFoundation(projectId)
    const stage = workspace.stages.find(item => item.kind === kind)
    if (!stage || !stage.canApprove) throw new DomainError('invalid-state', `${kind} has no approvable draft or its dependencies are incomplete.`)
    const version = this.one(this.db.prepare("SELECT id FROM project_foundation_versions WHERE id=? AND project_id=? AND foundation_kind=? AND status='draft'"), versionId, projectId, kind)
    const timestamp = now()
    const foundationIndex = FOUNDATION_DEFINITIONS.findIndex(item => item.kind === kind)
    const downstreamKinds = FOUNDATION_DEFINITIONS.slice(foundationIndex + 1).map(item => item.kind)
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare("UPDATE project_foundation_versions SET status='superseded' WHERE project_id=? AND foundation_kind=? AND status='approved'").run(projectId, kind)
      this.db.prepare("UPDATE project_foundation_versions SET status='approved',approved_at=? WHERE id=?").run(timestamp, String(version.id))
      if (downstreamKinds.length > 0) {
        const placeholders = downstreamKinds.map(() => '?').join(',')
        this.db.prepare(`UPDATE project_foundation_versions SET status='superseded'
          WHERE project_id=? AND foundation_kind IN (${placeholders}) AND status IN ('draft','approved')`).run(projectId, ...downstreamKinds)
      }
      this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, projectId)
    })
    this.refreshProjectRecoveryCapsules(projectId)
    const approvedContent = String(this.one(this.db.prepare('SELECT content FROM project_foundation_versions WHERE id=?'), String(version.id)).content)
    const project = this.getProjectTree(projectId).project
    if (project.status === 'active' && project.markdownSyncEnabled && project.workspacePath) {
      try {
        this.activeProjectTransaction(projectId, () => {
          writeFoundationMarkdown(project.workspacePath!, kind, String(this.one(this.db.prepare('SELECT title FROM project_foundation_versions WHERE id=?'), String(version.id)).title), approvedContent, 'approved')
        })
      } catch { /* Optional mirror failure or concurrent archive does not roll back the SQLite approval. */ }
    }
    return this.getProjectFoundation(projectId)
  }

  createFoundationGenerationRun(projectId: string, kind: ProjectFoundationKind, brief: string, guided: boolean, selection: ModelSelection, interactionSessionId: string | null = null): FoundationGenerationRun {
    this.assertProjectActive(projectId)
    const workspace = this.getProjectFoundation(projectId)
    const stage = workspace.stages.find(item => item.kind === kind)
    if (!stage) throw new DomainError('validation', `Unknown project foundation kind ${kind}.`)
    if (!stage.canGenerate) throw new DomainError('invalid-state', `Approve ${stage.dependencies.join(', ')} before generating ${kind}.`)
    const active = this.db.prepare("SELECT id,foundation_kind,status,phase FROM project_foundation_generation_runs WHERE project_id=? AND status IN ('planning','waiting_input','generating')").get(projectId) as Row | undefined
    if (active) {
      const activeKind = active.foundation_kind as ProjectFoundationKind
      const state = String(active.status) === 'waiting_input' ? '正在等待回答' : String(active.status) === 'generating' ? '正在生成' : '正在分析'
      throw new DomainError('invalid-state', `“${FOUNDATION_LABELS[activeKind]}”${state}，请先完成或取消它，再启动“${FOUNDATION_LABELS[kind]}”。`)
    }
    const dependencyVersionIds = stage.dependencies.map(dependency => {
      const approved = workspace.stages.find(item => item.kind === dependency)?.approvedVersion
      if (!approved) throw new DomainError('invalid-state', `Approved dependency ${dependency} is missing.`)
      return approved.id
    })
    const runId = id('foundation-run'), timestamp = now()
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`INSERT INTO project_foundation_generation_runs(
        id,project_id,foundation_kind,guided,status,phase,progress,brief,questions_json,answers_json,dependency_version_ids_json,provider,model,interaction_session_id,created_at,updated_at,started_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        runId, projectId, kind, guided ? 1 : 0, guided ? 'planning' : 'generating', guided ? 'analyzing_project' : 'assembling_context', guided ? 5 : 42,
        brief.trim(), '[]', '[]', JSON.stringify(dependencyVersionIds), selection.provider, selection.model, interactionSessionId?.trim() || null, timestamp, timestamp, timestamp,
      )
    })
    return this.getFoundationGenerationRun(runId)
  }

  getFoundationGenerationRun(runId: string): FoundationGenerationRun {
    return foundationGenerationRunFrom(this.one(this.db.prepare('SELECT * FROM project_foundation_generation_runs WHERE id=?'), runId))
  }

  listRecoverableFoundationGenerationRuns(): FoundationGenerationRun[] {
    return (this.db.prepare("SELECT * FROM project_foundation_generation_runs WHERE foundation_kind IN ('outline','characters','timeline') AND status IN ('planning','waiting_input','generating') ORDER BY created_at").all() as Row[]).map(foundationGenerationRunFrom)
  }

  listWaitingFoundationInteractions(sessionId: string): FoundationGenerationRun[] {
    return (this.db.prepare("SELECT * FROM project_foundation_generation_runs WHERE interaction_session_id=? AND status='waiting_input' ORDER BY created_at").all(sessionId) as Row[]).map(foundationGenerationRunFrom)
  }

  bindFoundationInteractionSession(runId: string, sessionId: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (!run.guided || !['planning','waiting_input'].includes(run.status)) throw new DomainError('invalid-state', '当前运行不能绑定 Harness 原生提问会话。')
    const normalized = sessionId.trim()
    if (!normalized) throw new DomainError('validation', 'Harness 会话 id 不能为空。')
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare('UPDATE project_foundation_generation_runs SET interaction_session_id=?,updated_at=? WHERE id=?').run(normalized, now(), runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  clearFoundationInteractionSession(runId: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (!run.guided || !['planning','waiting_input'].includes(run.status)) throw new DomainError('invalid-state', '当前运行不能切换为工作室内嵌提问。')
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare('UPDATE project_foundation_generation_runs SET interaction_session_id=NULL,updated_at=? WHERE id=?').run(now(), runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  updateFoundationGenerationRunProgress(runId: string, phase: string, progress: number, streamedCharacters?: number, telemetry?: GenerationTelemetry): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (!['planning','generating'].includes(run.status)) return run
    const safeProgress = Math.max(run.progress, Math.max(0, Math.min(99, Math.round(progress))))
    const safeCharacters = streamedCharacters === undefined ? run.streamedCharacters : Math.max(run.streamedCharacters, Math.round(streamedCharacters))
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare('UPDATE project_foundation_generation_runs SET phase=?,progress=?,streamed_characters=?,generation_telemetry_json=?,updated_at=? WHERE id=?').run(phase, safeProgress, safeCharacters, JSON.stringify(telemetry ?? run.generationTelemetry), now(), runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  resetFoundationGenerationStream(runId: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'generating') return run
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare("UPDATE project_foundation_generation_runs SET streamed_characters=0,streamed_text='',streamed_text_updated_at=NULL,generation_telemetry_json='{}',updated_at=? WHERE id=? AND status='generating'").run(now(), runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  updateFoundationGenerationStream(runId: string, streamedText: string, progress?: number, receivedCharacters?: number, telemetry?: GenerationTelemetry): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'generating' || streamedText.length < run.streamedText.length || streamedText === run.streamedText) return run
    const timestamp = now()
    const safeProgress = progress === undefined ? run.progress : Math.max(run.progress, Math.max(0, Math.min(99, Math.round(progress))))
    const safeCharacters = receivedCharacters === undefined ? run.streamedCharacters : Math.max(run.streamedCharacters, Math.round(receivedCharacters))
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare("UPDATE project_foundation_generation_runs SET phase='generating_content',progress=?,streamed_characters=?,streamed_text=?,streamed_text_updated_at=?,generation_telemetry_json=?,updated_at=? WHERE id=? AND status='generating'").run(safeProgress, safeCharacters, streamedText, timestamp, JSON.stringify(telemetry ?? run.generationTelemetry), timestamp, runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  setFoundationGenerationQuestions(runId: string, questions: FoundationPlannerQuestion[], readinessSummary: string, promptHash: string, outputJson: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'planning') throw new DomainError('invalid-state', 'Foundation generation run is not planning questions.')
    if (questions.length < 1 || questions.length > 3 || questions.some(question => !question.id.trim() || !question.question.trim() || question.options.length < 2 || question.options.length > 3)) {
      throw new DomainError('validation', 'Foundation planner requires one to three questions with two or three options each.')
    }
    const round = run.planningRound + 1
    const normalizedQuestions = questions.map((question, questionIndex) => ({
      ...question,
      id: `r${round}-q${questionIndex + 1}`,
      options: question.options.map((option, optionIndex) => ({ ...option, id: `r${round}-q${questionIndex + 1}-o${optionIndex + 1}` })),
    }))
    const history = this.foundationPlanningHistory(runId)
    history.push({ round, informationSufficient: false, readinessSummary: readinessSummary.trim(), promptHash, outputJson })
    const progress = Math.max(run.progress, round === 1 ? 30 : 40)
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET status='waiting_input',phase='awaiting_answers',progress=?,questions_json=?,planning_round=?,information_ready=0,readiness_summary=?,question_prompt_hash=?,question_output_json=?,planning_history_json=?,updated_at=? WHERE id=?`).run(
        progress, JSON.stringify([...run.questions, ...normalizedQuestions]), round, readinessSummary.trim(), promptHash, outputJson, JSON.stringify(history), now(), runId,
      )
    })
    return this.getFoundationGenerationRun(runId)
  }

  setFoundationInformationReady(runId: string, readinessSummary: string, promptHash: string, outputJson: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'planning') throw new DomainError('invalid-state', 'Foundation generation run is not evaluating information.')
    if (!run.guided || run.answers.length < 1) throw new DomainError('invalid-state', '至少完成一轮用户回答后才能判定信息充分。')
    if (run.questions.some(question => !run.answers.some(answer => answer.questionId === question.id))) throw new DomainError('invalid-state', '仍有规划问题尚未回答。')
    const history = this.foundationPlanningHistory(runId)
    history.push({ round: run.planningRound, informationSufficient: true, readinessSummary: readinessSummary.trim(), promptHash, outputJson })
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET status='generating',phase='information_ready',progress=?,information_ready=1,readiness_summary=?,question_prompt_hash=?,question_output_json=?,planning_history_json=?,updated_at=? WHERE id=?`).run(
        Math.max(run.progress, 42), readinessSummary.trim(), promptHash, outputJson, JSON.stringify(history), now(), runId,
      )
    })
    return this.getFoundationGenerationRun(runId)
  }

  closeFoundationPlanning(runId: string, readinessSummary: string, reason: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (!run.guided || !['planning','waiting_input'].includes(run.status)) throw new DomainError('invalid-state', '当前创作基建规划不能直接收口。')
    if (run.answers.length < 1) throw new DomainError('invalid-state', '至少确认一项创作方向后才能进入正式草稿。')
    const normalizedSummary = readinessSummary.trim()
    if (!normalizedSummary) throw new DomainError('validation', '有界规划收口必须记录信息准备度说明。')
    const promptHash = createHash('sha256').update(`bounded-foundation-intake-v1\n${reason}\n${run.id}\n${run.answers.length}`).digest('hex')
    const outputJson = JSON.stringify({ informationSufficient: true, readinessSummary: normalizedSummary, questions: [], resolution: reason })
    const history = this.foundationPlanningHistory(runId)
    history.push({ round: run.planningRound, informationSufficient: true, readinessSummary: normalizedSummary, promptHash, outputJson })
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET status='generating',phase='information_ready',progress=?,information_ready=1,readiness_summary=?,question_prompt_hash=?,question_output_json=?,planning_history_json=?,error_json=NULL,updated_at=?,finished_at=NULL WHERE id=?`).run(
        Math.max(run.progress, 42), normalizedSummary, promptHash, outputJson, JSON.stringify(history), now(), runId,
      )
    })
    return this.getFoundationGenerationRun(runId)
  }

  answerFoundationGenerationQuestion(runId: string, answer: FoundationPlannerAnswer): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'waiting_input') throw new DomainError('invalid-state', 'Foundation planner is not waiting for answers.')
    const question = run.questions.find(item => item.id === answer.questionId)
    if (!question) throw new DomainError('validation', 'Unknown foundation planner question.')
    const optionId = answer.optionId?.trim() || null
    const customText = answer.customText.trim()
    if (optionId && !question.options.some(option => option.id === optionId)) throw new DomainError('validation', 'Unknown planner option.')
    if (!optionId && !customText && answer.skipped !== true) throw new DomainError('validation', 'Choose an option, provide a custom answer, or explicitly skip the question.')
    const answers = new Map(run.answers.map(item => [item.questionId, item]))
    answers.set(question.id, { questionId: question.id, optionId, customText, ...(answer.skipped === true ? { skipped: true } : {}) })
    const nextAnswers = run.questions.flatMap(item => answers.get(item.id) ? [answers.get(item.id)!] : [])
    const complete = nextAnswers.length === run.questions.length
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET answers_json=?,status=?,phase=?,progress=?,updated_at=? WHERE id=?`).run(
        JSON.stringify(nextAnswers), complete ? 'planning' : 'waiting_input', complete ? 'evaluating_information' : 'awaiting_answers', complete ? Math.max(run.progress, 35) : run.progress, now(), runId,
      )
    })
    return this.getFoundationGenerationRun(runId)
  }

  completeFoundationGenerationRun(runId: string, output: { title: string; content: string }, trace: { promptVersion: string; promptHash: string; outputJson: string; usage?: ModelUsage; telemetry?: GenerationTelemetry }): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'generating') throw new DomainError('invalid-state', 'Foundation generation run is not generating content.')
    if (run.guided && !run.informationReady) throw new DomainError('invalid-state', '创作信息尚未确认充分，不能生成正式内容。')
    const workspace = this.getProjectFoundation(run.projectId)
    const stage = workspace.stages.find(item => item.kind === run.kind)
    if (!stage) throw new DomainError('invalid-state', 'Foundation stage is unavailable.')
    const currentDependencies = stage.dependencies.map(dependency => workspace.stages.find(item => item.kind === dependency)?.approvedVersion?.id ?? '')
    if (JSON.stringify(currentDependencies) !== JSON.stringify(run.dependencyVersionIds)) throw new DomainError('revision-conflict', '前置创作基建已发生变化，请重新开始本次规划。')
    this.createProjectFoundationVersion(run.projectId, run.kind, output, {
      provider: run.provider, model: run.model, promptVersion: trace.promptVersion, promptHash: trace.promptHash, outputJson: trace.outputJson, generationRunId: run.id,
    })
    const version = this.db.prepare('SELECT id FROM project_foundation_versions WHERE generation_run_id=?').get(run.id) as Row
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET status='succeeded',phase='complete',progress=100,streamed_characters=?,streamed_text=?,streamed_text_updated_at=?,generation_telemetry_json=?,result_version_id=?,error_json=NULL,updated_at=?,finished_at=? WHERE id=?`).run(output.content.length, output.content, timestamp, JSON.stringify(trace.telemetry ?? run.generationTelemetry), String(version.id), timestamp, timestamp, run.id)
    })
    return this.getFoundationGenerationRun(run.id)
  }

  failFoundationGenerationRun(runId: string, error: unknown): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (['succeeded','cancelled'].includes(run.status)) return run
    const payload = error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) }
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET status='failed',phase='failed',error_json=?,updated_at=?,finished_at=? WHERE id=?`).run(JSON.stringify(payload), timestamp, timestamp, runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  cancelFoundationGenerationRun(runId: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (!['planning','waiting_input','generating'].includes(run.status)) return run
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET status='cancelled',phase='cancelled',updated_at=?,finished_at=? WHERE id=?`).run(timestamp, timestamp, runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  retryFoundationGenerationRun(runId: string): FoundationGenerationRun {
    const run = this.getFoundationGenerationRun(runId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'failed') throw new DomainError('invalid-state', 'Only a failed foundation generation can be retried.')
    const active = this.db.prepare("SELECT id FROM project_foundation_generation_runs WHERE project_id=? AND status IN ('planning','waiting_input','generating')").get(run.projectId) as Row | undefined
    if (active) throw new DomainError('invalid-state', '当前项目已有一项创作基建正在规划或生成。')
    const workspace = this.getProjectFoundation(run.projectId)
    const stage = workspace.stages.find(item => item.kind === run.kind)
    const currentDependencies = stage?.dependencies.map(dependency => workspace.stages.find(item => item.kind === dependency)?.approvedVersion?.id ?? '') ?? []
    if (JSON.stringify(currentDependencies) !== JSON.stringify(run.dependencyVersionIds)) throw new DomainError('revision-conflict', '前置创作基建已发生变化，请重新开始本次规划。')
    const unanswered = run.questions.filter(question => !run.answers.some(answer => answer.questionId === question.id))
    const status = run.informationReady || !run.guided ? 'generating' : unanswered.length > 0 ? 'waiting_input' : 'planning'
    const phase = status === 'generating' ? 'assembling_context' : status === 'waiting_input' ? 'awaiting_answers' : run.answers.length > 0 ? 'evaluating_information' : 'analyzing_project'
    const progress = status === 'generating' ? Math.max(run.progress, 45) : status === 'waiting_input' ? run.progress : run.answers.length > 0 ? Math.max(run.progress, 35) : 5
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`UPDATE project_foundation_generation_runs SET status=?,phase=?,progress=?,streamed_characters=0,streamed_text='',streamed_text_updated_at=NULL,error_json=NULL,updated_at=?,started_at=?,finished_at=NULL WHERE id=?`).run(status, phase, progress, timestamp, timestamp, runId)
    })
    return this.getFoundationGenerationRun(runId)
  }

  private foundationPlanningHistory(runId: string): Array<{ round: number; informationSufficient: boolean; readinessSummary: string; promptHash: string; outputJson: string }> {
    const row = this.one(this.db.prepare('SELECT planning_history_json FROM project_foundation_generation_runs WHERE id=?'), runId)
    try { return JSON.parse(String(row.planning_history_json)) as Array<{ round: number; informationSufficient: boolean; readinessSummary: string; promptHash: string; outputJson: string }> }
    catch { return [] }
  }

  listRecoverableWorkflows(): WorkflowRun[] {
    const timestamp = now()
    const finalizedProjectIds = new Set<string>()
    this.transaction(() => {
      const cancelling = this.db.prepare("SELECT id FROM workflow_runs WHERE status='cancel_requested'").all() as Row[]
      for (const row of cancelling) {
        const workflowRunId = String(row.id)
        this.db.prepare("UPDATE workflow_node_runs SET status='cancelled',error_json=?,finished_at=? WHERE workflow_run_id=? AND status IN ('running','waiting_approval','failed_retryable')").run(JSON.stringify({ code: 'workflow-cancelled', message: 'Host 重启时完成了遗留取消请求。' }), timestamp, workflowRunId)
        this.db.prepare("UPDATE workflow_approvals SET status='rejected',decision_note='工作流已取消。',decided_at=? WHERE workflow_run_id=? AND status='pending'").run(timestamp, workflowRunId)
        this.failRunningModelRunsForWorkflowUnchecked(workflowRunId, timestamp, 'workflow-cancelled', '工作流已取消，模型结果不会写入。')
        this.db.prepare("UPDATE workflow_runs SET status='cancelled',current_node_key=NULL,error_json=NULL,finished_at=? WHERE id=? AND status='cancel_requested'").run(timestamp, workflowRunId)
        this.addWorkflowEvent(workflowRunId, null, 'workflow.cancelled', { source: 'host-recovery' })
      }
      this.db.prepare("UPDATE model_runs SET status='failed',error_json=?,finished_at=? WHERE status='running'")
        .run(JSON.stringify({ code: 'host-restart-interrupted', message: 'Host 重启中断了模型运行；关联工作流将从持久化节点安全重试。' }), timestamp)
      // Versions before completeFinalWorkflowNode persisted the final node and
      // Workflow completion in two transactions. Repair the only trustworthy
      // crash residue: the current revision round has a succeeded final node,
      // while the Workflow is still running with no current node.
      const stranded = this.db.prepare("SELECT id,project_id,revision_round FROM workflow_runs WHERE status='running' AND current_node_key IS NULL").all() as Row[]
      for (const row of stranded) {
        const workflowRunId = String(row.id)
        const finalNode = this.db.prepare(`SELECT id FROM workflow_node_runs
          WHERE workflow_run_id=? AND node_key=? AND status='succeeded' AND attempt>?
          ORDER BY attempt DESC LIMIT 1`).get(workflowRunId, CHAPTER_WORKFLOW_NODES[CHAPTER_WORKFLOW_NODES.length - 1]!, Number(row.revision_round) * 100) as Row | undefined
        if (!finalNode) continue
        const changed = this.db.prepare("UPDATE workflow_runs SET status='succeeded',finished_at=?,error_json=NULL WHERE id=? AND status='running' AND current_node_key IS NULL")
          .run(timestamp, workflowRunId)
        if (Number(changed.changes) !== 1) continue
        this.addWorkflowEvent(workflowRunId, String(finalNode.id), 'workflow.succeeded', { source: 'host-recovery' })
        finalizedProjectIds.add(String(row.project_id))
      }
    })
    for (const projectId of finalizedProjectIds) this.refreshProjectRecoveryCapsules(projectId)
    return (this.db.prepare("SELECT id FROM workflow_runs WHERE status='running' ORDER BY created_at").all() as Row[]).map(row => this.getWorkflowRun(String(row.id)))
  }

  /** Advances only the project revision changed by batch control bookkeeping. */
  private advanceWorkflowProjectRevisionUnchecked(workflowRunId: string, projectRevision: number): void {
    const row = this.one(this.db.prepare('SELECT input_snapshot_json FROM workflow_runs WHERE id=?'), workflowRunId)
    let snapshot: Record<string, unknown>
    try {
      const parsed = JSON.parse(String(row.input_snapshot_json)) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid snapshot')
      snapshot = parsed as Record<string, unknown>
    } catch {
      throw new DomainError('invalid-state', '工作流输入快照损坏，无法安全重试。')
    }
    snapshot.projectRevision = projectRevision
    this.db.prepare('UPDATE workflow_runs SET input_snapshot_json=?,project_revision_at_start=? WHERE id=?')
      .run(JSON.stringify(snapshot), projectRevision, workflowRunId)
  }

  private refreshWorkflowInputSnapshotUnchecked(workflowRunId: string): void {
    const run = this.getWorkflowRun(workflowRunId)
    const project = this.getProjectTree(run.projectId).project
    const chapter = this.getChapter(run.chapterId)
    const foundation = this.getProjectFoundation(run.projectId)
    const style = this.getProjectStyleProfile(run.projectId)
    let snapshot: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(run.inputSnapshotJson) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) snapshot = parsed as Record<string, unknown>
    } catch { /* Rebuild the authoritative fields below. */ }
    const oldSelection = run.knowledgeSelectionSnapshotId
      ? this.one(this.db.prepare('SELECT excluded_source_ids_json FROM knowledge_selection_snapshots WHERE id=?'), run.knowledgeSelectionSnapshotId)
      : null
    const selectionSnapshotId = id('knowledge-selection')
    const timestamp = now()
    this.db.prepare('INSERT INTO knowledge_selection_snapshots(id,project_id,project_revision,excluded_source_ids_json,created_at) VALUES (?,?,?,?,?)')
      .run(selectionSnapshotId, project.id, project.revision, oldSelection ? String(oldSelection.excluded_source_ids_json) : '[]', timestamp)
    if (run.knowledgeSelectionSnapshotId) {
      const items = this.db.prepare('SELECT source_project_id,source_project_title,scopes_json FROM knowledge_selection_items WHERE snapshot_id=?').all(run.knowledgeSelectionSnapshotId) as Row[]
      for (const item of items) this.db.prepare('INSERT INTO knowledge_selection_items(id,snapshot_id,source_project_id,source_project_title,scopes_json) VALUES (?,?,?,?,?)')
        .run(id('knowledge-selection-item'), selectionSnapshotId, String(item.source_project_id), String(item.source_project_title), String(item.scopes_json))
    }
    Object.assign(snapshot, {
      projectId: project.id,
      projectRevision: project.revision,
      chapterId: chapter.id,
      chapterRevision: chapter.revision,
      inputManuscriptVersionId: chapter.currentDraftVersionId ?? chapter.currentApprovedVersionId,
      foundationAssemblyHash: foundation.assemblyHash,
      styleRevision: style.revision,
      workflowDefinitionVersionId: run.definitionVersionId,
      knowledgeSelectionSnapshotId: selectionSnapshotId,
    })
    this.db.prepare('DELETE FROM retrieval_runs WHERE workflow_run_id=?').run(workflowRunId)
    this.db.prepare(`UPDATE workflow_runs SET input_snapshot_json=?,project_revision_at_start=?,chapter_revision_at_start=?,knowledge_selection_snapshot_id=?,revision_round=revision_round+1,current_node_key=?,error_json=NULL,finished_at=NULL WHERE id=?`)
      .run(JSON.stringify(snapshot), project.revision, chapter.revision, selectionSnapshotId, CHAPTER_WORKFLOW_NODES[0], workflowRunId)
    this.db.prepare('UPDATE chapter_generation_batch_items SET chapter_revision_at_enqueue=?,updated_at=? WHERE workflow_run_id=?').run(chapter.revision, timestamp, workflowRunId)
    this.addWorkflowEvent(workflowRunId, null, 'workflow.input_snapshot.refreshed', { projectRevision: project.revision, chapterRevision: chapter.revision, selectionSnapshotId })
  }

  private assertCompletedWorkflowModelRecoveryAuthority(run: WorkflowRun, node: WorkflowNodeRun, model: ModelRun, artifact: Row): void {
    let workflowSnapshot: Record<string, unknown>
    let modelSnapshot: Record<string, unknown>
    try {
      const parsedWorkflow = JSON.parse(run.inputSnapshotJson) as unknown
      const parsedModel = JSON.parse(model.inputSnapshotJson) as unknown
      if (!parsedWorkflow || typeof parsedWorkflow !== 'object' || Array.isArray(parsedWorkflow) || !parsedModel || typeof parsedModel !== 'object' || Array.isArray(parsedModel)) throw new Error('invalid snapshot')
      workflowSnapshot = parsedWorkflow as Record<string, unknown>
      modelSnapshot = parsedModel as Record<string, unknown>
    } catch {
      throw new DomainError('invalid-state', '已提交模型结果的权威输入快照损坏，不能自动恢复节点。')
    }
    const hasOwn = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key)
    const workflowInputVersionId = hasOwn(workflowSnapshot, 'inputManuscriptVersionId')
      ? workflowSnapshot.inputManuscriptVersionId === null ? null
        : typeof workflowSnapshot.inputManuscriptVersionId === 'string' ? workflowSnapshot.inputManuscriptVersionId : undefined
      : undefined
    const modelInputVersionId = hasOwn(modelSnapshot, 'inputManuscriptVersionId')
      ? modelSnapshot.inputManuscriptVersionId === null ? null
        : typeof modelSnapshot.inputManuscriptVersionId === 'string' ? modelSnapshot.inputManuscriptVersionId : undefined
      : undefined
    const modelFoundationHash = typeof modelSnapshot.foundationAssemblyHash === 'string' && modelSnapshot.foundationAssemblyHash
      ? modelSnapshot.foundationAssemblyHash : null
    const modelStyleRevision = modelSnapshot.styleProfile && typeof modelSnapshot.styleProfile === 'object' && !Array.isArray(modelSnapshot.styleProfile)
      && typeof (modelSnapshot.styleProfile as Record<string, unknown>).revision === 'number'
      ? (modelSnapshot.styleProfile as Record<string, unknown>).revision as number : null
    if (typeof modelSnapshot.projectRevision !== 'number'
      || typeof modelSnapshot.chapterRevision !== 'number'
      || workflowInputVersionId === undefined
      || modelInputVersionId === undefined
      || !modelFoundationHash
      || modelStyleRevision === null) {
      throw new DomainError('invalid-state', '已提交模型结果缺少完整的权威输入字段，不能自动恢复节点。')
    }
    const currentProject = projectFrom(this.one(this.db.prepare('SELECT * FROM projects WHERE id=?'), run.projectId))
    const currentChapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=?'), run.chapterId))
    const draftCommitted = node.nodeKey === 'generate_draft'
    const expectedRevisionDelta = draftCommitted ? 1 : 0
    const liveInputVersionId = draftCommitted
      ? artifact.parent_version_id === null ? null : String(artifact.parent_version_id)
      : currentChapter.currentDraftVersionId ?? currentChapter.currentApprovedVersionId
    const draftPointerMatches = !draftCommitted || currentChapter.currentDraftVersionId === String(artifact.id)
    if (currentProject.revision !== model.projectRevision + expectedRevisionDelta
      || currentChapter.revision !== model.chapterRevision + expectedRevisionDelta
      || run.projectRevisionAtStart !== model.projectRevision
      || run.chapterRevisionAtStart !== model.chapterRevision
      || workflowSnapshot.projectRevision !== model.projectRevision
      || workflowSnapshot.chapterRevision !== model.chapterRevision
      || modelSnapshot.projectRevision !== model.projectRevision
      || modelSnapshot.chapterRevision !== model.chapterRevision
      || liveInputVersionId !== model.inputManuscriptVersionId
      || workflowInputVersionId !== model.inputManuscriptVersionId
      || modelInputVersionId !== model.inputManuscriptVersionId
      || !draftPointerMatches) {
      throw new DomainError('revision-conflict', '项目或章节已在模型结果提交后发生变化，节点未自动恢复。')
    }
    const liveFoundationHash = this.getProjectFoundation(run.projectId).assemblyHash
    const workflowFoundationHash = typeof workflowSnapshot.foundationAssemblyHash === 'string' ? workflowSnapshot.foundationAssemblyHash : null
    if (!workflowFoundationHash || workflowFoundationHash !== liveFoundationHash || modelFoundationHash !== liveFoundationHash) {
      throw new DomainError('revision-conflict', '创作基建已在模型结果提交后变化，节点未自动恢复。')
    }
    const liveStyleRevision = this.getProjectStyleProfile(run.projectId).revision
    const workflowStyleRevision = typeof workflowSnapshot.styleRevision === 'number' ? workflowSnapshot.styleRevision : null
    if (workflowStyleRevision === null || workflowStyleRevision !== liveStyleRevision || modelStyleRevision !== liveStyleRevision) {
      throw new DomainError('revision-conflict', '项目文风已在模型结果提交后变化，节点未自动恢复。')
    }
  }

  private recoverCompletedWorkflowModelNodeUnchecked(run: WorkflowRun, node: WorkflowNodeRun): boolean {
    if (node.nodeKey !== 'plan_scenes' && node.nodeKey !== 'generate_draft') return false
    // The caller may have read run/node before another Host committed its
    // transition. Re-read both after BEGIN IMMEDIATE owns the writer lock so
    // every following binding and CAS is based on one authoritative state.
    const authoritativeRun = this.getWorkflowRun(run.id)
    const authoritativeNode = authoritativeRun.nodes.find(candidate => candidate.id === node.id)
    if (!authoritativeNode) throw new DomainError('invalid-state', '待恢复工作流节点已不存在。')
    if (authoritativeNode.status === 'succeeded') return true
    if (authoritativeRun.status !== 'running' || authoritativeRun.currentNodeKey !== authoritativeNode.nodeKey || authoritativeNode.status !== 'running') {
      throw new DomainError('invalid-state', '工作流已被其他 Host 推进、暂停或取消，当前节点未重复恢复。')
    }
    const modelRows = this.db.prepare("SELECT * FROM model_runs WHERE project_id=? AND chapter_id=? AND status='succeeded' ORDER BY finished_at DESC,created_at DESC").all(authoritativeRun.projectId, authoritativeRun.chapterId) as Row[]
    const model = modelRows.map(modelRunFrom).find(candidate => {
      const guard = this.workflowGuardFromSnapshot(candidate.inputSnapshotJson)
      if (guard?.workflowRunId === authoritativeRun.id && guard.workflowNodeRunId === authoritativeNode.id) return true
      if (authoritativeNode.nodeKey !== 'generate_draft') return false
      const version = this.db.prepare('SELECT workflow_run_id,workflow_node_run_id FROM manuscript_versions WHERE model_run_id=?').get(candidate.id) as Row | undefined
      return version?.workflow_run_id === authoritativeRun.id && version?.workflow_node_run_id === authoritativeNode.id
    })
    if (!model || (authoritativeNode.nodeKey === 'plan_scenes' ? model.purpose !== 'scene-plan' : model.purpose !== 'chapter-draft')) return false
    const artifact = authoritativeNode.nodeKey === 'plan_scenes'
      ? this.db.prepare('SELECT id FROM scene_plans WHERE model_run_id=?').get(model.id) as Row | undefined
      : this.db.prepare('SELECT id,parent_version_id FROM manuscript_versions WHERE model_run_id=?').get(model.id) as Row | undefined
    if (!artifact) return false
    this.assertCompletedWorkflowModelRecoveryAuthority(authoritativeRun, authoritativeNode, model, artifact)
    if (authoritativeNode.nodeKey === 'generate_draft') {
      const changed = this.db.prepare('UPDATE manuscript_versions SET workflow_run_id=?,workflow_node_run_id=? WHERE id=? AND workflow_run_id IS NULL').run(authoritativeRun.id, authoritativeNode.id, String(artifact.id))
      if (Number(changed.changes) === 0) {
        const version = this.one(this.db.prepare('SELECT workflow_run_id,workflow_node_run_id FROM manuscript_versions WHERE id=?'), String(artifact.id))
        if (version.workflow_run_id !== authoritativeRun.id || version.workflow_node_run_id !== authoritativeNode.id) {
          throw new DomainError('invalid-state', '已提交正文已绑定其他工作流节点，当前恢复已回滚。')
        }
      }
    }
    const index = CHAPTER_WORKFLOW_NODES.indexOf(authoritativeNode.nodeKey as typeof CHAPTER_WORKFLOW_NODES[number])
    const nextNodeKey = index >= 0 && index < CHAPTER_WORKFLOW_NODES.length - 1 ? CHAPTER_WORKFLOW_NODES[index + 1]! : null
    const output = authoritativeNode.nodeKey === 'plan_scenes'
      ? { scenePlanId: String(artifact.id), modelRunId: model.id, recovered: true }
      : { manuscriptVersionId: String(artifact.id), modelRunId: model.id, recovered: true }
    const timestamp = now()
    const changed = this.db.prepare("UPDATE workflow_node_runs SET status='succeeded',output_json=?,finished_at=? WHERE id=? AND workflow_run_id=? AND status='running'").run(JSON.stringify(output), timestamp, authoritativeNode.id, authoritativeRun.id)
    if (Number(changed.changes) !== 1) throw new DomainError('invalid-state', '工作流节点已被其他 Host 推进，当前恢复已回滚。')
    const advanced = this.db.prepare("UPDATE workflow_runs SET current_node_key=? WHERE id=? AND status='running' AND current_node_key=?").run(nextNodeKey, authoritativeRun.id, authoritativeNode.nodeKey)
    if (Number(advanced.changes) !== 1) throw new DomainError('invalid-state', '工作流已被其他 Host 推进，当前恢复已回滚。')
    this.addWorkflowEvent(authoritativeRun.id, authoritativeNode.id, 'workflow.node.recovered', { nodeKey: authoritativeNode.nodeKey, nextNodeKey, modelRunId: model.id })
    return true
  }

  prepareWorkflowNode(workflowRunId: string, nodeKey: string, input: unknown): { run: WorkflowRun; nodeRunId: string; alreadySucceeded: boolean } {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    if (run.status !== 'running') throw new DomainError('invalid-state', `Workflow is ${run.status}, not running.`)
    const succeeded = run.nodes.find(node => node.nodeKey === nodeKey && node.status === 'succeeded' && node.attempt > run.revisionRound * 100)
    if (succeeded) return { run, nodeRunId: succeeded.id, alreadySucceeded: true }
    const reusable = [...run.nodes].reverse().find(node => node.nodeKey === nodeKey && node.attempt > run.revisionRound * 100 && (node.status === 'running' || node.status === 'failed_retryable'))
    if (reusable) {
      if (reusable.status === 'running') {
        const recovered = this.activeProjectTransaction(run.projectId, () => this.recoverCompletedWorkflowModelNodeUnchecked(run, reusable))
        if (recovered) return { run: this.getWorkflowRun(workflowRunId), nodeRunId: reusable.id, alreadySucceeded: true }
      }
      if (reusable.status === 'failed_retryable') this.activeProjectTransaction(run.projectId, () => {
        this.db.prepare("UPDATE workflow_node_runs SET status='running',attempt=attempt+1,error_json=NULL,started_at=?,finished_at=NULL WHERE id=?").run(now(), reusable.id)
      })
      return { run: this.getWorkflowRun(workflowRunId), nodeRunId: reusable.id, alreadySucceeded: false }
    }
    const attemptBase = run.revisionRound * 100
    const prior = run.nodes.filter(node => node.nodeKey === nodeKey && node.attempt > attemptBase)
    const attempt = attemptBase + prior.length + 1
    const nodeRunId = id('workflow-node')
    const timestamp = now()
    const idempotencyKey = `${workflowRunId}:${nodeKey}:round-${run.revisionRound}`
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare(`INSERT INTO workflow_node_runs(id,workflow_run_id,node_key,node_version,status,attempt,idempotency_key,input_json,started_at)
        VALUES (?,?,?,1,'running',?,?,?,?)`).run(nodeRunId, workflowRunId, nodeKey, attempt, idempotencyKey, JSON.stringify(input), timestamp)
      this.db.prepare('UPDATE workflow_runs SET current_node_key=? WHERE id=?').run(nodeKey, workflowRunId)
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.node.started', { nodeKey, attempt })
    })
    return { run: this.getWorkflowRun(workflowRunId), nodeRunId, alreadySucceeded: false }
  }

  completeWorkflowNode(workflowRunId: string, nodeRunId: string, output: unknown, nextNodeKey: string | null): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      const workflow = this.one(this.db.prepare('SELECT status,current_node_key FROM workflow_runs WHERE id=?'), workflowRunId)
      const node = this.one(this.db.prepare('SELECT status,node_key FROM workflow_node_runs WHERE id=? AND workflow_run_id=?'), nodeRunId, workflowRunId)
      if (workflow.status !== 'running' || node.status !== 'running' || workflow.current_node_key !== node.node_key) {
        throw new DomainError('invalid-state', '工作流已暂停、取消或离开当前节点，迟到的节点结果未推进状态。')
      }
      const changed = this.db.prepare("UPDATE workflow_node_runs SET status='succeeded',output_json=?,finished_at=? WHERE id=? AND workflow_run_id=? AND status='running'").run(JSON.stringify(output), timestamp, nodeRunId, workflowRunId)
      if (changed.changes !== 1) throw new DomainError('invalid-state', 'Workflow node is not running.')
      const advanced = this.db.prepare("UPDATE workflow_runs SET current_node_key=? WHERE id=? AND status='running' AND current_node_key=?").run(nextNodeKey, workflowRunId, String(node.node_key))
      if (Number(advanced.changes) !== 1) throw new DomainError('invalid-state', 'Workflow no longer owns the current node.')
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.node.succeeded', { nextNodeKey })
    })
    this.refreshProjectRecoveryCapsules(this.getWorkflowRun(workflowRunId).projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  bindManuscriptVersionToWorkflow(versionId: string, workflowRunId: string, nodeRunId: string): void {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    const version = this.one(this.db.prepare('SELECT project_id FROM manuscript_versions WHERE id=?'), versionId)
    if (String(version.project_id) !== run.projectId) throw new DomainError('validation', '手稿版本不属于该工作流项目。')
    const changed = this.activeProjectTransaction(run.projectId, () => {
      const workflow = this.one(this.db.prepare('SELECT status,current_node_key FROM workflow_runs WHERE id=?'), workflowRunId)
      const node = this.one(this.db.prepare('SELECT status,node_key FROM workflow_node_runs WHERE id=? AND workflow_run_id=?'), nodeRunId, workflowRunId)
      if (workflow.status !== 'running' || node.status !== 'running' || workflow.current_node_key !== node.node_key) {
        throw new DomainError('invalid-state', '工作流已暂停、取消或离开当前节点，正文版本未绑定。')
      }
      return this.db.prepare('UPDATE manuscript_versions SET workflow_run_id=?,workflow_node_run_id=? WHERE id=? AND workflow_run_id IS NULL').run(workflowRunId, nodeRunId, versionId)
    })
    if (changed.changes !== 1) {
      const row = this.one(this.db.prepare('SELECT workflow_run_id,workflow_node_run_id FROM manuscript_versions WHERE id=?'), versionId)
      if (String(row.workflow_run_id) !== workflowRunId || String(row.workflow_node_run_id) !== nodeRunId) throw new DomainError('invalid-state', 'Manuscript version already belongs to another workflow node.')
    }
  }

  failWorkflowNode(workflowRunId: string, nodeRunId: string, error: unknown, retryable: boolean): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    const externalCode = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code: string }).code) : null
    const payload = { code: error instanceof DomainError ? error.code : externalCode ?? 'workflow-node-error', message: error instanceof Error ? error.message : String(error) }
    this.activeProjectTransaction(run.projectId, () => {
      const workflow = this.one(this.db.prepare('SELECT status,current_node_key FROM workflow_runs WHERE id=?'), workflowRunId)
      const node = this.one(this.db.prepare('SELECT status,node_key FROM workflow_node_runs WHERE id=? AND workflow_run_id=?'), nodeRunId, workflowRunId)
      const timestamp = now()
      if (workflow.status === 'cancelled' || workflow.status === 'cancel_requested') {
        this.db.prepare("UPDATE workflow_node_runs SET status='cancelled',error_json=?,finished_at=? WHERE id=? AND workflow_run_id=? AND status IN ('running','failed_retryable')").run(JSON.stringify(payload), timestamp, nodeRunId, workflowRunId)
        return
      }
      if (workflow.status === 'paused') {
        this.db.prepare("UPDATE workflow_node_runs SET status='failed_retryable',error_json=?,finished_at=? WHERE id=? AND workflow_run_id=? AND status='running'").run(JSON.stringify(payload), timestamp, nodeRunId, workflowRunId)
        this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.node.interrupted_while_paused', payload)
        return
      }
      if (workflow.status !== 'running') return
      if (node.status !== 'running' || workflow.current_node_key !== node.node_key) return
      const failedNode = this.db.prepare(`UPDATE workflow_node_runs SET status=?,error_json=?,finished_at=? WHERE id=? AND workflow_run_id=? AND status='running'`).run(retryable ? 'failed_retryable' : 'failed_terminal', JSON.stringify(payload), timestamp, nodeRunId, workflowRunId)
      const failedWorkflow = this.db.prepare("UPDATE workflow_runs SET status='failed',error_json=?,finished_at=? WHERE id=? AND status='running' AND current_node_key=?").run(JSON.stringify(payload), timestamp, workflowRunId, String(node.node_key))
      if (Number(failedNode.changes) !== 1 || Number(failedWorkflow.changes) !== 1) throw new DomainError('invalid-state', '工作流已被其他 Host 推进，失败状态未覆盖最新结果。')
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.node.failed', { retryable, ...payload })
    })
    this.refreshProjectRecoveryCapsules(this.getWorkflowRun(workflowRunId).projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  setWorkflowStatus(workflowRunId: string, status: 'running' | 'paused' | 'cancel_requested' | 'cancelled'): WorkflowRun {
    const before = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(before.projectId)
    if (['succeeded', 'cancelled'].includes(before.status)) throw new DomainError('invalid-state', `Workflow is already ${before.status}.`)
    const finalStatus = status === 'cancel_requested' ? 'cancelled' : status
    if (finalStatus === 'running' && !this.enforceWorkflowRelationshipSafety(workflowRunId)) throw new DomainError('invalid-state', YOLO_RELATIONSHIP_SAFETY_ERROR)
    try {
      this.activeProjectTransaction(before.projectId, () => {
        if (finalStatus === 'running') {
          this.assertWorkflowRelationshipSafetyUnchecked(workflowRunId)
          this.assertProjectWorkflowSlot(before.projectId, workflowRunId, this.workflowBatchId(workflowRunId))
        }
        const timestamp = now()
        if (finalStatus === 'cancelled') {
          this.db.prepare("UPDATE workflow_node_runs SET status='cancelled',error_json=?,finished_at=? WHERE workflow_run_id=? AND status IN ('running','waiting_approval','failed_retryable')").run(JSON.stringify({ code: 'workflow-cancelled', message: '工作流已取消。' }), timestamp, workflowRunId)
          this.db.prepare("UPDATE workflow_approvals SET status='rejected',decision_note='工作流已取消。',decided_at=? WHERE workflow_run_id=? AND status='pending'").run(timestamp, workflowRunId)
          this.failRunningModelRunsForWorkflowUnchecked(workflowRunId, timestamp, 'workflow-cancelled', '工作流已取消，模型结果不会写入。')
        }
        this.db.prepare('UPDATE workflow_runs SET status=?,current_node_key=CASE WHEN ?=\'cancelled\' THEN NULL ELSE current_node_key END,error_json=CASE WHEN ?=\'running\' THEN NULL ELSE error_json END,finished_at=? WHERE id=?').run(finalStatus, finalStatus, finalStatus, finalStatus === 'cancelled' ? timestamp : null, workflowRunId)
        this.addWorkflowEvent(workflowRunId, null, `workflow.${finalStatus}`, {})
      })
    } catch (cause) {
      if (cause instanceof DomainError && cause.message === YOLO_RELATIONSHIP_SAFETY_ERROR) this.enforceWorkflowRelationshipSafety(workflowRunId)
      throw cause
    }
    this.refreshProjectRecoveryCapsules(before.projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  retryWorkflow(workflowRunId: string): WorkflowRun {
    const before = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(before.projectId)
    if (!this.enforceWorkflowRelationshipSafety(workflowRunId)) throw new DomainError('invalid-state', YOLO_RELATIONSHIP_SAFETY_ERROR)
    if (before.status !== 'failed') throw new DomainError('invalid-state', 'Only a failed workflow can be retried.')
    const failed = [...before.nodes].reverse().find(node => node.status === 'failed_retryable' || node.status === 'failed_terminal')
    if (!failed || failed.status !== 'failed_retryable') throw new DomainError('invalid-state', 'The failed node is not retryable.')
    let failureCode = ''
    try { failureCode = String((JSON.parse(before.errorJson ?? '{}') as { code?: unknown }).code ?? '') } catch { failureCode = '' }
    try {
      this.activeProjectTransaction(before.projectId, () => {
        this.assertWorkflowRelationshipSafetyUnchecked(workflowRunId)
        const batchId = this.workflowBatchId(workflowRunId)
        this.assertProjectWorkflowSlot(before.projectId, workflowRunId, batchId)
        if (failureCode === 'revision-conflict') this.refreshWorkflowInputSnapshotUnchecked(workflowRunId)
        else if (failureCode === 'yolo-relationship-safety') {
          const currentProject = this.one(this.db.prepare('SELECT revision FROM projects WHERE id=?'), before.projectId)
          this.advanceWorkflowProjectRevisionUnchecked(workflowRunId, Number(currentProject.revision))
        }
        this.db.prepare("UPDATE workflow_runs SET status='running',current_node_key=CASE WHEN ?=1 THEN current_node_key ELSE ? END,error_json=NULL,finished_at=NULL WHERE id=? AND status='failed'").run(failureCode === 'revision-conflict' ? 1 : 0, failed.nodeKey, workflowRunId)
        this.addWorkflowEvent(workflowRunId, failed.id, 'workflow.retry.requested', { nodeKey: failureCode === 'revision-conflict' ? CHAPTER_WORKFLOW_NODES[0] : failed.nodeKey, previousNodeKey: failed.nodeKey, refreshedSnapshot: failureCode === 'revision-conflict' })
        if (batchId) {
          const timestamp = now()
          this.db.prepare("UPDATE chapter_generation_batch_items SET queue_state='dispatched',blocked_reason=NULL,updated_at=? WHERE workflow_run_id=?").run(timestamp, workflowRunId)
          this.db.prepare("UPDATE chapter_generation_batches SET status='running',error_json=NULL,revision=revision+1,updated_at=? WHERE id=? AND status='blocked'").run(timestamp, batchId)
        }
      })
    } catch (cause) {
      if (cause instanceof DomainError && cause.message === YOLO_RELATIONSHIP_SAFETY_ERROR) this.enforceWorkflowRelationshipSafety(workflowRunId)
      throw cause
    }
    this.refreshProjectRecoveryCapsules(this.getWorkflowRun(workflowRunId).projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  createReviewReport(workflowRunId: string, nodeRunId: string, manuscriptVersionId: string, kind: ReviewReport['kind'], report: unknown, verdict: ReviewReport['verdict'] = 'pass'): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare('INSERT OR IGNORE INTO review_reports(id,workflow_run_id,node_run_id,manuscript_version_id,review_kind,verdict,report_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id('review'), workflowRunId, nodeRunId, manuscriptVersionId, kind, verdict, JSON.stringify(report), now())
    })
    return this.getWorkflowRun(workflowRunId)
  }

  waitForWorkflowApproval(workflowRunId: string, nodeRunId: string, manuscriptVersionId: string): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare("UPDATE workflow_node_runs SET status='waiting_approval',output_json=?,finished_at=NULL WHERE id=? AND workflow_run_id=? AND status='running'").run(JSON.stringify({ manuscriptVersionId }), nodeRunId, workflowRunId)
      this.db.prepare('INSERT INTO workflow_approvals(id,workflow_run_id,manuscript_version_id,status,decision_note,created_at) VALUES (?,?,?,\'pending\',\'\',?)').run(id('workflow-approval'), workflowRunId, manuscriptVersionId, timestamp)
      this.db.prepare("UPDATE workflow_runs SET status='waiting_approval',current_node_key='wait_chapter_approval' WHERE id=?").run(workflowRunId)
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.waiting_approval', { manuscriptVersionId })
    })
    this.refreshProjectRecoveryCapsules(this.getWorkflowRun(workflowRunId).projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  decideWorkflowApproval(workflowRunId: string, decision: 'approved' | 'rejected', note: string): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    if (!this.enforceWorkflowRelationshipSafety(workflowRunId)) throw new DomainError('invalid-state', YOLO_RELATIONSHIP_SAFETY_ERROR)
    if (run.status !== 'waiting_approval' || run.approval?.status !== 'pending') throw new DomainError('invalid-state', 'Workflow is not waiting for approval.')
    const chapter = this.getChapter(run.chapterId)
    const source = chapter.versions.find(version => version.id === run.approval!.manuscriptVersionId)
    if (!source) throw new DomainError('invalid-state', 'Approval manuscript version is unavailable.')
    const timestamp = now()
    try {
      this.activeProjectTransaction(run.projectId, () => {
        this.assertWorkflowRelationshipSafetyUnchecked(workflowRunId)
        this.db.prepare('UPDATE workflow_approvals SET status=?,decision_note=?,decided_at=? WHERE id=?').run(decision, note.trim(), timestamp, run.approval!.id)
        this.db.prepare("UPDATE workflow_node_runs SET status='succeeded',output_json=?,finished_at=? WHERE id=(SELECT id FROM workflow_node_runs WHERE workflow_run_id=? AND node_key='wait_chapter_approval' AND status='waiting_approval' ORDER BY attempt DESC LIMIT 1)").run(JSON.stringify({ decision, note: note.trim() }), timestamp, workflowRunId)
        if (decision === 'approved') {
          this.db.prepare("UPDATE workflow_runs SET status='running',current_node_key='commit_approved_version',approved_version_id=? WHERE id=?").run(source.id, workflowRunId)
        } else {
          const nextVersionId = id('version')
          const revisionText = note.trim() ? `\n\n【返修说明】${note.trim()}` : '\n\n【返修说明】请根据审校意见继续修订。'
          const content = `${source.content}${revisionText}`
          this.db.prepare(`INSERT INTO manuscript_versions(id,project_id,chapter_id,parent_version_id,status,content,content_hash,word_count,origin,created_by,prompt_asset_version_id,model_run_id,workflow_run_id,created_at)
            VALUES (?,?,?,?,'draft',?,?,?,'model','model',?,?,?,?)`).run(nextVersionId, run.projectId, run.chapterId, source.id, content, createHash('sha256').update(content).digest('hex'), manuscriptWordCount(content), source.promptAssetVersionId, source.modelRunId, workflowRunId, timestamp)
          this.db.prepare('UPDATE chapters SET current_draft_version_id=?,revision=revision+1,updated_at=? WHERE id=?').run(nextVersionId, timestamp, run.chapterId)
          this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, run.projectId)
          this.db.prepare("UPDATE workflow_runs SET status='waiting_approval',current_node_key='wait_chapter_approval',revision_round=revision_round+1 WHERE id=?").run(workflowRunId)
          const nextRound = run.revisionRound + 1
          const nextNodeId = id('workflow-node')
          this.db.prepare(`INSERT INTO workflow_node_runs(id,workflow_run_id,node_key,node_version,status,attempt,idempotency_key,input_json,output_json,started_at)
            VALUES (?,?,'wait_chapter_approval',1,'waiting_approval',?,?,?, ?,?)`).run(nextNodeId, workflowRunId, nextRound * 100 + 1, `${workflowRunId}:wait_chapter_approval:round-${nextRound}`, JSON.stringify({ revisionRound: nextRound }), JSON.stringify({ manuscriptVersionId: nextVersionId }), timestamp)
          this.db.prepare("INSERT INTO workflow_approvals(id,workflow_run_id,manuscript_version_id,status,decision_note,created_at) VALUES (?,?,?,'pending','',?)").run(id('workflow-approval'), workflowRunId, nextVersionId, timestamp)
        }
        this.addWorkflowEvent(workflowRunId, null, `workflow.approval.${decision}`, { manuscriptVersionId: source.id, note: note.trim() })
      })
    } catch (cause) {
      if (cause instanceof DomainError && cause.message === YOLO_RELATIONSHIP_SAFETY_ERROR) this.enforceWorkflowRelationshipSafety(workflowRunId)
      throw cause
    }
    this.refreshProjectRecoveryCapsules(run.projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  createCanonCandidate(workflowRunId: string, nodeRunId: string): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    if (!run.approvedVersionId) throw new DomainError('invalid-state', 'Canon candidates require an approved workflow manuscript.')
    const chapter = this.getChapter(run.chapterId)
    const version = chapter.versions.find(item => item.id === run.approvedVersionId)
    if (!version || version.status !== 'approved') throw new DomainError('invalid-state', 'Canon candidates require a formally approved version.')
    this.activeProjectTransaction(run.projectId, () => {
      const liveWorkflow = this.one(this.db.prepare('SELECT approved_version_id FROM workflow_runs WHERE id=? AND project_id=? AND chapter_id=?'), workflowRunId, run.projectId, run.chapterId)
      if (liveWorkflow.approved_version_id === null || String(liveWorkflow.approved_version_id) !== run.approvedVersionId) throw new DomainError('revision-conflict', '工作流批准正文已发生变化，Canon 候选未提取。')
      const liveChapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=? AND project_id=?'), run.chapterId, run.projectId))
      if (liveChapter.currentApprovedVersionId !== run.approvedVersionId) throw new DomainError('revision-conflict', '当前批准正文已发生变化，Canon 候选未提取。')
      const liveVersion = versionFrom(this.one(this.db.prepare("SELECT * FROM manuscript_versions WHERE id=? AND chapter_id=? AND project_id=? AND status='approved'"), run.approvedVersionId, run.chapterId, run.projectId))
      const existing = this.db.prepare('SELECT id FROM canon_candidates WHERE workflow_run_id=?').get(workflowRunId)
      if (existing) return
      const modelRun = liveVersion.modelRunId ? this.db.prepare('SELECT output_json FROM model_runs WHERE id=?').get(liveVersion.modelRunId) as Row | undefined : undefined
      let candidates: Record<string, unknown>[] = []
      try { const output = modelRun?.output_json ? JSON.parse(String(modelRun.output_json)) as Record<string, unknown> : null; candidates = Array.isArray(output?.canonCandidates) ? output.canonCandidates.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[] : [] } catch { candidates = [] }
      const timestamp = now()
      if (candidates.length > 0) for (const candidate of candidates.slice(0, 50)) {
        const subject = typeof candidate.subject === 'string' && candidate.subject.trim() ? candidate.subject.trim() : liveChapter.title
        const predicate = typeof candidate.predicate === 'string' && candidate.predicate.trim() ? candidate.predicate.trim() : 'chapter.approved_content'
        this.db.prepare(`INSERT INTO canon_candidates(id,workflow_run_id,manuscript_version_id,subject,predicate,value_json,status,created_at) VALUES (?,?,?,?,?,?,'candidate',?)`).run(id('canon-candidate'), workflowRunId, liveVersion.id, subject, predicate, JSON.stringify(candidate), timestamp)
      } else this.db.prepare(`INSERT INTO canon_candidates(id,workflow_run_id,manuscript_version_id,subject,predicate,value_json,status,created_at) VALUES (?,?,?,?,?,?,'candidate',?)`)
        .run(id('canon-candidate'), workflowRunId, liveVersion.id, liveChapter.title, 'chapter.approved_content', JSON.stringify({ kind: 'fact', value: { contentHash: liveVersion.contentHash, wordCount: liveVersion.wordCount }, entityType: 'concept', systemDerived: 'approved-version-metadata' }), timestamp)
    })
    return this.getWorkflowRun(workflowRunId)
  }

  completeFinalWorkflowNode(workflowRunId: string, nodeRunId: string, output: unknown): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      const workflow = this.one(this.db.prepare('SELECT status,current_node_key FROM workflow_runs WHERE id=?'), workflowRunId)
      const node = this.one(this.db.prepare('SELECT status,node_key FROM workflow_node_runs WHERE id=? AND workflow_run_id=?'), nodeRunId, workflowRunId)
      const finalNodeKey = CHAPTER_WORKFLOW_NODES[CHAPTER_WORKFLOW_NODES.length - 1]!
      if (workflow.status !== 'running' || node.status !== 'running' || workflow.current_node_key !== node.node_key || node.node_key !== finalNodeKey) {
        throw new DomainError('invalid-state', '工作流已暂停、取消、离开最终节点或最终节点状态无效，不能标记成功。')
      }
      const completed = this.db.prepare("UPDATE workflow_node_runs SET status='succeeded',output_json=?,finished_at=? WHERE id=? AND workflow_run_id=? AND status='running'")
        .run(JSON.stringify(output), timestamp, nodeRunId, workflowRunId)
      const finished = this.db.prepare("UPDATE workflow_runs SET status='succeeded',current_node_key=NULL,error_json=NULL,finished_at=? WHERE id=? AND status='running' AND current_node_key=?")
        .run(timestamp, workflowRunId, finalNodeKey)
      if (Number(completed.changes) !== 1 || Number(finished.changes) !== 1) {
        throw new DomainError('invalid-state', '工作流最终节点已被其他 Host 推进，当前完成事务已回滚。')
      }
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.node.succeeded', { nextNodeKey: null })
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.succeeded', {})
    })
    this.refreshProjectRecoveryCapsules(run.projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  /** Must be called while the owning project write transaction is held. */
  private canonCandidateEvidenceContextUnchecked(workflowRunId: string, status: CanonCandidate['status']): { chapter: Chapter; version: ManuscriptVersion; candidates: CanonCandidate[] } {
    const workflow = this.one(this.db.prepare('SELECT project_id,chapter_id,approved_version_id FROM workflow_runs WHERE id=?'), workflowRunId)
    if (workflow.approved_version_id === null) throw new DomainError('invalid-state', 'Canon candidates require an approved workflow manuscript.')
    const projectId = String(workflow.project_id)
    const chapterId = String(workflow.chapter_id)
    const approvedVersionId = String(workflow.approved_version_id)
    const chapter = chapterFrom(this.one(this.db.prepare('SELECT * FROM chapters WHERE id=? AND project_id=?'), chapterId, projectId))
    if (chapter.currentApprovedVersionId !== approvedVersionId) throw new DomainError('revision-conflict', '当前批准正文已发生变化，Canon 候选必须重新提取。')
    const version = versionFrom(this.one(this.db.prepare("SELECT * FROM manuscript_versions WHERE id=? AND chapter_id=? AND project_id=? AND status='approved'"), approvedVersionId, chapterId, projectId))
    const candidates = (this.db.prepare('SELECT * FROM canon_candidates WHERE workflow_run_id=? AND status=? ORDER BY created_at,id').all(workflowRunId, status) as Row[]).map(candidateFrom)
    for (const candidate of candidates) {
      if (candidate.manuscriptVersionId !== approvedVersionId) throw new DomainError('revision-conflict', 'Canon 候选引用的正文已不是当前批准版本，必须重新提取。')
    }
    return { chapter, version, candidates }
  }

  /** Must be called while the owning project write transaction is held. */
  private insertValidatedApprovedVersionMetadataCandidateUnchecked(workflowRunId: string, chapter: Chapter, version: ManuscriptVersion, timestamp: string): CanonCandidate {
    const candidate: CanonCandidate = {
      id: id('canon-candidate'), workflowRunId, manuscriptVersionId: version.id,
      subject: chapter.title, predicate: 'chapter.approved_content', status: 'validated', createdAt: timestamp,
      valueJson: JSON.stringify({
        kind: 'fact', value: { contentHash: version.contentHash, wordCount: version.wordCount },
        entityType: 'concept', systemDerived: 'approved-version-metadata',
      }),
    }
    const evidencedValueJson = canonCandidateValueWithEvidence(candidate, version, 0)
    this.db.prepare(`INSERT INTO canon_candidates(id,workflow_run_id,manuscript_version_id,subject,predicate,value_json,status,created_at)
      VALUES (?,?,?,?,?,?,'validated',?)`).run(candidate.id, workflowRunId, version.id, candidate.subject, candidate.predicate, evidencedValueJson, timestamp)
    return { ...candidate, valueJson: evidencedValueJson }
  }

  validateCanonCandidates(workflowRunId: string, nodeRunId: string): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    if (!run.approvedVersionId || run.canonCandidates.length === 0) throw new DomainError('invalid-state', 'No approved Canon candidates are available.')
    this.activeProjectTransaction(run.projectId, () => {
      const { chapter, version, candidates } = this.canonCandidateEvidenceContextUnchecked(workflowRunId, 'candidate')
      if (version.id !== run.approvedVersionId) throw new DomainError('revision-conflict', '工作流批准正文已发生变化，Canon 候选必须重新提取。')
      const rejections: Array<{ candidateId: string; subject: string; predicate: string; reason: string }> = []
      let validatedCount = Number((this.db.prepare("SELECT COUNT(*) count FROM canon_candidates WHERE workflow_run_id=? AND status='validated'").get(workflowRunId) as Row).count)
      const committedCount = Number((this.db.prepare("SELECT COUNT(*) count FROM canon_candidates WHERE workflow_run_id=? AND status='committed'").get(workflowRunId) as Row).count)
      for (const [candidateIndex, candidate] of candidates.entries()) {
        let evidencedValueJson: string
        try {
          evidencedValueJson = canonCandidateValueWithEvidence(candidate, version, candidateIndex)
        } catch (cause) {
          if (!(cause instanceof DomainError) || cause.code !== 'validation') throw cause
          const changed = this.db.prepare("UPDATE canon_candidates SET status='rejected' WHERE id=? AND workflow_run_id=? AND status='candidate'").run(candidate.id, workflowRunId)
          if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', 'Canon 候选在验证期间发生变化，未提交任何故事事实。')
          rejections.push({ candidateId: candidate.id, subject: candidate.subject, predicate: candidate.predicate, reason: cause.message })
          continue
        }
        const changed = this.db.prepare("UPDATE canon_candidates SET value_json=?,status='validated' WHERE id=? AND workflow_run_id=? AND status='candidate'").run(evidencedValueJson, candidate.id, workflowRunId)
        if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', 'Canon 候选在验证期间发生变化，未提交任何故事事实。')
        validatedCount++
      }
      let fallbackUsed = false
      if (validatedCount === 0 && committedCount === 0) {
        this.insertValidatedApprovedVersionMetadataCandidateUnchecked(workflowRunId, chapter, version, now())
        validatedCount = 1
        fallbackUsed = true
      }
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.canon.candidates.validated', {
        validatedCount, rejectedCount: rejections.length, fallbackUsed, rejections,
      })
    })
    return this.getWorkflowRun(workflowRunId)
  }

  commitWorkflowCanon(workflowRunId: string, nodeRunId: string): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    if (!run.approvedVersionId) throw new DomainError('invalid-state', 'Canon cannot be committed before chapter approval.')
    const candidates = run.canonCandidates.filter(candidate => candidate.status === 'validated')
    if (candidates.length === 0 && run.canonFacts.length > 0) return run
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      const { chapter, version, candidates: validatedCandidates } = this.canonCandidateEvidenceContextUnchecked(workflowRunId, 'validated')
      if (version.id !== run.approvedVersionId) throw new DomainError('revision-conflict', '工作流批准正文已发生变化，Canon 候选必须重新提取。')
      const evidencedCandidates: Array<CanonCandidate & { evidencedValueJson: string }> = []
      const rejections: Array<{ candidateId: string; subject: string; predicate: string; reason: string }> = []
      for (const [candidateIndex, candidate] of validatedCandidates.entries()) {
        try {
          evidencedCandidates.push({ ...candidate, evidencedValueJson: canonCandidateValueWithEvidence(candidate, version, candidateIndex) })
        } catch (cause) {
          if (!(cause instanceof DomainError) || cause.code !== 'validation') throw cause
          const changed = this.db.prepare("UPDATE canon_candidates SET status='rejected' WHERE id=? AND workflow_run_id=? AND status='validated'").run(candidate.id, workflowRunId)
          if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', 'Canon 候选状态在提交前发生变化，未提交任何故事事实。')
          rejections.push({ candidateId: candidate.id, subject: candidate.subject, predicate: candidate.predicate, reason: cause.message })
        }
      }
      let fallbackUsed = false
      if (evidencedCandidates.length === 0) {
        const fallback = this.insertValidatedApprovedVersionMetadataCandidateUnchecked(workflowRunId, chapter, version, timestamp)
        evidencedCandidates.push({ ...fallback, evidencedValueJson: fallback.valueJson })
        fallbackUsed = true
      }
      for (const candidate of evidencedCandidates) {
        this.db.prepare(`INSERT INTO canon_facts(id,project_id,chapter_id,source_manuscript_version_id,candidate_id,subject,predicate,value_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(id('canon-fact'), run.projectId, run.chapterId, run.approvedVersionId, candidate.id, candidate.subject, candidate.predicate, candidate.evidencedValueJson, timestamp)
        this.db.prepare('UPDATE canon_candidates SET value_json=? WHERE id=?').run(candidate.evidencedValueJson, candidate.id)
        const changed = this.db.prepare("UPDATE canon_candidates SET status='committed' WHERE id=? AND workflow_run_id=? AND status='validated'").run(candidate.id, workflowRunId)
        if (Number(changed.changes) !== 1) throw new DomainError('revision-conflict', 'Canon 候选状态在提交前发生变化，未提交任何故事事实。')
      }
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.canon.committed', {
        count: evidencedCandidates.length, rejectedCount: rejections.length, fallbackUsed, rejections,
      })
    })
    return this.getWorkflowRun(workflowRunId)
  }

  private getKnowledgeSelectionSnapshot(snapshotId: string): KnowledgeSelectionSnapshot {
    const row = this.one(this.db.prepare('SELECT * FROM knowledge_selection_snapshots WHERE id=?'), snapshotId)
    const items = (this.db.prepare('SELECT * FROM knowledge_selection_items WHERE snapshot_id=? ORDER BY source_project_title').all(snapshotId) as Row[]).map(item => ({
      sourceProjectId: String(item.source_project_id), sourceProjectTitle: String(item.source_project_title), scopes: jsonArray<HistoricalKnowledgeScope>(item.scopes_json),
    }))
    return { id: String(row.id), projectId: String(row.project_id), projectRevision: Number(row.project_revision), items, excludedSourceIds: jsonArray<string>(row.excluded_source_ids_json), createdAt: String(row.created_at) }
  }

  private getRetrievalBundle(retrievalRunId: string): RetrievalBundle {
    const row = this.one(this.db.prepare('SELECT * FROM retrieval_runs WHERE id=?'), retrievalRunId)
    return {
      id: String(row.id), workflowRunId: String(row.workflow_run_id), purpose: String(row.purpose), projectRevision: Number(row.project_revision), selectionSnapshotId: String(row.selection_snapshot_id),
      items: (this.db.prepare('SELECT * FROM retrieval_items WHERE retrieval_run_id=? ORDER BY rank').all(retrievalRunId) as Row[]).map(retrievalItemFrom),
      conflicts: jsonArray<string>(row.conflicts_json), truncated: Boolean(row.truncated), createdAt: String(row.created_at),
    }
  }

  private getRetrievalBundleForWorkflow(workflowRunId: string): RetrievalBundle | null {
    const row = this.db.prepare('SELECT id FROM retrieval_runs WHERE workflow_run_id=?').get(workflowRunId) as Row | undefined
    return row ? this.getRetrievalBundle(String(row.id)) : null
  }

  getKnowledgeWorkspace(projectId: string): KnowledgeWorkspace {
    const project = this.getProjectTree(projectId).project
    const entities = (this.db.prepare(`SELECT e.* FROM story_entities e
      WHERE e.project_id=? AND (e.source_manuscript_version_id IS NULL OR EXISTS (
        SELECT 1 FROM chapters c WHERE c.project_id=e.project_id AND c.current_approved_version_id=e.source_manuscript_version_id
      )) ORDER BY e.entity_type,e.name`).all(projectId) as Row[]).map((row): StoryEntity => ({
      id: String(row.id), projectId: String(row.project_id), type: row.entity_type as StoryEntity['type'], name: String(row.name),
      aliases: (this.db.prepare('SELECT alias FROM entity_aliases WHERE entity_id=? ORDER BY alias').all(String(row.id)) as Row[]).map(item => String(item.alias)),
      description: String(row.description), sourceManuscriptVersionId: row.source_manuscript_version_id === null ? null : String(row.source_manuscript_version_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
    const timeline = (this.db.prepare(`SELECT t.* FROM timeline_events t
      JOIN chapters c ON c.id=t.chapter_id AND c.current_approved_version_id=t.source_manuscript_version_id
      WHERE t.project_id=? ORDER BY t.story_order`).all(projectId) as Row[]).map((row): TimelineEvent => ({
      id: String(row.id), projectId: String(row.project_id), chapterId: String(row.chapter_id), sourceManuscriptVersionId: String(row.source_manuscript_version_id), title: String(row.title), summary: String(row.summary), storyOrder: Number(row.story_order), status: 'canon',
      entityIds: (this.db.prepare('SELECT entity_id FROM timeline_event_entities WHERE timeline_event_id=? ORDER BY entity_id').all(String(row.id)) as Row[]).map(item => String(item.entity_id)), createdAt: String(row.created_at),
    }))
    const foreshadowing = (this.db.prepare(`SELECT f.* FROM foreshadowing_items f
      WHERE f.project_id=? AND (f.source_manuscript_version_id IS NULL OR EXISTS (
        SELECT 1 FROM chapters c WHERE c.project_id=f.project_id AND c.current_approved_version_id=f.source_manuscript_version_id
      )) ORDER BY f.updated_at DESC`).all(projectId) as Row[]).map(row => ({ id: String(row.id), projectId: String(row.project_id), title: String(row.title), description: String(row.description), status: row.status as 'planned' | 'planted' | 'reinforced' | 'resolved' | 'abandoned', sourceManuscriptVersionId: row.source_manuscript_version_id === null ? null : String(row.source_manuscript_version_id), updatedAt: String(row.updated_at) }))
    const library = this.getLibraryOverview()
    const historicalSources = [...library.active, ...library.archived].filter(item => item.id !== projectId).map((sourceProject): HistoricalSourceSetting => {
      const setting = this.db.prepare('SELECT * FROM historical_source_settings WHERE project_id=? AND source_project_id=?').get(projectId, sourceProject.id) as Row | undefined
      return { sourceProject, scopes: setting ? jsonArray<HistoricalKnowledgeScope>(setting.scopes_json) : [], enabled: Boolean(setting?.enabled), updatedAt: setting ? String(setting.updated_at) : null }
    })
    const latestRetrievals = (this.db.prepare('SELECT id FROM retrieval_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 10').all(projectId) as Row[]).map(row => this.getRetrievalBundle(String(row.id)))
    return {
      project, entities, canonFacts: (this.db.prepare(`SELECT f.* FROM canon_facts f
        JOIN chapters c ON c.id=f.chapter_id AND c.current_approved_version_id=f.source_manuscript_version_id
        WHERE f.project_id=? ORDER BY f.created_at DESC`).all(projectId) as Row[]).map(factFrom), timeline, foreshadowing,
      summaries: (this.db.prepare('SELECT * FROM knowledge_summaries WHERE project_id=? ORDER BY summary_scope,updated_at DESC').all(projectId) as Row[]).map(summaryFrom), historicalSources, latestRetrievals,
    }
  }

  configureHistoricalSource(projectId: string, sourceProjectId: string, enabled: boolean, scopes: HistoricalKnowledgeScope[]): KnowledgeWorkspace {
    this.assertProjectActive(projectId); this.getProjectTree(sourceProjectId)
    if (projectId === sourceProjectId) throw new DomainError('validation', 'A project cannot use itself as a historical source.')
    const allowed: HistoricalKnowledgeScope[] = ['structure_summary','pacing_statistics','style_features','writing_experience','worldbuilding_method','original_excerpt','names_and_entities','specific_plot']
    if (scopes.some(scope => !allowed.includes(scope))) throw new DomainError('validation', 'Historical source scopes contain an unsupported value.')
    const normalized = [...new Set(scopes)]
    this.activeProjectTransaction(projectId, () => {
      this.db.prepare(`INSERT INTO historical_source_settings(project_id,source_project_id,enabled,scopes_json,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(project_id,source_project_id) DO UPDATE SET enabled=excluded.enabled,scopes_json=excluded.scopes_json,updated_at=excluded.updated_at`).run(projectId, sourceProjectId, enabled ? 1 : 0, JSON.stringify(normalized), now())
    })
    return this.getKnowledgeWorkspace(projectId)
  }

  searchKnowledge(projectId: string, query: string, limit = 20): RetrievalItem[] {
    const term = query.trim()
    if (!term) throw new DomainError('validation', 'Knowledge search query cannot be empty.')
    this.getProjectTree(projectId)
    const results: RetrievalItem[] = []
    const push = (item: Omit<RetrievalItem, 'id' | 'rank'>) => { if (results.length < Math.max(1, Math.min(100, limit))) results.push({ ...item, id: id('search-result'), rank: results.length + 1 }) }
    const project = this.getProjectTree(projectId).project
    const like = `%${term.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    for (const row of this.db.prepare(`SELECT f.* FROM canon_facts f
      JOIN chapters c ON c.id=f.chapter_id AND c.current_approved_version_id=f.source_manuscript_version_id
      WHERE f.project_id=? AND (f.subject LIKE ? ESCAPE '\\' OR f.predicate LIKE ? ESCAPE '\\' OR f.value_json LIKE ? ESCAPE '\\')
      ORDER BY f.created_at DESC LIMIT 30`).all(projectId, like, like, like) as Row[]) push({ kind: 'canon_fact', content: `${String(row.subject)} ${String(row.predicate)} ${String(row.value_json)}`, sourceId: String(row.id), sourceVersionId: String(row.source_manuscript_version_id), sourceProjectId: projectId, sourceProjectTitle: project.title, authority: 'current_project_canon', citationLabel: `当前 Canon · ${String(row.subject)}` })
    for (const row of this.db.prepare(`SELECT ks.* FROM knowledge_summaries ks WHERE ks.project_id=? AND ks.content LIKE ? ESCAPE '\\'
      AND (ks.summary_scope<>'chapter' OR EXISTS (
        SELECT 1 FROM chapters c WHERE c.id=ks.source_id AND c.current_approved_version_id=ks.source_version_id
      )) ORDER BY ks.updated_at DESC LIMIT 30`).all(projectId, like) as Row[]) push({ kind: 'summary', content: String(row.content), sourceId: String(row.id), sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), sourceProjectId: projectId, sourceProjectTitle: project.title, authority: 'current_project_summary', citationLabel: `当前项目${String(row.summary_scope)}摘要` })
    let ftsRows: Row[] = []
    const currentFtsSource = `AND (k.source_type NOT IN ('approved_manuscript','chapter_summary') OR EXISTS (
      SELECT 1 FROM chapters c WHERE c.project_id=k.project_id AND c.current_approved_version_id=k.source_version_id
        AND (k.source_type='approved_manuscript' OR c.id=k.source_id)
    ))`
    const ftsLike = () => this.db.prepare(`SELECT k.* FROM knowledge_fts k WHERE k.project_id=? AND k.content LIKE ? ESCAPE '\\' ${currentFtsSource} LIMIT 30`).all(projectId, like) as Row[]
    try { ftsRows = this.db.prepare(`SELECT k.* FROM knowledge_fts k WHERE k.project_id=? AND knowledge_fts MATCH ? ${currentFtsSource} LIMIT 30`).all(projectId, `"${term.replaceAll('"', '""')}"`) as Row[] } catch { ftsRows = ftsLike() }
    if (ftsRows.length === 0) ftsRows = ftsLike()
    for (const row of ftsRows) push({ kind: String(row.source_type) === 'approved_manuscript' ? 'approved_excerpt' : 'summary', content: String(row.content).slice(0, 900), sourceId: String(row.source_id), sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), sourceProjectId: projectId, sourceProjectTitle: project.title, authority: String(row.source_type) === 'approved_manuscript' ? 'current_project_approved' : 'current_project_summary', citationLabel: String(row.source_type) === 'approved_manuscript' ? '当前项目批准正文' : '当前项目章节摘要' })
    const historical = this.db.prepare(`SELECT s.source_project_id,s.scopes_json,p.title FROM historical_source_settings s JOIN projects p ON p.id=s.source_project_id WHERE s.project_id=? AND s.enabled=1 ORDER BY p.title`).all(projectId) as Row[]
    for (const setting of historical) {
      const scopes = jsonArray<HistoricalKnowledgeScope>(setting.scopes_json)
      if (scopes.includes('structure_summary')) for (const row of this.db.prepare("SELECT * FROM knowledge_summaries WHERE project_id=? AND summary_scope IN ('project','book','volume') AND content LIKE ? ESCAPE '\\' LIMIT 20").all(String(setting.source_project_id), like) as Row[]) push({ kind: 'historical_summary', content: `[Historical reference: ${String(setting.title)}] ${String(row.content)}`, sourceId: String(row.id), sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), sourceProjectId: String(setting.source_project_id), sourceProjectTitle: String(setting.title), authority: 'historical_reference', citationLabel: `历史项目结构摘要 · ${String(setting.title)}` })
      if (scopes.includes('original_excerpt')) for (const row of this.db.prepare(`SELECT k.* FROM knowledge_fts k
        WHERE k.project_id=? AND k.source_type='approved_manuscript' AND k.content LIKE ? ESCAPE '\\'
          AND EXISTS (SELECT 1 FROM chapters c WHERE c.project_id=k.project_id AND c.current_approved_version_id=k.source_version_id)
        LIMIT 10`).all(String(setting.source_project_id), like) as Row[]) push({ kind: 'approved_excerpt', content: `[Historical reference: ${String(setting.title)}] ${String(row.content).slice(0, 600)}`, sourceId: String(row.source_id), sourceVersionId: row.source_version_id === null ? null : String(row.source_version_id), sourceProjectId: String(setting.source_project_id), sourceProjectTitle: String(setting.title), authority: 'historical_reference', citationLabel: `历史批准正文 · ${String(setting.title)}` })
    }
    return results
  }

  createRetrievalBundle(workflowRunId: string, purpose = 'chapter_draft'): RetrievalBundle {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    const existing = this.getRetrievalBundleForWorkflow(workflowRunId)
    if (existing) return existing
    if (!run.knowledgeSelectionSnapshotId || !run.knowledgeSelectionSnapshot) throw new DomainError('invalid-state', 'Workflow has no frozen knowledge selection.')
    const project = this.getProjectTree(run.projectId).project
    const chapter = this.getChapter(run.chapterId)
    const foundation = this.getProjectFoundation(run.projectId)
    const arcSourceId = `${chapter.volumeId ?? chapter.bookId}:arc:${Math.floor(Math.max(0, chapter.chapterNumber - 1) / 8) + 1}`
    const currentBookPosition = Number(this.one(this.db.prepare('SELECT position FROM books WHERE id=?'), chapter.bookId).position)
    const candidates: Omit<RetrievalItem, 'id' | 'rank'>[] = []
    const canonRows = this.db.prepare(`SELECT f.* FROM canon_facts f
      JOIN chapters c ON c.id=f.chapter_id AND c.current_approved_version_id=f.source_manuscript_version_id
      JOIN books b ON b.id=c.book_id
      WHERE f.project_id=? AND (b.position<? OR (b.position=? AND c.chapter_number<?))
      ORDER BY f.created_at DESC LIMIT 40`).all(run.projectId, currentBookPosition, currentBookPosition, chapter.chapterNumber) as Row[]
    for (const row of canonRows) candidates.push({ kind: 'canon_fact', content: `${String(row.subject)} ${String(row.predicate)} ${String(row.value_json)}`, sourceId: String(row.id), sourceVersionId: String(row.source_manuscript_version_id), sourceProjectId: run.projectId, sourceProjectTitle: project.title, authority: 'current_project_canon', citationLabel: `当前 Canon · ${String(row.subject)}` })
    const priorChapterSummaries = this.db.prepare(`SELECT ks.* FROM knowledge_summaries ks
      JOIN chapters c ON c.id=ks.source_id
      JOIN books b ON b.id=c.book_id
      JOIN memory_items mi ON mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id
        AND mi.state='active' AND mi.prompt_policy='auto'
      WHERE ks.project_id=? AND ks.status='current' AND ks.summary_scope='chapter'
        AND c.current_approved_version_id=ks.source_version_id
        AND (b.position<? OR (b.position=? AND c.chapter_number<?))
      ORDER BY b.position DESC,c.chapter_number DESC,ks.updated_at DESC LIMIT 20`).all(
      run.projectId, currentBookPosition, currentBookPosition, chapter.chapterNumber,
    ) as Row[]
    const globalSummaries = (this.db.prepare(`SELECT ks.* FROM knowledge_summaries ks
      JOIN memory_items mi ON mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id
        AND mi.state='active' AND mi.prompt_policy='auto'
      WHERE ks.project_id=? AND ks.status='current' AND (
        (ks.summary_scope='foundation' AND ks.source_id=?) OR
        (ks.summary_scope='project' AND ks.source_id=?) OR
        (ks.summary_scope='book' AND ks.source_id=?) OR
        (ks.summary_scope='volume' AND ks.source_id=?) OR
        (ks.summary_scope='arc' AND ks.source_id=?))
      ORDER BY CASE ks.summary_scope WHEN 'foundation' THEN 1 WHEN 'arc' THEN 2 WHEN 'volume' THEN 3 WHEN 'book' THEN 4 ELSE 5 END,ks.updated_at DESC`).all(
      run.projectId, foundation.assemblyHash ?? '', run.projectId, chapter.bookId, chapter.volumeId ?? chapter.bookId, arcSourceId,
    ) as Row[]).map(summaryFrom).filter(summary => summary.scope === 'foundation' || this.summaryIsUsableBeforeChapter(summary, currentBookPosition, chapter.chapterNumber))
    const summaries = [...priorChapterSummaries, ...globalSummaries]
    for (const value of summaries) {
      const summary = 'scope' in value ? value as KnowledgeSummary : summaryFrom(value as Row)
      candidates.push({ kind: 'summary', content: summary.content, sourceId: summary.id, sourceVersionId: summary.sourceVersionId, sourceProjectId: run.projectId, sourceProjectTitle: project.title, authority: 'current_project_summary', citationLabel: `当前项目${summary.scope}摘要` })
    }
    const approved = this.db.prepare(`SELECT m.*,c.title FROM manuscript_versions m
      JOIN chapters c ON c.id=m.chapter_id AND c.current_approved_version_id=m.id
      JOIN books b ON b.id=c.book_id
      WHERE m.project_id=? AND m.status='approved' AND (b.position<? OR (b.position=? AND c.chapter_number<?))
      ORDER BY b.position DESC,c.chapter_number DESC,m.approved_at DESC LIMIT 12`).all(
      run.projectId, currentBookPosition, currentBookPosition, chapter.chapterNumber,
    ) as Row[]
    for (const row of approved) candidates.push({ kind: 'approved_excerpt', content: String(row.content).slice(0, 900), sourceId: String(row.id), sourceVersionId: String(row.id), sourceProjectId: run.projectId, sourceProjectTitle: project.title, authority: 'current_project_approved', citationLabel: `批准正文 · ${String(row.title)}` })
    for (const selection of run.knowledgeSelectionSnapshot.items) {
      if (selection.scopes.includes('structure_summary')) {
        const rows = (this.db.prepare(`SELECT ks.* FROM knowledge_summaries ks
          JOIN memory_items mi ON mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id
            AND mi.state='active' AND mi.prompt_policy='auto'
          WHERE ks.project_id=? AND ks.status='current' AND ks.summary_scope IN ('project','book','volume')
            AND (ks.source_version_id IS NULL OR EXISTS (
              SELECT 1 FROM chapters source_chapter WHERE source_chapter.project_id=ks.project_id AND source_chapter.current_approved_version_id=ks.source_version_id
            ))
          ORDER BY ks.updated_at DESC LIMIT 12`).all(selection.sourceProjectId) as Row[]).map(summaryFrom).filter(summary => this.summaryDependenciesAreCurrent(summary))
        for (const summary of rows) candidates.push({ kind: 'historical_summary', content: `[Historical reference: ${selection.sourceProjectTitle}] ${summary.content}`, sourceId: summary.id, sourceVersionId: summary.sourceVersionId, sourceProjectId: selection.sourceProjectId, sourceProjectTitle: selection.sourceProjectTitle, authority: 'historical_reference', citationLabel: `历史项目结构摘要 · ${selection.sourceProjectTitle}` })
      }
      if (selection.scopes.includes('original_excerpt')) {
        const rows = this.db.prepare(`SELECT m.id,m.content,c.title FROM manuscript_versions m JOIN chapters c ON c.id=m.chapter_id WHERE m.project_id=? AND m.status='approved' ORDER BY m.approved_at DESC LIMIT 4`).all(selection.sourceProjectId) as Row[]
        for (const row of rows) candidates.push({ kind: 'approved_excerpt', content: `[Historical reference: ${selection.sourceProjectTitle}] ${String(row.content).slice(0, 600)}`, sourceId: String(row.id), sourceVersionId: String(row.id), sourceProjectId: selection.sourceProjectId, sourceProjectTitle: selection.sourceProjectTitle, authority: 'historical_reference', citationLabel: `历史批准正文 · ${selection.sourceProjectTitle} / ${String(row.title)}` })
      }
    }
    const budget = 12000
    let used = 0
    const selected: typeof candidates = []
    let truncated = false
    for (const candidate of candidates) {
      if (used + candidate.content.length > budget) { truncated = true; continue }
      selected.push(candidate); used += candidate.content.length
    }
    const retrievalRunId = id('retrieval-run')
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      this.db.prepare('INSERT INTO retrieval_runs(id,workflow_run_id,project_id,purpose,project_revision,selection_snapshot_id,conflicts_json,truncated,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(retrievalRunId, workflowRunId, run.projectId, purpose, run.projectRevisionAtStart, run.knowledgeSelectionSnapshotId, '[]', truncated ? 1 : 0, timestamp)
      selected.forEach((item, index) => this.db.prepare('INSERT INTO retrieval_items(id,retrieval_run_id,item_kind,content,source_id,source_version_id,source_project_id,source_project_title,authority,citation_label,rank) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id('retrieval-item'), retrievalRunId, item.kind, item.content, item.sourceId, item.sourceVersionId, item.sourceProjectId, item.sourceProjectTitle, item.authority, item.citationLabel, index + 1))
      this.addWorkflowEvent(workflowRunId, null, 'knowledge.retrieval.created', { retrievalRunId, selectionSnapshotId: run.knowledgeSelectionSnapshotId, itemCount: selected.length, truncated })
    })
    return this.getRetrievalBundle(retrievalRunId)
  }

  getKnowledgeRefreshContext(workflowRunId: string): KnowledgeRefreshContext {
    const run = this.getWorkflowRun(workflowRunId)
    if (!run.approvedVersionId) throw new DomainError('invalid-state', 'Long-novel memory requires an approved manuscript version.')
    const chapter = this.getChapter(run.chapterId)
    const approvedVersion = chapter.versions.find(version => version.id === run.approvedVersionId)
    if (!approvedVersion || approvedVersion.status !== 'approved') throw new DomainError('invalid-state', 'Approved manuscript is unavailable for memory refresh.')
    const project = this.getProjectTree(run.projectId).project
    const foundation = this.getProjectFoundation(run.projectId)
    if (!foundation.assemblyHash) throw new DomainError('invalid-state', 'Approved project foundation is unavailable for memory refresh.')
    const arcIndex = Math.floor(Math.max(0, chapter.chapterNumber - 1) / 8) + 1
    const arcStartChapter = (arcIndex - 1) * 8 + 1
    const arcEndChapter = arcIndex * 8
    const arcSourceId = `${chapter.volumeId ?? chapter.bookId}:arc:${arcIndex}`
    const currentBookPosition = Number(this.one(this.db.prepare('SELECT position FROM books WHERE id=?'), chapter.bookId).position)
    const current = (scope: KnowledgeSummary['scope'], sourceId: string): KnowledgeSummary | null => {
      const row = this.db.prepare(`SELECT ks.* FROM knowledge_summaries ks
        JOIN memory_items mi ON mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id
          AND mi.state='active' AND mi.prompt_policy='auto'
        WHERE ks.project_id=? AND ks.summary_scope=? AND ks.source_id=? AND ks.status='current'`).get(run.projectId, scope, sourceId) as Row | undefined
      if (!row) return null
      const summary = summaryFrom(row)
      return scope === 'foundation' || this.summaryIsUsableBeforeChapter(summary, currentBookPosition, chapter.chapterNumber) ? summary : null
    }
    const priorRows = this.db.prepare(`SELECT ks.*,c.id chapter_id,c.book_id,c.volume_id,c.chapter_number,c.title chapter_title,
        m.id approved_version_id,m.content approved_content,m.approved_at
      FROM chapters c JOIN books b ON b.id=c.book_id
      JOIN manuscript_versions m ON m.id=c.current_approved_version_id AND m.status='approved'
      LEFT JOIN knowledge_summaries ks ON ks.project_id=c.project_id AND ks.summary_scope='chapter' AND ks.source_id=c.id
        AND ks.status='current' AND ks.source_version_id=m.id
        AND EXISTS (SELECT 1 FROM memory_items mi WHERE mi.project_id=ks.project_id AND mi.origin='derived' AND mi.source_key=ks.id AND mi.state='active' AND mi.prompt_policy='auto')
      WHERE c.project_id=? AND (b.position<? OR (b.position=? AND c.chapter_number<?))
      ORDER BY b.position DESC,c.chapter_number DESC LIMIT 40`).all(
      run.projectId, currentBookPosition, currentBookPosition, chapter.chapterNumber,
    ) as Row[]
    const safePriorChapterSummaries = priorRows.slice().reverse().map(row => {
      const summary = row.id !== null && row.id !== undefined ? summaryFrom(row) : (() => {
        const compactNarrative = String(row.approved_content).replace(/\s+/g, ' ').trim().slice(0, 600) || String(row.chapter_title)
        return {
          id: `approved-fallback:${String(row.approved_version_id)}`, projectId: run.projectId, scope: 'chapter' as const,
          sourceId: String(row.chapter_id), sourceVersionId: String(row.approved_version_id), content: compactNarrative,
          structuredJson: '{}', compactNarrative, sourceStartChapter: Number(row.chapter_number), sourceEndChapter: Number(row.chapter_number),
          sourceVersionIds: [String(row.approved_version_id)], contentHash: createHash('sha256').update(compactNarrative).digest('hex'),
          provider: null, model: null, promptHash: null, status: 'current' as const, updatedAt: String(row.approved_at ?? now()),
        }
      })()
      return {
        chapterId: String(row.chapter_id), chapterNumber: Number(row.chapter_number), chapterTitle: String(row.chapter_title),
        approvedVersionId: String(row.approved_version_id), summary, bookId: String(row.book_id),
        volumeId: row.volume_id === null ? null : String(row.volume_id),
      }
    })
    return {
      project, chapter, approvedVersion, bookId: chapter.bookId, volumeId: chapter.volumeId,
      foundationVersions: this.getApprovedProjectFoundationVersions(run.projectId),
      previousFoundation: current('foundation', foundation.assemblyHash), previousArc: current('arc', arcSourceId),
      previousVolume: current('volume', chapter.volumeId ?? chapter.bookId), previousBook: current('book', chapter.bookId),
      previousProject: current('project', run.projectId), safePriorChapterSummaries, arcStartChapter, arcEndChapter,
    }
  }

  upsertKnowledgeSummary(projectId: string, summary: KnowledgeSummaryDraft): void {
    this.assertProjectActive(projectId)
    this.activeProjectTransaction(projectId, () => { this.upsertKnowledgeSummaryUnchecked(projectId, summary) })
  }

  private upsertKnowledgeSummaryUnchecked(projectId: string, summary: KnowledgeSummaryDraft): void {
    const timestamp = now()
    const content = summary.compactNarrative.trim()
    if (!content) throw new DomainError('validation', 'Knowledge summary compact narrative cannot be empty.')
    this.db.prepare(`INSERT INTO knowledge_summaries(
      id,project_id,summary_scope,source_id,source_version_id,content,status,updated_at,
      structured_json,compact_narrative,source_start_chapter,source_end_chapter,source_version_ids_json,content_hash,provider,model,prompt_hash
    ) VALUES (?,?,?,?,?,?,'current',?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project_id,summary_scope,source_id) DO UPDATE SET
      source_version_id=excluded.source_version_id,content=excluded.content,status='current',updated_at=excluded.updated_at,
      structured_json=excluded.structured_json,compact_narrative=excluded.compact_narrative,
      source_start_chapter=excluded.source_start_chapter,source_end_chapter=excluded.source_end_chapter,
      source_version_ids_json=excluded.source_version_ids_json,content_hash=excluded.content_hash,
      provider=excluded.provider,model=excluded.model,prompt_hash=excluded.prompt_hash`).run(
      id('knowledge-summary'), projectId, summary.scope, summary.sourceId, summary.sourceVersionId, content, timestamp,
      summary.structuredJson, content, summary.sourceStartChapter, summary.sourceEndChapter, JSON.stringify(summary.sourceVersionIds),
      createHash('sha256').update(`${summary.structuredJson}\n${content}`).digest('hex'), summary.provider, summary.model, summary.promptHash,
    )
    const persisted = this.one(this.db.prepare('SELECT * FROM knowledge_summaries WHERE project_id=? AND summary_scope=? AND source_id=?'), projectId, summary.scope, summary.sourceId)
    this.syncDerivedMemorySummaryUnchecked(projectId, persisted)
  }

  refreshKnowledgeIndexes(workflowRunId: string, summaries: KnowledgeSummaryDraft[] = []): KnowledgeWorkspace {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    if (!run.approvedVersionId) throw new DomainError('invalid-state', 'Knowledge indexes require an approved manuscript version.')
    const chapter = this.getChapter(run.chapterId)
    const version = chapter.versions.find(item => item.id === run.approvedVersionId)
    if (!version || version.status !== 'approved') throw new DomainError('invalid-state', 'Approved manuscript is unavailable for indexing.')
    const timestamp = now()
    const fallbackSummary = version.content.replace(/\s+/g, ' ').trim().slice(0, 360)
    const bookPosition = Number(this.one(this.db.prepare('SELECT position FROM books WHERE id=?'), chapter.bookId).position)
    const storyOrder = Math.max(0, bookPosition - 1) * 1_000_000 + chapter.chapterNumber * 1000
    this.activeProjectTransaction(run.projectId, () => {
      if (summaries.length === 0) {
        this.db.prepare(`INSERT INTO knowledge_summaries(id,project_id,summary_scope,source_id,source_version_id,content,status,updated_at,compact_narrative,source_start_chapter,source_end_chapter,source_version_ids_json,content_hash) VALUES (?,?,?,?,?,?,'current',?,?,?,?,?,?)
          ON CONFLICT(project_id,summary_scope,source_id) DO UPDATE SET source_version_id=excluded.source_version_id,content=excluded.content,compact_narrative=excluded.compact_narrative,source_start_chapter=excluded.source_start_chapter,source_end_chapter=excluded.source_end_chapter,source_version_ids_json=excluded.source_version_ids_json,content_hash=excluded.content_hash,status='current',updated_at=excluded.updated_at`).run(id('knowledge-summary'), run.projectId, 'chapter', chapter.id, version.id, fallbackSummary || chapter.title, timestamp, fallbackSummary || chapter.title, chapter.chapterNumber, chapter.chapterNumber, JSON.stringify([version.id]), createHash('sha256').update(fallbackSummary || chapter.title).digest('hex'))
        this.syncDerivedMemorySummaryUnchecked(run.projectId, this.one(this.db.prepare("SELECT * FROM knowledge_summaries WHERE project_id=? AND summary_scope='chapter' AND source_id=?"), run.projectId, chapter.id))
      } else {
        for (const summary of summaries) this.upsertKnowledgeSummaryUnchecked(run.projectId, summary)
      }
      const entityRow = this.db.prepare("SELECT id FROM story_entities WHERE project_id=? AND entity_type='concept' AND name=?").get(run.projectId, chapter.title) as Row | undefined
      const entityId = entityRow ? String(entityRow.id) : id('story-entity')
      if (!entityRow) this.db.prepare("INSERT INTO story_entities(id,project_id,entity_type,name,description,source_manuscript_version_id,created_at,updated_at) VALUES (?,?,'concept',?,?,?,?,?)").run(entityId, run.projectId, chapter.title, fallbackSummary, version.id, timestamp, timestamp)
      else this.db.prepare('UPDATE story_entities SET description=?,source_manuscript_version_id=?,updated_at=? WHERE id=?').run(fallbackSummary, version.id, timestamp, entityId)
      const timelineId = id('timeline-event')
      this.db.prepare("INSERT OR IGNORE INTO timeline_events(id,project_id,chapter_id,source_manuscript_version_id,title,summary,story_order,status,created_at) VALUES (?,?,?,?,?,?,?,'canon',?)").run(timelineId, run.projectId, chapter.id, version.id, chapter.title, fallbackSummary, storyOrder, timestamp)
      const persistedTimeline = this.db.prepare('SELECT id FROM timeline_events WHERE source_manuscript_version_id=?').get(version.id) as Row
      this.db.prepare('INSERT OR IGNORE INTO timeline_event_entities(timeline_event_id,entity_id) VALUES (?,?)').run(String(persistedTimeline.id), entityId)
      const facts = this.db.prepare('SELECT * FROM canon_facts WHERE project_id=? AND source_manuscript_version_id=? ORDER BY created_at').all(run.projectId, version.id) as Row[]
      const allowedTypes: StoryEntity['type'][] = ['character','location','faction','item','ability','species','organization','concept','rule']
      const allowedForeshadow = ['planned','planted','reinforced','resolved','abandoned'] as const
      for (const fact of facts) {
        let detail: Record<string, unknown> = {}
        try { const parsed = JSON.parse(String(fact.value_json)) as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown> } catch { detail = {} }
        const requestedType = typeof detail.entityType === 'string' ? detail.entityType : 'concept'
        const entityType = allowedTypes.includes(requestedType as StoryEntity['type']) ? requestedType as StoryEntity['type'] : 'concept'
        const subject = String(fact.subject)
        const semanticRow = this.db.prepare('SELECT id FROM story_entities WHERE project_id=? AND entity_type=? AND name=?').get(run.projectId, entityType, subject) as Row | undefined
        const semanticId = semanticRow ? String(semanticRow.id) : id('story-entity')
        const semanticDescription = `${String(fact.predicate)}: ${typeof detail.value === 'string' ? detail.value : JSON.stringify(detail.value ?? detail)}`
        if (!semanticRow) this.db.prepare('INSERT INTO story_entities(id,project_id,entity_type,name,description,source_manuscript_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(semanticId, run.projectId, entityType, subject, semanticDescription, version.id, timestamp, timestamp)
        else this.db.prepare('UPDATE story_entities SET description=?,source_manuscript_version_id=?,updated_at=? WHERE id=?').run(semanticDescription, version.id, timestamp, semanticId)
        if (Array.isArray(detail.aliases)) for (const alias of detail.aliases.filter(item => typeof item === 'string' && item.trim()).slice(0, 20)) this.db.prepare('INSERT OR IGNORE INTO entity_aliases(id,entity_id,alias,created_at) VALUES (?,?,?,?)').run(id('entity-alias'), semanticId, String(alias).trim(), timestamp)
        this.db.prepare('INSERT OR IGNORE INTO timeline_event_entities(timeline_event_id,entity_id) VALUES (?,?)').run(String(persistedTimeline.id), semanticId)
        if (detail.kind === 'foreshadowing' && typeof detail.foreshadowStatus === 'string' && allowedForeshadow.includes(detail.foreshadowStatus as typeof allowedForeshadow[number])) {
          const description = typeof detail.value === 'string' ? detail.value : String(fact.predicate)
          const stableForeshadowId = stableId('foreshadowing', 'canon-fact', String(fact.id))
          // Schema 19 has no dedicated Canon-fact key on foreshadowing rows. New
          // rows therefore use the immutable Canon fact id, while the semantic
          // lookup adopts an already-written legacy row after an upgrade. This
          // makes a retry safe without deleting or rewriting historical rows.
          let foreshadowRow = this.db.prepare('SELECT id FROM foreshadowing_items WHERE id=?').get(stableForeshadowId) as Row | undefined
          if (!foreshadowRow) foreshadowRow = this.db.prepare(`SELECT id FROM foreshadowing_items
            WHERE project_id=? AND source_manuscript_version_id=? AND title=? AND description=? AND status=?
            ORDER BY created_at,id LIMIT 1`).get(run.projectId, version.id, subject, description, detail.foreshadowStatus) as Row | undefined
          const foreshadowId = foreshadowRow ? String(foreshadowRow.id) : stableForeshadowId
          if (!foreshadowRow) this.db.prepare('INSERT INTO foreshadowing_items(id,project_id,title,description,status,source_manuscript_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(foreshadowId, run.projectId, subject, description, detail.foreshadowStatus, version.id, timestamp, timestamp)

          const stableTransitionId = stableId('foreshadow-transition', 'canon-fact', String(fact.id), 'initial')
          let transitionRow = this.db.prepare('SELECT id FROM foreshadowing_transitions WHERE id=?').get(stableTransitionId) as Row | undefined
          if (!transitionRow) transitionRow = this.db.prepare(`SELECT id FROM foreshadowing_transitions
            WHERE foreshadowing_id=? AND from_status IS NULL AND to_status=? AND source_manuscript_version_id=?
            ORDER BY created_at,id LIMIT 1`).get(foreshadowId, detail.foreshadowStatus, version.id) as Row | undefined
          if (!transitionRow) this.db.prepare('INSERT INTO foreshadowing_transitions(id,foreshadowing_id,from_status,to_status,source_manuscript_version_id,note,created_at) VALUES (?,?,NULL,?,?,?,?)').run(stableTransitionId, foreshadowId, detail.foreshadowStatus, version.id, 'Committed from approved Canon candidate.', timestamp)
        }
      }
      this.db.prepare(`DELETE FROM knowledge_fts WHERE project_id=? AND (
        source_id=? OR source_version_id IN (SELECT id FROM manuscript_versions WHERE chapter_id=?))`).run(run.projectId, chapter.id, chapter.id)
      this.db.prepare("INSERT INTO knowledge_fts(project_id,source_type,source_id,source_version_id,content) VALUES (?,'approved_manuscript',?,?,?)").run(run.projectId, version.id, version.id, version.content)
      const currentChapterSummary = this.db.prepare("SELECT content FROM knowledge_summaries WHERE project_id=? AND summary_scope='chapter' AND source_id=?").get(run.projectId, chapter.id) as Row | undefined
      this.db.prepare("INSERT INTO knowledge_fts(project_id,source_type,source_id,source_version_id,content) VALUES (?,'chapter_summary',?,?,?)").run(run.projectId, chapter.id, version.id, currentChapterSummary ? String(currentChapterSummary.content) : fallbackSummary)
      this.addWorkflowEvent(workflowRunId, null, 'knowledge.index.updated', { manuscriptVersionId: version.id, chapterId: chapter.id })
    })
    this.syncProjectMemory(run.projectId)
    return this.getKnowledgeWorkspace(run.projectId)
  }

  finishWorkflow(workflowRunId: string, nodeRunId: string): WorkflowRun {
    const run = this.getWorkflowRun(workflowRunId)
    this.assertProjectActive(run.projectId)
    const timestamp = now()
    this.activeProjectTransaction(run.projectId, () => {
      const workflow = this.one(this.db.prepare('SELECT status,current_node_key FROM workflow_runs WHERE id=?'), workflowRunId)
      const node = this.one(this.db.prepare('SELECT status FROM workflow_node_runs WHERE id=? AND workflow_run_id=?'), nodeRunId, workflowRunId)
      if (workflow.status !== 'running' || workflow.current_node_key !== null || node.status !== 'succeeded') {
        throw new DomainError('invalid-state', '工作流已取消、暂停或最终节点尚未完成，不能标记成功。')
      }
      const changed = this.db.prepare("UPDATE workflow_runs SET status='succeeded',current_node_key=NULL,finished_at=? WHERE id=? AND status='running' AND current_node_key IS NULL").run(timestamp, workflowRunId)
      if (Number(changed.changes) !== 1) throw new DomainError('invalid-state', 'Workflow no longer owns the final transition.')
      this.addWorkflowEvent(workflowRunId, nodeRunId, 'workflow.succeeded', {})
    })
    this.refreshProjectRecoveryCapsules(run.projectId)
    return this.getWorkflowRun(workflowRunId)
  }

  close(): void {
    if (this.closed) return
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.close()
    this.closed = true
  }
}
