import type { ApplicationOperation, AuthoringTransactionPort, AuthoringUnitOfWorkPort, ContentObjectMetadata, GovernanceTransactionPort, GovernanceUnitOfWorkPort, IdGeneratorPort, ScriptStudioEvent, SecurityAuditPort, SelectionSnapshotMetadata } from '@script-studio/contracts'
import {
  asAuditEventId, asEpisodeId, asIpId, asMemberId, asProjectId, asSeasonId, asTeamId, DomainError,
  type Approval, type AuditEvent, type CrossIpGrant, type Draft, type IdempotencyKey, type Ip, type IpBibleEntry, type IpPromotion, type ManuscriptVersion, type ProjectCanonFact, type RequestHash, type TeamId,
  type ProjectHierarchy, type TeamMember,
} from '@script-studio/domain'

export function hierarchy(): ProjectHierarchy {
  const teamId = asTeamId('team-1'), ipId = asIpId('ip-1'), projectId = asProjectId('project-1'), seasonId = asSeasonId('season-1'), episodeId = asEpisodeId('episode-1')
  return {
    team: { id: teamId, name: '第一工作室', status: 'active', revision: 1 },
    ip: { id: ipId, teamId, name: '潮汐 IP', status: 'active', revision: 1 },
    project: { id: projectId, teamId, ipId, title: '潮汐尽头', medium: 'episodic', status: 'active', revision: 1 },
    seasons: [{ id: seasonId, projectId, title: '第一季', position: 1, status: 'active', revision: 1, system: false }],
    episodes: [{ id: episodeId, projectId, seasonId, title: '第一集', position: 1, storyOrder: 1, status: 'draft', revision: 1, primary: false, currentDraftVersionId: null, currentApprovedVersionId: null }],
    sequences: [], scenes: [], beats: [],
  }
}

export function teamMember(role: TeamMember['role']): TeamMember {
  return { teamId: asTeamId('team-1'), memberId: asMemberId(`member-${role}`), role, status: 'active' }
}

export class MemoryTransaction implements AuthoringTransactionPort, GovernanceTransactionPort {
  hierarchy = hierarchy()
  member = teamMember('writer')
  drafts = new Map<string, Draft>()
  contentObjects = new Map<string, ContentObjectMetadata>()
  versions = new Map<string, ManuscriptVersion>()
  approvals: Approval[] = []
  canonFacts: ProjectCanonFact[] = []
  ips = new Map<string, Ip>([[this.hierarchy.ip.id, this.hierarchy.ip]])
  promotions = new Map<string, IpPromotion>()
  bibleEntries: IpBibleEntry[] = []
  selectionSnapshots = new Map<string, SelectionSnapshotMetadata>()
  grants = new Map<string, CrossIpGrant>()
  audits: AuditEvent[] = []
  events: ScriptStudioEvent[] = []
  failureAudits = new Set<string>()
  idempotency = new Map<string, { requestHash: RequestHash; status: 'claimed' | 'completed'; result?: unknown }>()
  failOn: 'saveProjectCanonFacts' | 'appendEvents' | null = null

