import { DomainError } from './errors.js'
import type { EpisodeId, SeasonId } from './ids.js'
import type { Episode, Project, ProjectHierarchy, Season } from './model.js'

function invalid(message: string): never {
  throw new DomainError('validation', message)
}

function assertPositive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${field} must be a positive safe integer.`)
}

function assertContiguous(rows: readonly { position: number }[], field: string): void {
  const positions = [...rows].map(row => row.position).sort((left, right) => left - right)
  positions.forEach((position, index) => {
    assertPositive(position, `${field}.position`)
    if (position !== index + 1) invalid(`${field} positions must be contiguous and one-based.`)
  })
}

export function deriveStoryOrder(seasons: readonly Season[], episodes: readonly Episode[]): Map<Episode['id'], number> {
  const result = new Map<Episode['id'], number>()
  const orderedSeasons = [...seasons].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
  let storyOrder = 1
  for (const season of orderedSeasons) {
    const orderedEpisodes = episodes.filter(episode => episode.seasonId === season.id)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    for (const episode of orderedEpisodes) result.set(episode.id, storyOrder++)
  }
  return result
}

export function assertProjectHierarchy(hierarchy: ProjectHierarchy): void {
  const { team, ip, project } = hierarchy
  if (ip.teamId !== team.id) invalid('IP must belong to the hierarchy Team.')
  if (project.teamId !== team.id || project.ipId !== ip.id) invalid('Project must belong to the hierarchy Team and IP.')
  if (hierarchy.seasons.length === 0) invalid('Project must contain at least one Season.')

  assertContiguous(hierarchy.seasons, 'Season')
  const seasonIds = new Set(hierarchy.seasons.map(season => season.id))
  if (seasonIds.size !== hierarchy.seasons.length) invalid('Season IDs must be unique.')
  for (const season of hierarchy.seasons) if (season.projectId !== project.id) invalid('Season must belong to the hierarchy Project.')

  const episodeIds = new Set(hierarchy.episodes.map(episode => episode.id))
  if (episodeIds.size !== hierarchy.episodes.length) invalid('Episode IDs must be unique.')
  for (const episode of hierarchy.episodes) {
    if (episode.projectId !== project.id || !seasonIds.has(episode.seasonId)) invalid('Episode must belong to a Season in the hierarchy Project.')
  }
  for (const season of hierarchy.seasons) assertContiguous(hierarchy.episodes.filter(episode => episode.seasonId === season.id), `Episode in Season ${season.id}`)
  if (project.medium === 'episodic' && hierarchy.seasons.some(season => !hierarchy.episodes.some(episode => episode.seasonId === season.id))) {
    invalid('Every episodic Season must contain at least one Episode.')
  }

  const expectedStoryOrder = deriveStoryOrder(hierarchy.seasons, hierarchy.episodes)
  for (const episode of hierarchy.episodes) {
    assertPositive(episode.storyOrder, 'Episode.storyOrder')
    if (episode.storyOrder !== expectedStoryOrder.get(episode.id)) invalid('Episode storyOrder must follow Season and Episode positions.')
  }

  if (project.medium === 'feature-film') {
    if (hierarchy.seasons.length !== 1 || hierarchy.seasons[0]?.system !== true) invalid('Feature film must have exactly one system Season.')
    if (hierarchy.episodes.length !== 1 || hierarchy.episodes[0]?.primary !== true) invalid('Feature film must have exactly one primary Episode.')
  }

  const sequenceIds = new Set(hierarchy.sequences.map(sequence => sequence.id))
  if (sequenceIds.size !== hierarchy.sequences.length) invalid('Sequence IDs must be unique.')
  for (const sequence of hierarchy.sequences) {
    if (sequence.projectId !== project.id || !episodeIds.has(sequence.episodeId)) invalid('Sequence must belong to an Episode in the hierarchy Project.')
  }
  for (const episode of hierarchy.episodes) assertContiguous(hierarchy.sequences.filter(sequence => sequence.episodeId === episode.id), `Sequence in Episode ${episode.id}`)
  const sceneIds = new Set(hierarchy.scenes.map(scene => scene.id))
  if (sceneIds.size !== hierarchy.scenes.length) invalid('Scene IDs must be unique.')
  for (const scene of hierarchy.scenes) {
    if (scene.projectId !== project.id || !episodeIds.has(scene.episodeId)) invalid('Scene must belong to an Episode in the hierarchy Project.')
    if (scene.sequenceId !== null && !sequenceIds.has(scene.sequenceId)) invalid('Scene sequence must belong to the hierarchy.')
    const sequence = scene.sequenceId === null ? null : hierarchy.sequences.find(candidate => candidate.id === scene.sequenceId)
    if (sequence && sequence.episodeId !== scene.episodeId) invalid('Scene and Sequence must belong to the same Episode.')
  }
  for (const episode of hierarchy.episodes) assertContiguous(hierarchy.scenes.filter(scene => scene.episodeId === episode.id), `Scene in Episode ${episode.id}`)
  const beatIds = new Set(hierarchy.beats.map(beat => beat.id))
  if (beatIds.size !== hierarchy.beats.length) invalid('Beat IDs must be unique.')
  for (const beat of hierarchy.beats) {
    const scene = hierarchy.scenes.find(candidate => candidate.id === beat.sceneId)
    if (beat.projectId !== project.id || !episodeIds.has(beat.episodeId) || !sceneIds.has(beat.sceneId)) invalid('Beat must belong to a Scene in the hierarchy Project.')
    if (scene?.episodeId !== beat.episodeId) invalid('Beat and Scene must belong to the same Episode.')
  }
  for (const scene of hierarchy.scenes) assertContiguous(hierarchy.beats.filter(beat => beat.sceneId === scene.id), `Beat in Scene ${scene.id}`)
}

export function createSeason(input: {
  project: Project
  existingSeasons: readonly Season[]
  existingEpisodes: readonly Episode[]
  seasonId: SeasonId
  title: string
  firstEpisodeId: EpisodeId
  firstEpisodeTitle: string
  expectedProjectRevision: number
}): { project: Project; season: Season; episode: Episode } {
  if (input.project.revision !== input.expectedProjectRevision) throw new DomainError('revision-conflict', 'Project revision changed before Season creation.')
  if (input.project.status !== 'active') throw new DomainError('invalid-state', 'Archived Project cannot create a Season.')
  if (input.project.medium !== 'episodic') throw new DomainError('invalid-state', 'Feature film cannot create another Season.')
  assertContiguous(input.existingSeasons, 'Season')
  if (input.existingSeasons.some(season => season.projectId !== input.project.id)) invalid('Every existing Season must belong to the Project.')
  if (input.existingSeasons.some(season => season.id === input.seasonId)) invalid('Season ID already exists.')
  if (input.existingEpisodes.some(episode => episode.id === input.firstEpisodeId)) invalid('Episode ID already exists.')
  const title = input.title.trim()
  if (!title) invalid('Season title is required.')
  const episodeTitle = input.firstEpisodeTitle.trim()
  if (!episodeTitle) invalid('First Episode title is required.')
  const seasonPosition = input.existingSeasons.length + 1
  return {
    project: { ...input.project, revision: input.project.revision + 1 },
    season: {
      id: input.seasonId,
      projectId: input.project.id,
      title,
      position: seasonPosition,
      status: 'active',
      revision: 1,
      system: false,
    },
    episode: {
      id: input.firstEpisodeId,
      projectId: input.project.id,
      seasonId: input.seasonId,
      title: episodeTitle,
      position: 1,
      storyOrder: input.existingEpisodes.length + 1,
      status: 'draft',
      revision: 1,
      primary: false,
      currentDraftVersionId: null,
      currentApprovedVersionId: null,
    },
  }
}
