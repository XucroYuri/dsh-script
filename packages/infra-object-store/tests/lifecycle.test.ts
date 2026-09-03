import { describe, expect, it } from 'vitest'
import { asContentObjectId, asProjectId, asTeamId } from '@script-studio/domain'
import { contentObjectKey, createPendingContentObject, markContentObjectFailed, markContentObjectReady, sha256Hex } from '../src/index.js'

const teamId = asTeamId('team-1')
const projectId = asProjectId('project-1')
const objectId = asContentObjectId('object-1')
const body = '不可变剧本快照'

describe('immutable object lifecycle', () => {
  it('computes a stable SHA-256 and key without using a user title', () => {
    const pending = createPendingContentObject({ id: objectId, teamId, projectId, mediaType: 'text/plain', body })
    expect(sha256Hex(body)).toBe(pending.contentHash)
    expect(pending.objectKey).toBe(contentObjectKey({ teamId, objectId, contentHash: pending.contentHash }))
    expect(pending.objectKey).not.toContain('剧本')
    expect(pending.status).toBe('pending')
  })

  it('only promotes a byte-for-byte matching pending object to ready', () => {
    const pending = createPendingContentObject({ id: objectId, teamId, projectId, mediaType: 'text/plain', body })
    expect(markContentObjectReady(pending, body)).toMatchObject({ status: 'ready', contentHash: pending.contentHash, byteSize: pending.byteSize })
    expect(() => markContentObjectReady(pending, `${body}!`)).toThrow('hash or byte size')
  })

  it('does not allow a ready or failed object to be rewritten', () => {
    const pending = createPendingContentObject({ id: objectId, teamId, projectId, mediaType: 'text/plain', body })
    const ready = markContentObjectReady(pending, body)
    const failed = markContentObjectFailed(pending, 'object store unavailable')
    expect(() => markContentObjectReady(ready, body)).toThrow('pending')
    expect(() => markContentObjectFailed(failed, 'retry')).toThrow('pending')
  })

  it('rejects malformed hash input at the key boundary', () => {
    expect(() => contentObjectKey({ teamId, objectId, contentHash: 'not-a-hash' })).toThrow('SHA-256')
  })
})
