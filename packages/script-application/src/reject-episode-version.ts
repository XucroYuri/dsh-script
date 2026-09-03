import type { AuthoringUnitOfWorkPort, ClockPort, IdGeneratorPort, RejectEpisodeVersionCommand, RejectEpisodeVersionResult, ScriptStudioEvent, SecurityAuditPort } from '@script-studio/contracts'
import { assertEpisodeActionAllowed, createAuditEvent, DomainError, rejectManuscriptVersion } from '@script-studio/domain'
import { auditApplicationFailure } from './failure-audit.js'

export interface RejectEpisodeVersionDependencies {
  unitOfWork: AuthoringUnitOfWorkPort
  clock: ClockPort
  ids: IdGeneratorPort
  securityAudit: SecurityAuditPort
}

export async function rejectEpisodeVersion(dependencies: RejectEpisodeVersionDependencies, command: RejectEpisodeVersionCommand): Promise<RejectEpisodeVersionResult> {
  try {
    return await dependencies.unitOfWork.execute(async transaction => {
      const claim = await transaction.claimIdempotency<RejectEpisodeVersionResult>({ teamId: command.teamId, operation: 'reject-episode-version', key: command.idempotencyKey, requestHash: command.requestHash })
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
      const rejected = rejectManuscriptVersion({
        episode, version, approvalId: command.approvalId, actorId: command.actorId, decisionNote: command.decisionNote,
        decidedAt: occurredAt, expectedEpisodeRevision: command.expectedEpisodeRevision, idempotencyKey: command.idempotencyKey,
      })
      const audit = createAuditEvent({
        id: dependencies.ids.auditEventId(), teamId: command.teamId, actorId: command.actorId, action: 'version.rejected',
        resourceType: 'approval', resourceId: rejected.approval.id, result: 'succeeded', occurredAt, idempotencyKey: command.idempotencyKey,
      })
      const events: ScriptStudioEvent[] = [
        { id: dependencies.ids.eventId(), type: 'manuscript-version.rejected', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: rejected.episode.revision, payload: { projectId: command.projectId, episodeId: command.episodeId, versionId: version.id, approvalId: rejected.approval.id, decisionNote: rejected.approval.decisionNote } },
        { id: dependencies.ids.eventId(), type: 'audit.appended', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: rejected.episode.revision, payload: { auditEventIds: [audit.id] } },
      ]
      await transaction.saveEpisode(rejected.episode)
      await transaction.saveApproval(rejected.approval)
      await transaction.appendAuditEvents([audit])
      await transaction.appendEvents(events)
      await transaction.completeIdempotency({ teamId: command.teamId, operation: 'reject-episode-version', key: command.idempotencyKey, requestHash: command.requestHash, result: rejected })
      return rejected
    })
  } catch (cause) {
    await auditApplicationFailure({ securityAudit: dependencies.securityAudit, clock: dependencies.clock, ids: dependencies.ids, teamId: command.teamId, actorId: command.actorId, resource: { type: 'episode', id: command.episodeId }, operation: 'reject-episode-version', action: 'approve', idempotencyKey: command.idempotencyKey }, cause)
    throw cause
  }
}
