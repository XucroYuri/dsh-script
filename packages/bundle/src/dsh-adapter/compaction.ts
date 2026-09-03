import type { Context } from '@deepseek-ai/cordis'

interface CompactionAgentLike {
  session: unknown
  options: { provider?: string; model?: string }
}

interface OptionalCompactionEngine {
  compactIfNeeded(agent: CompactionAgentLike, trigger: 'pressure' | 'context-overflow', signal: AbortSignal): Promise<unknown | null>
}

function engine(ctx: Context): OptionalCompactionEngine | null {
  const candidate = ctx.get('compaction') as Partial<OptionalCompactionEngine> | undefined
  return candidate && typeof candidate.compactIfNeeded === 'function' ? candidate as OptionalCompactionEngine : null
}

export function harnessCompactionCapability(ctx: Context): { available: boolean; status: 'ready' | 'unavailable' } {
  const available = engine(ctx) !== null
  return { available, status: available ? 'ready' : 'unavailable' }
}

export async function compactHarnessSessionOnPressure(ctx: Context, agent: CompactionAgentLike, signal: AbortSignal): Promise<'compacted' | 'not-needed' | 'unavailable'> {
  const compaction = engine(ctx)
  if (!compaction) return 'unavailable'
  const result = await compaction.compactIfNeeded(agent, 'pressure', signal)
  return result ? 'compacted' : 'not-needed'
}
