import { describe, expect, expectTypeOf, it } from 'vitest'
import { asIpId, asProjectId, asTeamId, asVersionId, type ProjectHierarchy, type ProjectMedium } from '@script-studio/domain'
import type { CreateProjectCommand, EpisodeDto, GetProjectHierarchyResponse, HierarchyRepositoryPort, ScriptStudioEvent } from '../src/index.js'

describe('script studio contracts', () => {
  it('shares the screenplay-only medium contract with Domain', () => {
    const command: CreateProjectCommand = {
      teamId: asTeamId('team-1'),
      ipId: asIpId('ip-1'),
      title: '潮汐尽头',
      medium: 'episodic',
      idempotencyKey: 'create-project-1',
    }
    expect(command.medium).toBe('episodic')
    expectTypeOf(command.medium).toEqualTypeOf<ProjectMedium>()
    // @ts-expect-error Source prose is not a Script Studio Project medium.
    command.medium = 'novel'
  })

  it('keeps hierarchy responses content-free and explicitly scoped', () => {
    const response = {
      team: { id: asTeamId('team-1'), name: '第一工作室', status: 'active', revision: 1 },
      ip: { id: asIpId('ip-1'), teamId: asTeamId('team-1'), name: '潮汐 IP', status: 'active', revision: 1 },
      project: { id: asProjectId('project-1'), teamId: asTeamId('team-1'), ipId: asIpId('ip-1'), title: '潮汐尽头', medium: 'feature-film', status: 'active', revision: 1 },
      seasons: [], episodes: [], sequences: [], scenes: [], beats: [],
    } satisfies GetProjectHierarchyResponse
    expect(response).not.toHaveProperty('content')
    expect(JSON.stringify(response)).not.toMatch(/token|credential|objectStoreKey/i)
  })

  it('uses stable discriminated events', () => {
    expectTypeOf<Extract<ScriptStudioEvent, { type: 'project.created' }>['payload']>().toMatchTypeOf<{ projectId: unknown; medium: ProjectMedium }>()
    expectTypeOf<HierarchyRepositoryPort['getProjectHierarchy']>().returns.resolves.toEqualTypeOf<ProjectHierarchy | null>()
    const episode = { currentDraftVersionId: asVersionId('version-draft'), currentApprovedVersionId: null } as EpisodeDto
    expectTypeOf(episode.currentDraftVersionId).toEqualTypeOf<ReturnType<typeof asVersionId> | null>()
  })
})
