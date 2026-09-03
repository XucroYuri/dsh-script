import { describe, expect, it } from 'vitest'
import { asEpisodeId, assertProjectHierarchy, asSeasonId, createSeason, type ProjectMedium } from '../src/index.js'
import { hierarchy } from './fixtures.js'

describe('screenplay project media', () => {
  it('admits episodic and feature-film only at compile time', () => {
    const media: ProjectMedium[] = ['episodic', 'feature-film']
    // @ts-expect-error A novel is source material, never a Script Studio Project medium.
    media.push('novel')
    expect(media.slice(0, 2)).toEqual(['episodic', 'feature-film'])
  })

  it('requires a feature film to have one system Season and one primary Episode', () => {
    expect(() => assertProjectHierarchy(hierarchy('feature-film'))).not.toThrow()
    const extraSeason = hierarchy('feature-film')
    extraSeason.seasons = [...extraSeason.seasons, { ...extraSeason.seasons[0]!, id: asSeasonId('season-2'), position: 2 }]
    expect(() => assertProjectHierarchy(extraSeason)).toThrow('exactly one system Season')

    const extraEpisode = hierarchy('feature-film')
    extraEpisode.episodes = [...extraEpisode.episodes, { ...extraEpisode.episodes[0]!, id: asEpisodeId('episode-2'), position: 2, storyOrder: 2, primary: false }]
    expect(() => assertProjectHierarchy(extraEpisode)).toThrow('exactly one primary Episode')
  })

  it('allows an episodic Project to contain multiple Seasons and Episodes', () => {
    const value = hierarchy()
    const projectId = value.project.id
    const secondSeasonId = asSeasonId('season-2')
    value.seasons = [...value.seasons, { id: secondSeasonId, projectId, title: '第二季', position: 2, status: 'active', revision: 1, system: false }]
    value.episodes = [...value.episodes, { ...value.episodes[0]!, id: asEpisodeId('episode-2'), seasonId: secondSeasonId, position: 1, storyOrder: 2 }]
    expect(() => assertProjectHierarchy(value)).not.toThrow()
  })

  it('rejects an episodic Season without an Episode', () => {
    const value = hierarchy()
    value.episodes = []
    value.sequences = []
    value.scenes = []
    value.beats = []
    expect(() => assertProjectHierarchy(value)).toThrow('must contain at least one Episode')
  })

  it('creates a Season only for an active episodic Project at the expected revision', () => {
    const value = hierarchy()
    const input = { project: value.project, existingSeasons: value.seasons, existingEpisodes: value.episodes, seasonId: asSeasonId('season-2'), title: ' 第二季 ', firstEpisodeId: asEpisodeId('episode-2'), firstEpisodeTitle: ' 第一集 ', expectedProjectRevision: 1 }
    const created = createSeason(input)
    expect(created).toMatchObject({ project: { revision: 2 }, season: { title: '第二季', position: 2, revision: 1, system: false }, episode: { title: '第一集', position: 1, storyOrder: 2, revision: 1 } })
    expect(() => createSeason({ ...input, project: { ...value.project, medium: 'feature-film' } })).toThrow('cannot create another Season')
    expect(() => createSeason({ ...input, expectedProjectRevision: 0 })).toThrow('revision')
  })
})
