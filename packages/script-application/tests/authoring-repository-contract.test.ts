import { authoringRepositoryContract } from '@script-studio/contracts/testing/authoring-repository-contract'
import {
  approveManuscriptVersion,
  asApprovalId,
  asAuditEventId,
  asContentObjectId,
  asDraftId,
  asIdempotencyKey,
  asMemberId,
  asProjectCanonFactId,
  asRequestHash,
  asTeamId,
  asVersionId,
  attachDraftVersion,
  createAuditEvent,
  createManuscriptVersionFromDraft,
  createProjectCanonFact,
  submitDraft,
  type Draft,
} from '@script-studio/domain'
import { MemoryTransaction, MemoryUnitOfWork } from './support.js'

const HASH = 'a'.repeat(64)

authoringRepositoryContract('Memory Authoring Repository contract', () => {
  const transaction = new MemoryTransaction()
  const hierarchy = transaction.hierarchy
  const teamId = hierarchy.team.id
  const otherTeamId = asTeamId('team-other')
  const episode = hierarchy.episodes[0]!
  const activeDraft: Draft = {
    id: asDraftId('draft-contract'), teamId, projectId: hierarchy.project.id, episodeId: episode.id,
    status: 'active', revision: 1, contentHash: HASH, stateVector: 'state-contract',
  }
  const submittedDraft = submitDraft(activeDraft, 1)
  const readyObject = Object.freeze({ id: asContentObjectId('object-ready'), teamId, projectId: hierarchy.project.id, contentHash: HASH, status: 'ready' as const })
  const pendingObject = Object.freeze({ id: asContentObjectId('object-pending'), teamId, projectId: hierarchy.project.id, contentHash: HASH, status: 'pending' as const })
  const version = createManuscriptVersionFromDraft({
    draft: submittedDraft, id: asVersionId('version-contract'), contentObjectId: readyObject.id, contentHash: HASH,
    stateVector: submittedDraft.stateVector, createdBy: asMemberId('member-writer'), createdAt: 'now', idempotencyKey: asIdempotencyKey('version-contract'),
  })
  const episodeWithDraft = attachDraftVersion(episode, version, 1)
  const approved = approveManuscriptVersion({
    episode: episodeWithDraft, version, approvalId: asApprovalId('approval-contract'), actorId: asMemberId('member-reviewer'),
    decidedAt: 'later', expectedEpisodeRevision: 2, idempotencyKey: asIdempotencyKey('approval-contract'),
  })
  const canonFact = createProjectCanonFact({
    id: asProjectCanonFactId('fact-contract'), approval: approved.approval, version, ipId: hierarchy.ip.id,
    subject: '主角', predicate: '抵达', value: '雾港', evidence: '主角抵达雾港。', createdAt: 'later',
  })
  const audit = createAuditEvent({
    id: asAuditEventId('audit-authoring-contract'), teamId, actorId: asMemberId('member-reviewer'), action: 'version.approved',
    resourceType: 'approval', resourceId: approved.approval.id, result: 'succeeded', occurredAt: 'later', idempotencyKey: approved.approval.idempotencyKey,
  })
  const events = Object.freeze([
    { id: 'event-approved', type: 'manuscript-version.approved' as const, teamId, actorId: asMemberId('member-reviewer'), occurredAt: 'later', aggregateRevision: approved.episode.revision, payload: { projectId: hierarchy.project.id, episodeId: episode.id, versionId: version.id, approvalId: approved.approval.id } },
    { id: 'event-canon', type: 'project-canon.committed' as const, teamId, actorId: asMemberId('member-reviewer'), occurredAt: 'later', aggregateRevision: approved.episode.revision, payload: { projectId: hierarchy.project.id, episodeId: episode.id, versionId: version.id, factIds: [canonFact.id] } },
  ])
  transaction.drafts.set(activeDraft.id, activeDraft)
  transaction.contentObjects.set(readyObject.id, readyObject)
  transaction.contentObjects.set(pendingObject.id, pendingObject)
  const unitOfWork = new MemoryUnitOfWork(transaction)
  return {
    transaction, unitOfWork, teamId, otherTeamId, hierarchy, readyObject, pendingObject, activeDraft, submittedDraft, version,
    episodeWithDraft, episodeApproved: approved.episode, approval: approved.approval, canonFact, audit, events,
    idempotencyKey: asIdempotencyKey('authoring-contract'), requestHash: asRequestHash('authoring-request'), otherRequestHash: asRequestHash('authoring-request-other'),
    async inspect() {
      const current = transaction.hierarchy.episodes[0]!
      return {
        episodeRevision: current.revision,
        currentDraftVersionId: current.currentDraftVersionId,
        currentApprovedVersionId: current.currentApprovedVersionId,
        draftCount: transaction.drafts.size,
        versionCount: transaction.versions.size,
        approvalCount: transaction.approvals.length,
        canonCount: transaction.canonFacts.length,
        auditCount: transaction.audits.length,
        eventCount: transaction.events.length,
      }
    },
  }
})
