import type { ClockPort, GovernanceTransactionPort, GovernanceUnitOfWorkPort, IdGeneratorPort, SecurityAuditPort } from '@script-studio/contracts/governance'
import { DomainError, type IdempotencyKey, type IpId, type MemberId, type TeamId } from '@script-studio/domain/governance'
import { auditApplicationFailure } from './failure-audit.js'

export interface IpGovernanceDependencies {
  unitOfWork: GovernanceUnitOfWorkPort
  clock: ClockPort
  ids: IdGeneratorPort
  securityAudit: SecurityAuditPort
}

export async function governanceFailure(
  dependencies: IpGovernanceDependencies,
  command: { teamId: TeamId; actorId: MemberId; targetIpId: IpId; idempotencyKey: IdempotencyKey },
  operation: 'propose-ip-promotion' | 'decide-ip-promotion' | 'create-cross-ip-grant' | 'revoke-cross-ip-grant',
  action: 'promote-ip-canon' | 'approve-ip-promotion' | 'manage-ip-grants',
  cause: unknown,
): Promise<void> {
  await auditApplicationFailure({
    securityAudit: dependencies.securityAudit,
    clock: dependencies.clock,
    ids: dependencies.ids,
    teamId: command.teamId,
    actorId: command.actorId,
    resource: { type: 'ip', id: command.targetIpId },
    operation,
    action,
    idempotencyKey: command.idempotencyKey,
  }, cause)
}

export async function governanceContext(transaction: GovernanceTransactionPort, teamId: TeamId, actorId: MemberId, targetIpId: IpId) {
  const [member, targetIp] = await Promise.all([transaction.getMember(teamId, actorId), transaction.getIp(teamId, targetIpId)])
  if (!member) throw new DomainError('forbidden', 'Actor is not an active Team member.', { permissionReason: 'not-a-member' })
  if (!targetIp) throw new DomainError('not-found', 'Target IP was not found.')
  return { member, targetIp }
}
