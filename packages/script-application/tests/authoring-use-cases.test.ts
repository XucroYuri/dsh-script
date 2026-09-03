import { describe, expect, it } from 'vitest'
import {
  asApprovalId, asContentObjectId, asDraftId, asIdempotencyKey, asProjectCanonFactId, asRequestHash, asVersionId,
  type Draft,
} from '@script-studio/domain'
import { approveEpisodeVersion, rejectEpisodeVersion, submitEpisodeDraft } from '../src/index.js'
import { DeterministicIds, MemorySecurityAudit, MemoryUnitOfWork, teamMember } from './support.js'

const HASH = 'a'.repeat(64)
const clock = { now: () => '2026-09-03T00:00:00.000Z' }

function draft(unitOfWork: MemoryUnitOfWork): Draft {
  const hierarchy = unitOfWork.transaction.hierarchy
  const value: Draft = {
    id: asDraftId('draft-1'), teamId: hierarchy.team.id, projectId: hierarchy.project.id, episodeId: hierarchy.episodes[0]!.id,
    status: 'active', revision: 1, contentHash: HASH, stateVector: 'state-1',
  }
  unitOfWork.transaction.drafts.set(value.id, value)
  return value
}

function submitCommand(unitOfWork: MemoryUnitOfWork) {
  const hierarchy = unitOfWork.transaction.hierarchy
  const value = draft(unitOfWork)
  const contentObjectId = asContentObjectId('object-1')
  unitOfWork.transaction.contentObjects.set(contentObjectId, { id: contentObjectId, teamId: hierarchy.team.id, projectId: hierarchy.project.id, contentHash: HASH, status: 'ready' })
  return {
    teamId: hierarchy.team.id, actorId: unitOfWork.transaction.member.memberId, projectId: hierarchy.project.id, episodeId: value.episodeId,
    draftId: value.id, versionId: asVersionId('version-1'), contentObjectId, contentHash: HASH,
    stateVector: 'state-1', expectedDraftRevision: 1, expectedEpisodeRevision: 1, idempotencyKey: asIdempotencyKey('submit-1'), requestHash: asRequestHash('request-submit-1'),
  }
}

function dependencies(unitOfWork: MemoryUnitOfWork, ids = new DeterministicIds()) {
  return { unitOfWork, clock, ids, securityAudit: new MemorySecurityAudit(unitOfWork.transaction) }
}

