import { Pool, type PoolConfig } from 'pg'
import type { CloudHierarchyRepositoryPort, VerifiedCloudSession } from '@script-studio/contracts'
import {
  asBeatId, asEpisodeId, asIpId, asProjectId, asSceneId, asSeasonId, asSequenceId, asTeamId, asVersionId,
  type Beat, type Episode, type Ip, type Project, type ProjectHierarchy, type Scene, type Season, type Sequence, type Team,
} from '@script-studio/domain'
import type { MemberId, ProjectId, TeamId } from '@script-studio/domain'

export const CLOUD_MIGRATION_ID = '0001_cloud_authority' as const

export const CLOUD_TENANT_TABLES = [
  'team_members', 'ips', 'projects', 'seasons', 'episodes', 'sequences', 'scenes', 'beats',
  'content_objects', 'audit_events', 'idempotency_keys', 'outbox_events',
] as const

export type CloudTenantTable = (typeof CLOUD_TENANT_TABLES)[number]

export interface CloudTenantSession {
  teamId: TeamId
  memberId: MemberId
}

export interface SessionSettingStatement {
  text: string
  values: readonly [string]
}

/**
 * Creates transaction-local settings consumed by the database RLS policies.
 * The API must execute these statements after beginning a transaction and
 * derive the values from verified OIDC/session claims, never from Client input.
 */
export function tenantSessionStatements(session: CloudTenantSession): readonly [SessionSettingStatement, SessionSettingStatement] {
  return [
    { text: "select set_config('app.team_id', $1, true)", values: [session.teamId] },
    { text: "select set_config('app.member_id', $1, true)", values: [session.memberId] },
  ]
}

export interface PostgresQueryPort {
  query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ rows: readonly Row[] }>
}

export interface PostgresTransactionPort extends PostgresQueryPort {
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface PostgresTransactionProviderPort {
  open(): Promise<PostgresTransactionPort>
  release(transaction: PostgresTransactionPort): Promise<void>
}

export async function withTenantTransaction<Result>(
  transaction: PostgresTransactionPort,
  session: CloudTenantSession,
  work: (transaction: PostgresTransactionPort) => Promise<Result>,
): Promise<Result> {
  let started = false
  try {
    await transaction.begin()
    started = true
    for (const statement of tenantSessionStatements(session)) await transaction.query(statement.text, statement.values)
    const result = await work(transaction)
    await transaction.commit()
    return result
  } catch (cause) {
    if (started) {
      try { await transaction.rollback() } catch { /* Preserve the original failure for the API boundary. */ }
    }
    throw cause
  }
}

type Numeric = number | string

interface RootRow extends Record<string, unknown> {
  team_id: string
  team_name: string
  team_status: Team['status']
  team_revision: Numeric
  ip_id: string
  ip_name: string
  ip_status: Ip['status']
  ip_revision: Numeric
  project_id: string
  project_title: string
  project_medium: Project['medium']
  project_status: Project['status']
  project_revision: Numeric
}

interface SeasonRow extends Record<string, unknown> { id: string; project_id: string; title: string; position: Numeric; status: Season['status']; revision: Numeric; system: boolean }
interface EpisodeRow extends Record<string, unknown> { id: string; project_id: string; season_id: string; title: string; position: Numeric; story_order: Numeric; status: Episode['status']; revision: Numeric; primary_episode: boolean; current_draft_version_id: string | null; current_approved_version_id: string | null }
interface SequenceRow extends Record<string, unknown> { id: string; project_id: string; episode_id: string; title: string; position: Numeric; status: Sequence['status']; revision: Numeric }
interface SceneRow extends Record<string, unknown> { id: string; project_id: string; episode_id: string; sequence_id: string | null; heading: string; position: Numeric; status: Scene['status']; revision: Numeric }
interface BeatRow extends Record<string, unknown> { id: string; project_id: string; episode_id: string; scene_id: string; text: string; position: Numeric; status: Beat['status']; revision: Numeric }

function numberValue(value: Numeric, field: string): number {
  const normalized = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(normalized)) throw new Error(`Invalid PostgreSQL integer in ${field}.`)
  return normalized
}

