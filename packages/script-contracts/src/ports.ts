import type { IpId, MemberId, PermissionAction, PermissionDecision, ProjectHierarchy, ProjectId, TeamId, TeamMember } from '@script-studio/domain'
import type { ResourceReference } from './dto.js'

export interface HierarchyRepositoryPort {
  getProjectHierarchy(teamId: TeamId, projectId: ProjectId): Promise<ProjectHierarchy | null>
}

export interface MembershipRepositoryPort {
  getMember(teamId: TeamId, memberId: MemberId): Promise<TeamMember | null>
}

export interface PermissionAuthorizerPort {
  authorize(input: { teamId: TeamId; memberId: MemberId; action: PermissionAction; resource: ResourceReference }): Promise<PermissionDecision>
}

export interface IpGrantRepositoryPort {
  hasActiveGrant(input: { teamId: TeamId; sourceIpId: IpId; targetIpId: IpId; selectionSnapshotId: string }): Promise<boolean>
}
