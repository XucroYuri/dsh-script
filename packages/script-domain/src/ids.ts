import { DomainError } from './errors.js'

type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

export type TeamId = Brand<string, 'TeamId'>
export type IpId = Brand<string, 'IpId'>
export type ProjectId = Brand<string, 'ProjectId'>
export type SeasonId = Brand<string, 'SeasonId'>
export type EpisodeId = Brand<string, 'EpisodeId'>
export type SequenceId = Brand<string, 'SequenceId'>
export type SceneId = Brand<string, 'SceneId'>
export type BeatId = Brand<string, 'BeatId'>
export type MemberId = Brand<string, 'MemberId'>
export type VersionId = Brand<string, 'VersionId'>
export type DraftId = Brand<string, 'DraftId'>
export type ApprovalId = Brand<string, 'ApprovalId'>
export type ProjectCanonFactId = Brand<string, 'ProjectCanonFactId'>
export type IpBibleEntryId = Brand<string, 'IpBibleEntryId'>
export type IpPromotionId = Brand<string, 'IpPromotionId'>
export type CrossIpGrantId = Brand<string, 'CrossIpGrantId'>
export type AuditEventId = Brand<string, 'AuditEventId'>
export type SelectionSnapshotId = Brand<string, 'SelectionSnapshotId'>
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>
export type ContentObjectId = Brand<string, 'ContentObjectId'>
export type RequestHash = Brand<string, 'RequestHash'>

function identifier<Name extends string>(value: string, field: string): Brand<string, Name> {
  const normalized = value.trim()
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(normalized)) {
    throw new DomainError('validation', `${field} must be a stable identifier.`)
  }
  return normalized as Brand<string, Name>
}

export const asTeamId = (value: string): TeamId => identifier<'TeamId'>(value, 'teamId')
export const asIpId = (value: string): IpId => identifier<'IpId'>(value, 'ipId')
export const asProjectId = (value: string): ProjectId => identifier<'ProjectId'>(value, 'projectId')
export const asSeasonId = (value: string): SeasonId => identifier<'SeasonId'>(value, 'seasonId')
export const asEpisodeId = (value: string): EpisodeId => identifier<'EpisodeId'>(value, 'episodeId')
export const asSequenceId = (value: string): SequenceId => identifier<'SequenceId'>(value, 'sequenceId')
export const asSceneId = (value: string): SceneId => identifier<'SceneId'>(value, 'sceneId')
export const asBeatId = (value: string): BeatId => identifier<'BeatId'>(value, 'beatId')
export const asMemberId = (value: string): MemberId => identifier<'MemberId'>(value, 'memberId')
export const asVersionId = (value: string): VersionId => identifier<'VersionId'>(value, 'versionId')
export const asDraftId = (value: string): DraftId => identifier<'DraftId'>(value, 'draftId')
export const asApprovalId = (value: string): ApprovalId => identifier<'ApprovalId'>(value, 'approvalId')
export const asProjectCanonFactId = (value: string): ProjectCanonFactId => identifier<'ProjectCanonFactId'>(value, 'projectCanonFactId')
export const asIpBibleEntryId = (value: string): IpBibleEntryId => identifier<'IpBibleEntryId'>(value, 'ipBibleEntryId')
export const asIpPromotionId = (value: string): IpPromotionId => identifier<'IpPromotionId'>(value, 'ipPromotionId')
export const asCrossIpGrantId = (value: string): CrossIpGrantId => identifier<'CrossIpGrantId'>(value, 'crossIpGrantId')
export const asAuditEventId = (value: string): AuditEventId => identifier<'AuditEventId'>(value, 'auditEventId')
export const asSelectionSnapshotId = (value: string): SelectionSnapshotId => identifier<'SelectionSnapshotId'>(value, 'selectionSnapshotId')
export const asIdempotencyKey = (value: string): IdempotencyKey => identifier<'IdempotencyKey'>(value, 'idempotencyKey')
export const asContentObjectId = (value: string): ContentObjectId => identifier<'ContentObjectId'>(value, 'contentObjectId')
export const asRequestHash = (value: string): RequestHash => identifier<'RequestHash'>(value, 'requestHash')
