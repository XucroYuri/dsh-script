import type { MemberId, ProjectHierarchy, ProjectId, TeamId } from '@script-studio/domain'

export interface VerifiedCloudSession {
  subject: string
  teamId: TeamId
  memberId: MemberId
}

export interface AccessTokenVerifierPort {
  verify(accessToken: string): Promise<VerifiedCloudSession | null>
}

export interface CloudHierarchyRepositoryPort {
  getProjectHierarchy(teamId: TeamId, projectId: ProjectId): Promise<ProjectHierarchy | null>
}

export interface ScriptStudioApiRequest {
  method: string
  path: string
  headers: Readonly<Record<string, string | undefined>>
  requestId: string
}

export interface ScriptStudioApiResponse<Body = unknown> {
  status: number
  body: Body
}
