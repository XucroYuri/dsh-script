import { describe, expect, it } from 'vitest'
import {
  PostgresHierarchyRepository,
  PgTransactionProvider,
  PostgresTransactionalHierarchyRepository,
  type PostgresClientPort,
  type PostgresQueryPort,
  type PostgresTransactionPort,
  withTenantTransaction,
} from '../src/index.js'
import {
  asMemberId,
  asProjectId,
  asTeamId,
} from '@script-studio/domain'

interface QueryCall {
  text: string
  values: readonly unknown[]
}

class HierarchyQueryStub implements PostgresQueryPort {
  readonly calls: QueryCall[] = []

  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ rows: readonly Row[] }> {
    this.calls.push({ text, values: [...values] })
    if (text.includes('set_config')) return { rows: [] as readonly Row[] }
    if (text.includes('FROM app.projects p')) {
      return {
        rows: [{
          team_id: 'team-1', team_name: '第一工作室', team_status: 'active', team_revision: '7',
          ip_id: 'ip-1', ip_name: '潮汐 IP', ip_status: 'active', ip_revision: '5',
          project_id: 'project-1', project_title: '潮汐尽头', project_medium: 'episodic', project_status: 'active', project_revision: '11',
        }] as unknown as readonly Row[],
      }
    }
    if (text.includes('FROM app.seasons')) {
      return { rows: [{ id: 'season-1', project_id: 'project-1', title: '第一季', position: '1', status: 'active', revision: '2', system: false }] as unknown as readonly Row[] }
    }
    if (text.includes('FROM app.episodes')) {
      return { rows: [{ id: 'episode-1', project_id: 'project-1', season_id: 'season-1', title: '第一集', position: '1', story_order: '1', status: 'draft', revision: '3', primary_episode: false, current_draft_version_id: 'version-1', current_approved_version_id: null }] as unknown as readonly Row[] }
    }
    if (text.includes('FROM app.sequences')) {
      return { rows: [{ id: 'sequence-1', project_id: 'project-1', episode_id: 'episode-1', title: '开场', position: '1', status: 'active', revision: '4' }] as unknown as readonly Row[] }
    }
    if (text.includes('FROM app.scenes')) {
      return { rows: [{ id: 'scene-1', project_id: 'project-1', episode_id: 'episode-1', sequence_id: 'sequence-1', heading: '内景·工作室·日', position: '1', status: 'active', revision: '6' }] as unknown as readonly Row[] }
    }
    if (text.includes('FROM app.beats')) {
      return { rows: [{ id: 'beat-1', project_id: 'project-1', episode_id: 'episode-1', scene_id: 'scene-1', text: '潮声从远处传来。', position: '1', status: 'active', revision: '8' }] as unknown as readonly Row[] }
    }
    throw new Error(`Unexpected query: ${text}`)
  }
}

class TransactionStub implements PostgresTransactionPort {
  readonly events: string[] = []
  readonly calls: QueryCall[] = []
  failOnWork = false

  async begin(): Promise<void> { this.events.push('begin') }

  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ rows: readonly Row[] }> {
    this.events.push('query')
    this.calls.push({ text, values: [...values] })
    if (this.failOnWork && text === 'select work') throw new Error('work failed')
    return { rows: [] as readonly Row[] }
  }

  async commit(): Promise<void> { this.events.push('commit') }

  async rollback(): Promise<void> { this.events.push('rollback') }
}

class HierarchyTransactionStub extends HierarchyQueryStub implements PostgresTransactionPort {
  readonly events: string[] = []

  async begin(): Promise<void> { this.events.push('begin') }

  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ rows: readonly Row[] }> {
    this.events.push('query')
    return super.query<Row>(text, values)
  }

  async commit(): Promise<void> { this.events.push('commit') }

  async rollback(): Promise<void> { this.events.push('rollback') }
}

const teamId = asTeamId('team-1')
const projectId = asProjectId('project-1')

