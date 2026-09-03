import { describe, expect, it } from 'vitest'
import type { AuditEvent, CrossIpGrant, IdempotencyKey, Ip, ProjectCanonFact, RequestHash, SelectionSnapshotId, TeamId } from '@script-studio/domain'
import type { GovernanceTransactionPort, GovernanceUnitOfWorkPort, SelectionSnapshotMetadata } from '../src/authoring.js'
import type { ScriptStudioEvent } from '../src/events.js'

export interface GovernanceRepositoryContractHarness {
  transaction: GovernanceTransactionPort
  unitOfWork: GovernanceUnitOfWorkPort
  teamId: TeamId
  otherTeamId: TeamId
  targetIp: Ip
  sourceIp: Ip
  sourceFact: ProjectCanonFact
  snapshot: SelectionSnapshotMetadata
  activeGrant: CrossIpGrant
  revokedGrant: CrossIpGrant
  idempotencyKey: IdempotencyKey
  requestHash: RequestHash
  otherRequestHash: RequestHash
  audit: AuditEvent
  event: ScriptStudioEvent
  inspect(): Promise<{ targetIpRevision: number; activeGrant: CrossIpGrant | null; auditCount: number; eventCount: number }>
}

export function governanceRepositoryContract(name: string, createHarness: () => GovernanceRepositoryContractHarness): void {
  describe(name, () => {
    it('atomically claims, completes and replays an operation while rejecting request-hash reuse', async () => {
      const harness = createHarness()
      const input = { teamId: harness.teamId, operation: 'create-cross-ip-grant' as const, key: harness.idempotencyKey, requestHash: harness.requestHash }
      await expect(harness.transaction.claimIdempotency(input)).resolves.toEqual({ status: 'claimed' })
      await harness.transaction.completeIdempotency({ ...input, result: { value: 1 } })
      await expect(harness.transaction.claimIdempotency(input)).resolves.toEqual({ status: 'replay', result: { value: 1 } })
      await expect(harness.transaction.claimIdempotency({ ...input, requestHash: harness.otherRequestHash })).rejects.toMatchObject({ code: 'revision-conflict' })
    })

    it('releases an idempotency claim and rolls back repository side effects when the UnitOfWork fails', async () => {
      const harness = createHarness()
      const input = { teamId: harness.teamId, operation: 'create-cross-ip-grant' as const, key: harness.idempotencyKey, requestHash: harness.requestHash }
      await expect(harness.unitOfWork.execute(async transaction => {
        await transaction.claimIdempotency(input)
        await transaction.saveIp({ ...harness.targetIp, revision: harness.targetIp.revision + 1 })
        await transaction.saveCrossIpGrant(harness.activeGrant)
        await transaction.appendAuditEvents([harness.audit])
        await transaction.appendEvents([harness.event])
        throw new Error('contract rollback')
      })).rejects.toThrow('contract rollback')
      await expect(harness.unitOfWork.execute(transaction => transaction.claimIdempotency(input))).resolves.toEqual({ status: 'claimed' })
      await expect(harness.inspect()).resolves.toEqual({ targetIpRevision: harness.targetIp.revision, activeGrant: harness.activeGrant, auditCount: 0, eventCount: 0 })
    })

    it('enforces Team scope for IP, Canon, Snapshot and Grant reads', async () => {
      const harness = createHarness()
      await expect(harness.transaction.getIp(harness.otherTeamId, harness.targetIp.id)).resolves.toBeNull()
      await expect(harness.transaction.getProjectCanonFact(harness.otherTeamId, harness.sourceFact.id)).resolves.toBeNull()
      await expect(harness.transaction.getSelectionSnapshot(harness.otherTeamId, harness.snapshot.id)).resolves.toBeNull()
      await expect(harness.transaction.getCrossIpGrant(harness.otherTeamId, harness.activeGrant.id)).resolves.toBeNull()
    })

    it('returns an immutable frozen Selection Snapshot with stable scopes', async () => {
      const harness = createHarness()
      const snapshot = await harness.transaction.getSelectionSnapshot(harness.teamId, harness.snapshot.id)
      expect(snapshot).toEqual(harness.snapshot)
      expect(snapshot?.frozen).toBe(true)
      expect(snapshot?.scopes).toEqual(harness.snapshot.scopes)
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot?.scopes)).toBe(true)
    })

    it('finds only the active Grant for an exact source, target and Snapshot tuple', async () => {
      const harness = createHarness()
      const input = { teamId: harness.teamId, sourceIpId: harness.sourceIp.id, targetIpId: harness.targetIp.id, selectionSnapshotId: harness.snapshot.id as SelectionSnapshotId }
      await expect(harness.transaction.findActiveGrant(input)).resolves.toEqual(harness.activeGrant)
      const revokedOnly = createHarness()
      await revokedOnly.transaction.saveCrossIpGrant({ ...revokedOnly.activeGrant, status: 'revoked', revokedBy: revokedOnly.revokedGrant.revokedBy, revokedAt: revokedOnly.revokedGrant.revokedAt })
      await expect(revokedOnly.transaction.findActiveGrant(input)).resolves.toBeNull()
    })
  })
}
