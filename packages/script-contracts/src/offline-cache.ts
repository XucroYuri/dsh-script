import type { DraftId, EpisodeId, IdempotencyKey, ProjectHierarchy, ProjectId, TeamId } from '@script-studio/domain'

export type OfflineOutboxOperation = 'draft-update'
export type OfflineOutboxStatus = 'pending' | 'in-flight' | 'failed'

export interface OfflineDraftUpdatePayload {
  draftId: DraftId
  episodeId: EpisodeId
  content: string
  stateVector: string
  expectedDraftRevision: number
  expectedEpisodeRevision: number
}

export interface OfflineOutboxEntry {
  id: string
  teamId: TeamId
  projectId: ProjectId
  operation: OfflineOutboxOperation
  idempotencyKey: IdempotencyKey
  payload: OfflineDraftUpdatePayload
  status: OfflineOutboxStatus
  attempts: number
  nextAttemptAt: string
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface OfflineHierarchyCachePort {
  saveHierarchy(input: { teamId: TeamId; projectId: ProjectId; hierarchy: ProjectHierarchy; cachedAt: string }): void
  getHierarchy(teamId: TeamId, projectId: ProjectId): ProjectHierarchy | null
  enqueueDraftUpdate(input: { id: string; teamId: TeamId; projectId: ProjectId; idempotencyKey: IdempotencyKey; payload: OfflineDraftUpdatePayload; createdAt: string }): OfflineOutboxEntry
  claimNext(now: string): OfflineOutboxEntry | null
  acknowledge(id: string): void
  fail(id: string, errorCode: string, nextAttemptAt: string): OfflineOutboxEntry | null
  retryFailed(id: string, nextAttemptAt: string): OfflineOutboxEntry | null
  recoverInFlight(now: string): number
}
