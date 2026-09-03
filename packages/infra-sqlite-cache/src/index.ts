import { DatabaseSync } from 'node:sqlite'
import type {
  OfflineDraftUpdatePayload, OfflineHierarchyCachePort, OfflineOutboxEntry, OfflineOutboxStatus,
} from '@script-studio/contracts'
import {
  asDraftId, asEpisodeId, asIdempotencyKey, asProjectId, asTeamId,
  DomainError,
  type ProjectHierarchy,
} from '@script-studio/domain'
import type { DraftId, EpisodeId, IdempotencyKey, ProjectId, TeamId } from '@script-studio/domain'

const DEFAULT_MAX_ATTEMPTS = 5
const MAX_ERROR_CODE_LENGTH = 128
const STABLE_TEXT = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/

interface Row extends Record<string, unknown> {}

export interface SqliteOfflineCacheOptions {
  maxAttempts?: number
}

function stableText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !STABLE_TEXT.test(value)) throw new DomainError('validation', `${field} must be a stable identifier.`)
  return value
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) throw new DomainError('validation', `${field} must be a valid timestamp.`)
  return value
}

function safeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new DomainError('validation', `${field} must be a non-negative safe integer.`)
  return Number(value)
}

function normalizePayload(payload: OfflineDraftUpdatePayload): OfflineDraftUpdatePayload {
  if (!payload || typeof payload !== 'object') throw new DomainError('validation', 'Draft update payload is required.')
  const draftId: DraftId = asDraftId(String(payload.draftId))
  const episodeId: EpisodeId = asEpisodeId(String(payload.episodeId))
  if (typeof payload.content !== 'string' || typeof payload.stateVector !== 'string') throw new DomainError('validation', 'Draft update content and stateVector must be strings.')
  return {
    draftId,
    episodeId,
    content: payload.content,
    stateVector: payload.stateVector,
    expectedDraftRevision: safeInteger(payload.expectedDraftRevision, 'expectedDraftRevision'),
    expectedEpisodeRevision: safeInteger(payload.expectedEpisodeRevision, 'expectedEpisodeRevision'),
  }
}

function payloadJson(payload: OfflineDraftUpdatePayload): string {
  return JSON.stringify(normalizePayload(payload))
}

function status(value: unknown): OfflineOutboxStatus {
  if (value === 'pending' || value === 'in-flight' || value === 'failed') return value
  throw new DomainError('invalid-state', 'Offline outbox status is invalid.')
}

