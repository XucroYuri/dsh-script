import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { BlockAssembler, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ModelOutputLimitError, type ModelGateway, type ModelGenerationRequest, type ModelGenerationResponse } from '../generation/model-gateway.js'
import { generationTelemetry } from '../generation/tokens.js'

export class HarnessModelGateway implements ModelGateway {
  constructor(private readonly ctx: Context) {}

  selection() {
    if (process.env.NOVEL_STUDIO_COMPOSITION_MODEL === '1') return { provider: 'novel-studio-test', model: 'deterministic-v1' }
    return this.ctx.agentDefaultModel.currentSelection()
  }

  providers() {
    return this.ctx.llm.listProviders()
  }

  async resolveCapacity(selection: { provider: string; model: string }, signal?: AbortSignal) {
    const info = await this.ctx.llm.resolveModelInfo(selection.provider, selection.model, signal)
    return {
      contextWindow: info.context?.contextWindow ?? null,
      contextWindowSource: info.context?.contextWindow ? 'provider' as const : 'fallback' as const,
      defaultMaxTokens: info.defaultMaxTokens ?? null,
      reasoningEfforts: info.reasoning?.efforts.map(effort => String(effort.id)) ?? [],
    }
  }

  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResponse> {
    const assembler = new BlockAssembler()
    let streamedText = ''
    let firstVisibleAtMs: number | null = null
    let lastVisibleAtMs: number | null = null
    const messages = [createUserMessage({ content: [{ type: 'text', text: request.prompt }], source: { kind: 'plugin', plugin: '@novel-studio/dsh-novel-studio' } })]
    for await (const chunk of this.ctx.llm.stream({
      provider: request.selection.provider,
      model: request.selection.model,
      ...(request.selection.reasoningEffort ? { reasoningEffort: request.selection.reasoningEffort as never } : {}),
      messages,
      system: request.system,
      maxTokens: request.maxTokens,
      signal: request.signal,
    })) {
      assembler.push(chunk)
      if (chunk.type === 'text-delta') {
        const timestamp = Date.now()
        firstVisibleAtMs ??= timestamp
        lastVisibleAtMs = timestamp
        streamedText += chunk.text
        request.onProgress?.({ outputCharacters: streamedText.length, text: streamedText, telemetry: generationTelemetry(streamedText, firstVisibleAtMs, lastVisibleAtMs) })
      }
    }
    const finish = assembler.finish
    const text = assembler.blocks().map(block => block.type === 'text' ? block.text : '').join('')
    const completedAtMs = Date.now()
    const response = {
      text,
      ...(assembler.usage ? { usage: assembler.usage } : {}),
      telemetry: generationTelemetry(text, firstVisibleAtMs, lastVisibleAtMs, completedAtMs, assembler.usage),
    }
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(`${finish.failure.code}: ${finish.failure.message}`)
    if (finish.kind === 'max-tokens') throw new ModelOutputLimitError(response, request.maxTokens)
    if (!text.trim()) throw new Error('Model produced no visible text output.')
    return response
  }
}

class CompositionTestAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const prompt = options.messages.flatMap(message => message.content).map(block => block.type === 'text' ? block.text : '').join('\n')
    const plannerMatch = prompt.match(/任务：评估项目创作基建信息充分性—([^\n]+)。/)
    const foundationMatch = prompt.match(/任务：生成项目创作基建—([^\n]+)。/)
    const confirmedRounds = (prompt.match(/### 第 \d+ 轮确认回答/g) ?? []).length
    const text = prompt.startsWith('任务：把三项已批准创作基建提炼为后续 1000 章都可复用的创作圣经')
      ? JSON.stringify({ compactNarrative: '主角围绕已批准主线推进；人物边界、世界规则、时间因果和伏笔承诺必须保持一致。', structuredSummary: { storySpine: ['批准主线'], characterConstraints: ['保持人物边界'], worldRules: ['遵守世界规则'], timelineConstraints: ['保持时间因果'], foreshadowingCommitments: ['兑现伏笔'], forbiddenDeviations: [] } })
      : prompt.startsWith('任务：提炼批准章节并增量更新长篇记忆')
      ? JSON.stringify(Object.fromEntries(['foundation','chapter','arc','volume','book','project'].map(scope => [scope, { compactNarrative: `${scope} summary preserves the earliest committed clue and current chapter state.`, structuredSummary: { stateChanges: ['chapter approved'], decisionsAndConsequences: [], newInformation: ['earliest clue retained'], timeAndPlace: [], relationshipChanges: [], foreshadowing: [], unresolvedConflicts: [] } }])))
      : plannerMatch
      ? confirmedRounds === 0
        ? JSON.stringify({ informationSufficient: false, readinessSummary: '核心优先级尚未确认。', questions: [{ question: `你希望${plannerMatch[1]}最优先确定什么？`, why: '这个选择会直接约束后续内容。', options: [{ label: '人物变化', description: '优先围绕人物选择和成长组织内容。', recommended: true }, { label: '情节推进', description: '优先围绕事件、冲突和转折组织内容。', recommended: false }, { label: '氛围体验', description: '优先围绕世界氛围和阅读感受组织内容。', recommended: false }] }] })
        : confirmedRounds === 1
        ? JSON.stringify({ informationSufficient: false, readinessSummary: '核心优先级已经明确，仍需确认最终代价。', questions: [{ question: '最终结果应该保留怎样的代价？', why: '代价决定中后段结构与结局力度。', options: [{ label: '不可逆代价', description: '目标达成，但失去的重要事物无法恢复。', recommended: true }, { label: '有限代价', description: '付出损失，但保留修复和继续成长的空间。', recommended: false }] }] })
        : JSON.stringify({ informationSufficient: true, readinessSummary: '核心优先级和最终代价均已明确，可以生成正式内容。', questions: [] })
      : foundationMatch
      ? JSON.stringify({ title: foundationMatch[1], content: `${foundationMatch[1]}已根据当前项目与所有已批准前置基建生成。${prompt.includes('确认方向：人物变化') ? '已应用规划选择：人物变化。' : ''}${prompt.includes('确认方向：不可逆代价') ? '已应用第二轮选择：不可逆代价。' : ''}这是可供后续章节提示词动态组装的确定性测试内容。` })
      : prompt.includes('任务：只重写“待重写选区”')
      ? JSON.stringify({ replacement: prompt.includes('Make it shorter') ? 'Short replacement.' : 'Rewritten selection only.' })
      : prompt.includes('任务：根据场景计划生成章节初稿')
      ? JSON.stringify({ title: 'Composition Draft', manuscript: 'Generated through the real Harness LLM stream pipeline. '.repeat(120).trim(), canonCandidates: [], uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } })
      : JSON.stringify({ chapterGoal: 'composition test goal', scenes: [{ scenePurpose: 'test scene', openingState: 'start', characterGoal: 'act', opposition: 'obstacle', turn: 'turn', outcome: 'changed', estimatedWords: 800 }], risks: [] })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    const liveText = Boolean(foundationMatch || prompt.includes('任务：根据场景计划生成章节初稿'))
    // Keep the composition adapter observably streaming without making the
    // enlarged, minimum-valid chapter fixture consume most of the workflow
    // smoke test's 15 second recovery budget.
    const chunkSize = liveText ? 72 : text.length
    for (let offset = 0; offset < text.length; offset += chunkSize) {
      yield { type: 'text-delta', index: 0, text: text.slice(offset, offset + chunkSize) }
      if (liveText) await new Promise(resolve => setTimeout(resolve, 35))
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: Math.max(20, Math.ceil(text.length / 2)) } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export function registerCompositionTestModel(ctx: Context): () => void {
  if (process.env.NOVEL_STUDIO_COMPOSITION_MODEL !== '1') return () => undefined
  return ctx.llm.registerAdapter(['novel-studio-test'], new CompositionTestAdapter())
}
