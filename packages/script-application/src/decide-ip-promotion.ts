import type { DecideIpPromotionCommand, DecideIpPromotionResult, ScriptStudioEvent } from '@script-studio/contracts/governance'
import { assertIpActionAllowed, createAuditEvent, decideIpPromotion, DomainError } from '@script-studio/domain/governance'
import { governanceContext, governanceFailure, type IpGovernanceDependencies } from './ip-governance-common.js'

export async function decideProjectCanonPromotion(dependencies: IpGovernanceDependencies, command: DecideIpPromotionCommand): Promise<DecideIpPromotionResult> {
  try {
    return await dependencies.unitOfWork.execute(async transaction => {
      const claim = await transaction.claimIdempotency<DecideIpPromotionResult>({ teamId: command.teamId, operation: 'decide-ip-promotion', key: command.idempotencyKey, requestHash: command.requestHash })
      if (claim.status === 'replay') return claim.result
      const [{ member, targetIp }, promotion] = await Promise.all([
        governanceContext(transaction, command.teamId, command.actorId, command.targetIpId),
        transaction.getIpPromotion(command.teamId, command.promotionId),
      ])
      if (!promotion) throw new DomainError('not-found', 'IP Promotion was not found.')
      const sourceFact = await transaction.getProjectCanonFact(command.teamId, promotion.sourceCanonFactId)
      if (!sourceFact) throw new DomainError('not-found', 'Promotion source Canon Fact was not found.')
      assertIpActionAllowed(targetIp, member, 'approve-ip-promotion', command.expectedIpRevision)
      const occurredAt = dependencies.clock.now()
      const decided = decideIpPromotion({
        promotion, targetIp, sourceFact, decision: command.decision, actorId: command.actorId, decidedAt: occurredAt,
        expectedIpRevision: command.expectedIpRevision, bibleEntryId: command.bibleEntryId, bibleKey: command.bibleKey, bibleValue: command.bibleValue,
      })
      const updatedIp = { ...targetIp, revision: decided.ipRevision }
      const audit = createAuditEvent({ id: dependencies.ids.auditEventId(), teamId: command.teamId, actorId: command.actorId, action: `ip-promotion.${command.decision}`, resourceType: 'ip', resourceId: targetIp.id, result: 'succeeded', occurredAt, idempotencyKey: command.idempotencyKey })
      const events: ScriptStudioEvent[] = [
        { id: dependencies.ids.eventId(), type: 'ip-promotion.decided', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: updatedIp.revision, payload: { promotionId: decided.promotion.id, ipId: targetIp.id, decision: command.decision, bibleEntryId: decided.bibleEntry?.id ?? null } },
        { id: dependencies.ids.eventId(), type: 'audit.appended', teamId: command.teamId, actorId: command.actorId, occurredAt, aggregateRevision: updatedIp.revision, payload: { auditEventIds: [audit.id] } },
      ]
      await transaction.saveIp(updatedIp)
      await transaction.saveIpPromotion(decided.promotion)
      if (decided.bibleEntry) await transaction.saveIpBibleEntry(decided.bibleEntry)
      await transaction.appendAuditEvents([audit])
      await transaction.appendEvents(events)
      await transaction.completeIdempotency({ teamId: command.teamId, operation: 'decide-ip-promotion', key: command.idempotencyKey, requestHash: command.requestHash, result: decided })
      return decided
    })
  } catch (cause) {
    await governanceFailure(dependencies, command, 'decide-ip-promotion', 'approve-ip-promotion', cause)
    throw cause
  }
}
