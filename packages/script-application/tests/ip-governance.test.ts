import { describe, expect, it } from 'vitest'
import {
  asCrossIpGrantId,
  asIdempotencyKey,
  asIpBibleEntryId,
  asIpId,
  asIpPromotionId,
  asProjectCanonFactId,
  asRequestHash,
  asSelectionSnapshotId,
  asTeamId,
  type ProjectCanonFact,
} from '@script-studio/domain'
import { decideProjectCanonPromotion, grantCrossIpSelection, proposeProjectCanonToIp, revokeCrossIpSelection } from '../src/index.js'
import { DeterministicIds, MemoryGovernanceUnitOfWork, MemorySecurityAudit, teamMember } from './support.js'

const clock = { now: () => '2026-09-03T00:00:00.000Z' }

function dependencies(unitOfWork: MemoryGovernanceUnitOfWork, ids = new DeterministicIds()) {
  return { unitOfWork, clock, ids, securityAudit: new MemorySecurityAudit(unitOfWork.transaction) }
}

function seedCanon(unitOfWork: MemoryGovernanceUnitOfWork): ProjectCanonFact {
  const value = unitOfWork.transaction.hierarchy
  const fact: ProjectCanonFact = Object.freeze({
    id: asProjectCanonFactId('fact-1'), teamId: value.team.id, ipId: value.ip.id, projectId: value.project.id,
    sourceEpisodeId: value.episodes[0]!.id, sourceVersionId: value.episodes[0]!.currentApprovedVersionId ?? (('version-1') as ProjectCanonFact['sourceVersionId']),
    sourceContentHash: 'a'.repeat(64), subject: '主角', predicate: '抵达', value: '雾港', evidence: '主角抵达雾港。', status: 'active', createdAt: 'now',
  })
  unitOfWork.transaction.canonFacts.push(fact)
  return fact
}

