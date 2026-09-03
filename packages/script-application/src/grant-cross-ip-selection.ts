import type { CreateCrossIpGrantCommand, CrossIpGrantResult, ScriptStudioEvent } from '@script-studio/contracts/governance'
import { assertIpActionAllowed, createAuditEvent, createCrossIpGrant, DomainError } from '@script-studio/domain/governance'
import { governanceContext, governanceFailure, type IpGovernanceDependencies } from './ip-governance-common.js'

export async function grantCrossIpSelection(dependencies: IpGovernanceDependencies, command: CreateCrossIpGrantCommand): Promise<CrossIpGrantResult> {
  try {
    return await dependencies.unitOfWork.execute(async transaction => {
      const claim = await transaction.claimIdempotency<CrossIpGrantResult>({ teamId: command.teamId, operation: 'create-cross-ip-grant', key: command.idempotencyKey, requestHash: command.requestHash })
      if (claim.status === 'replay') return claim.result
      const [{ member, targetIp }, sourceIp, snapshot, activeGrant] = await Promise.all([
        governanceContext(transaction, command.teamId, command.actorId, command.targetIpId),
        transaction.getIp(command.teamId, command.sourceIpId),
        transaction.getSelectionSnapshot(command.teamId, command.selectionSnapshotId),
        transaction.findActiveGrant({ teamId: command.teamId, sourceIpId: command.sourceIpId, targetIpId: command.targetIpId, selectionSnapshotId: command.selectionSnapshotId }),
      ])
      if (!sourceIp || !snapshot) throw new DomainError('not-found', 'Source IP or Selection Snapshot was not found.')
      assertIpActionAllowed(targetIp, member, 'manage-ip-grants', command.expectedTargetIpRevision)
      if (!snapshot.frozen || snapshot.teamId !== command.teamId || snapshot.sourceIpId !== sourceIp.id || snapshot.targetIpId !== targetIp.id) throw new DomainError('forbidden', 'Selection Snapshot is not frozen or does not match the Grant scope.', { permissionReason: 'resource-mismatch' })
      if (command.scopes.some(scope => !snapshot.scopes.includes(scope))) throw new DomainError('forbidden', 'Grant scopes exceed the frozen Selection Snapshot.', { permissionReason: 'resource-mismatch' })
      if (activeGrant) throw new DomainError('invalid-state', 'An active Grant already exists for this Selection Snapshot.')
      const occurredAt = dependencies.clock.now()
      const grant = createCrossIpGrant({ id: command.grantId, teamId: command.teamId, sourceIp, targetIp, selectionSnapshotId: snapshot.id, scopes: command.scopes, createdBy: command.actorId, createdAt: occurredAt, idempotencyKey: command.idempotencyKey })
      const updatedIp = { ...targetIp, revision: targetIp.revision + 1 }
      const result = { grant, targetIpRevision: updatedIp.revision }
      const audit = createAuditEvent({ id: dependencies.ids.auditEventId(), teamId: command.teamId, actorId: command.actorId, action: 'ip-grant.created', resourceType: 'grant', resourceId: grant.id, result: 'succeeded', occurredAt, idempotencyKey: command.idempotencyKey })
      const events: ScriptStudioEvent[] = [
        { id: dependencies.ids.eventId(), type: 'ip-grant.created', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: updatedIp.revision, payload: { grantId: grant.id, sourceIpId: grant.sourceIpId, targetIpId: grant.targetIpId, selectionSnapshotId: grant.selectionSnapshotId, scopes: grant.scopes } },
        { id: dependencies.ids.eventId(), type: 'audit.appended', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: updatedIp.revision, payload: { auditEventIds: [audit.id] } },
      ]
      await transaction.saveIp(updatedIp)
      await transaction.saveCrossIpGrant(grant)
      await transaction.appendAuditEvents([audit])
      await transaction.appendEvents(events)
      await transaction.completeIdempotency({ teamId: command.teamId, operation: 'create-cross-ip-grant', key: command.idempotencyKey, requestHash: command.requestHash, result })
      return result
    })
  } catch (cause) {
    await governanceFailure(dependencies, command, 'create-cross-ip-grant', 'manage-ip-grants', cause)
    throw cause
  }
}
