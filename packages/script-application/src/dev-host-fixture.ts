import {
  asEpisodeId,
  asIpId,
  asMemberId,
  asProjectId,
  asSeasonId,
  asTeamId,
  type ProjectHierarchy,
  type TeamMember,
} from '@script-studio/domain'
import { DevHostApi } from './dev-host-api.js'

export const STAGE_2_DEV_PROJECT_ID = asProjectId('project-1')
export const STAGE_2_DEV_ACTOR = {
  teamId: asTeamId('team-1'),
  memberId: asMemberId('member-writer'),
  role: 'writer' as const,
}

export interface Stage2DevHostFixture {
  api: DevHostApi
  actor: typeof STAGE_2_DEV_ACTOR
  projectId: typeof STAGE_2_DEV_PROJECT_ID
}

function hierarchy(): ProjectHierarchy {
  const teamId = STAGE_2_DEV_ACTOR.teamId
  const ipId = asIpId('ip-1')
  const seasonId = asSeasonId('season-1')
  const episodeId = asEpisodeId('episode-1')
  return {
    team: { id: teamId, name: '第一工作室', status: 'active', revision: 1 },
    ip: { id: ipId, teamId, name: '潮汐 IP', status: 'active', revision: 1 },
    project: { id: STAGE_2_DEV_PROJECT_ID, teamId, ipId, title: '潮汐尽头', medium: 'episodic', status: 'active', revision: 1 },
    seasons: [{ id: seasonId, projectId: STAGE_2_DEV_PROJECT_ID, title: '第一季', position: 1, status: 'active', revision: 1, system: false }],
    episodes: [{ id: episodeId, projectId: STAGE_2_DEV_PROJECT_ID, seasonId, title: '第一集', position: 1, storyOrder: 1, status: 'draft', revision: 1, primary: false, currentDraftVersionId: null, currentApprovedVersionId: null }],
    sequences: [],
    scenes: [],
    beats: [],
  }
}

export function createStage2DevHostFixture(): Stage2DevHostFixture {
  const member: TeamMember = { ...STAGE_2_DEV_ACTOR, status: 'active' }
  return {
    api: new DevHostApi({ hierarchies: [hierarchy()], members: [member] }),
    actor: STAGE_2_DEV_ACTOR,
    projectId: STAGE_2_DEV_PROJECT_ID,
  }
}