describe('IP Promotion application', () => {
  it('proposes explicitly, approves into IP Bible, and never mutates Project Canon', async () => {
    const unitOfWork = new MemoryGovernanceUnitOfWork(), ids = new DeterministicIds(), fact = seedCanon(unitOfWork)
    unitOfWork.transaction.member = teamMember('editor')
    const ip = unitOfWork.transaction.hierarchy.ip
    const proposed = await proposeProjectCanonToIp(dependencies(unitOfWork, ids), {
      teamId: ip.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: ip.id, sourceCanonFactId: fact.id,
      promotionId: asIpPromotionId('promotion-1'), conflictResolution: '无冲突', impactNote: '提升为母设定', expectedIpRevision: 1,
      idempotencyKey: asIdempotencyKey('propose-1'), requestHash: asRequestHash('request-propose-1'),
    })
    expect(proposed.promotion.status).toBe('proposed')
    expect(unitOfWork.transaction.bibleEntries).toHaveLength(0)

    unitOfWork.transaction.member = teamMember('admin')
    const decided = await decideProjectCanonPromotion(dependencies(unitOfWork, ids), {
      teamId: ip.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: ip.id, promotionId: proposed.promotion.id,
      decision: 'approved', expectedIpRevision: 1, bibleEntryId: asIpBibleEntryId('bible-1'), bibleKey: '主角抵达地', bibleValue: '雾港',
      idempotencyKey: asIdempotencyKey('decide-1'), requestHash: asRequestHash('request-decide-1'),
    })
    const replay = await decideProjectCanonPromotion(dependencies(unitOfWork, ids), {
      teamId: ip.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: ip.id, promotionId: proposed.promotion.id,
      decision: 'approved', expectedIpRevision: 1, bibleEntryId: asIpBibleEntryId('bible-1'), bibleKey: '主角抵达地', bibleValue: '雾港',
      idempotencyKey: asIdempotencyKey('decide-1'), requestHash: asRequestHash('request-decide-1'),
    })
    expect(replay).toEqual(decided)
    expect(unitOfWork.transaction.bibleEntries).toHaveLength(1)
    expect(unitOfWork.transaction.canonFacts).toEqual([fact])
    expect(unitOfWork.transaction.ips.get(ip.id)?.revision).toBe(2)
  })

  it('rejects editor decision and stale IP revision with independent audits', async () => {
    const unitOfWork = new MemoryGovernanceUnitOfWork(), ids = new DeterministicIds(), fact = seedCanon(unitOfWork)
    unitOfWork.transaction.member = teamMember('editor')
    const ip = unitOfWork.transaction.hierarchy.ip
    const proposed = await proposeProjectCanonToIp(dependencies(unitOfWork, ids), {
      teamId: ip.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: ip.id, sourceCanonFactId: fact.id,
      promotionId: asIpPromotionId('promotion-1'), conflictResolution: '无冲突', impactNote: '候选', expectedIpRevision: 1,
      idempotencyKey: asIdempotencyKey('propose-1'), requestHash: asRequestHash('request-propose-1'),
    })
    const base = {
      teamId: ip.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: ip.id, promotionId: proposed.promotion.id,
      decision: 'approved' as const, expectedIpRevision: 1, bibleEntryId: asIpBibleEntryId('bible-1'), bibleKey: '键', bibleValue: '值',
      idempotencyKey: asIdempotencyKey('decide-1'), requestHash: asRequestHash('request-decide-1'),
    }
    await expect(decideProjectCanonPromotion(dependencies(unitOfWork, ids), base)).rejects.toMatchObject({ code: 'forbidden' })
    unitOfWork.transaction.member = teamMember('admin')
    await expect(decideProjectCanonPromotion(dependencies(unitOfWork, ids), { ...base, actorId: unitOfWork.transaction.member.memberId, expectedIpRevision: 0, idempotencyKey: asIdempotencyKey('decide-2'), requestHash: asRequestHash('request-decide-2') })).rejects.toMatchObject({ code: 'revision-conflict' })
    unitOfWork.transaction.canonFacts = [{ ...fact, status: 'superseded' }]
    await expect(decideProjectCanonPromotion(dependencies(unitOfWork, ids), { ...base, actorId: unitOfWork.transaction.member.memberId, idempotencyKey: asIdempotencyKey('decide-3'), requestHash: asRequestHash('request-decide-3') })).rejects.toMatchObject({ code: 'revision-conflict' })
    expect(unitOfWork.transaction.bibleEntries).toHaveLength(0)
    expect(unitOfWork.transaction.events.slice(-3).map(event => event.type)).toEqual(['permission.denied', 'operation.conflict', 'operation.conflict'])
  })

  it('rejects a proposed Promotion without creating an IP Bible Entry', async () => {
    const unitOfWork = new MemoryGovernanceUnitOfWork(), ids = new DeterministicIds(), fact = seedCanon(unitOfWork)
    unitOfWork.transaction.member = teamMember('editor')
    const ip = unitOfWork.transaction.hierarchy.ip
    const proposed = await proposeProjectCanonToIp(dependencies(unitOfWork, ids), {
      teamId: ip.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: ip.id, sourceCanonFactId: fact.id,
      promotionId: asIpPromotionId('promotion-reject'), conflictResolution: '不纳入母设定', impactNote: '仅当前项目有效', expectedIpRevision: 1,
      idempotencyKey: asIdempotencyKey('propose-reject'), requestHash: asRequestHash('request-propose-reject'),
    })
    unitOfWork.transaction.member = teamMember('admin')
    const rejected = await decideProjectCanonPromotion(dependencies(unitOfWork, ids), {
      teamId: ip.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: ip.id, promotionId: proposed.promotion.id,
      decision: 'rejected', expectedIpRevision: 1, idempotencyKey: asIdempotencyKey('decide-reject'), requestHash: asRequestHash('request-decide-reject'),
    })
    expect(rejected).toMatchObject({ promotion: { status: 'rejected' }, bibleEntry: null, ipRevision: 2 })
    expect(unitOfWork.transaction.bibleEntries).toHaveLength(0)
    expect(unitOfWork.transaction.canonFacts).toEqual([fact])
  })
})