function entryFrom(row: Row): OfflineOutboxEntry {
  const payload = JSON.parse(String(row.payload_json)) as OfflineDraftUpdatePayload
  return {
    id: String(row.id),
    teamId: asTeamId(String(row.team_id)),
    projectId: asProjectId(String(row.project_id)),
    operation: 'draft-update',
    idempotencyKey: asIdempotencyKey(String(row.idempotency_key)),
    payload: normalizePayload(payload),
    status: status(row.status),
    attempts: safeInteger(Number(row.attempts), 'attempts'),
    nextAttemptAt: String(row.next_attempt_at),
    lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function belongsToHierarchy(hierarchy: ProjectHierarchy, teamId: TeamId, projectId: ProjectId): boolean {
  return hierarchy.team.id === teamId
    && hierarchy.project.id === projectId
    && hierarchy.project.teamId === teamId
}

export class SQLiteOfflineCache implements OfflineHierarchyCachePort {
  readonly databasePath: string
  private readonly db: DatabaseSync
  private readonly maxAttempts: number
  private closed = false

  constructor(databasePath = ':memory:', options: SqliteOfflineCacheOptions = {}) {
    this.databasePath = databasePath
    this.maxAttempts = safeInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts')
    if (this.maxAttempts < 1 || this.maxAttempts > 100) throw new DomainError('validation', 'maxAttempts must be between 1 and 100.')
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS script_studio_hierarchy_cache (
        team_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        PRIMARY KEY (team_id, project_id)
      );
      CREATE TABLE IF NOT EXISTS script_studio_offline_outbox (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation = 'draft-update'),
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'in-flight', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (team_id, operation, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS script_studio_offline_outbox_due
        ON script_studio_offline_outbox (status, next_attempt_at, created_at, id);
    `)
  }

  saveHierarchy(input: { teamId: TeamId; projectId: ProjectId; hierarchy: ProjectHierarchy; cachedAt: string }): void {
    this.ensureOpen()
    const teamId = asTeamId(String(input.teamId))
    const projectId = asProjectId(String(input.projectId))
    const cachedAt = timestamp(input.cachedAt, 'cachedAt')
    if (!belongsToHierarchy(input.hierarchy, teamId, projectId)) throw new DomainError('forbidden', 'Hierarchy does not belong to the requested Team and Project.')
    this.db.prepare(`INSERT INTO script_studio_hierarchy_cache(team_id,project_id,payload_json,cached_at)
      VALUES (?,?,?,?) ON CONFLICT(team_id,project_id) DO UPDATE SET payload_json=excluded.payload_json,cached_at=excluded.cached_at`)
      .run(teamId, projectId, JSON.stringify(input.hierarchy), cachedAt)
  }

  getHierarchy(teamId: TeamId, projectId: ProjectId): ProjectHierarchy | null {
    this.ensureOpen()
    const row = this.db.prepare('SELECT payload_json FROM script_studio_hierarchy_cache WHERE team_id=? AND project_id=?').get(asTeamId(String(teamId)), asProjectId(String(projectId))) as Row | undefined
    if (!row) return null
    try {
      const hierarchy = JSON.parse(String(row.payload_json)) as ProjectHierarchy
      return belongsToHierarchy(hierarchy, asTeamId(String(teamId)), asProjectId(String(projectId))) ? hierarchy : null
    } catch { return null }
  }

  enqueueDraftUpdate(input: { id: string; teamId: TeamId; projectId: ProjectId; idempotencyKey: IdempotencyKey; payload: OfflineDraftUpdatePayload; createdAt: string }): OfflineOutboxEntry {
    this.ensureOpen()
    const id = stableText(input.id, 'outbox id')
    const teamId = asTeamId(String(input.teamId))
    const projectId = asProjectId(String(input.projectId))
    const idempotencyKey = asIdempotencyKey(String(input.idempotencyKey))
    const createdAt = timestamp(input.createdAt, 'createdAt')
    const serialized = payloadJson(input.payload)
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO script_studio_offline_outbox(
        id,team_id,project_id,operation,idempotency_key,payload_json,status,attempts,next_attempt_at,last_error,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,'pending',0,?,NULL,?,?)
      ON CONFLICT(team_id,operation,idempotency_key) DO NOTHING`)
        .run(id, teamId, projectId, 'draft-update', idempotencyKey, serialized, createdAt, createdAt, createdAt)
      const row = this.db.prepare(`SELECT * FROM script_studio_offline_outbox WHERE team_id=? AND operation='draft-update' AND idempotency_key=?`).get(teamId, idempotencyKey) as Row | undefined
      if (!row) throw new DomainError('invalid-state', 'Offline outbox entry could not be created.')
      const entry = entryFrom(row)
      if (JSON.stringify(entry.payload) !== serialized) throw new DomainError('revision-conflict', 'Idempotency key was already used with another draft update.')
      return entry
    })
  }

  claimNext(now: string): OfflineOutboxEntry | null {
    this.ensureOpen()
    const currentTime = timestamp(now, 'now')
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM script_studio_offline_outbox
        WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1`).get(currentTime) as Row | undefined
      if (!row) return null
      const changed = this.db.prepare(`UPDATE script_studio_offline_outbox SET status='in-flight',updated_at=? WHERE id=? AND status='pending'`).run(currentTime, String(row.id))
      if (Number(changed.changes) !== 1) return null
      return entryFrom(this.db.prepare('SELECT * FROM script_studio_offline_outbox WHERE id=?').get(String(row.id)) as Row)
    })
  }

  acknowledge(id: string): void {
    this.ensureOpen()
    this.db.prepare("DELETE FROM script_studio_offline_outbox WHERE id=? AND status='in-flight'").run(stableText(id, 'outbox id'))
  }

  fail(id: string, errorCode: string, nextAttemptAt: string): OfflineOutboxEntry | null {
    this.ensureOpen()
    const outboxId = stableText(id, 'outbox id')
    const code = stableText(errorCode, 'errorCode')
    if (code.length > MAX_ERROR_CODE_LENGTH) throw new DomainError('validation', 'errorCode is too long.')
    const retryAt = timestamp(nextAttemptAt, 'nextAttemptAt')
    return this.transaction(() => {
      const row = this.db.prepare("SELECT attempts FROM script_studio_offline_outbox WHERE id=? AND status='in-flight'").get(outboxId) as Row | undefined
      if (!row) return null
      const attempts = safeInteger(Number(row.attempts), 'attempts') + 1
      const nextStatus: OfflineOutboxStatus = attempts >= this.maxAttempts ? 'failed' : 'pending'
      this.db.prepare("UPDATE script_studio_offline_outbox SET status=?,attempts=?,last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND status='in-flight'")
        .run(nextStatus, attempts, code, retryAt, retryAt, outboxId)
      return entryFrom(this.db.prepare('SELECT * FROM script_studio_offline_outbox WHERE id=?').get(outboxId) as Row)
    })
  }

  retryFailed(id: string, nextAttemptAt: string): OfflineOutboxEntry | null {
    this.ensureOpen()
    const outboxId = stableText(id, 'outbox id')
    const retryAt = timestamp(nextAttemptAt, 'nextAttemptAt')
    const changed = this.db.prepare("UPDATE script_studio_offline_outbox SET status='pending',last_error=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND status='failed'").run(retryAt, retryAt, outboxId)
    if (Number(changed.changes) !== 1) return null
    return entryFrom(this.db.prepare('SELECT * FROM script_studio_offline_outbox WHERE id=?').get(outboxId) as Row)
  }

  recoverInFlight(now: string): number {
    this.ensureOpen()
    const currentTime = timestamp(now, 'now')
    const changed = this.db.prepare("UPDATE script_studio_offline_outbox SET status='pending',next_attempt_at=?,updated_at=? WHERE status='in-flight'").run(currentTime, currentTime)
    return Number(changed.changes)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private transaction<Result>(work: () => Result): Result {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (cause) {
      try { this.db.exec('ROLLBACK') } catch { /* Preserve the original local failure. */ }
      throw cause
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new DomainError('invalid-state', 'Offline cache is closed.')
  }
}
