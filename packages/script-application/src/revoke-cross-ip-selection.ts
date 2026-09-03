import type { CrossIpGrantResult, RevokeCrossIpGrantCommand, ScriptStudioEvent } from '@script-studio/contracts/governance'
import { assertIpActionAllowed, createAuditEvent, DomainError, revokeCrossIpGrant } from '@script-studio/domain/governance'
import { governanceContext, governanceFailure, type IpGovernanceDependencies } from './ip-governance-common.js'

export async function revokeCrossIpSelection(dependencies: IpGovernanceDependencies, command: RevokeCrossIpGrantCommand): Promise<CrossIpGrantResult> {
  try {
    return await dependencies.unitOfWork.execute(async transaction => {
      const claim = await transaction.claimIdempotency<CrossIpGrantResult>({ teamId: command.teamId, operation: 'revoke-cross-ip-grant', key: command.idempotencyKey, requestHash: command.requestHash })
      if (claim.status === 'replay') return claim.result
      const [{ member, targetIp }, grant] = await Promise.all([
        governanceContext(transaction, command.teamId, command.actorId, command.targetIpId),
        transaction.getCrossIpGrant(command.teamId, command.grantId),
      ])
      if (!grant) throw new DomainError('not-found', 'Cross-IP Grant was not found.')
      assertIpActionAllowed(targetIp, member, 'manage-ip-grants', command.expectedTargetIpRevision)
      if (grant.teamId !== command.teamId || grant.targetIpId !== targetIp.id) throw new DomainError('forbidden', 'Grant does not belong to the target IP and Team.', { permissionReason: 'resource-mismatch' })
      const occurredAt = dependencies.clock.now()
      const revoked = revokeCrossIpGrant(grant, command.actorId, occurredAt)
      const updatedIp = { ...targetIp, revision: targetIp.revision + 1 }
      const result = { grant: revoked, targetIpRevision: updatedIp.revision }
      const audit = createAuditEvent({ id: dependencies.ids.auditEventId(), teamId: command.teamId, actorId: command.actorId, action: 'ip-grant.revoked', resourceType: 'grant', resourceId: grant.id, result: 'succeeded', occurredAt, idempotencyKey: command.idempotencyKey })
      const events: ScriptStudioEvent[] = [
        { id: dependencies.ids.eventId(), type: 'ip-grant.revoked', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: updatedIp.revision, payload: { grantId: revoked.id, sourceIpId: revoked.sourceIpId, targetIpId: revoked.targetIpId, selectionSnapshotId: revoked.selectionSnapshotId } },
        { id: dependencies.ids.eventId(), type: 'audit.appended', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: updatedIp.revision, payload: { auditEventIds: [audit.id] } },
      ]
      await transaction.saveIp(updatedIp)
      await transaction.saveCrossIpGrant(revoked)
      await transaction.appendAuditEvents([audit])
      await transaction.appendEvents(events)
      await transaction.completeIdempotency({ teamId: command.teamId, operation: 'revoke-cross-ip-grant', key: command.idempotencyKey, requestHash: command.requestHash, result })
      return result
    })
  } catch (cause) {
    await governanceFailure(dependencies, command, 'revoke-cross-ip-grant', 'manage-ip-grants', cause)
    throw cause
  }
}
