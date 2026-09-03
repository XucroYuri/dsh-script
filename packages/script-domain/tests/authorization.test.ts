import { describe, expect, it } from 'vitest'
import { asTeamId, assertEpisodeWriteAllowed, assertHierarchyWriteAllowed, authorize } from '../src/index.js'
import { hierarchy, member } from './fixtures.js'

describe('team authorization', () => {
  it('enforces the role matrix', () => {
    const teamId = asTeamId('team-1')
    expect(authorize(member('viewer'), teamId, 'read', ['active'])).toEqual({ allowed: true, reason: 'allowed' })
    expect(authorize(member('viewer'), teamId, 'write', ['active'])).toEqual({ allowed: false, reason: 'role-denied' })
    expect(authorize(member('writer'), teamId, 'write', ['active']).allowed).toBe(true)
    expect(authorize(member('writer'), teamId, 'approve', ['active']).allowed).toBe(false)
    expect(authorize(member('reviewer'), teamId, 'approve', ['active']).allowed).toBe(true)
    expect(authorize(member('editor'), teamId, 'promote-ip-canon', ['active']).allowed).toBe(true)
    expect(authorize(member('editor'), teamId, 'approve-ip-promotion', ['active']).allowed).toBe(false)
    expect(authorize(member('admin'), teamId, 'approve-ip-promotion', ['active']).allowed).toBe(true)
    expect(authorize(member('admin'), teamId, 'manage-ip-grants', ['active']).allowed).toBe(true)
    expect(authorize(member('admin'), teamId, 'manage-members', ['active']).allowed).toBe(true)
  })

  it('rejects missing and suspended members', () => {
    const teamId = asTeamId('team-1')
    expect(authorize(null, teamId, 'read', ['active']).reason).toBe('not-a-member')
    expect(authorize({ ...member('owner'), status: 'suspended' }, teamId, 'write', ['active']).reason).toBe('member-suspended')
    expect(authorize(member('owner'), asTeamId('team-other'), 'write', ['active']).reason).toBe('not-a-member')
  })

  it('enforces archive and revision write barriers', () => {
    const archived = hierarchy()
    archived.ip = { ...archived.ip, status: 'archived' }
    expect(() => assertHierarchyWriteAllowed(archived, member('writer'), 1)).toThrow('archived')
    expect(() => assertHierarchyWriteAllowed(hierarchy(), member('writer'), 0)).toThrow('revision-conflict')
    expect(() => assertHierarchyWriteAllowed(hierarchy(), { ...member('owner'), teamId: asTeamId('team-other') }, 1)).toThrow('not-a-member')
    expect(() => assertHierarchyWriteAllowed(hierarchy(), member('writer'), 1)).not.toThrow()

    const archivedSeason = hierarchy()
    archivedSeason.seasons = [{ ...archivedSeason.seasons[0]!, status: 'archived' }]
    expect(() => assertEpisodeWriteAllowed(archivedSeason, member('writer'), archivedSeason.episodes[0]!.id, 1)).toThrow('archived')
    expect(() => assertEpisodeWriteAllowed(hierarchy(), { ...member('writer'), teamId: asTeamId('team-other') }, hierarchy().episodes[0]!.id, 1)).toThrow('not-a-member')
  })
})