describe('SubmitEpisodeDraft', () => {
  it('freezes one immutable Version and replays without duplicate side effects', async () => {
    const unitOfWork = new MemoryUnitOfWork(), ids = new DeterministicIds(), command = submitCommand(unitOfWork)
    const first = await submitEpisodeDraft(dependencies(unitOfWork, ids), command)
    const replay = await submitEpisodeDraft(dependencies(unitOfWork, ids), command)
    expect(replay).toEqual(first)
    expect(unitOfWork.transaction.versions.size).toBe(1)
    expect(unitOfWork.transaction.hierarchy.episodes[0]).toMatchObject({ currentDraftVersionId: first.version.id, revision: 2, status: 'in-review' })
    expect(unitOfWork.transaction.audits).toHaveLength(1)
    expect(unitOfWork.transaction.events.map(event => event.type)).toEqual(['draft.submitted', 'manuscript-version.created', 'audit.appended'])
    await expect(submitEpisodeDraft(dependencies(unitOfWork, ids), { ...command, requestHash: asRequestHash('request-submit-other') })).rejects.toMatchObject({ code: 'revision-conflict' })
    expect(unitOfWork.transaction.versions.size).toBe(1)
    expect(unitOfWork.transaction.audits).toHaveLength(2)
    expect(unitOfWork.transaction.events.at(-1)?.type).toBe('operation.conflict')
  })

  it('rejects a viewer and rolls back every side effect', async () => {
    const unitOfWork = new MemoryUnitOfWork()
    unitOfWork.transaction.member = teamMember('viewer')
    const command = submitCommand(unitOfWork)
    await expect(submitEpisodeDraft(dependencies(unitOfWork), command)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(submitEpisodeDraft(dependencies(unitOfWork), command)).rejects.toMatchObject({ code: 'forbidden' })
    expect(unitOfWork.transaction.versions.size).toBe(0)
    expect(unitOfWork.transaction.audits).toHaveLength(1)
    expect(unitOfWork.transaction.events.map(event => event.type)).toEqual(['permission.denied'])
  })
})

describe('ApproveEpisodeVersion', () => {
  it('atomically approves, commits Project Canon, audits, emits, and replays idempotently', async () => {
    const unitOfWork = new MemoryUnitOfWork(), ids = new DeterministicIds()
    const submitted = await submitEpisodeDraft(dependencies(unitOfWork, ids), submitCommand(unitOfWork))
    unitOfWork.transaction.member = teamMember('reviewer')
    const hierarchy = unitOfWork.transaction.hierarchy
    const command = {
      teamId: hierarchy.team.id, actorId: unitOfWork.transaction.member.memberId, projectId: hierarchy.project.id,
      episodeId: hierarchy.episodes[0]!.id, versionId: submitted.version.id, approvalId: asApprovalId('approval-1'), expectedEpisodeRevision: 2,
      canonFacts: [{ id: asProjectCanonFactId('fact-1'), subject: '主角', predicate: '抵达', value: '雾港', evidence: '主角在午夜抵达雾港。' }],
      idempotencyKey: asIdempotencyKey('approve-1'), requestHash: asRequestHash('request-approve-1'),
    }
    const first = await approveEpisodeVersion(dependencies(unitOfWork, ids), command)
    const replay = await approveEpisodeVersion(dependencies(unitOfWork, ids), command)
    expect(replay).toEqual(first)
    expect(unitOfWork.transaction.approvals).toHaveLength(1)
    expect(unitOfWork.transaction.canonFacts).toHaveLength(1)
    expect(unitOfWork.transaction.audits).toHaveLength(2)
    expect(unitOfWork.transaction.events.filter(event => event.type === 'manuscript-version.approved')).toHaveLength(1)
    expect(unitOfWork.transaction.events.filter(event => event.type === 'project-canon.committed')).toHaveLength(1)
  })

  it('rejects writer approval and stale Episode revision without partial Canon', async () => {
    const unitOfWork = new MemoryUnitOfWork(), ids = new DeterministicIds()
    const submitted = await submitEpisodeDraft(dependencies(unitOfWork, ids), submitCommand(unitOfWork))
    const hierarchy = unitOfWork.transaction.hierarchy
    const base = {
      teamId: hierarchy.team.id, actorId: unitOfWork.transaction.member.memberId, projectId: hierarchy.project.id,
      episodeId: hierarchy.episodes[0]!.id, versionId: submitted.version.id, approvalId: asApprovalId('approval-1'), expectedEpisodeRevision: 2,
      canonFacts: [{ id: asProjectCanonFactId('fact-1'), subject: '主角', predicate: '抵达', value: '雾港', evidence: '证据' }],
      idempotencyKey: asIdempotencyKey('approve-1'), requestHash: asRequestHash('request-approve-1'),
    }
    await expect(approveEpisodeVersion(dependencies(unitOfWork, ids), base)).rejects.toMatchObject({ code: 'forbidden' })
    unitOfWork.transaction.member = teamMember('reviewer')
    await expect(approveEpisodeVersion(dependencies(unitOfWork, ids), { ...base, actorId: unitOfWork.transaction.member.memberId, expectedEpisodeRevision: 0, idempotencyKey: asIdempotencyKey('approve-2'), requestHash: asRequestHash('request-approve-2') })).rejects.toMatchObject({ code: 'revision-conflict' })
    expect(unitOfWork.transaction.approvals).toHaveLength(0)
    expect(unitOfWork.transaction.canonFacts).toHaveLength(0)
    expect(unitOfWork.transaction.audits).toHaveLength(3)
    expect(unitOfWork.transaction.events.slice(-2).map(event => event.type)).toEqual(['permission.denied', 'operation.conflict'])
  })

  it('rolls back Episode, Approval, Canon, Audit, events and idempotency after a mid-transaction failure', async () => {
    const unitOfWork = new MemoryUnitOfWork(), ids = new DeterministicIds()
    const submitted = await submitEpisodeDraft(dependencies(unitOfWork, ids), submitCommand(unitOfWork))
    unitOfWork.transaction.member = teamMember('reviewer')
    unitOfWork.transaction.failOn = 'saveProjectCanonFacts'
    const hierarchy = unitOfWork.transaction.hierarchy
    const command = {
      teamId: hierarchy.team.id, actorId: unitOfWork.transaction.member.memberId, projectId: hierarchy.project.id,
      episodeId: hierarchy.episodes[0]!.id, versionId: submitted.version.id, approvalId: asApprovalId('approval-fail'), expectedEpisodeRevision: 2,
      canonFacts: [{ id: asProjectCanonFactId('fact-fail'), subject: '主角', predicate: '抵达', value: '雾港', evidence: '证据' }],
      idempotencyKey: asIdempotencyKey('approve-fail'), requestHash: asRequestHash('request-approve-fail'),
    }
    await expect(approveEpisodeVersion(dependencies(unitOfWork, ids), command)).rejects.toThrow('injected canon failure')
    expect(unitOfWork.transaction.hierarchy.episodes[0]).toMatchObject({ status: 'in-review', revision: 2, currentApprovedVersionId: null })
    expect(unitOfWork.transaction.approvals).toHaveLength(0)
    expect(unitOfWork.transaction.canonFacts).toHaveLength(0)
    expect(unitOfWork.transaction.audits).toHaveLength(1)
    expect(unitOfWork.transaction.events).toHaveLength(3)
    unitOfWork.transaction.failOn = null
    await expect(approveEpisodeVersion(dependencies(unitOfWork, ids), command)).resolves.toMatchObject({ approval: { status: 'approved' } })
  })
})

describe('RejectEpisodeVersion', () => {
  it('records a rejected Approval, preserves the immutable draft pointer, and never creates Canon', async () => {
    const unitOfWork = new MemoryUnitOfWork(), ids = new DeterministicIds()
    const submitted = await submitEpisodeDraft(dependencies(unitOfWork, ids), submitCommand(unitOfWork))
    unitOfWork.transaction.member = teamMember('reviewer')
    const hierarchy = unitOfWork.transaction.hierarchy
    const command = {
      teamId: hierarchy.team.id, actorId: unitOfWork.transaction.member.memberId, projectId: hierarchy.project.id,
      episodeId: hierarchy.episodes[0]!.id, versionId: submitted.version.id, approvalId: asApprovalId('approval-reject'),
      decisionNote: '需要重写结尾冲突。', expectedEpisodeRevision: 2,
      idempotencyKey: asIdempotencyKey('reject-1'), requestHash: asRequestHash('request-reject-1'),
    }
    const rejected = await rejectEpisodeVersion(dependencies(unitOfWork, ids), command)
    expect(await rejectEpisodeVersion(dependencies(unitOfWork, ids), command)).toEqual(rejected)
    expect(rejected).toMatchObject({ episode: { status: 'draft', revision: 3, currentDraftVersionId: submitted.version.id, currentApprovedVersionId: null }, approval: { status: 'rejected', decisionNote: '需要重写结尾冲突。' } })
    expect(unitOfWork.transaction.approvals).toHaveLength(1)
    expect(unitOfWork.transaction.canonFacts).toHaveLength(0)
    expect(unitOfWork.transaction.events.filter(event => event.type === 'manuscript-version.rejected')).toHaveLength(1)
  })
})
