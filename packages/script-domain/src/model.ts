import type { BeatId, EpisodeId, IpId, MemberId, ProjectId, SceneId, SeasonId, SequenceId, TeamId, VersionId } from './ids.js'

export const PROJECT_MEDIA = ['episodic', 'feature-film'] as const
export type ProjectMedium = (typeof PROJECT_MEDIA)[number]

export type EntityStatus = 'active' | 'archived'
export type EpisodeStatus = 'draft' | 'in-review' | 'approved' | 'locked' | 'archived'
export type MemberRole = 'owner' | 'admin' | 'editor' | 'writer' | 'reviewer' | 'viewer'

export interface Team { id: TeamId; name: string; status: EntityStatus; revision: number }
export interface TeamMember { teamId: TeamId; memberId: MemberId; role: MemberRole; status: 'active' | 'suspended' }
export interface Ip { id: IpId; teamId: TeamId; name: string; status: EntityStatus; revision: number }
export interface Project { id: ProjectId; teamId: TeamId; ipId: IpId; title: string; medium: ProjectMedium; status: EntityStatus; revision: number }
export interface Season { id: SeasonId; projectId: ProjectId; title: string; position: number; status: EntityStatus; revision: number; system: boolean }
export interface Episode { id: EpisodeId; projectId: ProjectId; seasonId: SeasonId; title: string; position: number; storyOrder: number; status: EpisodeStatus; revision: number; primary: boolean; currentDraftVersionId: VersionId | null; currentApprovedVersionId: VersionId | null }
export interface Sequence { id: SequenceId; projectId: ProjectId; episodeId: EpisodeId; title: string; position: number; status: EntityStatus; revision: number }
export interface Scene { id: SceneId; projectId: ProjectId; episodeId: EpisodeId; sequenceId: SequenceId | null; heading: string; position: number; status: EntityStatus; revision: number }
export interface Beat { id: BeatId; projectId: ProjectId; episodeId: EpisodeId; sceneId: SceneId; text: string; position: number; status: EntityStatus; revision: number }

export interface ProjectHierarchy {
	team: Team
	ip: Ip
	project: Project
	seasons: readonly Season[]
	episodes: readonly Episode[]
	sequences: readonly Sequence[]
	scenes: readonly Scene[]
	beats: readonly Beat[]
}
