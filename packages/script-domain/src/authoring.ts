import { DomainError } from './errors.js'
import type {
  ApprovalId, AuditEventId, ContentObjectId, CrossIpGrantId, DraftId, EpisodeId, IdempotencyKey, IpBibleEntryId, IpId,
  IpPromotionId, MemberId, ProjectCanonFactId, ProjectId, SelectionSnapshotId, TeamId, VersionId,
} from './ids.js'
import type { Episode, Ip } from './model.js'

export type DraftStatus = 'active' | 'submitted' | 'superseded' | 'archived'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'superseded'
export type CanonFactStatus = 'active' | 'superseded'
export type IpPromotionStatus = 'proposed' | 'approved' | 'rejected'
export type CrossIpGrantStatus = 'active' | 'revoked' | 'expired'
export type CrossIpGrantScope = 'ip-bible' | 'project-canon' | 'source-asset' | 'structure'

export interface Draft {
  id: DraftId
  teamId: TeamId
  projectId: ProjectId
  episodeId: EpisodeId
  status: DraftStatus
  revision: number
  contentHash: string
  stateVector: string
}

export interface ManuscriptVersion {
  readonly id: VersionId
  readonly teamId: TeamId
  readonly projectId: ProjectId
  readonly episodeId: EpisodeId
  readonly sourceDraftId: DraftId
  readonly sourceDraftRevision: number
  readonly contentObjectId: ContentObjectId
  readonly contentHash: string
  readonly stateVector: string
  readonly createdBy: MemberId
  readonly createdAt: string
  readonly idempotencyKey: IdempotencyKey
}

export interface Approval {
  id: ApprovalId
  teamId: TeamId
  projectId: ProjectId
  episodeId: EpisodeId
  versionId: VersionId
  status: ApprovalStatus
  decisionNote: string
  decidedBy: MemberId | null
  decidedAt: string | null
  idempotencyKey: IdempotencyKey
}

export interface ProjectCanonFact {
  readonly id: ProjectCanonFactId
  readonly teamId: TeamId
  readonly ipId: IpId
  readonly projectId: ProjectId
  readonly sourceEpisodeId: EpisodeId
  readonly sourceVersionId: VersionId
  readonly sourceContentHash: string
  readonly subject: string
  readonly predicate: string
  readonly value: string
  readonly evidence: string
  readonly status: CanonFactStatus
  readonly createdAt: string
}

export interface IpBibleEntry {
  readonly id: IpBibleEntryId
  readonly teamId: TeamId
  readonly ipId: IpId
  readonly key: string
  readonly value: string
  readonly status: CanonFactStatus
  readonly revision: number
  readonly sourcePromotionId: IpPromotionId | null
  readonly createdBy: MemberId
  readonly createdAt: string
}

export interface IpPromotion {
  id: IpPromotionId
  teamId: TeamId
  ipId: IpId
  sourceProjectId: ProjectId
  sourceCanonFactId: ProjectCanonFactId
  sourceContentHash: string
  status: IpPromotionStatus
  conflictResolution: string
  impactNote: string
  proposedBy: MemberId
  proposedAt: string
  decidedBy: MemberId | null
  decidedAt: string | null
  idempotencyKey: IdempotencyKey
}

export interface CrossIpGrant {
  id: CrossIpGrantId
  teamId: TeamId
  sourceIpId: IpId
  targetIpId: IpId
  selectionSnapshotId: SelectionSnapshotId
  scopes: readonly CrossIpGrantScope[]
  status: CrossIpGrantStatus
  createdBy: MemberId
  createdAt: string
  revokedBy: MemberId | null
  revokedAt: string | null
  idempotencyKey: IdempotencyKey
}

export interface AuditEvent {
  readonly id: AuditEventId
  readonly teamId: TeamId
  readonly actorId: MemberId
  readonly action: string
  readonly resourceType: 'team' | 'ip' | 'project' | 'season' | 'episode' | 'draft' | 'version' | 'approval' | 'canon' | 'grant'
  readonly resourceId: string
  readonly result: 'succeeded' | 'denied' | 'conflict' | 'failed'
  readonly occurredAt: string
  readonly idempotencyKey: IdempotencyKey
}