describe('PostgreSQL hierarchy repository', () => {
  it('keeps every hierarchy query parameterized by the verified Team and Project', async () => {
    const database = new HierarchyQueryStub()
    const hierarchy = await new PostgresHierarchyRepository(database).getProjectHierarchy({ subject: 'oidc|writer', teamId, memberId: asMemberId('member-1') }, projectId)

    expect(database.calls).toHaveLength(6)
    expect(database.calls.every(call => call.values === undefined || JSON.stringify(call.values) === JSON.stringify(['team-1', 'project-1']))).toBe(true)
    expect(database.calls.every(call => !call.text.includes('team-1') && !call.text.includes('project-1'))).toBe(true)
    expect(hierarchy).toMatchObject({
      team: { id: teamId, revision: 7 },
      project: { id: projectId, title: '潮汐尽头', medium: 'episodic', revision: 11 },
      seasons: [{ id: 'season-1', position: 1 }],
      episodes: [{ id: 'episode-1', currentDraftVersionId: 'version-1' }],
      sequences: [{ id: 'sequence-1', episodeId: 'episode-1' }],
      scenes: [{ id: 'scene-1', sequenceId: 'sequence-1' }],
      beats: [{ id: 'beat-1', sceneId: 'scene-1' }],
    })
  })

  it('passes the complete verified session through the transaction wrapper', async () => {
    const transaction = new HierarchyTransactionStub()
    const repository = new (class {
      async open(): Promise<PostgresTransactionPort> { return transaction }
      async release(): Promise<void> { transaction.events.push('release') }
    })()
    const hierarchy = await new PostgresTransactionalHierarchyRepository(repository).getProjectHierarchy(
      { subject: 'oidc|writer', teamId, memberId: asMemberId('member-1') },
      projectId,
    )

    expect(hierarchy?.project.id).toBe(projectId)
    expect(transaction.events).toEqual(['begin', 'query', 'query', 'query', 'query', 'query', 'query', 'query', 'query', 'commit', 'release'])
    expect(transaction.calls.slice(0, 2)).toEqual([
      { text: "select set_config('app.team_id', $1, true)", values: ['team-1'] },
      { text: "select set_config('app.member_id', $1, true)", values: ['member-1'] },
    ])
    expect(transaction.calls.slice(2).every(call => JSON.stringify(call.values) === JSON.stringify(['team-1', 'project-1']))).toBe(true)
  })

  it('uses one checked-out client for transaction statements and releases it once', async () => {
    const client: PostgresClientPort & { calls: QueryCall[]; releases: number } = {
      calls: [],
      releases: 0,
      async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ rows: readonly Row[] }> {
        this.calls.push({ text, values: [...values] })
        return { rows: [] as readonly Row[] }
      },
      release() { this.releases += 1 },
    }
    const provider = new PgTransactionProvider({ connect: async () => client })
    const transaction = await provider.open()
    await transaction.begin()
    await transaction.query('select 1', ['value'])
    await transaction.commit()
    await provider.release(transaction)
    await provider.release(transaction)

    expect(client.calls.map(call => call.text)).toEqual(['BEGIN', 'select 1', 'COMMIT'])
    expect(client.releases).toBe(1)
  })
})

describe('tenant transaction boundary', () => {
  const session = { teamId, memberId: 'member-1' as never }

  it('sets transaction-local Team/member settings before work and commits', async () => {
    const transaction = new TransactionStub()
    const result = await withTenantTransaction(transaction, session, async active => {
      await active.query('select work', [])
      return 'done'
    })

    expect(result).toBe('done')
    expect(transaction.events).toEqual(['begin', 'query', 'query', 'query', 'commit'])
    expect(transaction.calls.slice(0, 2)).toEqual([
      { text: "select set_config('app.team_id', $1, true)", values: ['team-1'] },
      { text: "select set_config('app.member_id', $1, true)", values: ['member-1'] },
    ])
  })

  it('rolls back on query failure and preserves the original error', async () => {
    const transaction = new TransactionStub()
    transaction.failOnWork = true

    await expect(withTenantTransaction(transaction, session, async active => {
      await active.query('select work', [])
      return 'unreachable'
    })).rejects.toThrow('work failed')
    expect(transaction.events).toEqual(['begin', 'query', 'query', 'query', 'rollback'])
  })
})
