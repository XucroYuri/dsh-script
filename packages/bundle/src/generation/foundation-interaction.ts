import type { FoundationGenerationRun, ProjectFoundationKind } from '../domain/model.js'

/** Harness-agnostic boundary used by the HTTP surface to start native interaction. */
export interface FoundationInteractionDriver {
  start(projectId: string, kind: ProjectFoundationKind, brief: string, sessionId: string): FoundationGenerationRun
  resume(runId: string, sessionId: string): FoundationGenerationRun
  moveToInline(runId: string): FoundationGenerationRun
  cancel(runId: string): FoundationGenerationRun
}
