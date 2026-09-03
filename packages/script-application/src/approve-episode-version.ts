import type { ApproveEpisodeVersionCommand, ApproveEpisodeVersionResult, AuthoringUnitOfWorkPort, ClockPort, IdGeneratorPort, ScriptStudioEvent, SecurityAuditPort } from '@script-studio/contracts'
import { approveManuscriptVersion, assertEpisodeActionAllowed, createAuditEvent, createProjectCanonFact, DomainError } from '@script-studio/domain'
import { auditApplicationFailure } from './failure-audit.js'

export interface ApproveEpisodeVersionDependencies {
  unitOfWork: AuthoringUnitOfWorkPort
  clock: ClockPort
  ids: IdGeneratorPort
  securityAudit: SecurityAuditPort
}

export async function approveEpisodeVersion(dependencies: ApproveEpisodeVersionDependencies, command: ApproveEpisodeVersionCommand): Promise<ApproveEpisodeVersionResult> {
  try {
    return await dependencies.unitOfWork.execute(async transaction => {
      const claim = await transaction.claimIdempotency<ApproveEpisodeVersionResult>({ teamId: command.teamId, operation: 'approve-episode-version', key: command.idempotencyKey, requestHash: command.requestHash })
      if (claim.status === 'replay') return claim.result

    const [hierarchy, member, version] = await Promise.all([
      transaction.getHierarchy(command.teamId, command.projectId),
      transaction.getMember(command.teamId, command.actorId),
      transaction.getVersion(command.teamId, command.versionId),
    ])
    if (!hierarchy || !version) throw new DomainError('not-found', 'Project hierarchy or Version was not found.')
    if (!member) throw new DomainError('forbidden', 'Actor is not an active Team member.', { permissionReason: 'not-a-member' })
    if (version.teamId !== command.teamId || version.projectId !== command.projectId || version.episodeId !== command.episodeId) {
      throw new DomainError('forbidden', 'Version does not belong to the command scope.', { permissionReason: 'resource-mismatch' })
    }
    assertEpisodeActionAllowed(hierarchy, member, 'approve', command.episodeId, command.expectedEpisodeRevision)
    const episode = hierarchy.episodes.find(candidate => candidate.id === command.episodeId)
    if (!episode) throw new DomainError('not-found', 'Episode was not found.')

    const occurredAt = dependencies.clock.now()
    const approved = approveManuscriptVersion({
      episode,
      version,
      approvalId: command.approvalId,
      actorId: command.actorId,
      decidedAt: occurredAt,
      expectedEpisodeRevision: command.expectedEpisodeRevision,
      idempotencyKey: command.idempotencyKey,
    })
    const facts = command.canonFacts.map(fact => createProjectCanonFact({
      ...fact,
      approval: approved.approval,
      version,
      ipId: hierarchy.ip.id,
      createdAt: occurredAt,
    }))
    const result = { episode: approved.episode, approval: approved.approval, canonFacts: facts }
    const audit = createAuditEvent({
      id: dependencies.ids.auditEventId(), teamId: command.teamId, actorId: command.actorId, action: 'version.approved',
      resourceType: 'approval', resourceId: approved.approval.id, result: 'succeeded', occurredAt, idempotencyKey: command.idempotencyKey,
    })
    const events: ScriptStudioEvent[] = [
      { id: dependencies.ids.eventId(), type: 'manuscript-version.approved', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: approved.episode.revision, payload: { projectId: command.projectId, episodeId: command.episodeId, versionId: version.id, approvalId: approved.approval.id } },
      ...(facts.length === 0 ? [] : [{ id: dependencies.ids.eventId(), type: 'project-canon.committed' as const, teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: approved.episode.revision, payload: { projectId: command.projectId, episodeId: command.episodeId, versionId: version.id, factIds: facts.map(fact => fact.id) } }]),
      { id: dependencies.ids.eventId(), type: 'audit.appended', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: approved.episode.revision, payload: { auditEventIds: [audit.id] } },
    ]
    await transaction.saveEpisode(approved.episode)
    await transaction.saveApproval(approved.approval)
    await transaction.saveProjectCanonFacts(facts)
    await transaction.appendAuditEvents([audit])
    await transaction.appendEvents(events)
    await transaction.completeIdempotency({ teamId: command.teamId, operation: 'approve-episode-version', key: command.idempotencyKey, requestHash: command.requestHash, result })
    return result
    })
  } catch (cause) {
    await auditApplicationFailure({ securityAudit: dependencies.securityAudit, clock: dependencies.clock, ids: dependencies.ids, teamId: command.teamId, actorId: command.actorId, resource: { type: 'episode', id: command.episodeId }, operation: 'approve-episode-version', action: 'approve', idempotencyKey: command.idempotencyKey }, cause)
    throw cause
  }
}
