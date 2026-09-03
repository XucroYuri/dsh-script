import type { AuthoringUnitOfWorkPort, ClockPort, IdGeneratorPort, ScriptStudioEvent, SecurityAuditPort, SubmitEpisodeDraftCommand, SubmitEpisodeDraftResult } from '@script-studio/contracts'
import { assertEpisodeWriteAllowed, attachDraftVersion, createAuditEvent, createManuscriptVersionFromDraft, DomainError, submitDraft } from '@script-studio/domain'
import { auditApplicationFailure } from './failure-audit.js'

export interface SubmitEpisodeDraftDependencies {
  unitOfWork: AuthoringUnitOfWorkPort
  clock: ClockPort
  ids: IdGeneratorPort
  securityAudit: SecurityAuditPort
}

export async function submitEpisodeDraft(dependencies: SubmitEpisodeDraftDependencies, command: SubmitEpisodeDraftCommand): Promise<SubmitEpisodeDraftResult> {
  try {
    return await dependencies.unitOfWork.execute(async transaction => {
      const claim = await transaction.claimIdempotency<SubmitEpisodeDraftResult>({ teamId: command.teamId, operation: 'submit-episode-draft', key: command.idempotencyKey, requestHash: command.requestHash })
      if (claim.status === 'replay') return claim.result

      const [hierarchy, member, draft, contentObject] = await Promise.all([
      transaction.getHierarchy(command.teamId, command.projectId),
      transaction.getMember(command.teamId, command.actorId),
      transaction.getDraft(command.teamId, command.draftId),
      transaction.getContentObject(command.teamId, command.contentObjectId),
      ])
    if (!hierarchy || !draft) throw new DomainError('not-found', 'Project hierarchy or Draft was not found.')
    if (!member) throw new DomainError('forbidden', 'Actor is not an active Team member.', { permissionReason: 'not-a-member' })
    if (draft.teamId !== command.teamId || draft.projectId !== command.projectId || draft.episodeId !== command.episodeId) {
      throw new DomainError('forbidden', 'Draft does not belong to the command scope.', { permissionReason: 'resource-mismatch' })
    }
    assertEpisodeWriteAllowed(hierarchy, member, command.episodeId, command.expectedEpisodeRevision)
    if (!contentObject || contentObject.status !== 'ready' || contentObject.teamId !== command.teamId || contentObject.projectId !== command.projectId || contentObject.contentHash !== command.contentHash) {
      throw new DomainError('forbidden', 'Content object is not ready or does not belong to the command scope.', { permissionReason: 'resource-mismatch' })
    }

    const submitted = submitDraft(draft, command.expectedDraftRevision)
    const occurredAt = dependencies.clock.now()
    const version = createManuscriptVersionFromDraft({
      draft: submitted,
      id: command.versionId,
      contentObjectId: command.contentObjectId,
      contentHash: command.contentHash,
      stateVector: command.stateVector,
      createdBy: command.actorId,
      createdAt: occurredAt,
      idempotencyKey: command.idempotencyKey,
    })
    const episode = hierarchy.episodes.find(candidate => candidate.id === command.episodeId)
    if (!episode) throw new DomainError('not-found', 'Episode was not found.')
    const updatedEpisode = attachDraftVersion(episode, version, command.expectedEpisodeRevision)
    const result = { draft: submitted, version, episode: updatedEpisode }
    const audit = createAuditEvent({
      id: dependencies.ids.auditEventId(), teamId: command.teamId, actorId: command.actorId, action: 'draft.submitted',
      resourceType: 'version', resourceId: version.id, result: 'succeeded', occurredAt, idempotencyKey: command.idempotencyKey,
    })
    const events: ScriptStudioEvent[] = [
      { id: dependencies.ids.eventId(), type: 'draft.submitted', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: submitted.revision, payload: { projectId: command.projectId, episodeId: command.episodeId, draftId: submitted.id, draftRevision: submitted.revision } },
      { id: dependencies.ids.eventId(), type: 'manuscript-version.created', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: command.expectedEpisodeRevision, payload: { projectId: command.projectId, episodeId: command.episodeId, draftId: submitted.id, versionId: version.id, contentHash: version.contentHash } },
      { id: dependencies.ids.eventId(), type: 'audit.appended', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: submitted.revision, payload: { auditEventIds: [audit.id] } },
    ]
    await transaction.saveDraft(submitted)
    await transaction.saveVersion(version)
    await transaction.saveEpisode(updatedEpisode)
    await transaction.appendAuditEvents([audit])
    await transaction.appendEvents(events)
    await transaction.completeIdempotency({ teamId: command.teamId, operation: 'submit-episode-draft', key: command.idempotencyKey, requestHash: command.requestHash, result })
    return result
    })
  } catch (cause) {
    await auditApplicationFailure({ securityAudit: dependencies.securityAudit, clock: dependencies.clock, ids: dependencies.ids, teamId: command.teamId, actorId: command.actorId, resource: { type: 'episode', id: command.episodeId }, operation: 'submit-episode-draft', action: 'write', idempotencyKey: command.idempotencyKey }, cause)
    throw cause
  }
}
