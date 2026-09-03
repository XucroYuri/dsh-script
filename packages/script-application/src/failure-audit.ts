import type { ApplicationOperation, ClockPort, IdGeneratorPort, ResourceReference, SecurityAuditPort, ScriptStudioEvent } from '@script-studio/contracts'
import { createAuditEvent, DomainError, type IdempotencyKey, type MemberId, type PermissionAction, type TeamId } from '@script-studio/domain'

export interface FailureAuditContext {
  securityAudit: SecurityAuditPort
  clock: ClockPort
  ids: IdGeneratorPort
  teamId: TeamId
  actorId: MemberId
  resource: ResourceReference
  operation: ApplicationOperation
  action: PermissionAction
  idempotencyKey: IdempotencyKey
}

export async function auditApplicationFailure(context: FailureAuditContext, cause: unknown): Promise<void> {
  if (!(cause instanceof DomainError)) return
  const occurredAt = context.clock.now()
  const resource = context.resource
  const result = cause.code === 'forbidden' ? 'denied' : cause.code === 'revision-conflict' ? 'conflict' : 'failed'
  const audit = createAuditEvent({
    id: context.ids.auditEventId(), teamId: context.teamId, actorId: context.actorId, action: `${context.operation}.${result}`,
    resourceType: resource.type, resourceId: resource.id, result, occurredAt, idempotencyKey: context.idempotencyKey,
  })
  let event: ScriptStudioEvent
  if (cause.code === 'forbidden') {
    const detail = cause.details?.permissionReason
    const reason = typeof detail === 'string' && ['not-a-member', 'member-suspended', 'role-denied', 'resource-mismatch'].includes(detail)
      ? detail as 'not-a-member' | 'member-suspended' | 'role-denied' | 'resource-mismatch'
      : 'resource-mismatch'
    event = { id: context.ids.eventId(), type: 'permission.denied', teamId: context.teamId, actorId: context.actorId, occurredAt, aggregateRevision: 0, payload: { action: context.action, resource, reason } }
  } else if (cause.code === 'revision-conflict') {
    event = { id: context.ids.eventId(), type: 'operation.conflict', teamId: context.teamId, actorId: context.actorId, occurredAt, aggregateRevision: 0, payload: { operation: context.operation, resource, reason: 'revision-conflict' } }
  } else {
    event = { id: context.ids.eventId(), type: 'operation.failed', teamId: context.teamId, actorId: context.actorId, occurredAt, aggregateRevision: 0, payload: { operation: context.operation, resource, errorCode: cause.code } }
  }
  await context.securityAudit.recordFailure(audit, event)
}
