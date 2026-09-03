import type { CrossIpGrantScope, IpId, ProjectId, ProjectMedium, SelectionSnapshotId, SeasonId, TeamId } from '@script-studio/domain'
import type { ResourceReference } from './dto.js'

export interface CreateProjectCommand { teamId: TeamId; ipId: IpId; title: string; medium: ProjectMedium; idempotencyKey: string }
export interface CreateSeasonCommand { teamId: TeamId; projectId: ProjectId; title: string; expectedProjectRevision: number; idempotencyKey: string }
export interface CreateEpisodeCommand { teamId: TeamId; projectId: ProjectId; seasonId: SeasonId; title: string; expectedProjectRevision: number; idempotencyKey: string }
export interface ArchiveResourceCommand { teamId: TeamId; resource: Exclude<ResourceReference, { type: 'team' }>; expectedRevision: number; idempotencyKey: string }
export interface RestoreResourceCommand extends ArchiveResourceCommand {}
export interface GrantCrossIpSelectionCommand { teamId: TeamId; sourceIpId: IpId; targetIpId: IpId; selectionSnapshotId: SelectionSnapshotId; scopes: readonly CrossIpGrantScope[]; expectedTargetIpRevision: number; idempotencyKey: string }
