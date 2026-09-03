import { DomainError } from './errors.js'
import type { EpisodeId, TeamId } from './ids.js'
import type { EntityStatus, EpisodeStatus, Ip, MemberRole, ProjectHierarchy, TeamMember } from './model.js'
import { assertProjectHierarchy } from './hierarchy.js'

export type PermissionAction = 'read' | 'write' | 'approve' | 'promote-ip-canon' | 'approve-ip-promotion' | 'manage-ip-grants' | 'manage-members'
export type PermissionDecisionReason = 'allowed' | 'not-a-member' | 'member-suspended' | 'role-denied' | 'resource-mismatch' | 'archived' | 'revision-conflict'

export interface PermissionDecision { allowed: boolean; reason: PermissionDecisionReason }

const ROLE_ACTIONS: Record<MemberRole, readonly PermissionAction[]> = {
  owner: ['read', 'write', 'approve', 'promote-ip-canon', 'approve-ip-promotion', 'manage-ip-grants', 'manage-members'],
  admin: ['read', 'write', 'approve', 'promote-ip-canon', 'approve-ip-promotion', 'manage-ip-grants', 'manage-members'],
  editor: ['read', 'write', 'approve', 'promote-ip-canon'],
  writer: ['read', 'write'],
  reviewer: ['read', 'approve'],
  viewer: ['read'],
}

function isArchived(status: EntityStatus | EpisodeStatus): boolean {
  return status === 'archived'
}

export function authorize(
  member: TeamMember | null,
  requiredTeamId: TeamId,
  action: PermissionAction,
  statuses: readonly (EntityStatus | EpisodeStatus)[],
  revision?: { expected: number; actual: number },
): PermissionDecision {
  if (!member) return { allowed: false, reason: 'not-a-member' }
  if (member.status !== 'active') return { allowed: false, reason: 'member-suspended' }
  if (member.teamId !== requiredTeamId) return { allowed: false, reason: 'not-a-member' }
  if (action !== 'read' && statuses.some(isArchived)) return { allowed: false, reason: 'archived' }
  if (revision && revision.expected !== revision.actual) return { allowed: false, reason: 'revision-conflict' }
  if (!ROLE_ACTIONS[member.role].includes(action)) return { allowed: false, reason: 'role-denied' }
  return { allowed: true, reason: 'allowed' }
}

export function assertHierarchyWriteAllowed(hierarchy: ProjectHierarchy, member: TeamMember, expectedProjectRevision: number): void {
  const decision = authorize(member, hierarchy.team.id, 'write', [hierarchy.team.status, hierarchy.ip.status, hierarchy.project.status], {
    expected: expectedProjectRevision,
    actual: hierarchy.project.revision,
  })
  if (!decision.allowed) {
    const code = decision.reason === 'revision-conflict' ? 'revision-conflict' : decision.reason === 'role-denied' || decision.reason.includes('member') ? 'forbidden' : 'invalid-state'
    throw new DomainError(code, `Hierarchy write denied: ${decision.reason}.`, { permissionReason: decision.reason })
  }
}

export function assertEpisodeActionAllowed(hierarchy: ProjectHierarchy, member: TeamMember, action: 'write' | 'approve', episodeId: EpisodeId, expectedEpisodeRevision: number): void {
  assertProjectHierarchy(hierarchy)
  const episode = hierarchy.episodes.find(candidate => candidate.id === episodeId)
  if (!episode) throw new DomainError('not-found', 'Episode does not belong to the hierarchy.')
  const season = hierarchy.seasons.find(candidate => candidate.id === episode.seasonId)
  if (!season) throw new DomainError('invalid-state', 'Episode is missing its Season.')
  const decision = authorize(member, hierarchy.team.id, action, [
    hierarchy.team.status,
    hierarchy.ip.status,
    hierarchy.project.status,
    season.status,
    episode.status,
  ], { expected: expectedEpisodeRevision, actual: episode.revision })
  if (!decision.allowed) {
    const code = decision.reason === 'revision-conflict' ? 'revision-conflict' : decision.reason === 'role-denied' || decision.reason.includes('member') ? 'forbidden' : 'invalid-state'
    throw new DomainError(code, `Episode write denied: ${decision.reason}.`, { permissionReason: decision.reason })
  }
}

export function assertEpisodeWriteAllowed(hierarchy: ProjectHierarchy, member: TeamMember, episodeId: EpisodeId, expectedEpisodeRevision: number): void {
  assertEpisodeActionAllowed(hierarchy, member, 'write', episodeId, expectedEpisodeRevision)
}

export function assertIpActionAllowed(ip: Ip, member: TeamMember, action: 'promote-ip-canon' | 'approve-ip-promotion' | 'manage-ip-grants', expectedIpRevision: number): void {
  const decision = authorize(member, ip.teamId, action, [ip.status], { expected: expectedIpRevision, actual: ip.revision })
  if (!decision.allowed) {
    const code = decision.reason === 'revision-conflict' ? 'revision-conflict' : decision.reason === 'role-denied' || decision.reason.includes('member') ? 'forbidden' : 'invalid-state'
    throw new DomainError(code, `IP action denied: ${decision.reason}.`, { permissionReason: decision.reason })
  }
}
