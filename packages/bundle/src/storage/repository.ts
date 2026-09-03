import type {
  Chapter,
  ChapterDetail,
  CreateProjectInput,
  ManuscriptVersion,
  Project,
  ProjectTree,
  SaveDraftInput,
  WorkspaceSnapshot,
  GenerationContext,
  GenerationSources,
  GenerationPurpose,
  ModelRun,
  ModelSelection,
  ModelUsage,
  PromptAssetVersion,
  PromptCatalog,
  ProjectRules,
  ScenePlan,
  WorkflowRun,
  StudioOverview,
  StoryGrowthMap,
  HistoricalKnowledgeScope,
  KnowledgeRefreshContext,
  KnowledgeSummaryDraft,
  KnowledgeWorkspace,
  LibraryOverview,
  RetrievalBundle,
  RetrievalItem,
  ResumeContext,
  ProjectFoundationKind,
  FoundationGenerationRun,
  GenerationTelemetry,
  ProjectGenerationStatistics,
  FoundationPlannerAnswer,
  FoundationPlannerQuestion,
  ProjectFoundationVersion,
  ProjectFoundationWorkspace,
  WritingStyleProfile,
  WritingStyleProfileDraft,
  WritingStylePreset,
  AutomationMode,
  ChapterGenerationBatch,
  ChapterBatchStatus,
  ChapterBatchItem,
  MemoryBrowserPage,
  MemoryCategory,
  MemoryItem,
  MemoryConflict,
  MemoryRevisionDiff,
  MemoryRevisionHistoryEntry,
  MemoryPromptPolicy,
  MemoryUsagePage,
  RelationshipMode,
  RelationshipGraph,
  RelationshipCandidate,
  EntityRelationship,
  EntityRelationshipEvidence,
  RelationshipCategory,
  RelationshipCandidateBatchDecision,
  RelationshipCandidateBatchResult,
  RelationshipCandidateConfirmationInput,
  RelationshipExtractionRun,
  RelationshipFactLayer,
  RelationshipListPage,
} from '../domain/model.js'
import type { ManuscriptImportInput, ProjectExportFile, ProjectImportResult } from '../domain/project-portability.js'

export interface StorageHealth {
  ready: boolean
  schemaVersion: number
  expectedSchemaVersion: number
  journalMode: string
  foreignKeys: boolean
  dataHome: string
}

export interface LegacyLengthDraftRecovery {
  modelRunId: string
  manuscriptVersionId: string
  originalErrorCode: 'chapter-draft-too-long' | 'chapter-draft-too-short'
  source: 'output-json' | 'streamed-text'
  lengthAdvisory: unknown | null
}

