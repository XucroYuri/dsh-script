import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLOUD_MIGRATION_ID, CLOUD_TENANT_TABLES, tenantSessionStatements } from '../src/index.js'

const migration = await readFile(resolve(import.meta.dirname, '../migrations/0001_cloud_authority.sql'), 'utf8')

describe('PostgreSQL authority migration', () => {
  it('is a forward-only transactional migration with a replay marker', () => {
    expect(migration.startsWith('BEGIN;')).toBe(true)
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(migration).toContain(`VALUES ('${CLOUD_MIGRATION_ID}'`)
    expect(migration).not.toMatch(/DROP\s+TABLE/i)
    expect(migration).not.toContain('novel-studio')
  })

  it('gives every tenant table a team key and RLS policy', () => {
    for (const table of CLOUD_TENANT_TABLES) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS app\\.${table} \\(`))
      expect(migration).toMatch(new RegExp(`'${table}'`))
    }
    expect(migration).toContain('ALTER TABLE app.teams FORCE ROW LEVEL SECURITY;')
    expect(migration).toContain('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('USING (team_id = app.current_team_id())')
    expect(migration).toContain('WITH CHECK (team_id = app.current_team_id())')
  })

  it('uses same-Team composite references for hierarchy and content', () => {
    expect(migration).toContain('FOREIGN KEY (team_id, ip_id) REFERENCES app.ips (team_id, id)')
    expect(migration).toContain('FOREIGN KEY (team_id, project_id, season_id) REFERENCES app.seasons (team_id, project_id, id)')
    expect(migration).toContain('FOREIGN KEY (team_id, project_id, episode_id) REFERENCES app.episodes (team_id, project_id, id)')
    expect(migration).toContain('FOREIGN KEY (team_id, project_id, episode_id, scene_id) REFERENCES app.scenes (team_id, project_id, episode_id, id)')
    expect(migration).toContain('FOREIGN KEY (team_id, project_id) REFERENCES app.projects (team_id, id)')
    expect(migration).toContain('UNIQUE (team_id, project_id, id)')
    expect(migration).toContain('UNIQUE (team_id, project_id, episode_id, id)')
  })

  it('binds both tenant and member context transaction-locally', () => {
    expect(tenantSessionStatements({ teamId: 'team-1' as never, memberId: 'member-1' as never })).toEqual([
      { text: "select set_config('app.team_id', $1, true)", values: ['team-1'] },
      { text: "select set_config('app.member_id', $1, true)", values: ['member-1'] },
    ])
    expect(migration).toContain("current_setting('app.team_id', true)")
    expect(migration).toContain("current_setting('app.member_id', true)")
  })
})
