import { governanceRepositoryContract } from '@script-studio/contracts/testing/governance-repository-contract'
import {
  asAuditEventId,
  asCrossIpGrantId,
  asIdempotencyKey,
  asIpId,
  asMemberId,
  asProjectCanonFactId,
  asRequestHash,
  asSelectionSnapshotId,
  asTeamId,
  asVersionId,
  createCrossIpGrant,
  createAuditEvent,
  revokeCrossIpGrant,
  type ProjectCanonFact,
} from '@script-studio/domain'
import { MemoryGovernanceUnitOfWork, MemoryTransaction } from './support.js'

governanceRepositoryContract('Memory Governance Repository contract', () => {
  const transaction = new MemoryTransaction()
  const teamId = transaction.hierarchy.team.id
  const otherTeamId = asTeamId('team-other')
  const targetIp = transaction.hierarchy.ip
  const sourceIp = { ...targetIp, id: asIpId('ip-source') }
  transaction.ips.set(sourceIp.id, sourceIp)
  const sourceFact: ProjectCanonFact = Object.freeze({
    id: asProjectCanonFactId('fact-contract'), teamId, ipId: targetIp.id, projectId: transaction.hierarchy.project.id,
    sourceEpisodeId: transaction.hierarchy.episodes[0]!.id, sourceVersionId: asVersionId('version-contract'), sourceContentHash: 'a'.repeat(64),
    subject: '主角', predicate: '抵达', value: '雾港', evidence: '证据', status: 'active', createdAt: 'now',
  })
  transaction.canonFacts.push(sourceFact)
  const snapshot = Object.freeze({
    id: asSelectionSnapshotId('snapshot-contract'), teamId, sourceIpId: sourceIp.id, targetIpId: targetIp.id,
    scopes: Object.freeze(['ip-bible'] as const), frozen: true,
  })
  transaction.selectionSnapshots.set(snapshot.id, snapshot)
  const activeGrant = createCrossIpGrant({
    id: asCrossIpGrantId('grant-active'), teamId, sourceIp, targetIp, selectionSnapshotId: snapshot.id, scopes: snapshot.scopes,
    createdBy: asMemberId('member-admin'), createdAt: 'now', idempotencyKey: asIdempotencyKey('seed-active'),
  })
  const revokedGrant = revokeCrossIpGrant(createCrossIpGrant({
    id: asCrossIpGrantId('grant-revoked'), teamId, sourceIp, targetIp, selectionSnapshotId: snapshot.id, scopes: snapshot.scopes,
    createdBy: asMemberId('member-admin'), createdAt: 'now', idempotencyKey: asIdempotencyKey('seed-revoked'),
  }), asMemberId('member-admin'), 'later')
  transaction.grants.set(activeGrant.id, activeGrant)
  transaction.grants.set(revokedGrant.id, revokedGrant)
  const unitOfWork = new MemoryGovernanceUnitOfWork(transaction)
  const audit = createAuditEvent({
    id: asAuditEventId('audit-contract'), teamId, actorId: asMemberId('member-admin'), action: 'ip-grant.created',
    resourceType: 'grant', resourceId: activeGrant.id, result: 'succeeded', occurredAt: 'now', idempotencyKey: asIdempotencyKey('audit-contract'),
  })
  const event = {
    id: 'event-contract', type: 'ip-grant.created' as const, teamId, actorId: asMemberId('member-admin'), occurredAt: 'now', aggregateRevision: 1,
    payload: { grantId: activeGrant.id, sourceIpId: sourceIp.id, targetIpId: targetIp.id, selectionSnapshotId: snapshot.id, scopes: snapshot.scopes },
  }
  return {
    transaction, unitOfWork, teamId, otherTeamId, targetIp, sourceIp, sourceFact, snapshot, activeGrant, revokedGrant, audit, event,
    idempotencyKey: asIdempotencyKey('contract-key'), requestHash: asRequestHash('contract-request'), otherRequestHash: asRequestHash('contract-request-other'),
    async inspect() {
      return {
        targetIpRevision: transaction.ips.get(targetIp.id)!.revision,
        activeGrant: await transaction.findActiveGrant({ teamId, sourceIpId: sourceIp.id, targetIpId: targetIp.id, selectionSnapshotId: snapshot.id }),
        auditCount: transaction.audits.length,
        eventCount: transaction.events.length,
      }
    },
  }
})