const ROOT_QUERY = `SELECT t.id AS team_id, t.name AS team_name, t.status AS team_status, t.revision AS team_revision,
  i.id AS ip_id, i.name AS ip_name, i.status AS ip_status, i.revision AS ip_revision,
  p.id AS project_id, p.title AS project_title, p.medium AS project_medium, p.status AS project_status, p.revision AS project_revision
FROM app.projects p
JOIN app.teams t ON t.id = p.team_id
JOIN app.ips i ON i.id = p.ip_id AND i.team_id = p.team_id
WHERE p.team_id = $1 AND p.id = $2`
const SEASONS_QUERY = 'SELECT id, project_id, title, position, status, revision, system FROM app.seasons WHERE team_id = $1 AND project_id = $2 ORDER BY position, id'
const EPISODES_QUERY = 'SELECT id, project_id, season_id, title, position, story_order, status, revision, primary_episode, current_draft_version_id, current_approved_version_id FROM app.episodes WHERE team_id = $1 AND project_id = $2 ORDER BY story_order, id'
const SEQUENCES_QUERY = 'SELECT id, project_id, episode_id, title, position, status, revision FROM app.sequences WHERE team_id = $1 AND project_id = $2 ORDER BY episode_id, position, id'
const SCENES_QUERY = 'SELECT id, project_id, episode_id, sequence_id, heading, position, status, revision FROM app.scenes WHERE team_id = $1 AND project_id = $2 ORDER BY episode_id, position, id'
const BEATS_QUERY = 'SELECT id, project_id, episode_id, scene_id, text, position, status, revision FROM app.beats WHERE team_id = $1 AND project_id = $2 ORDER BY episode_id, scene_id, position, id'

export class PostgresHierarchyRepository implements CloudHierarchyRepositoryPort {
  constructor(private readonly database: PostgresQueryPort) {}

  async getProjectHierarchy(session: VerifiedCloudSession, projectId: ProjectId): Promise<ProjectHierarchy | null> {
    return this.getProjectHierarchyForTeam(session.teamId, projectId)
  }