describe('Cross-IP Grant application', () => {
  it('creates and revokes a Grant without changing the frozen Selection Snapshot', async () => {
    const unitOfWork = new MemoryGovernanceUnitOfWork(), ids = new DeterministicIds()
    unitOfWork.transaction.member = teamMember('admin')
    const targetIp = unitOfWork.transaction.hierarchy.ip
    const sourceIp = { ...targetIp, id: asIpId('ip-source') }
    unitOfWork.transaction.ips.set(sourceIp.id, sourceIp)
    const snapshot = Object.freeze({ id: asSelectionSnapshotId('snapshot-1'), teamId: targetIp.teamId, sourceIpId: sourceIp.id, targetIpId: targetIp.id, scopes: ['ip-bible', 'structure'] as const, frozen: true })
    unitOfWork.transaction.selectionSnapshots.set(snapshot.id, snapshot)
    const createCommand = {
      teamId: targetIp.teamId, actorId: unitOfWork.transaction.member.memberId, sourceIpId: sourceIp.id, targetIpId: targetIp.id,
      grantId: asCrossIpGrantId('grant-1'), selectionSnapshotId: snapshot.id, scopes: ['ip-bible', 'structure'], expectedTargetIpRevision: 1,
      idempotencyKey: asIdempotencyKey('grant-1'), requestHash: asRequestHash('request-grant-1'),
    } as const
    const created = await grantCrossIpSelection(dependencies(unitOfWork, ids), createCommand)
    expect(await grantCrossIpSelection(dependencies(unitOfWork, ids), createCommand)).toEqual(created)
    expect(created).toMatchObject({ grant: { status: 'active', selectionSnapshotId: snapshot.id }, targetIpRevision: 2 })
    const revokeCommand = {
      teamId: targetIp.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: targetIp.id, grantId: created.grant.id,
      expectedTargetIpRevision: 2, idempotencyKey: asIdempotencyKey('revoke-1'), requestHash: asRequestHash('request-revoke-1'),
    } as const
    const revoked = await revokeCrossIpSelection(dependencies(unitOfWork, ids), revokeCommand)
    expect(await revokeCrossIpSelection(dependencies(unitOfWork, ids), revokeCommand)).toEqual(revoked)
    expect(revoked).toMatchObject({ grant: { status: 'revoked', selectionSnapshotId: snapshot.id }, targetIpRevision: 3 })
    expect(unitOfWork.transaction.selectionSnapshots.get(snapshot.id)).toBe(snapshot)
    expect(unitOfWork.transaction.audits.filter(audit => audit.action.startsWith('ip-grant.'))).toHaveLength(2)
    expect(unitOfWork.transaction.events.filter(event => event.type === 'ip-grant.created' || event.type === 'ip-grant.revoked')).toHaveLength(2)
  })

  it('rejects duplicate active, cross-Team snapshot, unauthorized and stale writes', async () => {
    const unitOfWork = new MemoryGovernanceUnitOfWork(), ids = new DeterministicIds()
    const targetIp = unitOfWork.transaction.hierarchy.ip
    const sourceIp = { ...targetIp, id: asIpId('ip-source') }
    unitOfWork.transaction.ips.set(sourceIp.id, sourceIp)
    const snapshotId = asSelectionSnapshotId('snapshot-1')
    unitOfWork.transaction.selectionSnapshots.set(snapshotId, { id: snapshotId, teamId: targetIp.teamId, sourceIpId: sourceIp.id, targetIpId: targetIp.id, scopes: ['ip-bible'], frozen: true })
    const base = {
      teamId: targetIp.teamId, actorId: unitOfWork.transaction.member.memberId, sourceIpId: sourceIp.id, targetIpId: targetIp.id,
      grantId: asCrossIpGrantId('grant-1'), selectionSnapshotId: snapshotId, scopes: ['ip-bible'] as const, expectedTargetIpRevision: 1,
      idempotencyKey: asIdempotencyKey('grant-1'), requestHash: asRequestHash('request-grant-1'),
    }
    await expect(grantCrossIpSelection(dependencies(unitOfWork, ids), base)).rejects.toMatchObject({ code: 'forbidden' })
    unitOfWork.transaction.member = teamMember('admin')
    const created = await grantCrossIpSelection(dependencies(unitOfWork, ids), { ...base, actorId: unitOfWork.transaction.member.memberId })
    await expect(grantCrossIpSelection(dependencies(unitOfWork, ids), { ...base, actorId: unitOfWork.transaction.member.memberId, grantId: asCrossIpGrantId('grant-2'), expectedTargetIpRevision: 2, idempotencyKey: asIdempotencyKey('grant-2'), requestHash: asRequestHash('request-grant-2') })).rejects.toThrow('already exists')
    expect(unitOfWork.transaction.events.at(-1)?.type).toBe('operation.failed')
    await expect(revokeCrossIpSelection(dependencies(unitOfWork, ids), { teamId: targetIp.teamId, actorId: unitOfWork.transaction.member.memberId, targetIpId: targetIp.id, grantId: created.grant.id, expectedTargetIpRevision: 1, idempotencyKey: asIdempotencyKey('revoke-stale'), requestHash: asRequestHash('request-revoke-stale') })).rejects.toMatchObject({ code: 'revision-conflict' })
    await expect(grantCrossIpSelection(dependencies(unitOfWork, ids), { ...base, actorId: unitOfWork.transaction.member.memberId, grantId: asCrossIpGrantId('grant-scope'), scopes: ['source-asset'], expectedTargetIpRevision: 2, idempotencyKey: asIdempotencyKey('grant-scope'), requestHash: asRequestHash('request-grant-scope') })).rejects.toMatchObject({ code: 'forbidden' })

    const otherTeamSnapshot = asSelectionSnapshotId('snapshot-other')
    unitOfWork.transaction.selectionSnapshots.set(otherTeamSnapshot, { id: otherTeamSnapshot, teamId: asTeamId('team-other'), sourceIpId: sourceIp.id, targetIpId: targetIp.id, scopes: ['ip-bible'], frozen: true })
    await expect(grantCrossIpSelection(dependencies(unitOfWork, ids), { ...base, actorId: unitOfWork.transaction.member.memberId, selectionSnapshotId: otherTeamSnapshot, grantId: asCrossIpGrantId('grant-other'), expectedTargetIpRevision: 2, idempotencyKey: asIdempotencyKey('grant-other'), requestHash: asRequestHash('request-grant-other') })).rejects.toMatchObject({ code: 'not-found' })
  })
})
