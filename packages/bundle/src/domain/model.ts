export type ProjectStatus = 'active' | 'archived'
export type ChapterStatus = 'draft' | 'approved'
export type ManuscriptStatus = 'draft' | 'approved' | 'superseded'
export type ManuscriptOrigin = 'user' | 'autosave' | 'model'
export type GenerationPurpose = 'scene-plan' | 'chapter-draft'
export const ACTIVE_PROJECT_FOUNDATION_KINDS = ['outline', 'characters', 'timeline'] as const
export type ActiveProjectFoundationKind = (typeof ACTIVE_PROJECT_FOUNDATION_KINDS)[number]
export type ProjectFoundationKind = 'outline' | 'characters' | 'worldbuilding' | 'timeline' | 'foreshadowing'

export function isActiveProjectFoundationKind(value: string): value is ActiveProjectFoundationKind {
  return (ACTIVE_PROJECT_FOUNDATION_KINDS as readonly string[]).includes(value)
}

export interface Project {
  id: string
  title: string
  slug: string
  language: string
  genre: string | null
  audience: string | null
  status: ProjectStatus
  targetWordCount: number | null
  chapterTargetWords: number | null
  currentBookId: string
  revision: number
  createdAt: string
  updatedAt: string
  /** Set while the project is in the archive; absent on older in-memory fixtures. */
  archivedAt?: string | null
  /** Optional user-selected local novel folder; SQLite remains the source of truth. */
  workspacePath?: string | null
  /** When true, approved/draft chapters and memory are mirrored to Markdown files. */
  markdownSyncEnabled?: boolean
  memoryUpdatedAt?: string | null
}

export interface LibraryOverview {
  active: Project[]
  archived: Project[]
}

export interface Book {
  id: string
  projectId: string
  title: string
  position: number
  createdAt: string
}

export interface Volume {
  id: string
  projectId: string
  bookId: string
  title: string
  position: number
  createdAt: string
}