function requireHash(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new DomainError('validation', 'contentHash must be a SHA-256 hex digest.')
  return normalized
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new DomainError('validation', `${field} is required.`)
  return normalized
}

export function submitDraft(draft: Draft, expectedRevision: number): Draft {
  if (draft.revision !== expectedRevision) throw new DomainError('revision-conflict', 'Draft revision changed before submission.')
  if (draft.status !== 'active') throw new DomainError('invalid-state', 'Only an active Draft can be submitted.')
  requireHash(draft.contentHash)
  requireText(draft.stateVector, 'stateVector')
  return { ...draft, status: 'submitted', revision: draft.revision + 1 }
}

export function createManuscriptVersionFromDraft(input: {
  draft: Draft
  id: VersionId
  contentObjectId: ContentObjectId
  contentHash: string
  stateVector: string
  createdBy: MemberId
  createdAt: string
  idempotencyKey: IdempotencyKey
}): ManuscriptVersion {
  if (input.draft.status !== 'submitted') throw new DomainError('invalid-state', 'Draft must be submitted before a Version is frozen.')
  const contentHash = requireHash(input.contentHash)
  if (contentHash !== requireHash(input.draft.contentHash)) throw new DomainError('validation', 'Version content hash must match the submitted Draft.')
  if (input.stateVector !== input.draft.stateVector) throw new DomainError('validation', 'Version state vector must match the submitted Draft.')
  return Object.freeze({
    id: input.id,
    teamId: input.draft.teamId,
    projectId: input.draft.projectId,
    episodeId: input.draft.episodeId,
    sourceDraftId: input.draft.id,
    sourceDraftRevision: input.draft.revision,
    contentObjectId: input.contentObjectId,
    contentHash,
    stateVector: input.stateVector,
    createdBy: input.createdBy,
    createdAt: requireText(input.createdAt, 'createdAt'),
    idempotencyKey: input.idempotencyKey,
  })
}

export function approveManuscriptVersion(input: {
  episode: Episode
  version: ManuscriptVersion
  approvalId: ApprovalId
  actorId: MemberId
  decidedAt: string
  expectedEpisodeRevision: number
  idempotencyKey: IdempotencyKey
}): { episode: Episode; approval: Approval } {
  if (input.episode.revision !== input.expectedEpisodeRevision) throw new DomainError('revision-conflict', 'Episode revision changed before approval.')
  if (input.episode.status === 'archived' || input.episode.status === 'locked') throw new DomainError('invalid-state', 'Episode cannot be approved in its current state.')
  if (input.version.episodeId !== input.episode.id || input.version.projectId !== input.episode.projectId) throw new DomainError('validation', 'Version must belong to the approved Episode.')
  const approval: Approval = {
    id: input.approvalId,
    teamId: input.version.teamId,
    projectId: input.version.projectId,
    episodeId: input.episode.id,
    versionId: input.version.id,
    status: 'approved',
    decisionNote: '',
    decidedBy: input.actorId,
    decidedAt: requireText(input.decidedAt, 'decidedAt'),
    idempotencyKey: input.idempotencyKey,
  }
  return {
    episode: { ...input.episode, status: 'approved', currentApprovedVersionId: input.version.id, revision: input.episode.revision + 1 },
    approval,
  }
}

export function rejectManuscriptVersion(input: {
  episode: Episode
  version: ManuscriptVersion
  approvalId: ApprovalId
  actorId: MemberId
  decisionNote: string
  decidedAt: string
  expectedEpisodeRevision: number
  idempotencyKey: IdempotencyKey
}): { episode: Episode; approval: Approval } {
  if (input.episode.revision !== input.expectedEpisodeRevision) throw new DomainError('revision-conflict', 'Episode revision changed before rejection.')
  if (input.episode.status === 'archived' || input.episode.status === 'locked') throw new DomainError('invalid-state', 'Episode cannot reject a Version in its current state.')
  if (input.version.episodeId !== input.episode.id || input.version.projectId !== input.episode.projectId) throw new DomainError('validation', 'Version must belong to the rejected Episode.')
  const approval: Approval = {
    id: input.approvalId,
    teamId: input.version.teamId,
    projectId: input.version.projectId,
    episodeId: input.episode.id,
    versionId: input.version.id,
    status: 'rejected',
    decisionNote: requireText(input.decisionNote, 'decisionNote'),
    decidedBy: input.actorId,
    decidedAt: requireText(input.decidedAt, 'decidedAt'),
    idempotencyKey: input.idempotencyKey,
  }
  return {
    episode: { ...input.episode, status: 'draft', currentDraftVersionId: input.version.id, revision: input.episode.revision + 1 },
    approval,
  }
}

