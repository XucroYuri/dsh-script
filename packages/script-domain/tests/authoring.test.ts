import { describe, expect, it } from 'vitest'
import {
  approveManuscriptVersion,
  asApprovalId,
  asAuditEventId,
  asContentObjectId,
  asCrossIpGrantId,
  asDraftId,
  asIdempotencyKey,
  asIpBibleEntryId,
  asIpId,
  asIpPromotionId,
  asMemberId,
  asProjectCanonFactId,
  asSelectionSnapshotId,
  asTeamId,
  asVersionId,
  assertVersionUnchanged,
  createAuditEvent,
  createCrossIpGrant,
  decideIpPromotion,
  createManuscriptVersionFromDraft,
  createProjectCanonFact,
  proposeIpPromotion,
  rejectManuscriptVersion,
  revokeCrossIpGrant,
  submitDraft,
  type Approval,
  type Draft,
  type Ip,
} from '../src/index.js'
import { hierarchy } from './fixtures.js'

const HASH = 'a'.repeat(64)

function submittedDraft(): Draft {
  const value = hierarchy()
  return submitDraft({
    id: asDraftId('draft-1'), teamId: value.team.id, projectId: value.project.id, episodeId: value.episodes[0]!.id,
    status: 'active', revision: 1, contentHash: HASH, stateVector: 'state-1',
  }, 1)
}

function version() {
  return createManuscriptVersionFromDraft({
    draft: submittedDraft(), id: asVersionId('version-1'), contentObjectId: asContentObjectId('object-1'), contentHash: HASH,
    stateVector: 'state-1', createdBy: asMemberId('member-writer'), createdAt: '2026-09-03T00:00:00.000Z',
    idempotencyKey: asIdempotencyKey('submit-1'),
  })
}

describe('draft and immutable manuscript version', () => {
  it('submits with expected revision and freezes a matching content snapshot', () => {
    const draft = submittedDraft()
    expect(draft).toMatchObject({ status: 'submitted', revision: 2 })
    const frozen = version()
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(frozen).toMatchObject({ sourceDraftRevision: 2, contentHash: HASH, stateVector: 'state-1' })
    expect(() => assertVersionUnchanged(frozen, { ...frozen, contentHash: 'b'.repeat(64) })).toThrow('immutable')
  })

  it('rejects stale, active, or mismatched draft snapshots', () => {
    const value = hierarchy()
    const draft: Draft = { id: asDraftId('draft-1'), teamId: value.team.id, projectId: value.project.id, episodeId: value.episodes[0]!.id, status: 'active', revision: 1, contentHash: HASH, stateVector: 'state-1' }
    expect(() => submitDraft(draft, 0)).toThrow('revision')
    expect(() => createManuscriptVersionFromDraft({ draft, id: asVersionId('version-1'), contentObjectId: asContentObjectId('object-1'), contentHash: HASH, stateVector: 'state-1', createdBy: asMemberId('member-writer'), createdAt: 'now', idempotencyKey: asIdempotencyKey('submit-1') })).toThrow('submitted')
    expect(() => createManuscriptVersionFromDraft({ draft: submittedDraft(), id: asVersionId('version-1'), contentObjectId: asContentObjectId('object-1'), contentHash: 'b'.repeat(64), stateVector: 'state-1', createdBy: asMemberId('member-writer'), createdAt: 'now', idempotencyKey: asIdempotencyKey('submit-1') })).toThrow('hash')
  })
})

