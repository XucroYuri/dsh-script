import { hostAdapterParityContract } from '@script-studio/contracts/testing/host-adapter-parity-contract'
import { DevHostApi } from '@script-studio/application'
import {
  asEpisodeId,
  asIdempotencyKey,
  asIpId,
  asMemberId,
  asProjectId,
  asRequestHash,
  asSeasonId,
  asTeamId,
  type ProjectHierarchy,
} from '@script-studio/domain'
import { DshScriptStudioAdapter } from '@script-studio/dsh-adapter'
import { CodexScriptStudioAdapter } from '../src/index.js'

function hierarchy(): ProjectHierarchy {
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

hostAdapterParityContract('Codex and DSH adapter parity', () => {
  const value = hierarchy()
  const member = { teamId: value.team.id, memberId: asMemberId('member-writer'), role: 'writer' as const, status: 'active' as const }
  const api = new DevHostApi({ hierarchies: [value], members: [member] })
  const codex = new CodexScriptStudioAdapter(api, { hostVersion: '0.150.1', hostInstanceId: 'codex-test', adapterVersion: '0.1.0' })
  const dsh = new DshScriptStudioAdapter(api, { hostVersion: '0.1.0-rc.7', hostInstanceId: 'dsh-test', adapterVersion: '0.1.0' })
  const createSeason = {
    requestId: 'create-season-1',
    operation: 'create-season' as const,
    actor: { teamId: value.team.id, memberId: member.memberId, role: member.role },
    payload: {
      projectId: value.project.id,
      seasonId: asSeasonId('season-2'),
      title: '第二季',
      firstEpisodeId: asEpisodeId('episode-2'),
      firstEpisodeTitle: '第一集',
      expectedProjectRevision: 1,
      idempotencyKey: asIdempotencyKey('create-season-1'),
      requestHash: asRequestHash('create-season-request-1'),
    },
  }
  return {
    codex,
    dsh,
    hierarchyRead: { requestId: 'hierarchy-1', operation: 'get-project-hierarchy', actor: createSeason.actor, payload: { projectId: value.project.id } },
    forbiddenHierarchyRead: { requestId: 'hierarchy-forbidden', operation: 'get-project-hierarchy', actor: { ...createSeason.actor, role: 'viewer' }, payload: { projectId: value.project.id } },
    createSeason,
    createSeasonWithOtherHash: { ...createSeason, requestId: 'create-season-conflict', payload: { ...createSeason.payload, requestHash: asRequestHash('create-season-request-other') } },
  }
})
