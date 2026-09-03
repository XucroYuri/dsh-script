import { describe, expect, it } from 'vitest'
import type { OfflineDraftUpdatePayload } from '@script-studio/contracts'
import {
  asDraftId, asEpisodeId, asIdempotencyKey, asIpId, asProjectId, asSeasonId, asTeamId,
  type ProjectHierarchy,
} from '@script-studio/domain'
import { SQLiteOfflineCache } from '../src/index.js'

const teamId = asTeamId('team-1')
const otherTeamId = asTeamId('team-2')
const projectId = asProjectId('project-1')
const hierarchy: ProjectHierarchy = {
  team: { id: teamId, name: '第一工作室', status: 'active', revision: 1 },
  ip: { id: asIpId('ip-1'), teamId, name: '潮汐 IP', status: 'active', revision: 1 },
  project: { id: projectId, teamId, ipId: asIpId('ip-1'), title: '潮汐尽头', medium: 'episodic', status: 'active', revision: 1 },
  seasons: [{ id: asSeasonId('season-1'), projectId, title: '第一季', position: 1, status: 'active', revision: 1, system: false }],
  episodes: [], sequences: [], scenes: [], beats: [],
}

const payload: OfflineDraftUpdatePayload = {
  draftId: asDraftId('draft-1'),
  episodeId: asEpisodeId('episode-1'),
  content: '潮声从远处传来。',
  stateVector: 'state-1',
  expectedDraftRevision: 2,
  expectedEpisodeRevision: 3,
}

function enqueue(cache: SQLiteOfflineCache, overrides: Partial<OfflineDraftUpdatePayload> = {}) {
  return cache.enqueueDraftUpdate({
    id: 'outbox-1', teamId, projectId, idempotencyKey: asIdempotencyKey('draft-update-1'),
    payload: { ...payload, ...overrides }, createdAt: '2026-09-03T12:00:00.000Z',
  })
}

describe('SQLite offline cache', () => {
  it('keeps hierarchy snapshots isolated by Team and Project', () => {
    const cache = new SQLiteOfflineCache()
    try {
      cache.saveHierarchy({ teamId, projectId, hierarchy, cachedAt: '2026-09-03T12:00:00.000Z' })
      expect(cache.getHierarchy(teamId, projectId)).toEqual(hierarchy)
      expect(cache.getHierarchy(otherTeamId, projectId)).toBeNull()
    } finally { cache.close() }
  })

  it('deduplicates a Draft update by Team/idempotency key and never persists extra fields', () => {
    const cache = new SQLiteOfflineCache()
    try {
      const first = enqueue(cache, { ...payload, accessToken: 'must-not-persist' } as unknown as Partial<OfflineDraftUpdatePayload>)
      expect(first).toEqual(enqueue(cache))
      expect(JSON.stringify(first)).not.toContain('must-not-persist')
      expect(() => enqueue(cache, { content: 'different request' })).toThrow('Idempotency key was already used')
    } finally { cache.close() }
  })

  it('claims due work atomically, requeues failures with a delay, and acknowledges success', () => {
    const cache = new SQLiteOfflineCache()
    try {
      enqueue(cache)
      expect(cache.claimNext('2026-09-03T12:00:01.000Z')?.status).toBe('in-flight')
      expect(cache.claimNext('2026-09-03T12:00:01.000Z')).toBeNull()
      expect(cache.fail('outbox-1', 'network-timeout', '2026-09-03T12:05:00.000Z')?.status).toBe('pending')
      expect(cache.claimNext('2026-09-03T12:04:59.000Z')).toBeNull()
      expect(cache.claimNext('2026-09-03T12:05:00.000Z')?.attempts).toBe(1)
      cache.acknowledge('outbox-1')
      expect(cache.claimNext('2026-09-03T12:06:00.000Z')).toBeNull()
    } finally { cache.close() }
  })

  it('recovers in-flight work after restart and caps repeated failures', () => {
    const cache = new SQLiteOfflineCache(':memory:', { maxAttempts: 2 })
    try {
      enqueue(cache)
      expect(cache.claimNext('2026-09-03T12:00:01.000Z')).not.toBeNull()
      expect(cache.recoverInFlight('2026-09-03T12:01:00.000Z')).toBe(1)
      expect(cache.claimNext('2026-09-03T12:01:00.000Z')).not.toBeNull()
      expect(cache.fail('outbox-1', 'temporary-failure', '2026-09-03T12:02:00.000Z')?.status).toBe('pending')
      expect(cache.claimNext('2026-09-03T12:02:00.000Z')).not.toBeNull()
      expect(cache.fail('outbox-1', 'temporary-failure', '2026-09-03T12:03:00.000Z')?.status).toBe('failed')
      expect(cache.claimNext('2026-09-03T12:04:00.000Z')).toBeNull()
      expect(cache.retryFailed('outbox-1', '2026-09-03T12:05:00.000Z')?.status).toBe('pending')
      expect(cache.claimNext('2026-09-03T12:05:00.000Z')?.status).toBe('in-flight')
    } finally { cache.close() }
  })

  it('turns use after close into a local invalid-state failure', () => {
    const cache = new SQLiteOfflineCache()
    cache.close()
    expect(() => cache.getHierarchy(teamId, projectId)).toThrow('Offline cache is closed.')
  })
})
