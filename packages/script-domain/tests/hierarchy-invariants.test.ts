import { describe, expect, it } from 'vitest'
import { asEpisodeId, asProjectId, asSequenceId, assertProjectHierarchy, deriveStoryOrder } from '../src/index.js'
import { hierarchy } from './fixtures.js'

describe('screenplay hierarchy invariants', () => {
  it('accepts a complete Team through Beat ownership chain', () => {
    expect(() => assertProjectHierarchy(hierarchy())).not.toThrow()
  })

  it('rejects ownership drift at Episode, Scene and Beat boundaries', () => {
    const episodeDrift = hierarchy()
    episodeDrift.episodes = [{ ...episodeDrift.episodes[0]!, projectId: asProjectId('project-other') }]
    expect(() => assertProjectHierarchy(episodeDrift)).toThrow('Episode must belong')

    const sceneDrift = hierarchy()
    sceneDrift.scenes = [{ ...sceneDrift.scenes[0]!, episodeId: asEpisodeId('episode-other') }]
    expect(() => assertProjectHierarchy(sceneDrift)).toThrow('Scene must belong')

    const beatDrift = hierarchy()
    beatDrift.beats = [{ ...beatDrift.beats[0]!, episodeId: asEpisodeId('episode-other') }]
    expect(() => assertProjectHierarchy(beatDrift)).toThrow('Beat must belong')
  })

  it('derives story order from Season and Episode positions and rejects drift', () => {
    const value = hierarchy()
    expect([...deriveStoryOrder(value.seasons, value.episodes).values()]).toEqual([1])
    value.episodes = [{ ...value.episodes[0]!, storyOrder: 2 }]
    expect(() => assertProjectHierarchy(value)).toThrow('storyOrder must follow')
  })

  it('requires unique IDs and contiguous positions inside each Episode and Scene', () => {
    const duplicateSequence = hierarchy()
    duplicateSequence.sequences = [...duplicateSequence.sequences, { ...duplicateSequence.sequences[0]!, position: 2 }]
    expect(() => assertProjectHierarchy(duplicateSequence)).toThrow('Sequence IDs must be unique')

    const sequenceGap = hierarchy()
    sequenceGap.sequences = [{ ...sequenceGap.sequences[0]!, id: asSequenceId('sequence-2'), position: 2 }]
    expect(() => assertProjectHierarchy(sequenceGap)).toThrow('Sequence in Episode')

    const beatGap = hierarchy()
    beatGap.beats = [{ ...beatGap.beats[0]!, position: 2 }]
    expect(() => assertProjectHierarchy(beatGap)).toThrow('Beat in Scene')
  })
})
