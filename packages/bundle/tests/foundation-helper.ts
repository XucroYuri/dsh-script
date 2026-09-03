import type { ProjectFoundationKind } from '../src/domain/model.js'
import type { NovelRepository } from '../src/storage/repository.js'

const kinds: ProjectFoundationKind[] = ['outline', 'characters', 'timeline']

export function approveTestFoundation(repository: NovelRepository, projectId: string): void {
  for (const kind of kinds) {
    const workspace = repository.createProjectFoundationVersion(projectId, kind, {
      title: `Test ${kind}`,
      content: `Approved ${kind} foundation content with enough detail for deterministic chapter generation tests.`,
    }, { provider: 'test', model: 'deterministic', promptVersion: 'test-v1', promptHash: `hash-${kind}`, outputJson: '{}' })
    const draft = workspace.stages.find(stage => stage.kind === kind)?.latestVersion
    if (!draft) throw new Error(`Missing ${kind} draft`)
    repository.approveProjectFoundationVersion(projectId, kind, draft.id)
  }
}