export function attachDraftVersion(episode: Episode, version: ManuscriptVersion, expectedEpisodeRevision: number): Episode {
  if (episode.revision !== expectedEpisodeRevision) throw new DomainError('revision-conflict', 'Episode revision changed before attaching Draft Version.')
  if (episode.status === 'archived' || episode.status === 'locked') throw new DomainError('invalid-state', 'Episode cannot accept a Draft Version in its current state.')
  if (version.episodeId !== episode.id || version.projectId !== episode.projectId) throw new DomainError('validation', 'Version must belong to the target Episode.')
  return { ...episode, status: 'in-review', currentDraftVersionId: version.id, revision: episode.revision + 1 }
}

export function createProjectCanonFact(input: {
  id: ProjectCanonFactId
  approval: Approval
  version: ManuscriptVersion
  ipId: IpId
  subject: string
  predicate: string
  value: string
  evidence: string
  createdAt: string
}): ProjectCanonFact {
  if (input.approval.status !== 'approved' || input.approval.versionId !== input.version.id) throw new DomainError('invalid-state', 'Project Canon requires an approved Version.')
  return Object.freeze({
    id: input.id,
    teamId: input.version.teamId,
    ipId: input.ipId,
    projectId: input.version.projectId,
    sourceEpisodeId: input.version.episodeId,
    sourceVersionId: input.version.id,
    sourceContentHash: input.version.contentHash,
    subject: requireText(input.subject, 'subject'),
    predicate: requireText(input.predicate, 'predicate'),
    value: requireText(input.value, 'value'),
    evidence: requireText(input.evidence, 'evidence'),
    status: 'active',
    createdAt: requireText(input.createdAt, 'createdAt'),
  })
}

export function proposeIpPromotion(input: {
  id: IpPromotionId
  targetIp: Ip
  sourceFact: ProjectCanonFact
  conflictResolution: string
  impactNote: string
  actorId: MemberId
  proposedAt: string
  idempotencyKey: IdempotencyKey
}): IpPromotion {
  if (input.sourceFact.status !== 'active') throw new DomainError('invalid-state', 'Only an active Project Canon Fact can be proposed for IP Promotion.')
  if (input.sourceFact.teamId !== input.targetIp.teamId || input.sourceFact.ipId !== input.targetIp.id) {
    throw new DomainError('forbidden', 'IP Promotion source fact must belong to the target IP and Team.', { permissionReason: 'resource-mismatch' })
  }
  requireText(input.conflictResolution, 'conflictResolution')
  requireText(input.impactNote, 'impactNote')
  return {
    id: input.id,
    teamId: input.targetIp.teamId,
    ipId: input.targetIp.id,
    sourceProjectId: input.sourceFact.projectId,
    sourceCanonFactId: input.sourceFact.id,
    sourceContentHash: input.sourceFact.sourceContentHash,
    status: 'proposed',
    conflictResolution: input.conflictResolution,
    impactNote: input.impactNote,
    proposedBy: input.actorId,
    proposedAt: requireText(input.proposedAt, 'proposedAt'),
    decidedBy: null,
    decidedAt: null,
    idempotencyKey: input.idempotencyKey,
  }
}

