import { describe, expect, it } from 'vitest'
import type { AccessTokenVerifierPort, CloudHierarchyRepositoryPort, VerifiedCloudSession } from '@script-studio/contracts'
import { asMemberId, asProjectId, asTeamId, type ProjectHierarchy } from '@script-studio/domain'
import { ScriptStudioApi } from '../src/index.js'

const teamId = asTeamId('team-verified')
const otherTeamId = asTeamId('team-other')
const projectId = asProjectId('project-1')
const session: VerifiedCloudSession = { subject: 'oidc|writer', teamId, memberId: asMemberId('member-writer') }
const hierarchy = {
  team: { id: teamId, name: 'Verified Team', status: 'active', revision: 1 },
  ip: { id: 'ip-1', teamId, name: 'IP', status: 'active', revision: 1 },
  project: { id: projectId, teamId, ipId: 'ip-1', title: 'Project', medium: 'episodic', status: 'active', revision: 1 },
  seasons: [], episodes: [], sequences: [], scenes: [], beats: [],
} as unknown as ProjectHierarchy

class TestSessions implements AccessTokenVerifierPort {
  seen: string[] = []
  async verify(token: string): Promise<VerifiedCloudSession | null> { this.seen.push(token); return token === 'valid-token' ? session : null }
}

class TestHierarchy implements CloudHierarchyRepositoryPort {
  seen: Array<{ teamId: string; memberId: string; projectId: string }> = []
  async getProjectHierarchy(requestSession: VerifiedCloudSession, requestProjectId: typeof projectId): Promise<ProjectHierarchy | null> {
    this.seen.push({ teamId: requestSession.teamId, memberId: requestSession.memberId, projectId: requestProjectId })
    return requestSession.teamId === teamId && requestSession.memberId === session.memberId && requestProjectId === projectId ? hierarchy : null
  }
}

function request(headers: Record<string, string | undefined> = {}) {
  return { method: 'GET', path: `/api/script-studio/v1/projects/${projectId}/hierarchy`, headers, requestId: 'api-test-1' }
}

describe('authenticated Script Studio API boundary', () => {
  it('rejects missing or invalid bearer sessions without querying the repository', async () => {
    const sessions = new TestSessions()
    const repository = new TestHierarchy()
    const api = new ScriptStudioApi(sessions, repository)
    await expect(api.handle(request())).resolves.toMatchObject({ status: 401, body: { error: { code: 'forbidden' } } })
    await expect(api.handle(request({ authorization: 'Bearer invalid-token' }))).resolves.toMatchObject({ status: 401 })
    expect(repository.seen).toHaveLength(0)
    expect(sessions.seen).toEqual(['invalid-token'])
  })

  it('uses the verified Team scope even when Client sends a conflicting header', async () => {
    const sessions = new TestSessions()
    const repository = new TestHierarchy()
    const api = new ScriptStudioApi(sessions, repository)
    const response = await api.handle(request({ authorization: 'Bearer valid-token', 'x-team-id': otherTeamId }))
    expect(response).toMatchObject({ status: 200, body: { ok: true, result: { project: { id: projectId, teamId } } } })
    expect(repository.seen).toEqual([{ teamId, memberId: session.memberId, projectId }])
    expect(JSON.stringify(response)).not.toContain('valid-token')
  })

  it('maps an unknown project to a stable not-found error', async () => {
    const sessions = new TestSessions()
    const repository = new TestHierarchy()
    const api = new ScriptStudioApi(sessions, repository)
    const response = await api.handle({ ...request({ authorization: 'Bearer valid-token' }), path: '/api/script-studio/v1/projects/project-missing/hierarchy' })
    expect(response).toMatchObject({ status: 404, body: { ok: false, error: { code: 'not-found' } } })
  })

  it('does not accept another HTTP method as the hierarchy route', async () => {
    const api = new ScriptStudioApi(new TestSessions(), new TestHierarchy())
    await expect(api.handle({ ...request({ authorization: 'Bearer valid-token' }), method: 'POST' })).resolves.toMatchObject({ status: 404 })
  })
})
