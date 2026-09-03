import {
  asBeatId, asEpisodeId, asIpId, asMemberId, asProjectId, asSceneId, asSeasonId, asSequenceId, asTeamId,
  type ProjectHierarchy,
  type TeamMember,
} from '../src/index.js'

export function hierarchy(medium: 'episodic' | 'feature-film' = 'episodic'): ProjectHierarchy {
  const teamId = asTeamId('team-1')
  const ipId = asIpId('ip-1')
  const projectId = asProjectId('project-1')
  const seasonId = asSeasonId('season-1')
  const episodeId = asEpisodeId('episode-1')
  const sequenceId = asSequenceId('sequence-1')
  const sceneId = asSceneId('scene-1')
  return {
    team: { id: teamId, name: '第一工作室', status: 'active', revision: 1 },
    ip: { id: ipId, teamId, name: '潮汐 IP', status: 'active', revision: 1 },
    project: { id: projectId, teamId, ipId, title: '潮汐尽头', medium, status: 'active', revision: 1 },
    seasons: [{ id: seasonId, projectId, title: medium === 'feature-film' ? '系统季' : '第一季', position: 1, status: 'active', revision: 1, system: medium === 'feature-film' }],
    episodes: [{ id: episodeId, projectId, seasonId, title: medium === 'feature-film' ? '主剧本' : '第一集', position: 1, storyOrder: 1, status: 'draft', revision: 1, primary: medium === 'feature-film', currentDraftVersionId: null, currentApprovedVersionId: null }],
    sequences: [{ id: sequenceId, projectId, episodeId, title: '第一序列', position: 1, status: 'active', revision: 1 }],
    scenes: [{ id: sceneId, projectId, episodeId, sequenceId, heading: '内景 港口 夜', position: 1, status: 'active', revision: 1 }],
    beats: [{ id: asBeatId('beat-1'), projectId, episodeId, sceneId, text: '灯塔熄灭。', position: 1, status: 'active', revision: 1 }],
  }
}

export function member(role: TeamMember['role']): TeamMember {
  return { teamId: asTeamId('team-1'), memberId: asMemberId(`member-${role}`), role, status: 'active' }
}
