import { describe, expect, it } from 'vitest'
import { HOST_CONTRACT_VERSION, type HostIdentity } from '@script-studio/contracts/host'
import { asEpisodeId, asIpId, asMemberId, asProjectId, asSeasonId, asTeamId, type ProjectHierarchy } from '@script-studio/domain'
import { DevHostApi } from '../src/index.js'

function fixture() {
  const teamId = asTeamId('team-1'), ipId = asIpId('ip-1'), projectId = asProjectId('project-1'), seasonId = asSeasonId('season-1')
  const hierarchy: ProjectHierarchy = {
    team: { id: teamId, name: '第一工作室', status: 'active', revision: 1 },
    ip: { id: ipId, teamId, name: '潮汐 IP', status: 'active', revision: 1 },
    project: { id: projectId, teamId, ipId, title: '潮汐尽头', medium: 'episodic', status: 'active', revision: 1 },
    seasons: [{ id: seasonId, projectId, title: '第一季', position: 1, status: 'active', revision: 1, system: false }],
    episodes: [{ id: asEpisodeId('episode-1'), projectId, seasonId, title: '第一集', position: 1, storyOrder: 1, status: 'draft', revision: 1, primary: false, currentDraftVersionId: null, currentApprovedVersionId: null }],
    sequences: [], scenes: [], beats: [],
  }
  const member = { teamId, memberId: asMemberId('member-writer'), role: 'writer' as const, status: 'active' as const }
  return { hierarchy, member }
}

const host: HostIdentity = { kind: 'codex', name: 'Codex', hostVersion: '0.150.1', hostInstanceId: 'test', adapterVersion: '0.1.0' }

describe('DevHostApi contract boundary', () => {
  it('fails closed on an unsupported major Host Contract', async () => {
    const value = fixture()
    const api = new DevHostApi({ hierarchies: [value.hierarchy], members: [value.member] })
    const response = await api.handle({ contractVersion: '2.0.0', host, invocation: { requestId: 'unsupported-1', operation: 'capabilities' } })
    expect(response).toMatchObject({ ok: false, contractVersion: HOST_CONTRACT_VERSION, error: { code: 'validation', requestId: 'unsupported-1' } })
  })

  it('rejects a host actor whose claimed role does not match Team membership', async () => {
    const value = fixture()
    const api = new DevHostApi({ hierarchies: [value.hierarchy], members: [value.member] })
    const response = await api.handle({
      contractVersion: HOST_CONTRACT_VERSION,
      host,
      invocation: {
        requestId: 'role-spoof-1', operation: 'get-project-hierarchy',
        actor: { teamId: value.hierarchy.team.id, memberId: value.member.memberId, role: 'admin' },
        payload: { projectId: value.hierarchy.project.id },
      },
    })
    expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })
})
