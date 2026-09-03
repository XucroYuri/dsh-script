import type {
  Approval, ApprovalId, AuditEvent, AuditEventId, ContentObjectId, CrossIpGrant, CrossIpGrantId, CrossIpGrantScope, Draft, DraftId, Episode, EpisodeId, IdempotencyKey, Ip,
  IpBibleEntry, IpBibleEntryId, IpId, IpPromotion, IpPromotionId, ManuscriptVersion, MemberId, ProjectCanonFact, ProjectCanonFactId, ProjectHierarchy, ProjectId,
  RequestHash, SelectionSnapshotId, TeamId, TeamMember, VersionId,
} from '@script-studio/domain'
import type { ScriptStudioEvent } from './events.js'

export interface SubmitEpisodeDraftCommand {
  teamId: TeamId
  actorId: MemberId
  projectId: ProjectId
  episodeId: EpisodeId
  draftId: DraftId
  versionId: VersionId
  contentObjectId: ContentObjectId
  contentHash: string
  stateVector: string
  expectedDraftRevision: number
  expectedEpisodeRevision: number
  idempotencyKey: IdempotencyKey
  requestHash: RequestHash
}

export interface CanonFactInput {
  id: ProjectCanonFactId
  subject: string
  predicate: string
  value: string
  evidence: string
}

export interface ApproveEpisodeVersionCommand {
  teamId: TeamId
  actorId: MemberId
  projectId: ProjectId
  episodeId: EpisodeId
  versionId: VersionId
  approvalId: ApprovalId
  expectedEpisodeRevision: number
  canonFacts: readonly CanonFactInput[]
  idempotencyKey: IdempotencyKey
  requestHash: RequestHash
}

export interface SubmitEpisodeDraftResult { draft: Draft; version: ManuscriptVersion; episode: Episode }
export interface ApproveEpisodeVersionResult { episode: Episode; approval: Approval; canonFacts: readonly ProjectCanonFact[] }
export type AuthoringOperation = 'submit-episode-draft' | 'approve-episode-version'
export type GovernanceOperation = 'propose-ip-promotion' | 'decide-ip-promotion' | 'create-cross-ip-grant' | 'revoke-cross-ip-grant'
export type ApplicationOperation = AuthoringOperation | GovernanceOperation
export type IdempotencyClaim<Result> = { status: 'claimed' } | { status: 'replay'; result: Result }
export interface ContentObjectMetadata { id: ContentObjectId; teamId: TeamId; projectId: ProjectId; contentHash: string; status: 'pending' | 'ready' | 'failed' }

export interface AuthoringTransactionPort {
  claimIdempotency<Result>(input: { teamId: TeamId; operation: ApplicationOperation; key: IdempotencyKey; requestHash: RequestHash }): Promise<IdempotencyClaim<Result>>
  completeIdempotency<Result>(input: { teamId: TeamId; operation: ApplicationOperation; key: IdempotencyKey; requestHash: RequestHash; result: Result }): Promise<void>
  getHierarchy(teamId: TeamId, projectId: ProjectId): Promise<ProjectHierarchy | null>
  getMember(teamId: TeamId, memberId: MemberId): Promise<TeamMember | null>
  getDraft(teamId: TeamId, draftId: DraftId): Promise<Draft | null>
  getContentObject(teamId: TeamId, contentObjectId: ContentObjectId): Promise<ContentObjectMetadata | null>
  saveDraft(draft: Draft): Promise<void>
  getVersion(teamId: TeamId, versionId: VersionId): Promise<ManuscriptVersion | null>
  saveVersion(version: ManuscriptVersion): Promise<void>
  saveEpisode(episode: Episode): Promise<void>
  saveApproval(approval: Approval): Promise<void>
  saveProjectCanonFacts(facts: readonly ProjectCanonFact[]): Promise<void>
  appendAuditEvents(events: readonly AuditEvent[]): Promise<void>
  appendEvents(events: readonly ScriptStudioEvent[]): Promise<void>
}

export interface AuthoringUnitOfWorkPort {
  execute<Result>(operation: (transaction: AuthoringTransactionPort) => Promise<Result>): Promise<Result>
}