export interface Chapter {
  id: string
  projectId: string
  bookId: string
  volumeId: string | null
  chapterNumber: number
  title: string
  status: ChapterStatus
  currentDraftVersionId: string | null
  currentApprovedVersionId: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ManuscriptVersion {
  id: string
  projectId: string
  chapterId: string
  parentVersionId: string | null
  status: ManuscriptStatus
  content: string
  contentHash: string
  wordCount: number
  origin: ManuscriptOrigin
  createdBy: 'user' | 'model'
  promptAssetVersionId: string | null
  modelRunId: string | null
  workflowRunId: string | null
  workflowNodeRunId: string | null
  createdAt: string
  approvedAt: string | null
}

export type WorkflowRunStatus = 'running' | 'paused' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled'
export type WorkflowNodeStatus = 'pending' | 'ready' | 'running' | 'waiting_approval' | 'succeeded' | 'failed_retryable' | 'failed_terminal' | 'cancel_requested' | 'cancelled' | 'skipped'

export interface WorkflowDefinitionVersion {
  id: string
  definitionId: string
  key: string
  name: string
  version: number
  nodes: string[]
  contentHash: string
  createdAt: string
}

export interface WorkflowNodeRun {
  id: string
  workflowRunId: string
  nodeKey: string
  nodeVersion: number
  status: WorkflowNodeStatus
  attempt: number
  idempotencyKey: string
  inputJson: string
  outputJson: string | null
  startedAt: string | null
  finishedAt: string | null
  errorJson: string | null
}

export interface WorkflowEvent {
  id: string
  workflowRunId: string
  nodeRunId: string | null
  type: string
  payloadJson: string
  createdAt: string
}

export interface WorkflowApproval {
  id: string
  workflowRunId: string
  manuscriptVersionId: string
  status: 'pending' | 'approved' | 'rejected'
  decisionNote: string
  decidedAt: string | null
  createdAt: string
}

export interface ReviewReport {
  id: string
  workflowRunId: string
  nodeRunId: string
  manuscriptVersionId: string
  kind: 'plot' | 'character' | 'timeline' | 'style' | 'aggregate'
  verdict: 'pass' | 'revise'
  reportJson: string
  createdAt: string
}

export interface CanonCandidate {
  id: string
  workflowRunId: string
  manuscriptVersionId: string
  subject: string
  predicate: string
  valueJson: string
  status: 'candidate' | 'validated' | 'committed' | 'rejected'
  createdAt: string
}

export interface CanonFact {
  id: string
  projectId: string
  chapterId: string
  sourceManuscriptVersionId: string
  candidateId: string
  subject: string
  predicate: string
  valueJson: string
  createdAt: string
}

export type StoryEntityType = 'character' | 'location' | 'faction' | 'item' | 'ability' | 'species' | 'organization' | 'concept' | 'rule'
export type HistoricalKnowledgeScope = 'structure_summary' | 'pacing_statistics' | 'style_features' | 'writing_experience' | 'worldbuilding_method' | 'original_excerpt' | 'names_and_entities' | 'specific_plot'

export interface StoryEntity { id: string; projectId: string; type: StoryEntityType; name: string; aliases: string[]; description: string; sourceManuscriptVersionId: string | null; createdAt: string; updatedAt: string }
export interface TimelineEvent { id: string; projectId: string; chapterId: string; sourceManuscriptVersionId: string; title: string; summary: string; storyOrder: number; status: 'canon'; entityIds: string[]; createdAt: string }
export interface ForeshadowingItem { id: string; projectId: string; title: string; description: string; status: 'planned' | 'planted' | 'reinforced' | 'resolved' | 'abandoned'; sourceManuscriptVersionId: string | null; updatedAt: string }
export interface KnowledgeSummary {
  id: string
  projectId: string
  scope: 'foundation' | 'chapter' | 'arc' | 'volume' | 'book' | 'project'
  sourceId: string
  sourceVersionId: string | null
  content: string
  structuredJson: string
  compactNarrative: string
  sourceStartChapter: number | null
  sourceEndChapter: number | null
  sourceVersionIds: string[]
  contentHash: string
  provider: string | null
  model: string | null
  promptHash: string | null
  status: 'current' | 'stale'
  updatedAt: string
}
export interface HistoricalSourceSetting { sourceProject: Project; scopes: HistoricalKnowledgeScope[]; enabled: boolean; updatedAt: string | null }
export interface KnowledgeSelectionItem { sourceProjectId: string; sourceProjectTitle: string; scopes: HistoricalKnowledgeScope[] }
export interface KnowledgeSelectionSnapshot { id: string; projectId: string; projectRevision: number; items: KnowledgeSelectionItem[]; excludedSourceIds: string[]; createdAt: string }
export interface RetrievalItem { id: string; kind: 'canon_fact' | 'summary' | 'approved_excerpt' | 'historical_summary'; content: string; sourceId: string; sourceVersionId: string | null; sourceProjectId: string; sourceProjectTitle: string; authority: 'current_project_canon' | 'current_project_summary' | 'current_project_approved' | 'historical_reference'; citationLabel: string; rank: number }
export interface RetrievalBundle { id: string; workflowRunId: string; purpose: string; projectRevision: number; selectionSnapshotId: string; items: RetrievalItem[]; conflicts: string[]; truncated: boolean; createdAt: string }
export interface KnowledgeWorkspace { project: Project; entities: StoryEntity[]; canonFacts: CanonFact[]; timeline: TimelineEvent[]; foreshadowing: ForeshadowingItem[]; summaries: KnowledgeSummary[]; historicalSources: HistoricalSourceSetting[]; latestRetrievals: RetrievalBundle[] }

export interface KnowledgeSummaryDraft {
  scope: KnowledgeSummary['scope']
  sourceId: string
  sourceVersionId: string | null
  structuredJson: string
  compactNarrative: string
  sourceStartChapter: number | null
  sourceEndChapter: number | null
  sourceVersionIds: string[]
  provider: string
  model: string
  promptHash: string
}

export interface KnowledgeRefreshContext {
  project: Project
  chapter: ChapterDetail
  approvedVersion: ManuscriptVersion
  bookId: string
  volumeId: string | null
  foundationVersions: ProjectFoundationVersion[]
  previousFoundation: KnowledgeSummary | null
  previousArc: KnowledgeSummary | null
  previousVolume: KnowledgeSummary | null
  previousBook: KnowledgeSummary | null
  previousProject: KnowledgeSummary | null
  safePriorChapterSummaries: Array<PriorChapterSummary & { bookId: string; volumeId: string | null }>
  arcStartChapter: number
  arcEndChapter: number
}

export interface PromptAssemblySectionTrace {
  key: string
  label: string
  estimatedTokens: number
  included: boolean
  truncated: boolean
  reason: string
  sourceIds: string[]
}

export interface PromptAssemblyTrace {
  contextWindow: number
  contextWindowSource: 'provider' | 'fallback'
  maxOutputTokens: number
  safetyTokens: number
  systemTokens: number
  basePromptTokens: number
  memoryBudgetTokens: number
  selectedMemoryTokens: number
  estimatedInputTokens: number
  sections: PromptAssemblySectionTrace[]
}

export interface WorkflowRun {
  id: string
  projectId: string
  chapterId: string
  definitionVersionId: string
  status: WorkflowRunStatus
  currentNodeKey: string | null
  inputSnapshotJson: string
  projectRevisionAtStart: number
  chapterRevisionAtStart: number
  approvedVersionId: string | null
  revisionRound: number
  createdAt: string
  startedAt: string
  finishedAt: string | null
  errorJson: string | null
  knowledgeSelectionSnapshotId: string | null
  knowledgeSelectionSnapshot: KnowledgeSelectionSnapshot | null
  retrievalBundle: RetrievalBundle | null
  definition: WorkflowDefinitionVersion
  nodes: WorkflowNodeRun[]
  events: WorkflowEvent[]
  approval: WorkflowApproval | null
  reviews: ReviewReport[]
  canonCandidates: CanonCandidate[]
  canonFacts: CanonFact[]
}

export type AutomationMode = 'auto' | 'yolo'
export type ChapterBatchMode = 'selected' | 'continuous'
export type ChapterBatchStatus = 'planning' | 'awaiting_plan_approval' | 'queued' | 'running' | 'waiting_approval' | 'pause_requested' | 'paused' | 'blocked' | 'succeeded' | 'completed_with_skips' | 'cancelled'
export type ChapterBatchItemState = 'planned' | 'queued' | 'dispatched' | 'blocked' | 'skipped' | 'cancelled'

export interface ChapterWritingBrief {
  chapterId: string
  writingGoal: string
  openingContinuity: string
  endingHook: string
  targetWords: number
  source: 'user' | 'batch-plan'
  revision: number
  batchItemId: string | null
  provider: string | null
  model: string | null
  promptHash: string | null
  updatedAt: string
}

export interface ChapterBatchItem {
  id: string
  batchId: string
  chapterId: string | null
  position: number
  plannedTitle: string
  writingGoal: string
  openingContinuity: string
  endingHook: string
  targetWords: number
  queueState: ChapterBatchItemState
  workflowRunId: string | null
  workflow: WorkflowRun | null
  chapterRevisionAtEnqueue: number | null
  blockedReason: string | null
  createdAt: string
  updatedAt: string
}

export interface ChapterBatchPlan {
  id: string
  batchId: string
  status: 'planning' | 'succeeded' | 'failed' | 'cancelled'
  provider: string
  model: string
  promptHash: string
  inputSnapshotJson: string
  outputJson: string | null
  streamedText: string
  errorJson: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface ChapterGenerationBatch {
  id: string
  projectId: string
  mode: ChapterBatchMode
  automationMode: AutomationMode
  status: ChapterBatchStatus
  requestedCount: number
  policyJson: string
  revision: number
  errorJson: string | null
  plan: ChapterBatchPlan | null
  items: ChapterBatchItem[]
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type MemoryOrigin = 'derived' | 'user'
export type MemoryStorage = 'database' | 'markdown'
export type MemoryCategory = 'continuity' | 'constraint' | 'character' | 'world' | 'timeline' | 'foreshadowing' | 'idea' | 'research' | 'other'
export type MemoryPromptPolicy = 'auto' | 'manual' | 'excluded'
export type MemoryItemState = 'active' | 'archived' | 'conflicted'

export interface MemoryRevision {
  id: string
  itemId: string
  revision: number
  content: string
  structuredJson: string
  contentHash: string
  actor: 'model' | 'user' | 'filesystem' | 'migration'
  parentRevisionId: string | null
  provider: string | null
  model: string | null
  promptHash: string | null
  createdAt: string
}

export interface MemorySource {
  id: string
  revisionId: string
  sourceType: string
  sourceId: string
  sourceVersionId: string | null
  label: string
  createdAt: string
}

export interface MemoryUsage {
  id: string
  itemId: string
  revisionId: string
  modelRunId: string
  sectionKey: string
  included: boolean
  truncated: boolean
  estimatedTokens: number
  reason: string
  createdAt: string
}

export interface MemoryUsagePage {
  items: MemoryUsage[]
  total: number
  nextCursor: string | null
}

export interface MemoryItem {
  id: string
  projectId: string
  origin: MemoryOrigin
  storage: MemoryStorage
  scope: KnowledgeSummary['scope']
  category: MemoryCategory
  state: MemoryItemState
  promptPolicy: MemoryPromptPolicy
  sourceKey: string
  revision: number
  currentRevision: MemoryRevision
  sources: MemorySource[]
  recentUsages: MemoryUsage[]
  createdAt: string
  updatedAt: string
}

export interface MemoryBrowserPage {
  items: MemoryItem[]
  total: number
  nextCursor: string | null
  facets: Record<string, Record<string, number>>
}

export interface MemoryRevisionHistoryEntry extends MemoryRevision {
  sources: MemorySource[]
}

export interface MemoryRevisionDiff {
  from: MemoryRevision
  to: MemoryRevision
  lines: Array<{ kind: 'same' | 'added' | 'removed'; text: string }>
}

export interface MemoryConflict {
  id: string
  itemId: string
  baseRevisionId: string | null
  baseContent: string
  databaseRevisionId: string
  databaseContent: string
  fileContent: string
  fileHash: string
  baseToDatabaseDiff: MemoryRevisionDiff['lines']
  baseToFileDiff: MemoryRevisionDiff['lines']
  status: 'open' | 'resolved'
  resolution: string | null
  createdAt: string
  resolvedAt: string | null
}

export type RelationshipMode = 'off' | AutomationMode
export type RelationshipCategory = 'family' | 'emotion' | 'alliance' | 'conflict' | 'membership' | 'possession' | 'location' | 'knowledge' | 'causality' | 'other'
export type RelationshipFactLayer = 'planned' | 'canon' | 'author_asserted'

export interface EntityRelationship {
  id: string
  projectId: string
  sourceEntityId: string
  targetEntityId: string
  sourceEntityName: string
  targetEntityName: string
  predicateKey: string
  label: string
  category: RelationshipCategory
  directionality: 'directed' | 'symmetric'
  factLayer: RelationshipFactLayer
  validFromStoryOrder: number | null
  validToStoryOrder: number | null
  status: 'active' | 'superseded'
  supersedesRelationshipId: string | null
  createdBy: 'user' | 'ai_confirmed' | 'ai_yolo'
  fingerprint: string
  revision: number
  evidenceCount: number
  createdAt: string
  updatedAt: string
}

export interface EntityRelationshipEvidence {
  id: string
  relationshipId: string
  sourceType: string
  sourceId: string
  sourceVersionId: string | null
  label: string
  excerptStart: number | null
  excerptEnd: number | null
  contentHash: string
  excerpt: string | null
  createdAt: string
}

export interface RelationshipCandidate {
  id: string
  runId: string
  sourceEntityId: string | null
  targetEntityId: string | null
  sourceLabel: string
  targetLabel: string
  predicateKey: string
  label: string
  category: RelationshipCategory
  directionality: 'directed' | 'symmetric'
  factLayer: RelationshipFactLayer
  validFromStoryOrder: number | null
  validToStoryOrder: number | null
  confidence: number
  status: 'pending' | 'ambiguous' | 'confirmed' | 'rejected'
  evidenceJson: string
  fingerprint: string
  createdAt: string
  updatedAt: string
}

export interface RelationshipListPage {
  items: EntityRelationship[]
  total: number
  nextCursor: string | null
}

export type RelationshipExtractionRunStatus = 'queued' | 'running' | 'waiting_review' | 'succeeded' | 'blocked' | 'failed' | 'cancelled'

export interface RelationshipExtractionRun {
  id: string
  projectId: string
  automationMode: AutomationMode
  status: RelationshipExtractionRunStatus
  provider: string
  model: string
  promptHash: string
  errorJson: string | null
  candidateCount: number
  pendingCount: number
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface RelationshipCandidateConfirmationInput {
  sourceEntityId?: string
  targetEntityId?: string
  label?: string
  predicateKey?: string
  category?: RelationshipCategory
  directionality?: 'directed' | 'symmetric'
  factLayer?: RelationshipFactLayer
  validFromStoryOrder?: number | null
  validToStoryOrder?: number | null
}

export interface RelationshipCandidateBatchDecision {
  candidateId: string
  decision: 'confirm' | 'reject'
  input?: RelationshipCandidateConfirmationInput
}

export interface RelationshipCandidateBatchResult {
  candidateId: string
  decision: 'confirm' | 'reject'
  relationship: EntityRelationship | null
}

export interface RelationshipGraph {
  projectId: string
  mode: RelationshipMode
  nodes: StoryEntity[]
  edges: EntityRelationship[]
  pendingCount: number
  truncated: boolean
}

export interface StudioProjectSummary {
  project: Project
  bookCount: number
  volumeCount: number
  chapterCount: number
  approvedChapterCount: number
  latestWorkflow: WorkflowRun | null
  activeWorkflowCount: number
  waitingApprovalCount: number
}

export interface StudioOverview {
  projects: StudioProjectSummary[]
  activeRuns: WorkflowRun[]
  waitingApprovalRuns: WorkflowRun[]
  failedRuns: WorkflowRun[]
  recentRuns: WorkflowRun[]
}

export interface StoryGrowthBranch {
  versionId: string
  status: ManuscriptStatus
  wordCount: number
  origin: ManuscriptOrigin
  createdAt: string
}

export interface StoryGrowthAnchor {
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  bookTitle: string
  volumeTitle: string
  status: ChapterStatus
  totalWordCount: number
  approvedWordCount: number
  branches: StoryGrowthBranch[]
}

export interface StoryGrowthMap {
  project: Project
  anchors: StoryGrowthAnchor[]
  totalWordCount: number
  approvedWordCount: number
  generatedAt: string
}

export interface GenerationStatisticsTotals {
  runs: number
  succeededRuns: number
  failedRuns: number
  runningRuns: number
  usageReportedRuns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  generatedDrafts: number
  generatedWords: number
}

export interface GenerationPurposeStatistics extends GenerationStatisticsTotals {
  purpose: GenerationPurpose
}

export interface ChapterGenerationStatistics extends GenerationStatisticsTotals {
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  bookTitle: string
  volumeTitle: string
  status: ChapterStatus
  lastRunAt: string | null
}

export interface GenerationStatisticsProject {
  id: string
  title: string
  status: ProjectStatus
}

/**
 * Content-free statistics derived from persisted chapter ModelRuns and their
 * committed model manuscript versions. Missing provider usage is reported as
 * missing coverage instead of being estimated.
 */
export interface ProjectGenerationStatistics {
  project: GenerationStatisticsProject
  totals: GenerationStatisticsTotals
  purposes: GenerationPurposeStatistics[]
  chapters: ChapterGenerationStatistics[]
  generatedAt: string
}

export interface ChapterDetail extends Chapter {
  versions: ManuscriptVersion[]
}

export interface ProjectTree {
  project: Project
  books: Array<Book & { volumes: Array<Volume & { chapters: Chapter[] }> }>
}

export interface WorkspaceSnapshot {
  projects: Project[]
  selectedProjectId: string | null
  selectedChapterId: string | null
  selectedProject: ProjectTree | null
  selectedChapter: ChapterDetail | null
}

export interface RecoveryCapsule {
  schemaVersion: 1
  sessionId: string
  projectId: string
  bookId: string | null
  chapterId: string | null
  activeDraftVersionId: string | null
  workflowRunId: string | null
  workflowNode: string | null
  knowledgeSelectionSnapshotId: string | null
  promptPackId: string
  lastApprovedProjectRevision: number
  pendingUserDecisions: string[]
  recoveryGeneratedAt: string
}

export interface ResumeContext {
  sessionId: string
  capsule: RecoveryCapsule
  project: { id: string; title: string; revision: number }
  chapter: { id: string; title: string; revision: number } | null
  workflow: { id: string; status: WorkflowRunStatus; currentNodeKey: string | null } | null
  pendingApprovals: Array<{ workflowRunId: string; manuscriptVersionId: string }>
  latestApprovedVersion: { id: string; chapterId: string; approvedAt: string | null } | null
  staleRevisionDetected: boolean
  previousCapsuleRevision: number | null
  suggestedNextAction: string
  furtherTools: string[]
}

export interface CreateProjectInput {
  title: string
  language?: string
  genre?: string
  audience?: string
  targetWordCount?: number
  chapterTargetWords?: number
  stylePresetId?: string
  workspacePath?: string
  markdownSyncEnabled?: boolean
}

export type StyleProfileSource = 'builtin' | 'extracted' | 'user'

export interface StyleProfileAttributes {
  narrativeVoice: string
  pointOfView: string
  tense: string
  sentenceRhythm: string
  paragraphRhythm: string
  dialogueStyle: string
  descriptionStyle: string
  emotionalCadence: string
  pacing: string
  imagery: string
  expansionRules: string[]
  avoid: string[]
}

export interface WritingStylePreset {
  id: string
  name: string
  summary: string
  attributes: StyleProfileAttributes
}

export interface WritingStyleProfile {
  projectId: string
  profileId: string
  presetId: string | null
  source: StyleProfileSource
  name: string
  summary: string
  attributes: StyleProfileAttributes
  sampleHash: string | null
  revision: number
  updatedAt: string
}

export interface WritingStyleProfileDraft {
  profileId?: string
  presetId?: string | null
  source: Exclude<StyleProfileSource, 'builtin'>
  name: string
  summary: string
  attributes: StyleProfileAttributes
  sampleHash?: string | null
}

export interface SaveDraftInput {
  content: string
  baseRevision: number
  origin?: 'user' | 'autosave'
}

export interface PromptPack {
  id: string
  name: string
  locale: string
  source: 'builtin' | 'user'
  createdAt: string
}

export interface PromptAssetVersion {
  id: string
  promptAssetId: string
  version: number
  locale: string
  template: string
  inputSchemaJson: string
  outputSchemaJson: string
  source: 'builtin' | 'user'
  contentHash: string
  createdAt: string
}

export interface PromptAsset {
  id: string
  promptPackId: string
  key: string
  name: string
  purpose: GenerationPurpose
  activeVersionId: string
  versions: PromptAssetVersion[]
}

export interface ProjectRules {
  projectId: string
  styleRules: string
  chapterGoal: string
  forbiddenContent: string
  styleProfile?: WritingStyleProfile
  revision: number
  updatedAt: string
}

export interface ProjectFoundationVersion {
  id: string
  projectId: string
  kind: ProjectFoundationKind
  version: number
  title: string
  content: string
  contentHash: string
  status: 'draft' | 'approved' | 'superseded'
  provider: string
  model: string
  promptVersion: string
  promptHash: string
  dependencyVersionIds: string[]
  generationRunId: string | null
  createdAt: string
  approvedAt: string | null
}

export type FoundationGenerationRunStatus = 'planning' | 'waiting_input' | 'generating' | 'succeeded' | 'failed' | 'cancelled'

export interface FoundationPlannerOption {
  id: string
  label: string
  description: string
  recommended: boolean
}

export interface FoundationPlannerQuestion {
  id: string
  question: string
  why: string
  options: FoundationPlannerOption[]
}

export interface FoundationPlannerAnswer {
  questionId: string
  optionId: string | null
  customText: string
  skipped?: boolean
}

export interface FoundationGenerationRun {
  id: string
  projectId: string
  kind: ProjectFoundationKind
  guided: boolean
  status: FoundationGenerationRunStatus
  phase: string
  progress: number
  brief: string
  questions: FoundationPlannerQuestion[]
  answers: FoundationPlannerAnswer[]
  planningRound: number
  informationReady: boolean
  readinessSummary: string
  interactionSessionId: string | null
  dependencyVersionIds: string[]
  provider: string
  model: string
  streamedCharacters: number
  streamedText: string
  streamedTextUpdatedAt: string | null
  generationTelemetry: GenerationTelemetry
  resultVersionId: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  startedAt: string
  finishedAt: string | null
}

export interface ProjectFoundationStage {
  kind: ProjectFoundationKind
  position: number
  title: string
  description: string
  dependencies: ProjectFoundationKind[]
  status: 'locked' | 'ready' | 'draft' | 'approved'
  latestVersion: ProjectFoundationVersion | null
  approvedVersion: ProjectFoundationVersion | null
  versionCount: number
  canGenerate: boolean
  canApprove: boolean
  activeGenerationRun: FoundationGenerationRun | null
  latestGenerationRun: FoundationGenerationRun | null
}

export interface ProjectFoundationWorkspace {
  project: Project
  stages: ProjectFoundationStage[]
  readyForChapterGeneration: boolean
  approvedVersionIds: string[]
  assemblyHash: string | null
}

export interface PromptCatalog {
  packs: PromptPack[]
  assets: PromptAsset[]
  projectRules: ProjectRules
  selections: Record<GenerationPurpose, string>
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface GenerationTelemetry {
  firstVisibleTokenAt: string | null
  lastVisibleTokenAt: string | null
  visibleCharacters: number
  estimatedOutputTokens: number
  estimatedTokensPerSecond: number | null
  finalOutputTokens: number | null
  finalReasoningTokens: number | null
  decodeSeconds: number | null
  finalTokensPerSecond: number | null
}

export interface ModelRun {
  id: string
  projectId: string
  chapterId: string
  purpose: GenerationPurpose
  provider: string
  model: string
  promptAssetVersionId: string
  inputManuscriptVersionId: string | null
  projectRevision: number
  chapterRevision: number
  status: 'running' | 'succeeded' | 'failed'
  inputSnapshotJson: string
  streamedText: string
  streamedTextUpdatedAt: string | null
  generationTelemetry: GenerationTelemetry
  outputJson: string | null
  usageJson: string | null
  errorJson: string | null
  createdAt: string
  finishedAt: string | null
}

export type GenerationSourceKind = 'foundation' | 'chapter-summary' | 'canon' | 'approved-excerpt' | 'style' | 'memory' | 'filesystem-memory' | 'historical' | 'long-memory'

export interface GenerationSourceItem {
  id: string
  label: string
  detail?: string
  kind: GenerationSourceKind
  used: boolean
}

export interface GenerationSources {
  modelRunId: string | null
  purpose: 'chapter-draft'
  status: 'unavailable' | 'running' | 'succeeded' | 'failed'
  createdAt: string | null
  items: GenerationSourceItem[]
  truncated: boolean
}

export interface ScenePlan {
  id: string
  projectId: string
  chapterId: string
  modelRunId: string
  promptAssetVersionId: string
  inputManuscriptVersionId: string | null
  contentJson: string
  createdAt: string
}

export interface PriorChapterSummary {
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  approvedVersionId: string
  summary: KnowledgeSummary
}

export interface PreviousChapterContinuity {
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  approvedVersionId: string
  summary: KnowledgeSummary | null
  approvedEndingExcerpt: string
}

export interface GenerationContext {
  purpose: GenerationPurpose
  project: Project
  chapter: ChapterDetail
  rules: ProjectRules
  styleProfile?: WritingStyleProfile
  promptVersion: PromptAssetVersion
  inputManuscriptVersionId: string | null
  inputManuscript: string
  latestScenePlan: ScenePlan | null
  retrievalBundle: RetrievalBundle | null
  foundationVersions: ProjectFoundationVersion[]
  foundationAssemblyHash: string
  longMemory: KnowledgeSummary[]
  priorChapterSummaries: PriorChapterSummary[]
  previousChapterContinuity: PreviousChapterContinuity | null
  chapterBrief?: ChapterWritingBrief | null
  authorMemory?: MemoryItem[]
  confirmedRelationships?: EntityRelationship[]
  /** User-editable Markdown memory files loaded at generation time. */
  filesystemMemory?: Array<{ path: string; content: string; hash: string }>
}

export interface GenerationResult {
  modelRun: ModelRun
  scenePlan?: ScenePlan
  chapter?: ChapterDetail
}

export class DomainError extends Error {
  constructor(
    public readonly code: 'validation' | 'not-found' | 'revision-conflict' | 'invalid-state',
    message: string,
  ) {
    super(message)
  }
}
