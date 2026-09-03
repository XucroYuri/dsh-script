import type {
  HostRequestEnvelope, HostResponseEnvelope, HostSuccessResult, ScriptStudioHostApiPort,
} from '@script-studio/contracts/host'
import {
  HOST_CONTRACT_VERSION,
  STAGE_2_CAPABILITIES,
} from '@script-studio/contracts/host'
import {
  authorize,
  createSeason,
  DomainError,
  assertProjectHierarchy,
  type ProjectHierarchy,
  type RequestHash,
  type TeamMember,
} from '@script-studio/domain'

interface CompletedRequest {
  requestHash: RequestHash
  result: Extract<HostSuccessResult, { operation: 'create-season' }>
}

export class DevHostApi implements ScriptStudioHostApiPort {
  private readonly hierarchies = new Map<string, ProjectHierarchy>()
  private readonly members = new Map<string, TeamMember>()
  private readonly completed = new Map<string, CompletedRequest>()
  private readonly inProgress = new Set<string>()

  constructor(input: { hierarchies: readonly ProjectHierarchy[]; members: readonly TeamMember[] }) {
    for (const hierarchy of input.hierarchies) {
      assertProjectHierarchy(hierarchy)
      this.hierarchies.set(`${hierarchy.team.id}:${hierarchy.project.id}`, structuredClone(hierarchy))
    }
    for (const member of input.members) this.members.set(`${member.teamId}:${member.memberId}`, structuredClone(member))
  }

  async handle(request: HostRequestEnvelope): Promise<HostResponseEnvelope> {
    const requestId = request.invocation.requestId
    try {
      if (request.contractVersion.split('.')[0] !== HOST_CONTRACT_VERSION.split('.')[0]) {
        throw new DomainError('validation', `Unsupported Host Contract ${request.contractVersion}.`)
      }
      const result = this.execute(request)
      return { requestId, contractVersion: HOST_CONTRACT_VERSION, ok: true, result }
    } catch (cause) {
      const error = cause instanceof DomainError ? cause : new DomainError('invalid-state', cause instanceof Error ? cause.message : String(cause))
      return {
        requestId,
        contractVersion: HOST_CONTRACT_VERSION,
        ok: false,
        error: { code: error.code, message: error.message, requestId, details: error.details },
      }
    }
  }

  private execute(request: HostRequestEnvelope): HostSuccessResult {
    const { invocation } = request
    if (invocation.operation === 'capabilities') {
      return { operation: 'capabilities', capabilities: STAGE_2_CAPABILITIES, host: request.host }
    }

    const member = this.members.get(`${invocation.actor.teamId}:${invocation.actor.memberId}`)
    if (!member || member.status !== 'active' || member.role !== invocation.actor.role) {
      throw new DomainError('forbidden', 'Host actor is not an active Team member.', { permissionReason: 'not-a-member' })
    }
    const key = `${invocation.actor.teamId}:${invocation.payload.projectId}`
    const hierarchy = this.hierarchies.get(key)
    if (!hierarchy) throw new DomainError('not-found', 'Project hierarchy was not found.')

    if (invocation.operation === 'get-project-hierarchy') {
      const decision = authorize(member, hierarchy.team.id, 'read', [hierarchy.team.status, hierarchy.ip.status, hierarchy.project.status])
      if (!decision.allowed) throw new DomainError('forbidden', `Hierarchy read denied: ${decision.reason}.`, { permissionReason: decision.reason })
      return { operation: 'get-project-hierarchy', hierarchy: structuredClone(hierarchy) }
    }

    const decision = authorize(member, hierarchy.team.id, 'write', [hierarchy.team.status, hierarchy.ip.status, hierarchy.project.status])
    if (!decision.allowed) {
      const code = decision.reason === 'archived' ? 'invalid-state' : 'forbidden'
      throw new DomainError(code, `Create Season denied: ${decision.reason}.`, { permissionReason: decision.reason })
    }
    return this.createSeason(hierarchy, invocation.payload)
  }

  private createSeason(
    hierarchy: ProjectHierarchy,
    payload: Extract<HostRequestEnvelope['invocation'], { operation: 'create-season' }>['payload'],
  ): Extract<HostSuccessResult, { operation: 'create-season' }> {
    const scope = `${hierarchy.team.id}:${hierarchy.project.id}:create-season:${payload.idempotencyKey}`
    const replay = this.completed.get(scope)
    if (replay) {
      if (replay.requestHash !== payload.requestHash) throw new DomainError('revision-conflict', 'Idempotency key was already used with another request.')
      return structuredClone(replay.result)
    }
    if (this.inProgress.has(scope)) throw new DomainError('invalid-state', 'Create Season is already in progress.')
    this.inProgress.add(scope)
    try {
      const created = createSeason({
        project: hierarchy.project,
        existingSeasons: hierarchy.seasons,
        existingEpisodes: hierarchy.episodes,
        seasonId: payload.seasonId,
        title: payload.title,
        firstEpisodeId: payload.firstEpisodeId,
        firstEpisodeTitle: payload.firstEpisodeTitle,
        expectedProjectRevision: payload.expectedProjectRevision,
      })
      const updated: ProjectHierarchy = {
        ...hierarchy,
        project: created.project,
        seasons: [...hierarchy.seasons, created.season],
        episodes: [...hierarchy.episodes, created.episode],
      }
      assertProjectHierarchy(updated)
      this.hierarchies.set(`${hierarchy.team.id}:${hierarchy.project.id}`, updated)
      const result = { operation: 'create-season' as const, season: created.season, episode: created.episode, projectRevision: created.project.revision }
      this.completed.set(scope, { requestHash: payload.requestHash, result: structuredClone(result) })
      return result
    } finally {
      this.inProgress.delete(scope)
    }
  }
}
