export const NOVEL_STUDIO_PACKAGE = '@novel-studio/dsh-novel-studio'
export const NOVEL_STUDIO_VERSION = '0.8.0-author-control.6'
export const SUPPORTED_HARNESS_VERSION = '0.1.0-rc.7'
export const DOCTOR_ROUTE = '/api/novel-studio/doctor'
export const DOCTOR_TOOL_SMOKE_ROUTE = '/api/novel-studio/doctor/tool-smoke'
export const NOVEL_API_ROUTE = '/api/novel-studio/v1'

export interface NovelDoctorReport {
  ok: boolean
  service: 'novel-studio'
  phase: 5
  bundleVersion: string
  harnessVersion: string
  host: {
    status: 'ready'
    startedAt: string
    uptimeMs: number
  }
  capabilities: {
    hostHealth: true
    novelDoctorTool: boolean
    clientSurface: true
    database: true
    workflows: true
    knowledgeTools: boolean
      recovery: boolean
      harnessCompaction: { available: boolean; status: 'ready' | 'unavailable' }
      longNovelMemory: true
  }
  storage: {
    ready: boolean
    schemaVersion: number
    expectedSchemaVersion: number
    journalMode: string
    foreignKeys: boolean
    dataHome: string
  }
  model: {
    selection: { provider: string; model: string; reasoningEffort?: string }
    providers: Array<{ id: string; name: string }>
    ready: boolean
  }
}