  async getProjectHierarchyForTeam(teamId: TeamId, projectId: ProjectId): Promise<ProjectHierarchy | null> {
    const values = [teamId, projectId]
    const root = (await this.database.query<RootRow>(ROOT_QUERY, values)).rows[0]
    if (!root) return null
    const [seasons, episodes, sequences, scenes, beats] = await Promise.all([
      this.database.query<SeasonRow>(SEASONS_QUERY, values),
      this.database.query<EpisodeRow>(EPISODES_QUERY, values),
      this.database.query<SequenceRow>(SEQUENCES_QUERY, values),
      this.database.query<SceneRow>(SCENES_QUERY, values),
      this.database.query<BeatRow>(BEATS_QUERY, values),
    ])
    return {
      team: { id: asTeamId(root.team_id), name: root.team_name, status: root.team_status, revision: numberValue(root.team_revision, 'team.revision') },
      ip: { id: asIpId(root.ip_id), teamId: asTeamId(root.team_id), name: root.ip_name, status: root.ip_status, revision: numberValue(root.ip_revision, 'ip.revision') },
      project: { id: asProjectId(root.project_id), teamId: asTeamId(root.team_id), ipId: asIpId(root.ip_id), title: root.project_title, medium: root.project_medium, status: root.project_status, revision: numberValue(root.project_revision, 'project.revision') },
      seasons: seasons.rows.map(row => ({ id: asSeasonId(row.id), projectId: asProjectId(row.project_id), title: row.title, position: numberValue(row.position, 'season.position'), status: row.status, revision: numberValue(row.revision, 'season.revision'), system: row.system })),
      episodes: episodes.rows.map(row => ({ id: asEpisodeId(row.id), projectId: asProjectId(row.project_id), seasonId: asSeasonId(row.season_id), title: row.title, position: numberValue(row.position, 'episode.position'), storyOrder: numberValue(row.story_order, 'episode.story_order'), status: row.status, revision: numberValue(row.revision, 'episode.revision'), primary: row.primary_episode, currentDraftVersionId: row.current_draft_version_id ? asVersionId(row.current_draft_version_id) : null, currentApprovedVersionId: row.current_approved_version_id ? asVersionId(row.current_approved_version_id) : null })),
      sequences: sequences.rows.map(row => ({ id: asSequenceId(row.id), projectId: asProjectId(row.project_id), episodeId: asEpisodeId(row.episode_id), title: row.title, position: numberValue(row.position, 'sequence.position'), status: row.status, revision: numberValue(row.revision, 'sequence.revision') })),
      scenes: scenes.rows.map(row => ({ id: asSceneId(row.id), projectId: asProjectId(row.project_id), episodeId: asEpisodeId(row.episode_id), sequenceId: row.sequence_id ? asSequenceId(row.sequence_id) : null, heading: row.heading, position: numberValue(row.position, 'scene.position'), status: row.status, revision: numberValue(row.revision, 'scene.revision') })),
      beats: beats.rows.map(row => ({ id: asBeatId(row.id), projectId: asProjectId(row.project_id), episodeId: asEpisodeId(row.episode_id), sceneId: asSceneId(row.scene_id), text: row.text, position: numberValue(row.position, 'beat.position'), status: row.status, revision: numberValue(row.revision, 'beat.revision') })),
    }
  }
}

export class PostgresTransactionalHierarchyRepository implements CloudHierarchyRepositoryPort {
  constructor(private readonly transactions: PostgresTransactionProviderPort) {}

  async getProjectHierarchy(session: VerifiedCloudSession, projectId: ProjectId): Promise<ProjectHierarchy | null> {
    const transaction = await this.transactions.open()
    let primaryError: unknown
    try {
      return await withTenantTransaction(transaction, session, active => new PostgresHierarchyRepository(active).getProjectHierarchyForTeam(session.teamId, projectId))
    } catch (cause) {
      primaryError = cause
      throw cause
    } finally {
      try { await this.transactions.release(transaction) } catch (releaseError) { if (primaryError === undefined) throw releaseError }
    }
  }
}

export interface PostgresClientPort extends PostgresQueryPort {
  release(destroy?: boolean): void
}

export interface PostgresPoolPort {
  connect(): Promise<PostgresClientPort>
}

export class PgTransactionClient implements PostgresTransactionPort {
  private released = false

  constructor(private readonly client: PostgresClientPort) {}

  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ rows: readonly Row[] }> {
    return this.client.query<Row>(text, [...values])
  }

  async begin(): Promise<void> { await this.query('BEGIN', []) }
  async commit(): Promise<void> { await this.query('COMMIT', []) }
  async rollback(): Promise<void> { await this.query('ROLLBACK', []) }
  release(destroy = false): void {
    if (this.released) return
    this.released = true
    this.client.release(destroy)
  }
}

export class PgTransactionProvider implements PostgresTransactionProviderPort {
  constructor(private readonly pool: PostgresPoolPort) {}

  async open(): Promise<PostgresTransactionPort> { return new PgTransactionClient(await this.pool.connect()) }

  async release(transaction: PostgresTransactionPort): Promise<void> {
    if (!(transaction instanceof PgTransactionClient)) throw new Error('Transaction was not opened by this provider.')
    transaction.release()
  }
}

export function createPgTransactionProvider(config: PoolConfig): { provider: PgTransactionProvider; close: () => Promise<void> } {
  const pool = new Pool(config)
  return { provider: new PgTransactionProvider(pool), close: () => pool.end() }
}
