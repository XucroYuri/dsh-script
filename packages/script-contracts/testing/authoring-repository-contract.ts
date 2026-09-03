import { describe, expect, it } from 'vitest'
import type {
  Approval, AuditEvent, Draft, IdempotencyKey, ManuscriptVersion, ProjectCanonFact, ProjectHierarchy, RequestHash, TeamId,
} from '@script-studio/domain'
import type {
  AuthoringTransactionPort, AuthoringUnitOfWorkPort, ContentObjectMetadata,
} from '../src/authoring.js'
import type { ScriptStudioEvent } from '../src/events.js'

export interface AuthoringRepositoryInspection {
  episodeRevision: number
  currentDraftVersionId: string | null
  currentApprovedVersionId: string | null
  draftCount: number
  versionCount: number
  approvalCount: number
  canonCount: number
  auditCount: number
  eventCount: number
}

export interface AuthoringRepositoryContractHarness {
  transaction: AuthoringTransactionPort
  unitOfWork: AuthoringUnitOfWorkPort
  teamId: TeamId
  otherTeamId: TeamId
  hierarchy: ProjectHierarchy
  readyObject: ContentObjectMetadata
  pendingObject: ContentObjectMetadata
  activeDraft: Draft
  submittedDraft: Draft
  version: ManuscriptVersion
  episodeWithDraft: ProjectHierarchy['episodes'][number]
  episodeApproved: ProjectHierarchy['episodes'][number]
  approval: Approval
  canonFact: ProjectCanonFact
  audit: AuditEvent
  events: readonly ScriptStudioEvent[]
  idempotencyKey: IdempotencyKey
  requestHash: RequestHash
  otherRequestHash: RequestHash
  inspect(): Promise<AuthoringRepositoryInspection>
}

export function authoringRepositoryContract(name: string, createHarness: () => AuthoringRepositoryContractHarness): void {
  describe(name, () => {
    it('enforces Team scope for hierarchy, Draft, Version and Content Object reads', async () => {
      const harness = createHarness()
      await expect(harness.transaction.getHierarchy(harness.otherTeamId, harness.hierarchy.project.id)).resolves.toBeNull()
      await expect(harness.transaction.getDraft(harness.otherTeamId, harness.activeDraft.id)).resolves.toBeNull()
      await expect(harness.transaction.getVersion(harness.otherTeamId, harness.version.id)).resolves.toBeNull()
      await expect(harness.transaction.getContentObject(harness.otherTeamId, harness.readyObject.id)).resolves.toBeNull()
    })

    it('preserves ready and pending Content Object metadata exactly', async () => {
      const harness = createHarness()
      await expect(harness.transaction.getContentObject(harness.teamId, harness.readyObject.id)).resolves.toEqual(harness.readyObject)
      await expect(harness.transaction.getContentObject(harness.teamId, harness.pendingObject.id)).resolves.toEqual(harness.pendingObject)
    })

    it('stores Manuscript Version immutably and rejects an Episode pointer to a missing Version', async () => {
      const harness = createHarness()
      await harness.transaction.saveVersion(harness.version)
      const stored = await harness.transaction.getVersion(harness.teamId, harness.version.id)
      expect(stored).toEqual(harness.version)
      expect(Object.isFrozen(stored)).toBe(true)
      await expect(harness.transaction.saveVersion({ ...harness.version, contentHash: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'invalid-state' })
      await expect(harness.transaction.saveEpisode({ ...harness.episodeWithDraft, currentDraftVersionId: ('missing-version' as ManuscriptVersion['id']) })).rejects.toMatchObject({ code: 'invalid-state' })
    })

    it('commits Draft, Version, Episode pointers, Approval, Canon, Audit, Events and idempotency atomically', async () => {
      const harness = createHarness()
      const input = { teamId: harness.teamId, operation: 'approve-episode-version' as const, key: harness.idempotencyKey, requestHash: harness.requestHash }
      await harness.unitOfWork.execute(async transaction => {
        await transaction.claimIdempotency(input)
        await transaction.saveDraft(harness.submittedDraft)
        await transaction.saveVersion(harness.version)
        await transaction.saveEpisode(harness.episodeApproved)
        await transaction.saveApproval(harness.approval)
        await transaction.saveProjectCanonFacts([harness.canonFact])
        await transaction.appendAuditEvents([harness.audit])
        await transaction.appendEvents(harness.events)
        await transaction.completeIdempotency({ ...input, result: { approvalId: harness.approval.id } })
      })
      await expect(harness.transaction.claimIdempotency(input)).resolves.toEqual({ status: 'replay', result: { approvalId: harness.approval.id } })
      await expect(harness.inspect()).resolves.toEqual({
        episodeRevision: harness.episodeApproved.revision,
        currentDraftVersionId: harness.episodeApproved.currentDraftVersionId,
        currentApprovedVersionId: harness.episodeApproved.currentApprovedVersionId,
        draftCount: 1,
        versionCount: 1,
        approvalCount: 1,
        canonCount: 1,
        auditCount: 1,
        eventCount: harness.events.length,
      })
    })

    it('rolls back deep mutations and every side effect, then releases the idempotency claim', async () => {
      const harness = createHarness()
      const input = { teamId: harness.teamId, operation: 'approve-episode-version' as const, key: harness.idempotencyKey, requestHash: harness.requestHash }
      await expect(harness.unitOfWork.execute(async transaction => {
        await transaction.claimIdempotency(input)
        harness.hierarchy.project.title = 'mutated in failed transaction'
        await transaction.saveDraft(harness.submittedDraft)
        await transaction.saveVersion(harness.version)
        await transaction.saveEpisode(harness.episodeApproved)
        await transaction.saveApproval(harness.approval)
        await transaction.saveProjectCanonFacts([harness.canonFact])
        await transaction.appendAuditEvents([harness.audit])
        await transaction.appendEvents(harness.events)
        throw new Error('authoring contract rollback')
      })).rejects.toThrow('authoring contract rollback')
      await expect(harness.unitOfWork.execute(transaction => transaction.claimIdempotency(input))).resolves.toEqual({ status: 'claimed' })
      expect((await harness.transaction.getHierarchy(harness.teamId, harness.hierarchy.project.id))?.project.title).not.toBe('mutated in failed transaction')
      await expect(harness.inspect()).resolves.toEqual({
        episodeRevision: harness.hierarchy.episodes[0]!.revision,
        currentDraftVersionId: harness.hierarchy.episodes[0]!.currentDraftVersionId,
        currentApprovedVersionId: harness.hierarchy.episodes[0]!.currentApprovedVersionId,
        draftCount: 1,
        versionCount: 0,
        approvalCount: 0,
        canonCount: 0,
        auditCount: 0,
        eventCount: 0,
      })
      await expect(harness.transaction.claimIdempotency({ ...input, requestHash: harness.otherRequestHash })).rejects.toMatchObject({ code: 'revision-conflict' })
    })
  })
}