  private idempotencyScope(teamId: TeamId, operation: ApplicationOperation, key: IdempotencyKey): string { return `${teamId}:${operation}:${key}` }
  async claimIdempotency<Result>(input: { teamId: TeamId; operation: ApplicationOperation; key: IdempotencyKey; requestHash: RequestHash }) {
    const scope = this.idempotencyScope(input.teamId, input.operation, input.key)
    const existing = this.idempotency.get(scope)
    if (existing && existing.requestHash !== input.requestHash) throw new DomainError('revision-conflict', 'Idempotency key was already used with another request.')
    if (existing?.status === 'completed') return { status: 'replay' as const, result: existing.result as Result }
    if (existing) throw new DomainError('invalid-state', 'Idempotent operation is already in progress.')
    this.idempotency.set(scope, { requestHash: input.requestHash, status: 'claimed' })
    return { status: 'claimed' as const }
  }
  async completeIdempotency<Result>(input: { teamId: TeamId; operation: ApplicationOperation; key: IdempotencyKey; requestHash: RequestHash; result: Result }): Promise<void> {
    const scope = this.idempotencyScope(input.teamId, input.operation, input.key)
    const existing = this.idempotency.get(scope)
    if (!existing || existing.requestHash !== input.requestHash) throw new DomainError('invalid-state', 'Idempotency claim is missing.')
    this.idempotency.set(scope, { requestHash: input.requestHash, status: 'completed', result: input.result })
  }
  async getHierarchy(teamId: TeamId, projectId: ProjectHierarchy['project']['id']): Promise<ProjectHierarchy | null> { return this.hierarchy.team.id === teamId && this.hierarchy.project.id === projectId ? this.hierarchy : null }
  async getMember(teamId: TeamId, memberId: TeamMember['memberId']): Promise<TeamMember | null> { return this.member.teamId === teamId && this.member.memberId === memberId ? this.member : null }
  async getDraft(teamId: TeamId, draftId: Draft['id']): Promise<Draft | null> { const draft = this.drafts.get(draftId); return draft?.teamId === teamId ? draft : null }
  async getContentObject(teamId: TeamId, contentObjectId: ContentObjectMetadata['id']): Promise<ContentObjectMetadata | null> { const object = this.contentObjects.get(contentObjectId); return object?.teamId === teamId ? object : null }
  async saveDraft(draft: Draft): Promise<void> { this.drafts.set(draft.id, draft) }
  async getVersion(teamId: TeamId, versionId: ManuscriptVersion['id']): Promise<ManuscriptVersion | null> { const version = this.versions.get(versionId); return version?.teamId === teamId ? version : null }
  async saveVersion(version: ManuscriptVersion): Promise<void> { this.versions.set(version.id, version) }
  async saveEpisode(episode: ProjectHierarchy['episodes'][number]): Promise<void> { this.hierarchy = { ...this.hierarchy, episodes: this.hierarchy.episodes.map(current => current.id === episode.id ? episode : current) } }
  async saveApproval(approval: Approval): Promise<void> { this.approvals.push(approval) }
  async saveProjectCanonFacts(facts: readonly ProjectCanonFact[]): Promise<void> { if (this.failOn === 'saveProjectCanonFacts') throw new Error('injected canon failure'); this.canonFacts.push(...facts) }
  async getIp(teamId: TeamId, ipId: Ip['id']): Promise<Ip | null> { const ip = this.ips.get(ipId); return ip?.teamId === teamId ? ip : null }
  async saveIp(ip: Ip): Promise<void> { this.ips.set(ip.id, ip); if (ip.id === this.hierarchy.ip.id) this.hierarchy = { ...this.hierarchy, ip } }
  async getProjectCanonFact(teamId: TeamId, factId: ProjectCanonFact['id']): Promise<ProjectCanonFact | null> { return this.canonFacts.find(fact => fact.teamId === teamId && fact.id === factId) ?? null }
  async getIpPromotion(teamId: TeamId, promotionId: IpPromotion['id']): Promise<IpPromotion | null> { const promotion = this.promotions.get(promotionId); return promotion?.teamId === teamId ? promotion : null }
  async saveIpPromotion(promotion: IpPromotion): Promise<void> { this.promotions.set(promotion.id, promotion) }
  async saveIpBibleEntry(entry: IpBibleEntry): Promise<void> { this.bibleEntries.push(entry) }
  async getSelectionSnapshot(teamId: TeamId, snapshotId: SelectionSnapshotMetadata['id']): Promise<SelectionSnapshotMetadata | null> { const snapshot = this.selectionSnapshots.get(snapshotId); return snapshot?.teamId === teamId ? snapshot : null }
  async findActiveGrant(input: { teamId: TeamId; sourceIpId: Ip['id']; targetIpId: Ip['id']; selectionSnapshotId: SelectionSnapshotMetadata['id'] }): Promise<CrossIpGrant | null> {
    return [...this.grants.values()].find(grant => grant.status === 'active' && grant.teamId === input.teamId && grant.sourceIpId === input.sourceIpId && grant.targetIpId === input.targetIpId && grant.selectionSnapshotId === input.selectionSnapshotId) ?? null
  }
  async getCrossIpGrant(teamId: TeamId, grantId: CrossIpGrant['id']): Promise<CrossIpGrant | null> { const grant = this.grants.get(grantId); return grant?.teamId === teamId ? grant : null }
  async saveCrossIpGrant(grant: CrossIpGrant): Promise<void> { this.grants.set(grant.id, grant) }
  async appendAuditEvents(events: readonly AuditEvent[]): Promise<void> { this.audits.push(...events) }
  async appendEvents(events: readonly ScriptStudioEvent[]): Promise<void> { if (this.failOn === 'appendEvents') throw new Error('injected event failure'); this.events.push(...events) }
}

export class MemoryUnitOfWork implements AuthoringUnitOfWorkPort {
  constructor(readonly transaction = new MemoryTransaction()) {}

  async execute<Result>(operation: (transaction: AuthoringTransactionPort) => Promise<Result>): Promise<Result> {
    const snapshot = {
      hierarchy: this.transaction.hierarchy,
      drafts: new Map(this.transaction.drafts), contentObjects: new Map(this.transaction.contentObjects), versions: new Map(this.transaction.versions),
      approvals: [...this.transaction.approvals], canonFacts: [...this.transaction.canonFacts], ips: new Map(this.transaction.ips),
      promotions: new Map(this.transaction.promotions), bibleEntries: [...this.transaction.bibleEntries], selectionSnapshots: new Map(this.transaction.selectionSnapshots), grants: new Map(this.transaction.grants), audits: [...this.transaction.audits],
      events: [...this.transaction.events], idempotency: new Map(this.transaction.idempotency),
    }
    try {
      return await operation(this.transaction)
    } catch (cause) {
      Object.assign(this.transaction, snapshot)
      throw cause
    }
  }
}

export class MemoryGovernanceUnitOfWork implements GovernanceUnitOfWorkPort {
  constructor(readonly transaction = new MemoryTransaction()) {}
  async execute<Result>(operation: (transaction: GovernanceTransactionPort) => Promise<Result>): Promise<Result> {
    const authoring = new MemoryUnitOfWork(this.transaction)
    return authoring.execute(() => operation(this.transaction))
  }
}

export class MemorySecurityAudit implements SecurityAuditPort {
  constructor(private readonly transaction: MemoryTransaction) {}
  async recordFailure(audit: AuditEvent, event: ScriptStudioEvent): Promise<void> {
    const key = `${audit.action}:${audit.idempotencyKey}`
    if (this.transaction.failureAudits.has(key)) return
    this.transaction.failureAudits.add(key)
    this.transaction.audits.push(audit)
    this.transaction.events.push(event)
  }
}

export class DeterministicIds implements IdGeneratorPort {
  private audit = 0
  private event = 0
  auditEventId() { return asAuditEventId(`audit-${++this.audit}`) }
  eventId() { return `event-${++this.event}` }
}
