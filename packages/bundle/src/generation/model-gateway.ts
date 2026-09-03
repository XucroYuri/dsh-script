import type { GenerationTelemetry, ModelSelection, ModelUsage } from '../domain/model.js'

export interface ResolvedModelCapacity {
  contextWindow: number | null
  contextWindowSource: 'provider' | 'fallback'
  defaultMaxTokens: number | null
  reasoningEfforts: string[]
}

export interface ModelGenerationRequest {
  selection: ModelSelection
  system: string
  prompt: string
  maxTokens: number
  signal?: AbortSignal
  onProgress?: (progress: { outputCharacters: number; text: string; telemetry?: GenerationTelemetry }) => void
}

export interface ModelGenerationResponse {
  text: string
  usage?: ModelUsage
  telemetry?: GenerationTelemetry
}

export class ModelOutputLimitError extends Error {
  readonly code = 'model-output-limit'

  constructor(
    public readonly partialResponse: ModelGenerationResponse,
    public readonly requestedMaxTokens: number,
  ) {
    super('模型输出达到单次上限，已保留中断前的内容；Novel Studio 会尝试自动续写，仍未收束时会保存为可审阅草稿。')
    this.name = 'ModelOutputLimitError'
  }
}

export interface ModelGateway {
  selection(): ModelSelection
  providers(): Array<{ id: string; name: string }>
  resolveCapacity?(selection: ModelSelection, signal?: AbortSignal): Promise<ResolvedModelCapacity>
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResponse>
}