export function decideIpPromotion(input: {
  promotion: IpPromotion
  targetIp: Ip
  sourceFact: ProjectCanonFact
  decision: 'approved' | 'rejected'
  actorId: MemberId
  decidedAt: string
  expectedIpRevision: number
  bibleEntryId?: IpBibleEntryId
  bibleKey?: string
  bibleValue?: string
}): { promotion: IpPromotion; bibleEntry: IpBibleEntry | null; ipRevision: number } {
  if (input.promotion.status !== 'proposed') throw new DomainError('invalid-state', 'Only a proposed IP Promotion can be decided.')
  if (input.targetIp.id !== input.promotion.ipId || input.targetIp.teamId !== input.promotion.teamId) throw new DomainError('forbidden', 'IP Promotion does not belong to the target IP and Team.', { permissionReason: 'resource-mismatch' })
  if (input.sourceFact.id !== input.promotion.sourceCanonFactId || input.sourceFact.status !== 'active' || input.sourceFact.sourceContentHash !== input.promotion.sourceContentHash) {
    throw new DomainError('revision-conflict', 'IP Promotion source Canon changed before decision.')
  }
  if (input.targetIp.status === 'archived') throw new DomainError('invalid-state', 'Archived IP cannot decide a Promotion.')
  if (input.targetIp.revision !== input.expectedIpRevision) throw new DomainError('revision-conflict', 'IP revision changed before Promotion decision.')
  const decidedAt = requireText(input.decidedAt, 'decidedAt')
  const promotion = { ...input.promotion, status: input.decision, decidedBy: input.actorId, decidedAt } satisfies IpPromotion
  if (input.decision === 'rejected') return { promotion, bibleEntry: null, ipRevision: input.targetIp.revision + 1 }
  if (!input.bibleEntryId) throw new DomainError('validation', 'Approved Promotion requires an IP Bible Entry ID.')
  const bibleEntry = Object.freeze({
    id: input.bibleEntryId,
    teamId: input.targetIp.teamId,
    ipId: input.targetIp.id,
    key: requireText(input.bibleKey ?? '', 'bibleKey'),
    value: requireText(input.bibleValue ?? '', 'bibleValue'),
    status: 'active' as const,
    revision: 1,
    sourcePromotionId: input.promotion.id,
    createdBy: input.actorId,
    createdAt: decidedAt,
  })
  return { promotion, bibleEntry, ipRevision: input.targetIp.revision + 1 }
}

export function createCrossIpGrant(input: {
  id: CrossIpGrantId
  teamId: TeamId
  sourceIp: Ip
  targetIp: Ip
  selectionSnapshotId: SelectionSnapshotId
  scopes: readonly CrossIpGrantScope[]
  createdBy: MemberId
  createdAt: string
  idempotencyKey: IdempotencyKey
}): CrossIpGrant {
  if (input.sourceIp.teamId !== input.teamId || input.targetIp.teamId !== input.teamId) throw new DomainError('forbidden', 'Cross-Team Grant is forbidden.', { permissionReason: 'resource-mismatch' })
  if (input.sourceIp.id === input.targetIp.id) throw new DomainError('validation', 'Cross-IP Grant requires different source and target IPs.')
  if (input.scopes.length === 0 || new Set(input.scopes).size !== input.scopes.length) throw new DomainError('validation', 'Cross-IP Grant scopes must be non-empty and unique.')
  return {
    id: input.id,
    teamId: input.teamId,
    sourceIpId: input.sourceIp.id,
    targetIpId: input.targetIp.id,
    selectionSnapshotId: input.selectionSnapshotId,
    scopes: Object.freeze([...input.scopes]),
    status: 'active',
    createdBy: input.createdBy,
    createdAt: requireText(input.createdAt, 'createdAt'),
    revokedBy: null,
    revokedAt: null,
    idempotencyKey: input.idempotencyKey,
  }
}

export function revokeCrossIpGrant(grant: CrossIpGrant, actorId: MemberId, revokedAt: string): CrossIpGrant {
  if (grant.status !== 'active') throw new DomainError('invalid-state', 'Only an active Cross-IP Grant can be revoked.')
  return { ...grant, status: 'revoked', revokedBy: actorId, revokedAt: requireText(revokedAt, 'revokedAt') }
}

export function createAuditEvent(event: AuditEvent): AuditEvent {
  requireText(event.action, 'action')
  requireText(event.resourceId, 'resourceId')
  requireText(event.occurredAt, 'occurredAt')
  return Object.freeze({ ...event })
}

export function assertVersionUnchanged(before: ManuscriptVersion, after: ManuscriptVersion): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new DomainError('invalid-state', 'Manuscript Version is immutable.')
}
