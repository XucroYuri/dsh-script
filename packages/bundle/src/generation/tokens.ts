import type { GenerationTelemetry, ModelUsage } from '../domain/model.js'

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const nonCjk = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '')
  const compact = nonCjk.replace(/\s+/g, ' ').trim()
  return cjk + (compact ? Math.ceil(compact.length / 4) : 0)
}

export function generationTelemetry(
  text: string,
  firstVisibleAtMs: number | null,
  lastVisibleAtMs: number | null,
  completedAtMs?: number,
  usage?: ModelUsage,
): GenerationTelemetry {
  const estimatedOutputTokens = estimateTextTokens(text)
  const liveSeconds = firstVisibleAtMs !== null && lastVisibleAtMs !== null
    ? Math.max(0.25, (lastVisibleAtMs - firstVisibleAtMs) / 1000)
    : null
  const decodeSeconds = firstVisibleAtMs !== null && completedAtMs !== undefined
    ? Math.max(0.001, (completedAtMs - firstVisibleAtMs) / 1000)
    : null
  return {
    firstVisibleTokenAt: firstVisibleAtMs === null ? null : new Date(firstVisibleAtMs).toISOString(),
    lastVisibleTokenAt: lastVisibleAtMs === null ? null : new Date(lastVisibleAtMs).toISOString(),
    visibleCharacters: text.length,
    estimatedOutputTokens,
    estimatedTokensPerSecond: liveSeconds === null ? null : estimatedOutputTokens / liveSeconds,
    finalOutputTokens: usage?.outputTokens ?? null,
    finalReasoningTokens: usage?.reasoningTokens ?? null,
    decodeSeconds,
    finalTokensPerSecond: usage && decodeSeconds !== null ? usage.outputTokens / decodeSeconds : null,
  }
}

export function emptyGenerationTelemetry(): GenerationTelemetry {
  return {
    firstVisibleTokenAt: null,
    lastVisibleTokenAt: null,
    visibleCharacters: 0,
    estimatedOutputTokens: 0,
    estimatedTokensPerSecond: null,
    finalOutputTokens: null,
    finalReasoningTokens: null,
    decodeSeconds: null,
    finalTokensPerSecond: null,
  }
}
