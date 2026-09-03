import type {
  BeatId, DomainErrorCode, EpisodeId, EpisodeStatus, IpId, MemberId, MemberRole, PermissionAction, PermissionDecisionReason,
  ProjectId, ProjectMedium, SceneId, SeasonId, SequenceId, TeamId, VersionId,
} from '@script-studio/domain'

export interface ApiError { code: DomainErrorCode; message: string; requestId: string; details?: Readonly<Record<string, unknown>> }

export interface TeamDto { id: TeamId; name: string; status: 'active' | 'archived'; revision: number }
export interface IpDto { id: IpId; teamId: TeamId; name: string; status: 'active' | 'archived'; revision: number }
export interface ProjectDto { id: ProjectId; teamId: TeamId; ipId: IpId; title: string; medium: ProjectMedium; status: 'active' | 'archived'; revision: number }
export interface SeasonDto { id: SeasonId; projectId: ProjectId; title: string; position: number; status: 'active' | 'archived'; revision: number; system: boolean }
export interface EpisodeDto { id: EpisodeId; projectId: ProjectId; seasonId: SeasonId; title: string; position: number; storyOrder: number; status: EpisodeStatus; revision: number; primary: boolean; currentDraftVersionId: VersionId | null; currentApprovedVersionId: VersionId | null }
export interface SequenceDto { id: SequenceId; projectId: ProjectId; episodeId: EpisodeId; title: string; position: number; status: 'active' | 'archived'; revision: number }
export interface SceneDto { id: SceneId; projectId: ProjectId; episodeId: EpisodeId; sequenceId: SequenceId | null; heading: string; position: number; status: 'active' | 'archived'; revision: number }
export interface BeatDto { id: BeatId; projectId: ProjectId; episodeId: EpisodeId; sceneId: SceneId; text: string; position: number; status: 'active' | 'archived'; revision: number }

export interface GetProjectHierarchyResponse {
  team: TeamDto
  ip: IpDto
  project: ProjectDto
  seasons: readonly SeasonDto[]
  episodes: readonly EpisodeDto[]
  sequences: readonly SequenceDto[]
  scenes: readonly SceneDto[]
  beats: readonly BeatDto[]
}

export interface ActorContext { memberId: MemberId; teamId: TeamId; role: MemberRole }
export type ResourceReference =
  | { type: 'team'; id: TeamId }
  | { type: 'ip'; id: IpId }
  | { type: 'project'; id: ProjectId }
  | { type: 'season'; id: SeasonId }
  | { type: 'episode'; id: EpisodeId }

export interface PermissionCheckRequest { actor: ActorContext; action: PermissionAction; resource: ResourceReference }
export interface PermissionCheckResponse { allowed: boolean; reason: PermissionDecisionReason }
