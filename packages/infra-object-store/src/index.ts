import { createHash } from 'node:crypto'
import { DomainError, type ContentObjectId, type ProjectId, type TeamId } from '@script-studio/domain'
import type { ContentObjectReference } from '@script-studio/contracts'

export const CONTENT_HASH_ALGORITHM = 'sha256' as const

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new DomainError('validation', `${field} is required.`)
  return normalized
}

function hash(value: string): string {
  const normalized = required(value, 'contentHash').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new DomainError('validation', 'contentHash must be a SHA-256 hex digest.')
  return normalized
}

export function sha256Hex(body: Uint8Array | string): string {
  return createHash(CONTENT_HASH_ALGORITHM).update(body).digest('hex')
}

export function contentObjectKey(input: { teamId: TeamId; objectId: ContentObjectId; contentHash: string }): string {
  const teamId = encodeURIComponent(required(input.teamId, 'teamId'))
  const objectId = encodeURIComponent(required(input.objectId, 'objectId'))
  return `teams/${teamId}/objects/${objectId}/${hash(input.contentHash)}`
}

export function createPendingContentObject(input: {
  id: ContentObjectId
  teamId: TeamId
  projectId: ProjectId
  mediaType: string
  body: Uint8Array | string
}): ContentObjectReference {
  const contentHash = sha256Hex(input.body)
  return Object.freeze({
    id: input.id,
    teamId: input.teamId,
    projectId: input.projectId,
    objectKey: contentObjectKey({ teamId: input.teamId, objectId: input.id, contentHash }),
    contentHash,
    byteSize: typeof input.body === 'string' ? Buffer.byteLength(input.body) : input.body.byteLength,
    mediaType: required(input.mediaType, 'mediaType'),
    status: 'pending',
  })
}

export function markContentObjectReady(object: ContentObjectReference, actualBody: Uint8Array | string): ContentObjectReference {
  if (object.status !== 'pending') throw new DomainError('invalid-state', 'Only a pending Content Object can become ready.')
  const actualHash = sha256Hex(actualBody)
  const actualSize = typeof actualBody === 'string' ? Buffer.byteLength(actualBody) : actualBody.byteLength
  if (actualHash !== hash(object.contentHash) || actualSize !== object.byteSize) {
    throw new DomainError('validation', 'Stored object hash or byte size does not match the pending Content Object.')
  }
  return Object.freeze({ ...object, contentHash: actualHash, status: 'ready' })
}

export function markContentObjectFailed(object: ContentObjectReference, reason: string): ContentObjectReference {
  if (object.status !== 'pending') throw new DomainError('invalid-state', 'Only a pending Content Object can fail.')
  return Object.freeze({ ...object, status: 'failed', failureReason: required(reason, 'failureReason') })
}