describe('approval, Project Canon and IP boundaries', () => {
  it('approves an immutable Version and only then creates Project Canon', () => {
    const value = hierarchy()
    const frozen = version()
    const approved = approveManuscriptVersion({ episode: value.episodes[0]!, version: frozen, approvalId: asApprovalId('approval-1'), actorId: asMemberId('member-reviewer'), decidedAt: '2026-09-03T00:01:00.000Z', expectedEpisodeRevision: 1, idempotencyKey: asIdempotencyKey('approve-1') })
    expect(approved.episode).toMatchObject({ status: 'approved', revision: 2, currentApprovedVersionId: frozen.id })
    const fact = createProjectCanonFact({ id: asProjectCanonFactId('fact-1'), approval: approved.approval, version: frozen, ipId: value.ip.id, subject: '主角', predicate: '抵达', value: '雾港', evidence: '主角在午夜抵达雾港。', createdAt: '2026-09-03T00:01:00.000Z' })
    expect(fact).toMatchObject({ projectId: value.project.id, sourceVersionId: frozen.id, sourceContentHash: HASH, status: 'active' })
  })

  it('blocks Canon before approval and detects Episode revision drift', () => {
    const value = hierarchy()
    const frozen = version()
    const pending: Approval = { id: asApprovalId('approval-1'), teamId: value.team.id, projectId: value.project.id, episodeId: value.episodes[0]!.id, versionId: frozen.id, status: 'pending', decisionNote: '', decidedBy: null, decidedAt: null, idempotencyKey: asIdempotencyKey('approve-1') }
    expect(() => createProjectCanonFact({ id: asProjectCanonFactId('fact-1'), approval: pending, version: frozen, ipId: value.ip.id, subject: '主角', predicate: '抵达', value: '雾港', evidence: '证据', createdAt: 'now' })).toThrow('approved')
    expect(() => approveManuscriptVersion({ episode: value.episodes[0]!, version: frozen, approvalId: asApprovalId('approval-1'), actorId: asMemberId('member-reviewer'), decidedAt: 'now', expectedEpisodeRevision: 0, idempotencyKey: asIdempotencyKey('approve-1') })).toThrow('revision')
  })

  it('rejects a Version with a required revision note and never creates Canon', () => {
    const value = hierarchy()
    const frozen = version()
    const rejected = rejectManuscriptVersion({ episode: value.episodes[0]!, version: frozen, approvalId: asApprovalId('approval-reject'), actorId: asMemberId('member-reviewer'), decisionNote: '需要重写结尾冲突。', decidedAt: 'now', expectedEpisodeRevision: 1, idempotencyKey: asIdempotencyKey('reject-1') })
    expect(rejected).toMatchObject({ episode: { status: 'draft', revision: 2, currentDraftVersionId: frozen.id, currentApprovedVersionId: null }, approval: { status: 'rejected', decisionNote: '需要重写结尾冲突。' } })
    expect(() => createProjectCanonFact({ id: asProjectCanonFactId('fact-reject'), approval: rejected.approval, version: frozen, ipId: value.ip.id, subject: '主角', predicate: '抵达', value: '雾港', evidence: '证据', createdAt: 'now' })).toThrow('approved')
    expect(() => rejectManuscriptVersion({ episode: value.episodes[0]!, version: frozen, approvalId: asApprovalId('approval-empty'), actorId: asMemberId('member-reviewer'), decisionNote: ' ', decidedAt: 'now', expectedEpisodeRevision: 1, idempotencyKey: asIdempotencyKey('reject-empty') })).toThrow('decisionNote')
  })

  it('requires explicit same-Team Promotion and rejects cross-Team Grants', () => {
    const value = hierarchy()
    const frozen = version()
    const approval = approveManuscriptVersion({ episode: value.episodes[0]!, version: frozen, approvalId: asApprovalId('approval-1'), actorId: asMemberId('member-reviewer'), decidedAt: 'now', expectedEpisodeRevision: 1, idempotencyKey: asIdempotencyKey('approve-1') }).approval
    const fact = createProjectCanonFact({ id: asProjectCanonFactId('fact-1'), approval, version: frozen, ipId: value.ip.id, subject: '主角', predicate: '抵达', value: '雾港', evidence: '证据', createdAt: 'now' })
    const promotion = proposeIpPromotion({ id: asIpPromotionId('promotion-1'), targetIp: value.ip, sourceFact: fact, conflictResolution: '无冲突', impactNote: '作为母设定候选', actorId: asMemberId('member-editor'), proposedAt: 'now', idempotencyKey: asIdempotencyKey('promote-1') })
    expect(promotion.status).toBe('proposed')
    const promoted = decideIpPromotion({ promotion, targetIp: value.ip, sourceFact: fact, decision: 'approved', actorId: asMemberId('member-owner'), decidedAt: 'later', expectedIpRevision: 1, bibleEntryId: asIpBibleEntryId('bible-1'), bibleKey: '主角抵达地', bibleValue: '雾港' })
    expect(promoted).toMatchObject({ promotion: { status: 'approved' }, bibleEntry: { sourcePromotionId: promotion.id, revision: 1 }, ipRevision: 2 })
    expect(() => decideIpPromotion({ promotion, targetIp: value.ip, sourceFact: fact, decision: 'approved', actorId: asMemberId('member-owner'), decidedAt: 'later', expectedIpRevision: 0, bibleEntryId: asIpBibleEntryId('bible-2'), bibleKey: '主角抵达地', bibleValue: '雾港' })).toThrow('revision')
    expect(() => proposeIpPromotion({ id: asIpPromotionId('promotion-2'), targetIp: value.ip, sourceFact: { ...fact, status: 'superseded' }, conflictResolution: '无冲突', impactNote: '候选', actorId: asMemberId('member-editor'), proposedAt: 'now', idempotencyKey: asIdempotencyKey('promote-2') })).toThrow('active')

    const sourceIp: Ip = { ...value.ip, id: asIpId('ip-source') }
    const targetIp: Ip = { ...value.ip, id: asIpId('ip-target') }
    const grant = createCrossIpGrant({ id: asCrossIpGrantId('grant-1'), teamId: value.team.id, sourceIp, targetIp, selectionSnapshotId: asSelectionSnapshotId('snapshot-1'), scopes: ['ip-bible'], createdBy: asMemberId('member-owner'), createdAt: 'now', idempotencyKey: asIdempotencyKey('grant-1') })
    expect(revokeCrossIpGrant(grant, asMemberId('member-owner'), 'later').status).toBe('revoked')
    expect(() => createCrossIpGrant({ id: asCrossIpGrantId('grant-2'), teamId: value.team.id, sourceIp, targetIp: { ...targetIp, teamId: asTeamId('team-other') }, selectionSnapshotId: asSelectionSnapshotId('snapshot-2'), scopes: ['ip-bible'], createdBy: asMemberId('member-owner'), createdAt: 'now', idempotencyKey: asIdempotencyKey('grant-2') })).toThrow('Cross-Team')
  })

  it('creates append-only audit records', () => {
    const audit = createAuditEvent({ id: asAuditEventId('audit-1'), teamId: asTeamId('team-1'), actorId: asMemberId('member-owner'), action: 'version.approved', resourceType: 'version', resourceId: 'version-1', result: 'succeeded', occurredAt: 'now', idempotencyKey: asIdempotencyKey('approve-1') })
    expect(Object.isFrozen(audit)).toBe(true)
  })
})
