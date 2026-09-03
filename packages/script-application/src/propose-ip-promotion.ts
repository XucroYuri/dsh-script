import type { ProposeIpPromotionCommand, ProposeIpPromotionResult, ScriptStudioEvent } from '@script-studio/contracts/governance'
import { assertIpActionAllowed, createAuditEvent, DomainError, proposeIpPromotion } from '@script-studio/domain/governance'
import { governanceContext, governanceFailure, type IpGovernanceDependencies } from './ip-governance-common.js'

export async function proposeProjectCanonToIp(dependencies: IpGovernanceDependencies, command: ProposeIpPromotionCommand): Promise<ProposeIpPromotionResult> {
  try {
    return await dependencies.unitOfWork.execute(async transaction => {
      const claim = await transaction.claimIdempotency<ProposeIpPromotionResult>({ teamId: command.teamId, operation: 'propose-ip-promotion', key: command.idempotencyKey, requestHash: command.requestHash })
      if (claim.status === 'replay') return claim.result
      const [{ member, targetIp }, sourceFact] = await Promise.all([
        governanceContext(transaction, command.teamId, command.actorId, command.targetIpId),
        transaction.getProjectCanonFact(command.teamId, command.sourceCanonFactId),
      ])
      if (!sourceFact) throw new DomainError('not-found', 'Project Canon Fact was not found.')
      assertIpActionAllowed(targetIp, member, 'promote-ip-canon', command.expectedIpRevision)
      const occurredAt = dependencies.clock.now()
      const promotion = proposeIpPromotion({
        id: command.promotionId, targetIp, sourceFact, conflictResolution: command.conflictResolution, impactNote: command.impactNote,
        actorId: command.actorId, proposedAt: occurredAt, idempotencyKey: command.idempotencyKey,
      })
      const audit = createAuditEvent({ id: dependencies.ids.auditEventId(), teamId: command.teamId, actorId: command.actorId, action: 'ip-promotion.proposed', resourceType: 'canon', resourceId: sourceFact.id, result: 'succeeded', occurredAt, idempotencyKey: command.idempotencyKey })
      const events: ScriptStudioEvent[] = [
        { id: dependencies.ids.eventId(), type: 'ip-promotion.proposed', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: targetIp.revision, payload: { promotionId: promotion.id, ipId: targetIp.id, sourceCanonFactId: sourceFact.id } },
        { id: dependencies.ids.eventId(), type: 'audit.appended', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: targetIp.revision, payload: { auditEventIds: [audit.id] } },
      ]
      const result = { promotion }
      await transaction.saveIpPromotion(promotion)
      await transaction.appendAuditEvents([audit])
      await transaction.appendEvents(events)
      await transaction.completeIdempotency({ teamId: command.teamId, operation: 'propose-ip-promotion', key: command.idempotencyKey, requestHash: command.requestHash, result })
      return result
    })
  } catch (cause) {
    await governanceFailure(dependencies, command, 'propose-ip-promotion', 'promote-ip-canon', cause)
    throw cause
  }
}