export interface NovelRepository {
  health(): StorageHealth
  listProjects(): Project[]
  getLibraryOverview(): LibraryOverview
  archiveProject(projectId: string, baseRevision?: number): Project
  restoreProject(projectId: string, baseRevision?: number): Project
  createProject(input: CreateProjectInput): ProjectTree
  importManuscript(input: ManuscriptImportInput): ProjectImportResult
  exportProjectMarkdown(projectId: string): ProjectExportFile
  exportProjectSnapshot(projectId: string): ProjectExportFile
  restoreProjectSnapshot(snapshot: unknown, title?: string): ProjectTree
  getProjectTree(projectId: string): ProjectTree
  createChapter(projectId: string, title?: string): Chapter
  getChapter(chapterId: string): ChapterDetail
  saveDraft(chapterId: string, input: SaveDraftInput): ChapterDetail
  approveVersion(chapterId: string, versionId: string, baseRevision: number): ChapterDetail
  approveVersionAndStartPostProcessing(chapterId: string, versionId: string, baseRevision: number): { chapter: ChapterDetail; workflow: WorkflowRun }
  selectWorkspace(projectId: string | null, chapterId: string | null, sessionId?: string): WorkspaceSnapshot
  getWorkspace(): WorkspaceSnapshot
  bindSessionProject(sessionId: string, projectId: string, chapterId?: string | null): ResumeContext
  getResumeContext(sessionId: string, projectId?: string): ResumeContext
  getPromptCatalog(projectId: string): PromptCatalog
  updateProjectRules(projectId: string, rules: Pick<ProjectRules, 'styleRules' | 'chapterGoal' | 'forbiddenContent'>, baseRevision: number): PromptCatalog
  listStylePresets(): WritingStylePreset[]
  getProjectStyleProfile(projectId: string): WritingStyleProfile
  setProjectStylePreset(projectId: string, presetId: string, baseRevision: number): WritingStyleProfile
  saveWritingStyleProfile(projectId: string, draft: WritingStyleProfileDraft, baseRevision: number): WritingStyleProfile
  createPromptVersion(promptAssetId: string, template: string): PromptAssetVersion
  selectPromptVersion(projectId: string, purpose: GenerationPurpose, promptAssetVersionId: string): PromptCatalog
  getGenerationContext(chapterId: string, purpose: GenerationPurpose): GenerationContext
  startModelRun(context: GenerationContext, selection: ModelSelection, inputSnapshotJson: string): ModelRun
  updateModelRunStream(modelRunId: string, streamedText: string, telemetry?: GenerationTelemetry): ModelRun
  failModelRun(modelRunId: string, error: unknown): ModelRun
  completeScenePlan(modelRunId: string, output: unknown, usage?: ModelUsage, telemetry?: GenerationTelemetry): ScenePlan
  completeGeneratedDraft(modelRunId: string, manuscript: string, output: unknown, usage?: ModelUsage, telemetry?: GenerationTelemetry): ChapterDetail
  tryRecoverLegacyLengthRejectedDraft(workflowRunId: string, nodeRunId: string): LegacyLengthDraftRecovery | null
  listModelRuns(chapterId: string): ModelRun[]
  getChapterGenerationSources(chapterId: string): GenerationSources
  createChapterBatch(projectId: string, input: { mode: 'selected' | 'continuous'; automationMode: AutomationMode; chapterIds?: string[]; startChapterId?: string; count: number }, selection: ModelSelection, projectRevision: number): ChapterGenerationBatch
  completeChapterBatchPlan(batchId: string, items: Array<Pick<ChapterBatchItem, 'chapterId' | 'plannedTitle' | 'writingGoal' | 'openingContinuity' | 'endingHook' | 'targetWords'>>, trace: { promptHash: string; outputJson: string; streamedText?: string; inputSnapshotJson?: string }): ChapterGenerationBatch
  failChapterBatchPlan(batchId: string, error: unknown): ChapterGenerationBatch
  approveChapterBatchPlan(batchId: string, items: Array<Pick<ChapterBatchItem, 'id' | 'plannedTitle' | 'writingGoal' | 'openingContinuity' | 'endingHook' | 'targetWords'>>, baseRevision: number): ChapterGenerationBatch
  getChapterBatch(batchId: string): ChapterGenerationBatch
  listChapterBatches(projectId: string): ChapterGenerationBatch[]
  reorderChapterBatch(batchId: string, itemIds: string[], baseRevision: number): ChapterGenerationBatch
  setChapterBatchStatus(batchId: string, action: 'start' | 'pause' | 'resume' | 'cancel', projectRevision: number): ChapterGenerationBatch
  setChapterBatchRuntimeStatus(batchId: string, status: ChapterBatchStatus): ChapterGenerationBatch
  dispatchNextBatchItem(batchId: string): { batch: ChapterGenerationBatch; workflow: WorkflowRun | null }
  reconcileChapterBatch(workflowRunId: string): ChapterGenerationBatch | null
  getWorkflowBatchAutomationMode(workflowRunId: string): AutomationMode | null
  enforceWorkflowRelationshipSafety(workflowRunId: string): boolean
  retryChapterBatchItem(batchId: string, itemId: string, projectRevision: number): { batch: ChapterGenerationBatch; workflow: WorkflowRun | null }
  skipChapterBatchItem(batchId: string, itemId: string, projectRevision: number): ChapterGenerationBatch
  listRecoverableChapterBatches(): ChapterGenerationBatch[]
  searchMemory(projectId: string, query?: { q?: string; origin?: string; scope?: string; category?: string; state?: string; storage?: string; promptPolicy?: string; used?: string; cursor?: string; limit?: number }): MemoryBrowserPage
  getMemoryItem(itemId: string): MemoryItem
  listMemoryRevisions(itemId: string): MemoryRevisionHistoryEntry[]
  getMemoryRevisionDiff(itemId: string, fromRevisionId: string, toRevisionId: string): MemoryRevisionDiff
  listMemoryUsages(itemId: string, input?: { cursor?: string; limit?: number }): MemoryUsagePage
  createUserMemory(projectId: string, input: { content: string; scope: MemoryItem['scope']; category: MemoryCategory; promptPolicy?: MemoryPromptPolicy; sourceItemId?: string }, projectRevision: number): MemoryItem
  updateUserMemory(itemId: string, input: { content?: string; category?: MemoryCategory; promptPolicy?: MemoryPromptPolicy; baseRevision: number; projectRevision: number }): MemoryItem
  restoreMemoryRevision(itemId: string, revisionId: string, baseRevision: number, projectRevision: number): MemoryItem
  setMemoryItemArchived(itemId: string, archived: boolean, baseRevision: number, projectRevision: number): MemoryItem
  rescanMemoryMarkdown(projectId: string, projectRevision: number): { changed: number; conflicts: MemoryConflict[] }
  listMemoryConflicts(projectId: string): MemoryConflict[]
  resolveMemoryConflict(itemId: string, conflictId: string, resolution: 'database' | 'file' | 'merged' | 'both', baseRevision: number, projectRevision: number, mergedContent?: string): MemoryItem
  getRelationshipMode(projectId: string): RelationshipMode
  setRelationshipMode(projectId: string, mode: RelationshipMode, baseRevision: number): RelationshipMode
  getRelationshipGraph(projectId: string, input?: { rootEntityId?: string; depth?: 1 | 2; categories?: RelationshipCategory[]; factLayers?: RelationshipFactLayer[]; atStoryOrder?: number; limitNodes?: number; limitEdges?: number }): RelationshipGraph
  listEntityRelationships(projectId: string, query?: { q?: string; categories?: RelationshipCategory[]; factLayers?: RelationshipFactLayer[]; atStoryOrder?: number; cursor?: string; limit?: number }): RelationshipListPage
  listRelationshipCandidates(projectId: string, status?: RelationshipCandidate['status']): RelationshipCandidate[]
  listRelationshipExtractionRuns(projectId: string, limit?: number): RelationshipExtractionRun[]
  createRelationshipExtractionRun(projectId: string, mode: AutomationMode, selection: ModelSelection, sourceSnapshotJson: string, promptHash: string): string
  completeRelationshipExtractionRun(runId: string, candidates: Array<Omit<RelationshipCandidate, 'id' | 'runId' | 'status' | 'createdAt' | 'updatedAt'>>): RelationshipCandidate[]
  failRelationshipExtractionRun(runId: string, error: unknown): void
  decideRelationshipCandidate(projectId: string, candidateId: string, decision: 'confirm' | 'reject', input: RelationshipCandidateConfirmationInput | undefined, projectRevision: number): EntityRelationship | null
  decideRelationshipCandidates(projectId: string, decisions: RelationshipCandidateBatchDecision[], projectRevision: number): RelationshipCandidateBatchResult[]
  createEntityRelationship(projectId: string, input: { sourceEntityId: string; targetEntityId: string; predicateKey: string; label: string; category: RelationshipCategory; directionality: 'directed' | 'symmetric'; factLayer: RelationshipFactLayer; validFromStoryOrder?: number | null; validToStoryOrder?: number | null }, baseRevision: number): EntityRelationship
  reviseEntityRelationship(projectId: string, relationshipId: string, input: { label: string; predicateKey: string; category: RelationshipCategory; directionality: 'directed' | 'symmetric'; factLayer: RelationshipFactLayer; validFromStoryOrder?: number | null; validToStoryOrder?: number | null }, baseRevision: number): EntityRelationship
  getRelationshipEvidence(projectId: string, relationshipId: string): EntityRelationshipEvidence[]
  startChapterWorkflow(chapterId: string, excludedSourceIds?: string[]): WorkflowRun
  getKnowledgeWorkspace(projectId: string): KnowledgeWorkspace
  configureHistoricalSource(projectId: string, sourceProjectId: string, enabled: boolean, scopes: HistoricalKnowledgeScope[]): KnowledgeWorkspace
  createRetrievalBundle(workflowRunId: string, purpose?: string): RetrievalBundle
  getKnowledgeRefreshContext(workflowRunId: string): KnowledgeRefreshContext
  upsertKnowledgeSummary(projectId: string, summary: KnowledgeSummaryDraft): void
  refreshKnowledgeIndexes(workflowRunId: string, summaries?: KnowledgeSummaryDraft[]): KnowledgeWorkspace
  searchKnowledge(projectId: string, query: string, limit?: number): RetrievalItem[]
  getWorkflowRun(workflowRunId: string): WorkflowRun
  listChapterWorkflows(chapterId: string): WorkflowRun[]
  getStudioOverview(): StudioOverview
  getProjectGenerationStatistics(projectId: string): ProjectGenerationStatistics
  /** @deprecated Kept during the compatibility window; the Client now uses project statistics. */
  getStoryGrowthMap(projectId: string): StoryGrowthMap
  getProjectFoundation(projectId: string): ProjectFoundationWorkspace
  createProjectFoundationVersion(projectId: string, kind: ProjectFoundationKind, output: { title: string; content: string }, trace: { provider: string; model: string; promptVersion: string; promptHash: string; outputJson: string; generationRunId?: string }): ProjectFoundationWorkspace
  approveProjectFoundationVersion(projectId: string, kind: ProjectFoundationKind, versionId: string): ProjectFoundationWorkspace
  getApprovedProjectFoundationVersions(projectId: string): ProjectFoundationVersion[]
  createFoundationGenerationRun(projectId: string, kind: ProjectFoundationKind, brief: string, guided: boolean, selection: ModelSelection, interactionSessionId?: string | null): FoundationGenerationRun
  getFoundationGenerationRun(runId: string): FoundationGenerationRun
  listRecoverableFoundationGenerationRuns(): FoundationGenerationRun[]
  listWaitingFoundationInteractions(sessionId: string): FoundationGenerationRun[]
  bindFoundationInteractionSession(runId: string, sessionId: string): FoundationGenerationRun
  clearFoundationInteractionSession(runId: string): FoundationGenerationRun
  updateFoundationGenerationRunProgress(runId: string, phase: string, progress: number, streamedCharacters?: number, telemetry?: GenerationTelemetry): FoundationGenerationRun
  resetFoundationGenerationStream(runId: string): FoundationGenerationRun
  updateFoundationGenerationStream(runId: string, streamedText: string, progress?: number, receivedCharacters?: number, telemetry?: GenerationTelemetry): FoundationGenerationRun
  setFoundationGenerationQuestions(runId: string, questions: FoundationPlannerQuestion[], readinessSummary: string, promptHash: string, outputJson: string): FoundationGenerationRun
  setFoundationInformationReady(runId: string, readinessSummary: string, promptHash: string, outputJson: string): FoundationGenerationRun
  closeFoundationPlanning(runId: string, readinessSummary: string, reason: string): FoundationGenerationRun
  answerFoundationGenerationQuestion(runId: string, answer: FoundationPlannerAnswer): FoundationGenerationRun
  completeFoundationGenerationRun(runId: string, output: { title: string; content: string }, trace: { promptVersion: string; promptHash: string; outputJson: string; usage?: ModelUsage; telemetry?: GenerationTelemetry }): FoundationGenerationRun
  failFoundationGenerationRun(runId: string, error: unknown): FoundationGenerationRun
  cancelFoundationGenerationRun(runId: string): FoundationGenerationRun
  retryFoundationGenerationRun(runId: string): FoundationGenerationRun
  listRecoverableWorkflows(): WorkflowRun[]
  prepareWorkflowNode(workflowRunId: string, nodeKey: string, input: unknown): { run: WorkflowRun; nodeRunId: string; alreadySucceeded: boolean }
  completeWorkflowNode(workflowRunId: string, nodeRunId: string, output: unknown, nextNodeKey: string | null): WorkflowRun
  completeFinalWorkflowNode(workflowRunId: string, nodeRunId: string, output: unknown): WorkflowRun
  bindManuscriptVersionToWorkflow(versionId: string, workflowRunId: string, nodeRunId: string): void
  failWorkflowNode(workflowRunId: string, nodeRunId: string, error: unknown, retryable: boolean): WorkflowRun
  setWorkflowStatus(workflowRunId: string, status: 'running' | 'paused' | 'cancel_requested' | 'cancelled'): WorkflowRun
  retryWorkflow(workflowRunId: string): WorkflowRun
  createReviewReport(workflowRunId: string, nodeRunId: string, manuscriptVersionId: string, kind: 'plot' | 'character' | 'timeline' | 'style' | 'aggregate', report: unknown, verdict?: 'pass' | 'revise'): WorkflowRun
  waitForWorkflowApproval(workflowRunId: string, nodeRunId: string, manuscriptVersionId: string): WorkflowRun
  decideWorkflowApproval(workflowRunId: string, decision: 'approved' | 'rejected', note: string): WorkflowRun
  createCanonCandidate(workflowRunId: string, nodeRunId: string): WorkflowRun
  validateCanonCandidates(workflowRunId: string, nodeRunId: string): WorkflowRun
  commitWorkflowCanon(workflowRunId: string, nodeRunId: string): WorkflowRun
  finishWorkflow(workflowRunId: string, nodeRunId: string): WorkflowRun
  close(): void
}

export type { Chapter, ChapterDetail, ManuscriptVersion, Project, ProjectTree, WorkspaceSnapshot }