export interface ClockPort { now(): string }
export interface IdGeneratorPort { auditEventId(): AuditEventId; eventId(): string }
export interface SecurityAuditPort { recordFailure(audit: AuditEvent, event: ScriptStudioEvent): Promise<void> }

export interface ProposeIpPromotionCommand {
  teamId: TeamId; actorId: MemberId; targetIpId: IpId; sourceCanonFactId: ProjectCanonFactId; promotionId: IpPromotionId
  conflictResolution: string; impactNote: string; expectedIpRevision: number; idempotencyKey: IdempotencyKey; requestHash: RequestHash
}
export interface DecideIpPromotionCommand {
  teamId: TeamId; actorId: MemberId; targetIpId: IpId; promotionId: IpPromotionId; decision: 'approved' | 'rejected'
  expectedIpRevision: number; bibleEntryId?: IpBibleEntryId; bibleKey?: string; bibleValue?: string
  idempotencyKey: IdempotencyKey; requestHash: RequestHash
}
export interface CreateCrossIpGrantCommand {
  teamId: TeamId; actorId: MemberId; sourceIpId: IpId; targetIpId: IpId; grantId: CrossIpGrantId
  selectionSnapshotId: SelectionSnapshotId; scopes: readonly CrossIpGrantScope[]; expectedTargetIpRevision: number
  idempotencyKey: IdempotencyKey; requestHash: RequestHash
}
export interface RevokeCrossIpGrantCommand {
  teamId: TeamId; actorId: MemberId; targetIpId: IpId; grantId: CrossIpGrantId; expectedTargetIpRevision: number
  idempotencyKey: IdempotencyKey; requestHash: RequestHash
}
export interface ProposeIpPromotionResult { promotion: IpPromotion }
export interface DecideIpPromotionResult { promotion: IpPromotion; bibleEntry: IpBibleEntry | null; ipRevision: number }
export interface CrossIpGrantResult { grant: CrossIpGrant; targetIpRevision: number }
export interface SelectionSnapshotMetadata { id: SelectionSnapshotId; teamId: TeamId; sourceIpId: IpId; targetIpId: IpId; scopes: readonly CrossIpGrantScope[]; frozen: boolean }

export interface GovernanceTransactionPort {
  claimIdempotency<Result>(input: { teamId: TeamId; operation: ApplicationOperation; key: IdempotencyKey; requestHash: RequestHash }): Promise<IdempotencyClaim<Result>>
  completeIdempotency<Result>(input: { teamId: TeamId; operation: ApplicationOperation; key: IdempotencyKey; requestHash: RequestHash; result: Result }): Promise<void>
  getMember(teamId: TeamId, memberId: MemberId): Promise<TeamMember | null>
  getIp(teamId: TeamId, ipId: IpId): Promise<Ip | null>
  saveIp(ip: Ip): Promise<void>
  getProjectCanonFact(teamId: TeamId, factId: ProjectCanonFactId): Promise<ProjectCanonFact | null>
  getIpPromotion(teamId: TeamId, promotionId: IpPromotionId): Promise<IpPromotion | null>
  saveIpPromotion(promotion: IpPromotion): Promise<void>
  saveIpBibleEntry(entry: IpBibleEntry): Promise<void>
  getSelectionSnapshot(teamId: TeamId, snapshotId: SelectionSnapshotId): Promise<SelectionSnapshotMetadata | null>
  findActiveGrant(input: { teamId: TeamId; sourceIpId: IpId; targetIpId: IpId; selectionSnapshotId: SelectionSnapshotId }): Promise<CrossIpGrant | null>
  getCrossIpGrant(teamId: TeamId, grantId: CrossIpGrantId): Promise<CrossIpGrant | null>
  saveCrossIpGrant(grant: CrossIpGrant): Promise<void>
  appendAuditEvents(events: readonly AuditEvent[]): Promise<void>
  appendEvents(events: readonly ScriptStudioEvent[]): Promise<void>
}
export interface GovernanceUnitOfWorkPort { execute<Result>(operation: (transaction: GovernanceTransactionPort) => Promise<Result>): Promise<Result> }
