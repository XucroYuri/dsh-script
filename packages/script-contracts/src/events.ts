import type { ApprovalId, AuditEventId, CrossIpGrantId, CrossIpGrantScope, DomainErrorCode, DraftId, EpisodeId, IpBibleEntryId, IpId, IpPromotionId, MemberId, PermissionAction, PermissionDecisionReason, ProjectCanonFactId, ProjectId, ProjectMedium, SeasonId, SelectionSnapshotId, TeamId, VersionId } from '@script-studio/domain'
import type { ResourceReference } from './dto.js'
import type { ApplicationOperation } from './authoring.js'

interface EventEnvelope<Type extends string, Payload> {
  id: string
  type: Type
  teamId: TeamId
  actorId: MemberId
  occurredAt: string
  aggregateRevision: number
  payload: Payload
}

export type ScriptStudioEvent =
  | EventEnvelope<'project.created', { projectId: ProjectId; ipId: IpId; medium: ProjectMedium }>
  | EventEnvelope<'season.created', { projectId: ProjectId; seasonId: SeasonId; position: number }>
  | EventEnvelope<'episode.created', { projectId: ProjectId; seasonId: SeasonId; episodeId: EpisodeId; position: number; storyOrder: number }>
  | EventEnvelope<'resource.archived', { resource: Exclude<ResourceReference, { type: 'team' }> }>
  | EventEnvelope<'permission.denied', { action: PermissionAction; resource: ResourceReference; reason: PermissionDecisionReason }>
  | EventEnvelope<'operation.conflict', { operation: ApplicationOperation; resource: ResourceReference; reason: 'revision-conflict' }>
  | EventEnvelope<'operation.failed', { operation: ApplicationOperation; resource: ResourceReference; errorCode: Exclude<DomainErrorCode, 'forbidden' | 'revision-conflict'> }>
  | EventEnvelope<'ip-grant.created', { grantId: CrossIpGrantId; sourceIpId: IpId; targetIpId: IpId; selectionSnapshotId: SelectionSnapshotId; scopes: readonly CrossIpGrantScope[] }>
  | EventEnvelope<'ip-grant.revoked', { grantId: CrossIpGrantId; sourceIpId: IpId; targetIpId: IpId; selectionSnapshotId: SelectionSnapshotId }>
  | EventEnvelope<'ip-promotion.proposed', { promotionId: IpPromotionId; ipId: IpId; sourceCanonFactId: ProjectCanonFactId }>
  | EventEnvelope<'ip-promotion.decided', { promotionId: IpPromotionId; ipId: IpId; decision: 'approved' | 'rejected'; bibleEntryId: IpBibleEntryId | null }>
  | EventEnvelope<'draft.submitted', { projectId: ProjectId; episodeId: EpisodeId; draftId: DraftId; draftRevision: number }>
  | EventEnvelope<'manuscript-version.created', { projectId: ProjectId; episodeId: EpisodeId; draftId: DraftId; versionId: VersionId; contentHash: string }>
  | EventEnvelope<'manuscript-version.approved', { projectId: ProjectId; episodeId: EpisodeId; versionId: VersionId; approvalId: ApprovalId }>
  | EventEnvelope<'project-canon.committed', { projectId: ProjectId; episodeId: EpisodeId; versionId: VersionId; factIds: readonly ProjectCanonFactId[] }>
  | EventEnvelope<'audit.appended', { auditEventIds: readonly AuditEventId[] }>
