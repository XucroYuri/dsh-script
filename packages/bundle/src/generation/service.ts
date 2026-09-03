import { createHash } from 'node:crypto'
import { DomainError, type ChapterGenerationBatch, type FoundationGenerationRun, type FoundationPlannerQuestion, type GenerationContext, type GenerationPurpose, type GenerationResult, type GenerationTelemetry, type KnowledgeSummary, type KnowledgeSummaryDraft, type ModelSelection, type ModelUsage, type ProjectFoundationKind, type ProjectFoundationWorkspace, type ProjectTree, type PromptAssemblyTrace, type RelationshipCandidate, type StyleProfileAttributes, type WritingStyleProfile } from '../domain/model.js'
import { MAX_SELECTION_CONTEXT_CHARACTERS, MAX_SELECTION_REWRITE_CHARACTERS, MAX_SELECTION_REWRITE_INSTRUCTION_CHARACTERS, type SelectionRewriteInput, type SelectionRewriteResult } from '../domain/selection-rewrite.js'
import type { NovelRepository } from '../storage/repository.js'
import { parseStructuredModelOutput, renderBudgetedGenerationPrompt, renderFoundationAuthorityExcerpt, validateGenerationOutput } from '../prompt-assets/render.js'
import { ModelOutputLimitError, type ModelGateway, type ModelGenerationRequest, type ModelGenerationResponse, type ResolvedModelCapacity } from './model-gateway.js'
import { createThrottledStreamWriter, extractStreamingJsonString } from './stream-preview.js'
import { boundedPlanningSummary, FOUNDATION_MAX_CONFIRMED_ANSWERS, FOUNDATION_MAX_PLANNING_ROUNDS, foundationPlanningStopReason, removeRepeatedPlannerQuestions } from './foundation-planning.js'
import { estimateTextTokens } from './tokens.js'
import { styleProfileText } from '../style/presets.js'
import { normalizeChapterBatchPlan } from '../domain/chapter-batches.js'
import { chapterDraftBudget, chapterDraftLengthAdvisory, effectiveChapterTargetWords, normalizeScenePlanWordBudget, scenePlanWordBudgetAudit } from './chapter-budget.js'
import { manuscriptWordCount } from '../domain/manuscript.js'

const SYSTEM_PROMPT = `你正在 Novel Studio 中执行小说生产任务。
数据库中的批准版本优先于聊天记忆。模型输出始终是草稿，不得声称已批准。不得覆盖已批准文稿。输出必须满足用户选择的 Prompt Asset 结构，只输出要求的 JSON。`

const FOUNDATION_PLANNER_PROMPT_VERSION = 'project-foundation-intake-v2'
const FOUNDATION_PROMPT_VERSION = 'project-foundation-v3-information-ready'
const FOUNDATION_MEMORY_PROMPT_VERSION = 'long-memory-foundation-v1'
const CHAPTER_MEMORY_PROMPT_VERSION = 'long-memory-incremental-v2-safe-rebuild'
const FALLBACK_CONTEXT_WINDOW = 64_000
const FOUNDATION_OUTPUT_MAX_TOKENS = 12_000
const FOUNDATION_LABELS: Record<ProjectFoundationKind, string> = { outline: '全书大纲', characters: '人物体系', worldbuilding: '世界观与规则', timeline: '故事时间线', foreshadowing: '伏笔与回收计划' }
const MAX_STYLE_SAMPLE_CHARACTERS = 24_000
const MAX_DRAFT_CONTINUATIONS = 2
const FOUNDATION_REVIEW_FOCUS: Record<ProjectFoundationKind, string> = {
  outline: '主线概念、主角目标、核心冲突、阶段转折、结局方向与题材边界',
  characters: '主要人物的目标、关系、行为边界、能力限制、知识边界和变化弧线',
  timeline: '故事起点、关键事件顺序、时间跨度、因果链、并行事件和不可逆节点',
  worldbuilding: '世界规则、阵营、场所和禁区',
  foreshadowing: '伏笔埋设、强化和回收节点',
}

function structuredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('invalid-state', message)
  return value as Record<string, unknown>
}

function clipPromptText(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters ? value : `${value.slice(0, maxCharacters).trimEnd()}\n[本区段已截断]`
}

interface GenerationAdvisory {
  kind: 'local-scene-plan-fallback' | 'plain-text-recovery' | 'continued-after-output-limit' | 'incomplete-after-output-limit'
  message: string
  requiresAuthorReview: boolean
}

function cancellationError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'CancellationError')
}

function retryableProviderError(cause: unknown): boolean {
  if (!(cause instanceof Error) || cause instanceof DomainError || cause instanceof ModelOutputLimitError || cancellationError(cause)) return false
  if (cause instanceof TypeError || cause instanceof RangeError || cause instanceof ReferenceError || cause instanceof SyntaxError) return false
  return !/(?:unauthori[sz]ed|authentication|invalid[_ -]?api[_ -]?key|permission denied|insufficient quota)/i.test(cause.message)
}

function salvageTextField(raw: string, fields: string[]): string {
  for (const field of fields) {
    const streamed = extractStreamingJsonString(raw, field).trim()
    if (streamed) return streamed
  }
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const value = parsed as Record<string, unknown>
      for (const field of fields) if (typeof value[field] === 'string' && value[field].trim()) return value[field].trim()
    }
  } catch { /* A streaming JSON string may be intentionally incomplete. */ }
  const plain = raw.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim()
  return plain && !/^[{[]/.test(plain) ? plain : ''
}

function appendWithoutRepeatedBoundary(base: string, continuation: string): string {
  const next = continuation.trimStart()
  if (!next) return base
  const maximum = Math.min(600, base.length, next.length)
  for (let length = maximum; length >= 12; length -= 1) {
    if (base.slice(-length) === next.slice(0, length)) return `${base}${next.slice(length)}`
  }
  return `${base}${base.endsWith('\n') ? '' : '\n'}${next}`
}

function mergeUsage(left?: ModelUsage, right?: ModelUsage): ModelUsage | undefined {
  if (!left) return right
  if (!right) return left
  const optional = (key: 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens') => {
    const values = [left[key], right[key]].filter((value): value is number => typeof value === 'number')
    return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined
  }
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...(optional('cacheReadTokens') === undefined ? {} : { cacheReadTokens: optional('cacheReadTokens') }),
    ...(optional('cacheWriteTokens') === undefined ? {} : { cacheWriteTokens: optional('cacheWriteTokens') }),
    ...(optional('reasoningTokens') === undefined ? {} : { reasoningTokens: optional('reasoningTokens') }),
  }
}

export class RegenerablePostProcessingError extends Error {
  readonly regenerable = true

  constructor(
    public readonly stage: 'memory-summary' | 'relationship-extraction',
    public readonly code: string,
    cause: Error,
  ) {
    super(cause.message)
    this.name = 'RegenerablePostProcessingError'
    ;(this as Error & { cause?: Error }).cause = cause
  }
}

function throwRegenerableGatewayError(stage: RegenerablePostProcessingError['stage'], cause: unknown): never {
  // Provider adapters commonly reject with Error subclasses or the explicit
  // ModelOutputLimitError. Programming/contract errors must remain fail-safe
  // even if they happen to escape from the gateway implementation.
  if (!(cause instanceof Error)
    || cause instanceof DomainError
    || cause instanceof TypeError
    || cause instanceof RangeError
    || cause instanceof ReferenceError
    || cause instanceof SyntaxError
    || cause.name === 'AbortError'
    || cause.name === 'CancellationError') throw cause
  const code = 'code' in cause && typeof cause.code === 'string' && cause.code.trim()
    ? cause.code.trim()
    : 'provider-error'
  throw new RegenerablePostProcessingError(stage, code, cause)
}

interface BatchPlanningSection {
  key: string
  label: string
  content: string
  priority: number
  maxTokens: number
  sourceIds: string[]
  preserveTail?: boolean
}

function fitTextToTokenBudget(text: string, budget: number, preserveTail = false): { text: string; truncated: boolean } {
  if (estimateTextTokens(text) <= budget) return { text, truncated: false }
  const fitPrefix = (value: string, tokenBudget: number): string => {
    let low = 0
    let high = value.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (estimateTextTokens(value.slice(0, middle)) <= tokenBudget) low = middle
      else high = middle - 1
    }
    return value.slice(0, low)
  }
  if (!preserveTail) {
    const marker = '\n[本区段已按批次规划预算截断]'
    return { text: `${fitPrefix(text, Math.max(1, budget - estimateTextTokens(marker))).trimEnd()}${marker}`, truncated: true }
  }
  const marker = '\n[本区段中段已省略；保留开头与结尾]\n'
  const usable = Math.max(2, budget - estimateTextTokens(marker))
  const headBudget = Math.max(1, Math.floor(usable * .62))
  const tailBudget = Math.max(1, usable - headBudget)
  const head = fitPrefix(text, headBudget).trimEnd()
  const reversedTail = fitPrefix([...text].reverse().join(''), tailBudget)
  return { text: `${head}${marker}${[...reversedTail].reverse().join('').trimStart()}`, truncated: true }
}

function assembleBatchPlanningSections(
  sections: BatchPlanningSection[],
  options: { contextWindow: number; contextWindowSource: 'provider' | 'fallback'; maxOutputTokens: number; system: string; fixedPrompt: string },
): { text: string; trace: PromptAssemblyTrace; candidateSectionCount: number; omittedSectionCount: number; omittedSourceIdCount: number } {
  const safetyTokens = Math.max(2_048, Math.min(8_192, Math.floor(options.contextWindow * .06)))
  const systemTokens = estimateTextTokens(options.system)
  const basePromptTokens = estimateTextTokens(options.fixedPrompt)
  const available = Math.max(0, options.contextWindow - options.maxOutputTokens - safetyTokens - systemTokens - basePromptTokens)
  const memoryBudgetTokens = Math.min(18_000, available)
  let remaining = memoryBudgetTokens
  let selectedMemoryTokens = 0
  const selected: string[] = []
  const traces: PromptAssemblyTrace['sections'] = []
  const candidates = [...sections].sort((left, right) => right.priority - left.priority)
  const boundedCandidates = candidates.slice(0, 240)
  let omittedSourceIdCount = candidates.slice(240).reduce((total, section) => total + section.sourceIds.length, 0)
  for (const section of boundedCandidates) {
    if (!section.content.trim()) continue
    const sourceIds = section.sourceIds.slice(0, 24)
    omittedSourceIdCount += Math.max(0, section.sourceIds.length - sourceIds.length)
    if (remaining < 64) {
      traces.push({ key: section.key, label: section.label, estimatedTokens: estimateTextTokens(section.content), included: false, truncated: false, reason: '批次规划输入预算已用尽', sourceIds })
      continue
    }
    const fitted = fitTextToTokenBudget(section.content, Math.min(section.maxTokens, remaining), section.preserveTail)
    const used = estimateTextTokens(fitted.text)
    selected.push(`## ${section.label}\n${fitted.text}`)
    selectedMemoryTokens += used
    remaining -= used
    traces.push({ key: section.key, label: section.label, estimatedTokens: used, included: true, truncated: fitted.truncated, reason: fitted.truncated ? '按批次规划区段上限截断' : '按权威优先级进入批次规划', sourceIds })
  }
  const text = selected.join('\n\n') || '没有可用的批准上下文。'
  return {
    text,
    trace: {
      contextWindow: options.contextWindow, contextWindowSource: options.contextWindowSource, maxOutputTokens: options.maxOutputTokens,
      safetyTokens, systemTokens, basePromptTokens, memoryBudgetTokens, selectedMemoryTokens,
      estimatedInputTokens: systemTokens + basePromptTokens + estimateTextTokens(text), sections: traces,
    },
    candidateSectionCount: candidates.length,
    omittedSectionCount: Math.max(0, candidates.length - boundedCandidates.length),
    omittedSourceIdCount,
  }
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, worker: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const run = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      results[index] = await worker(values[index]!, index)
    }
  }
  const settled = await Promise.allSettled(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, run))
  const failure = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected')
  if (failure) throw failure.reason
  return results
}

function normalizedPlannerEvaluation(value: unknown, hasUserAnswers: boolean): { informationSufficient: boolean; readinessSummary: string; questions: FoundationPlannerQuestion[] } {
  const record = structuredRecord(value, '模型未返回有效的规划问题。')
  if (typeof record.informationSufficient !== 'boolean') throw new DomainError('invalid-state', '规划阶段必须明确判断信息是否充分。')
  const readinessSummary = typeof record.readinessSummary === 'string' ? record.readinessSummary.trim() : ''
  if (!readinessSummary) throw new DomainError('invalid-state', '规划阶段必须说明当前信息准备度。')
  if (!hasUserAnswers && record.informationSufficient) throw new DomainError('invalid-state', '首次规划必须先向用户提问，不能直接判定信息充分。')
  if (!Array.isArray(record.questions)) throw new DomainError('invalid-state', '规划阶段 questions 必须是数组。')
  if (record.informationSufficient && record.questions.length !== 0) throw new DomainError('invalid-state', '信息充分后不应继续返回问题。')
  if (!record.informationSufficient && (record.questions.length < 1 || record.questions.length > 3)) throw new DomainError('invalid-state', '信息不足时需要返回 1 至 3 个关键问题。')
  const questions = record.questions.map((rawQuestion, questionIndex) => {
    const question = structuredRecord(rawQuestion, '规划问题格式无效。')
    const text = typeof question.question === 'string' ? question.question.trim() : ''
    const why = typeof question.why === 'string' ? question.why.trim() : ''
    if (!text || !why || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 3) {
      throw new DomainError('invalid-state', '每个规划问题都需要问题、提问原因和 2 至 3 个选项。')
    }
    return {
      id: `q${questionIndex + 1}`,
      question: text,
      why,
      options: question.options.map((rawOption, optionIndex) => {
        const option = structuredRecord(rawOption, '规划选项格式无效。')
        const label = typeof option.label === 'string' ? option.label.trim() : ''
        const description = typeof option.description === 'string' ? option.description.trim() : ''
        if (!label || !description) throw new DomainError('invalid-state', '每个规划选项都需要标题和说明。')
        return { id: `q${questionIndex + 1}-o${optionIndex + 1}`, label, description, recommended: option.recommended === true }
      }),
    }
  })
  return { informationSufficient: record.informationSufficient, readinessSummary, questions }
}

function styleString(record: Record<string, unknown>, key: keyof StyleProfileAttributes): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('invalid-state', `文风提炼结果缺少 ${String(key)}。`)
  return value.trim().slice(0, 1_200)
}

function styleList(record: Record<string, unknown>, key: keyof StyleProfileAttributes): string[] {
  const value = record[key]
  if (!Array.isArray(value)) throw new DomainError('invalid-state', `文风提炼结果缺少 ${String(key)} 列表。`)
  return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 8).map(item => item.slice(0, 240))
}

function normalizedStyleExtraction(value: unknown, fallbackName: string): { name: string; summary: string; attributes: StyleProfileAttributes } {
  const root = structuredRecord(value, '模型未返回有效的文风提炼结果。')
  const attributes = structuredRecord(root.attributes, '文风提炼结果缺少结构化 attributes。')
  const name = typeof root.name === 'string' && root.name.trim() ? root.name.trim().slice(0, 80) : fallbackName
  const summary = typeof root.summary === 'string' ? root.summary.trim().slice(0, 600) : ''
  if (!summary) throw new DomainError('invalid-state', '文风提炼结果缺少 summary。')
  return {
    name,
    summary,
    attributes: {
      narrativeVoice: styleString(attributes, 'narrativeVoice'),
      pointOfView: styleString(attributes, 'pointOfView'),
      tense: styleString(attributes, 'tense'),
      sentenceRhythm: styleString(attributes, 'sentenceRhythm'),
      paragraphRhythm: styleString(attributes, 'paragraphRhythm'),
      dialogueStyle: styleString(attributes, 'dialogueStyle'),
      descriptionStyle: styleString(attributes, 'descriptionStyle'),
      emotionalCadence: styleString(attributes, 'emotionalCadence'),
      pacing: styleString(attributes, 'pacing'),
      imagery: styleString(attributes, 'imagery'),
      expansionRules: styleList(attributes, 'expansionRules'),
      avoid: styleList(attributes, 'avoid'),
    },
  }
}

export class GenerationService {
  private readonly activeGenerations = new Set<string>()
  private readonly activeSelectionRewrites = new Set<string>()
  private readonly activeBatchPlans = new Map<string, Promise<ChapterGenerationBatch>>()

  constructor(private readonly repository: NovelRepository, private readonly gateway: ModelGateway) {}

  private async generateWithRetry(request: ModelGenerationRequest): Promise<ModelGenerationResponse> {
    try {
      return await this.gateway.generate(request)
    } catch (cause) {
      if (!retryableProviderError(cause)) throw cause
      return this.gateway.generate(request)
    }
  }

  private scenePlanFallback(context: GenerationContext, targetWords: number, cause: unknown): Record<string, unknown> {
    const chapterGoal = context.chapterBrief?.writingGoal || context.rules.chapterGoal || `推进《${context.chapter.title}》的核心冲突并形成明确变化`
    return {
      chapterGoal,
      scenes: [{
        scenePurpose: chapterGoal,
        openingState: context.chapterBrief?.openingContinuity || '承接已批准前文与当前人物状态',
        characterGoal: chapterGoal,
        opposition: '使主角目标不能立即完成的具体阻力',
        turn: '事件或信息产生明确变化',
        outcome: context.chapterBrief?.endingHook || '形成自然收束并为后续章节留下推进力',
        estimatedWords: targetWords,
      }],
      risks: [],
      _novelStudioGenerationAdvisory: {
        kind: 'local-scene-plan-fallback',
        message: `AI 未返回可解析的场景结构，已用章节目标生成最小可行计划，正文生成可继续。${cause instanceof Error ? `（${cause.message}）` : ''}`,
        requiresAuthorReview: false,
      } satisfies GenerationAdvisory,
    }
  }

  private async continueOutputLimitedDraft(
    context: GenerationContext,
    selection: ModelSelection,
    initial: ModelGenerationResponse,
    maxTokens: number,
    signal?: AbortSignal,
  ): Promise<{ manuscript: string; response: ModelGenerationResponse; advisory: GenerationAdvisory }> {
    let manuscript = salvageTextField(initial.text, ['manuscript'])
    if (!manuscript.trim()) throw new ModelOutputLimitError(initial, maxTokens)
    let usage = initial.usage
    let telemetry = initial.telemetry
    let continuationCount = 0
    let incomplete = true
    for (; continuationCount < MAX_DRAFT_CONTINUATIONS; continuationCount += 1) {
      const tail = manuscript.slice(-6_000)
      const continuationPrompt = `任务：上一次章节正文因服务的单次输出上限中断。从已保存结尾之后无缝续写，不得重复已写文字，完成未完的场景并让本章自然收束。\n\n项目：${context.project.title}\n章节：第 ${context.chapter.chapterNumber} 章《${context.chapter.title}》\n写作目标：${context.chapterBrief?.writingGoal || context.rules.chapterGoal || '推进当前冲突'}\n结尾钩子：${context.chapterBrief?.endingHook || '自然收束并保留后续推进力'}\n场景计划：${context.latestScenePlan?.contentJson ?? '无独立场景计划'}\n\n已保存正文结尾（只用于承接，返回时不得重复）：\n${tail}\n\n只输出 JSON：{"continuation":""}`
      let response: ModelGenerationResponse
      let hitLimit = false
      try {
        response = await this.generateWithRetry({
          selection,
          system: '你是 Novel Studio 的小说续写器。只续写因输出上限中断的当前章节，不重复前文，不修改已保存内容。',
          prompt: continuationPrompt,
          maxTokens,
          signal,
        })
      } catch (cause) {
        if (cause instanceof ModelOutputLimitError) {
          response = cause.partialResponse
          hitLimit = true
        } else if (cancellationError(cause)) {
          throw cause
        } else {
          break
        }
      }
      const continuation = salvageTextField(response.text, ['continuation', 'manuscript'])
      if (!continuation.trim()) break
      manuscript = appendWithoutRepeatedBoundary(manuscript, continuation)
      usage = mergeUsage(usage, response.usage)
      telemetry = response.telemetry ?? telemetry
      if (!hitLimit) {
        incomplete = false
        continuationCount += 1
        break
      }
    }
    return {
      manuscript,
      response: {
        text: manuscript,
        ...(usage ? { usage } : {}),
        ...(telemetry ? { telemetry: { ...telemetry, visibleCharacters: manuscript.length } } : {}),
      },
      advisory: incomplete
        ? { kind: 'incomplete-after-output-limit', message: '已保留模型返回的可用正文，但自动续写后仍可能未完全收束，请在审阅时检查结尾。', requiresAuthorReview: true }
        : { kind: 'continued-after-output-limit', message: `模型触发过单次输出上限，系统已自动续写 ${continuationCount} 段并合并为可审阅草稿。`, requiresAuthorReview: false },
    }
  }

  status() {
    const providers = this.gateway.providers()
    return { selection: this.gateway.selection(), providers, ready: providers.some(provider => provider.id === this.gateway.selection().provider) }
  }

  async extractWritingStyle(projectId: string, name: string, sampleText: string, baseRevision: number, signal?: AbortSignal): Promise<WritingStyleProfile> {
    const trimmed = sampleText.trim()
    if (trimmed.length < 300) throw new DomainError('validation', '用于提炼文风的样文至少需要 300 个字符。')
    if (trimmed.length > MAX_STYLE_SAMPLE_CHARACTERS) throw new DomainError('validation', `单次文风提炼最多接收 ${MAX_STYLE_SAMPLE_CHARACTERS} 个字符。`)
    const profileName = name.trim() || '我的自定义文风'
    const selection = this.gateway.selection()
    const capacity = await this.resolveCapacity(selection, signal)
    const system = '你是 Novel Studio 的文风分析器。只提炼可迁移的写作特征，不模仿或复述具体作者，不复制样文句子，不保存样文原文。只输出合法 JSON。'
    const prompt = `任务：从用户提供的样文中提炼一份可用于后续扩写的结构化文风配置。

文风名称：${profileName}

分析要求：
1. 只总结叙事声音、视角、时态、句子和段落节奏、对白、描写、情绪推进、场景节奏与意象等可迁移特征。
2. 不要提取人物、世界观、专名、具体剧情、连续原句或作者身份；这些不属于文风。
3. expansionRules 必须说明“扩写时应该增加什么、如何增加”，避免只给形容词。
4. avoid 必须列出会破坏这种文风的常见写法。
5. 不要把任何样文句子原样放进输出。

样文（只用于本次分析，不要在结果中复述）：
${trimmed}

只输出 JSON：{
  "name":"",
  "summary":"",
  "attributes":{
    "narrativeVoice":"",
    "pointOfView":"",
    "tense":"",
    "sentenceRhythm":"",
    "paragraphRhythm":"",
    "dialogueStyle":"",
    "descriptionStyle":"",
    "emotionalCadence":"",
    "pacing":"",
    "imagery":"",
    "expansionRules":[],
    "avoid":[]
  }
}`
    const response = await this.gateway.generate({ selection: this.lowReasoningSelection(selection, capacity), system, prompt, maxTokens: 2600, signal })
    const output = normalizedStyleExtraction(parseStructuredModelOutput(response.text), profileName)
    return this.repository.saveWritingStyleProfile(projectId, {
      source: 'extracted', profileId: `style-${projectId}`, presetId: null, name: output.name, summary: output.summary,
      attributes: output.attributes, sampleHash: createHash('sha256').update(trimmed).digest('hex'),
    }, baseRevision)
  }

  async generate(
    chapterId: string,
    purpose: GenerationPurpose,
    signal?: AbortSignal,
    workflowGuard?: { workflowRunId: string; workflowNodeRunId: string },
  ): Promise<GenerationResult> {
    const generationKey = `${chapterId}:${purpose}`
    if (this.activeGenerations.has(generationKey)) {
      throw new Error(purpose === 'scene-plan' ? '这个章节正在规划场景，请等待当前生成完成。' : '这个章节正在生成正文，请等待当前生成完成。')
    }
    this.activeGenerations.add(generationKey)
    try { return await this.generateOnce(chapterId, purpose, signal, workflowGuard) }
    finally { this.activeGenerations.delete(generationKey) }
  }

  async planChapterBatch(batchId: string, signal?: AbortSignal): Promise<ChapterGenerationBatch> {
    const existing = this.activeBatchPlans.get(batchId)
    if (existing) return existing
    const pending = this.planChapterBatchOnce(batchId, signal)
    this.activeBatchPlans.set(batchId, pending)
    try { return await pending }
    finally { if (this.activeBatchPlans.get(batchId) === pending) this.activeBatchPlans.delete(batchId) }
  }

  private async planChapterBatchOnce(batchId: string, signal?: AbortSignal): Promise<ChapterGenerationBatch> {
    const batch = this.repository.getChapterBatch(batchId)
    if (batch.status !== 'planning' || !batch.plan || batch.plan.status !== 'planning') throw new DomainError('invalid-state', '章节批次当前不需要规划。')
    const projectTree = this.repository.getProjectTree(batch.projectId)
    const policy = JSON.parse(batch.policyJson) as { selectedChapterIds?: string[]; startChapterId?: string | null }
    const chapterIds = batch.mode === 'selected' ? policy.selectedChapterIds ?? [] : policy.startChapterId ? [policy.startChapterId] : []
    const anchorChapters = chapterIds.map(chapterId => this.repository.getChapter(chapterId))
    const requestedAnchor = anchorChapters[0]
    if (!requestedAnchor) throw new DomainError('validation', '章节批次缺少有效的起始章节。')
    if (batch.mode === 'selected' && anchorChapters.length !== batch.requestedCount) throw new DomainError('validation', '选章批次缺少完整章节列表。')
    const chapterOrder = new Map<string, number>()
    const indexStoryOrder = (tree: ProjectTree): void => tree.books.forEach((book, bookIndex) => book.volumes.forEach(volume => volume.chapters.forEach(chapter => {
      chapterOrder.set(chapter.id, bookIndex * 1_000_000 + chapter.chapterNumber * 1000)
    })))
    indexStoryOrder(projectTree)
    const knowledge = this.repository.getKnowledgeWorkspace(batch.projectId)
    const selection = { provider: batch.plan.provider, model: batch.plan.model }
    const capacity = await this.resolveCapacity(selection, signal)
    const planningSelection = this.lowReasoningSelection(selection, capacity)
    const system = '你是 Novel Studio 的章节批次规划器。只规划章节目标与衔接，不写正文。批准的创作基建、正文、Canon、作者约束和确认关系按权威顺序约束规划。只输出合法 JSON。'
    const style = this.repository.getProjectStyleProfile(batch.projectId)
    const targetSnapshots: Array<Record<string, unknown>> = []
    const parsedOutputs: Array<{ chapterId: string; output: unknown }> = []
    const streamedOutputs: Array<{ chapterId: string; text: string }> = []

    const planTarget = async (chapter: typeof requestedAnchor, expectedCount: number, continuous: boolean) => {
      const context = this.repository.getGenerationContext(chapter.id, 'scene-plan')
      const storyOrder = chapterOrder.get(chapter.id) ?? chapter.chapterNumber * 1000
      const sections: BatchPlanningSection[] = []
      const foundationTokens = Math.max(1_200, Math.min(2_400, Math.floor(6_000 / Math.max(1, context.foundationVersions.length))))
      for (const version of context.foundationVersions) sections.push({
        key: `foundation:${version.kind}:${version.id}`, label: `${FOUNDATION_LABELS[version.kind]} · 已批准 v${version.version}`,
        content: version.content, priority: 500, maxTokens: foundationTokens, sourceIds: [version.id], preserveTail: true,
      })
      const canonBoundary = continuous ? storyOrder : storyOrder - 1
      const visibleCanon = knowledge.canonFacts.filter(item => (chapterOrder.get(item.chapterId) ?? Number.MAX_SAFE_INTEGER) <= canonBoundary)
      for (const fact of visibleCanon) sections.push({
        key: `canon:${fact.id}`, label: `Canon · ${fact.subject} ${fact.predicate}`,
        content: fact.valueJson, priority: 490, maxTokens: 360, sourceIds: [fact.id, fact.sourceManuscriptVersionId],
      })
      if (continuous && context.chapter.currentApprovedVersionId) {
        const approved = context.chapter.versions.find(version => version.id === context.chapter.currentApprovedVersionId && version.status === 'approved')
        if (approved) sections.push({
          key: `anchor-approved:${approved.id}`, label: `连续规划起点 · 第 ${chapter.chapterNumber} 章批准正文`, content: approved.content,
          priority: 480, maxTokens: 2_000, sourceIds: [chapter.id, approved.id], preserveTail: true,
        })
      }
      if (context.previousChapterContinuity) sections.push({
        key: `previous-ending:${context.previousChapterContinuity.approvedVersionId}`, label: '紧邻前章批准结尾',
        content: context.previousChapterContinuity.approvedEndingExcerpt, priority: 480, maxTokens: 1_500,
        sourceIds: [context.previousChapterContinuity.chapterId, context.previousChapterContinuity.approvedVersionId], preserveTail: true,
      })
      for (const item of context.authorMemory ?? []) {
        if (item.state !== 'active' || item.promptPolicy !== 'auto') continue
        const constraint = item.category === 'constraint' || item.category === 'continuity'
        sections.push({
          key: `memory:${item.id}`, label: `${constraint ? '作者硬约束' : '作者参考'} · ${item.category}`, content: item.currentRevision.content,
          priority: constraint ? 470 : 180, maxTokens: constraint ? 1_500 : 900, sourceIds: [item.id, item.currentRevision.id],
        })
      }
      for (const relation of context.confirmedRelationships ?? []) if (relation.status === 'active') sections.push({
        key: `relationship:${relation.id}`, label: '作者已确认实体关系',
        content: `${relation.sourceEntityName} ${relation.directionality === 'symmetric' ? '↔' : '→'} ${relation.targetEntityName}：${relation.label}（${relation.factLayer}）`,
        priority: 465, maxTokens: 320, sourceIds: [relation.id],
      })
      for (const item of context.priorChapterSummaries) sections.push({
        key: `chapter-summary:${item.summary.id}`, label: `第 ${item.chapterNumber} 章《${item.chapterTitle}》批准摘要`,
        content: item.summary.compactNarrative || item.summary.content, priority: 440, maxTokens: 900,
        sourceIds: [item.summary.id, item.chapterId, item.approvedVersionId, ...item.summary.sourceVersionIds],
      })
      for (const summary of context.longMemory) sections.push({
        key: `summary:${summary.scope}:${summary.id}`,
        label: summary.scope === 'foundation' ? '创作圣经压缩索引（仅作补充）' : `${summary.scope} 派生长篇记忆`,
        content: summary.compactNarrative || summary.content, priority: summary.scope === 'foundation' ? 450 : 300,
        maxTokens: summary.scope === 'chapter' ? 800 : 1_500, sourceIds: [summary.id, ...summary.sourceVersionIds],
      })

      const targetDescription = continuous
        ? `从第 ${chapter.chapterNumber} 章《${chapter.title}》之后，在同一卷连续规划 ${expectedCount} 个新章节。每项 chapterId 必须为 null。`
        : `只规划这个已有章节：${chapter.id} · 第 ${chapter.chapterNumber} 章《${chapter.title}》。这是独立安全调用，不得猜测其他队列章节。`
      const fixedPrompt = `任务：为小说项目规划严格串行批次中的章节 Brief。\n\n项目：${projectTree.project.title}\n题材：${projectTree.project.genre ?? '未指定'}\n默认目标字数：${projectTree.project.chapterTargetWords ?? 3000}\n${targetDescription}\n项目文风：${clipPromptText(context.rules.styleRules || style.summary || '保持当前既有叙事风格。', 2_000)}\n\n[此处插入有界批准上下文]\n\n为每章给出具体标题、写作目标、前章承接点、结尾钩子和目标字数。${continuous ? '相邻章必须形成因果连续链，不能重置人物状态。' : 'Brief 只能使用该章故事位置之前的事实；执行队列不代表故事相邻。'}不要把占位审校描述成质量保证。只输出 JSON：{"items":[{"chapterId":${continuous ? 'null' : JSON.stringify(chapter.id)},"plannedTitle":"","writingGoal":"","openingContinuity":"","endingHook":"","targetWords":3000}]}`
      const maxTokens = Math.min(8_000, 900 + expectedCount * 380)
      const assembled = assembleBatchPlanningSections(sections, {
        contextWindow: capacity.contextWindow ?? FALLBACK_CONTEXT_WINDOW, contextWindowSource: capacity.contextWindowSource,
        maxOutputTokens: maxTokens, system, fixedPrompt,
      })
      const prompt = fixedPrompt.replace('[此处插入有界批准上下文]', `批准上下文（按权威排序，派生摘要不得覆盖批准原文）：\n${assembled.text}`)
      const promptHash = createHash('sha256').update(`${system}\n${prompt}`).digest('hex')
      let response: ModelGenerationResponse = { text: '' }
      let parsed: unknown
      let normalized: ReturnType<typeof normalizeChapterBatchPlan>
      try {
        response = await this.generateWithRetry({ selection: planningSelection, system, prompt, maxTokens, signal })
        parsed = parseStructuredModelOutput(response.text)
        if (continuous) {
          normalized = normalizeChapterBatchPlan(parsed, { mode: 'continuous', requestedCount: expectedCount, defaultTargetWords: projectTree.project.chapterTargetWords ?? 3000 })
        } else {
          const root = structuredRecord(parsed, '模型未返回有效的单章批次计划。')
          const rows = Array.isArray(root.items) ? root.items : Array.isArray(root.chapters) ? root.chapters : null
          if (!rows || rows.length !== 1) throw new DomainError('validation', '单章批次规划必须只返回一项。')
          normalized = normalizeChapterBatchPlan({ items: [{ ...structuredRecord(rows[0], '单章批次计划格式无效。'), chapterId: chapter.id }] }, {
            mode: 'selected', requestedCount: 1, selectedChapterIds: [chapter.id], defaultTargetWords: projectTree.project.chapterTargetWords ?? 3000,
          })
        }
      } catch (cause) {
        if (cancellationError(cause) || cause instanceof TypeError || cause instanceof RangeError || cause instanceof ReferenceError) throw cause
        const defaultTargetWords = projectTree.project.chapterTargetWords ?? 3000
        const fallbackItems = Array.from({ length: expectedCount }, (_, index) => ({
          chapterId: continuous ? null : chapter.id,
          plannedTitle: continuous ? `第 ${chapter.chapterNumber + index + 1} 章` : chapter.title,
          writingGoal: context.chapterBrief?.writingGoal || context.rules.chapterGoal || '承接已批准前文，推进当前核心冲突并形成明确变化',
          openingContinuity: index === 0 ? context.chapterBrief?.openingContinuity || '从最近已批准章节的人物状态自然承接' : '承接批次中上一章的结果，不重置人物状态',
          endingHook: context.chapterBrief?.endingHook || '形成自然收束，并留下可继续推进的事件或问题',
          targetWords: defaultTargetWords,
        }))
        parsed = { items: fallbackItems, _novelStudioPlanningAdvisory: { kind: 'local-plan-fallback', message: '模型未返回可用的批次计划，已创建可编辑的本地计划草稿。' } }
        normalized = normalizeChapterBatchPlan(parsed, continuous
          ? { mode: 'continuous', requestedCount: expectedCount, defaultTargetWords }
          : { mode: 'selected', requestedCount: 1, selectedChapterIds: [chapter.id], defaultTargetWords })
      }
      targetSnapshots.push({
        chapterId: chapter.id, storyOrder, chapterRevision: context.chapter.revision,
        currentApprovedVersionId: context.chapter.currentApprovedVersionId,
        foundationAssemblyHash: context.foundationAssemblyHash, foundationVersionIds: context.foundationVersions.map(version => version.id),
        authoritySnapshot: {
          canonFactIds: visibleCanon.map(fact => fact.id).sort(),
          authorMemoryRevisions: (context.authorMemory ?? []).filter(item => item.state === 'active' && item.promptPolicy === 'auto').map(item => `${item.id}:${item.currentRevision.id}`).sort(),
          longMemoryRevisions: context.longMemory.map(summary => `${summary.id}:${summary.contentHash}`).sort(),
          confirmedRelationshipIds: (context.confirmedRelationships ?? []).filter(item => item.status === 'active').map(item => item.id).sort(),
          priorApprovedVersionIds: context.priorChapterSummaries.map(item => item.approvedVersionId).sort(),
        },
        promptHash,
        trace: { ...assembled.trace, candidateSectionCount: assembled.candidateSectionCount, omittedSectionCount: assembled.omittedSectionCount, omittedSourceIdCount: assembled.omittedSourceIdCount },
      })
      parsedOutputs.push({ chapterId: chapter.id, output: parsed })
      streamedOutputs.push({ chapterId: chapter.id, text: response.text })
      return normalized.items
    }

    try {
      const items = batch.mode === 'selected'
        ? (await mapWithConcurrency(anchorChapters, 2, chapter => planTarget(chapter, 1, false))).flat()
        : await planTarget(requestedAnchor, batch.requestedCount, true)
      const targetOrder = new Map(anchorChapters.map((chapter, index) => [chapter.id, index]))
      const orderOf = (chapterId: string) => targetOrder.get(chapterId) ?? 0
      targetSnapshots.sort((left, right) => orderOf(String(left.chapterId)) - orderOf(String(right.chapterId)))
      parsedOutputs.sort((left, right) => orderOf(left.chapterId) - orderOf(right.chapterId))
      streamedOutputs.sort((left, right) => orderOf(left.chapterId) - orderOf(right.chapterId))
      const aggregatePromptHash = createHash('sha256').update(targetSnapshots.map(target => String(target.promptHash)).join('\n')).digest('hex')
      const inputSnapshotJson = JSON.stringify({
        schemaVersion: 2, purpose: 'chapter-batch-plan', plannerVersion: 'chapter-batch-plan-v2-safe-context',
        projectId: batch.projectId, projectRevision: projectTree.project.revision, mode: batch.mode,
        selection: planningSelection, foundationAssemblyHash: targetSnapshots[0]?.foundationAssemblyHash ?? null, styleRevision: style.revision,
        aggregatePromptHash, targets: targetSnapshots,
      })
      return this.repository.completeChapterBatchPlan(batchId, items, {
        promptHash: aggregatePromptHash, inputSnapshotJson,
        outputJson: JSON.stringify({ items, modelOutputs: parsedOutputs }), streamedText: streamedOutputs.map(item => item.text).join('\n'),
      })
    } catch (cause) {
      this.repository.failChapterBatchPlan(batchId, cause)
      throw cause
    }
  }

  async extractEntityRelationships(workflowRunId: string, signal?: AbortSignal): Promise<RelationshipCandidate[]> {
    const workflow = this.repository.getWorkflowRun(workflowRunId)
    const mode = this.repository.getRelationshipMode(workflow.projectId)
    if (mode === 'off') return []
    if (!workflow.approvedVersionId) throw new DomainError('invalid-state', '关系提取只读取已批准正文。')
    const chapter = this.repository.getChapter(workflow.chapterId)
    const approved = chapter.versions.find(version => version.id === workflow.approvedVersionId && version.status === 'approved')
    if (!approved) throw new DomainError('invalid-state', '关系提取来源正文未批准。')
    const knowledge = this.repository.getKnowledgeWorkspace(workflow.projectId)
    const foundation = this.repository.getApprovedProjectFoundationVersions(workflow.projectId)
    const projectTree = this.repository.getProjectTree(workflow.projectId)
    const chapterOrder = new Map<string, number>()
    projectTree.books.forEach((book, bookIndex) => book.volumes.forEach(volume => volume.chapters.forEach(item => {
      chapterOrder.set(item.id, bookIndex * 1_000_000 + item.chapterNumber * 1000)
    })))
    const currentOrder = chapterOrder.get(chapter.id) ?? chapter.chapterNumber
    const allowedVersionIds = new Set(projectTree.books.flatMap((book, bookIndex) => book.volumes.flatMap(volume => volume.chapters
      .filter(item => bookIndex * 1_000_000 + item.chapterNumber * 1000 <= currentOrder)
      .flatMap(item => item.currentApprovedVersionId ? [item.currentApprovedVersionId] : []))))
    const visibleEntities = knowledge.entities.filter(entity => !entity.sourceManuscriptVersionId || allowedVersionIds.has(entity.sourceManuscriptVersionId))
    const visibleTimeline = knowledge.timeline.filter(event => allowedVersionIds.has(event.sourceManuscriptVersionId))
      .sort((left, right) => (chapterOrder.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER))
      .slice(-30)
    const visibleForeshadowing = knowledge.foreshadowing.filter(item => !item.sourceManuscriptVersionId || allowedVersionIds.has(item.sourceManuscriptVersionId))
    const selection = this.gateway.selection()
    const sourceSnapshot = {
      workflowRunId, manuscriptVersionId: approved.id, foundationVersionIds: foundation.map(version => version.id),
      canonFactIds: workflow.canonFacts.map(fact => fact.id), timelineEventIds: visibleTimeline.map(event => event.id),
      foreshadowingIds: visibleForeshadowing.map(item => item.id), visibleEntityIds: visibleEntities.map(entity => entity.id),
    }
    const system = '你是 Novel Studio 的实体关系提取器。只提取本章批准正文中能逐字定位证据的实体关系；不得把背景设定、Canon、时间线、猜测、候选或草稿单独当作本章证据。端点优先使用给定实体 ID。只输出合法 JSON。'
    const prompt = `任务：从本章批准正文中提取本章新增或发生变化的实体关系。批准创作基建、Canon、时间线与伏笔只用于核对冲突和实体身份，不能作为本次关系的独立证据。\n\n已知实体（只含截至本章已批准来源；只能使用这些 ID，无法唯一匹配时 endpoint id 返回 null 并保留 label）：\n${visibleEntities.map(entity => `${entity.id} | ${entity.type} | ${entity.name}${entity.aliases.length ? ` | 别名 ${entity.aliases.join('、')}` : ''}`).join('\n')}\n\n批准创作基建（校验约束，不可单独作为证据）：\n${foundation.map(version => `## ${version.title}\n${version.content}`).join('\n\n')}\n\n本章批准正文（唯一允许的关系证据来源）：\n${approved.content}\n\n本章 Canon（仅校验）：\n${workflow.canonFacts.map(fact => `${fact.subject} ${fact.predicate} ${fact.valueJson}`).join('\n') || '暂无'}\n\n截至本章的时间线（仅校验）：\n${visibleTimeline.map(event => `${event.storyOrder} ${event.title}：${event.summary}`).join('\n') || '暂无'}\n\n截至本章的伏笔（仅校验）：\n${visibleForeshadowing.map(item => `${item.title} [${item.status}]：${item.description}`).join('\n') || '暂无'}\n\n规则：category 只能是 family/emotion/alliance/conflict/membership/possession/location/knowledge/causality/other；directionality 为 directed 或 symmetric；本次事实层固定为 canon；confidence 为 0 到 1。evidenceLabel 必须逐字摘录本章批准正文中的短句，不能概括。关系起点由系统锚定在本章；候选不得自行进入 Prompt。只输出 JSON：{"relationships":[{"sourceEntityId":null,"targetEntityId":null,"sourceLabel":"","targetLabel":"","predicateKey":"","label":"","category":"other","directionality":"directed","validToStoryOrder":null,"confidence":0.8,"evidenceLabel":"批准正文中的逐字短句"}]}`
    const promptHash = createHash('sha256').update(`${system}\n${prompt}`).digest('hex')
    const extractionRunId = this.repository.createRelationshipExtractionRun(workflow.projectId, mode, selection, JSON.stringify(sourceSnapshot), promptHash)
    try {
      let response: Awaited<ReturnType<ModelGateway['generate']>>
      try {
        response = await this.gateway.generate({ selection, system, prompt, maxTokens: 4200, signal })
      } catch (cause) {
        throwRegenerableGatewayError('relationship-extraction', cause)
      }
      let root: Record<string, unknown>
      try {
        root = structuredRecord(parseStructuredModelOutput(response.text), '模型未返回有效的关系提取结果。')
        if (!Array.isArray(root.relationships)) throw new DomainError('invalid-state', '关系提取结果缺少 relationships 数组。')
      } catch (cause) {
        if (!(cause instanceof DomainError)) throw cause
        throw new RegenerablePostProcessingError('relationship-extraction', 'invalid-model-output', cause)
      }
      const categories = ['family', 'emotion', 'alliance', 'conflict', 'membership', 'possession', 'location', 'knowledge', 'causality', 'other'] as const
      const candidates = (root.relationships as unknown[]).slice(0, 200).flatMap((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
        const value = raw as Record<string, unknown>
        const category = typeof value.category === 'string' && categories.includes(value.category as typeof categories[number]) ? value.category as typeof categories[number] : 'other'
        const directionality = value.directionality === 'symmetric' ? 'symmetric' as const : 'directed' as const
        const factLayer = 'canon' as const
        const sourceLabel = typeof value.sourceLabel === 'string' ? value.sourceLabel.trim() : ''
        const targetLabel = typeof value.targetLabel === 'string' ? value.targetLabel.trim() : ''
        const predicateKey = typeof value.predicateKey === 'string' ? value.predicateKey.trim() : ''
        const label = typeof value.label === 'string' ? value.label.trim() : ''
        if (!sourceLabel || !targetLabel || !predicateKey || !label) return []
        const evidenceLabel = typeof value.evidenceLabel === 'string' ? value.evidenceLabel.trim() : ''
        const evidenceStart = evidenceLabel ? approved.content.indexOf(evidenceLabel) : -1
        const evidenceLocated = evidenceStart >= 0 && approved.content.lastIndexOf(evidenceLabel) === evidenceStart
        const evidenceEnd = evidenceLocated ? evidenceStart + evidenceLabel.length : null
        return [{
          // Evidence that cannot be located verbatim stays ambiguous and is
          // never auto-committed, while the writing workflow keeps moving.
          sourceEntityId: evidenceLocated && typeof value.sourceEntityId === 'string' && value.sourceEntityId.trim() ? value.sourceEntityId.trim() : null,
          targetEntityId: evidenceLocated && typeof value.targetEntityId === 'string' && value.targetEntityId.trim() ? value.targetEntityId.trim() : null,
          sourceLabel, targetLabel, predicateKey, label, category, directionality, factLayer,
          validFromStoryOrder: currentOrder,
          validToStoryOrder: null,
          confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : 0,
          evidenceJson: JSON.stringify([{
            sourceType: 'manuscript-version', sourceId: approved.id, sourceVersionId: approved.id,
            label: evidenceLocated ? evidenceLabel.slice(0, 300) : `第 ${chapter.chapterNumber} 章批准正文 · 证据摘录未能唯一定位`,
            excerptStart: evidenceLocated ? evidenceStart : null, excerptEnd: evidenceEnd, contentHash: approved.contentHash,
          }]),
          fingerprint: '',
        }]
      })
      return this.repository.completeRelationshipExtractionRun(extractionRunId, candidates)
    } catch (cause) {
      this.repository.failRelationshipExtractionRun(extractionRunId, cause)
      throw cause
    }
  }

  async rewriteSelection(chapterId: string, input: SelectionRewriteInput, signal?: AbortSignal): Promise<SelectionRewriteResult> {
    const selectedText = input.selectedText
    const instruction = input.instruction.trim()
    if (!selectedText.trim()) throw new DomainError('validation', '请先选中需要重写的正文。')
    if (selectedText.length > MAX_SELECTION_REWRITE_CHARACTERS) throw new DomainError('validation', `单次最多重写 ${MAX_SELECTION_REWRITE_CHARACTERS} 个字符。`)
    if (instruction.length > MAX_SELECTION_REWRITE_INSTRUCTION_CHARACTERS) throw new DomainError('validation', `重写要求最多 ${MAX_SELECTION_REWRITE_INSTRUCTION_CHARACTERS} 个字符。`)
    if (input.contextBefore.length > MAX_SELECTION_CONTEXT_CHARACTERS || input.contextAfter.length > MAX_SELECTION_CONTEXT_CHARACTERS) {
      throw new DomainError('validation', '选区前后文超出允许范围。')
    }
    const generationKey = `${chapterId}:selection-rewrite`
    if (this.activeSelectionRewrites.has(generationKey)) throw new DomainError('invalid-state', '这个章节已有选区正在重写，请等待当前重写完成。')
    this.activeSelectionRewrites.add(generationKey)
    try {
      const context = this.repository.getGenerationContext(chapterId, 'chapter-draft')
      if (context.chapter.revision !== input.baseRevision) throw new DomainError('revision-conflict', '章节版本已经变化，请重新选择需要重写的内容。')
      const baseSelection = this.gateway.selection()
      const capacity = await this.resolveCapacity(baseSelection, signal)
      const selection = this.lowReasoningSelection(baseSelection, capacity)
      const foundationAuthority = renderFoundationAuthorityExcerpt(context, 8_000)
      const continuity = context.longMemory
        .filter(summary => summary.scope !== 'foundation')
        .map(summary => `${summary.scope}：${summary.compactNarrative || summary.content}`)
        .join('\n\n')
      const projectTree = this.repository.getProjectTree(context.project.id)
      const chapterOrder = new Map<string, number>()
      projectTree.books.forEach((book, bookIndex) => book.volumes.forEach(volume => volume.chapters.forEach(chapter => {
        chapterOrder.set(chapter.id, bookIndex * 1_000_000 + chapter.chapterNumber * 1000)
      })))
      const currentOrder = chapterOrder.get(context.chapter.id) ?? context.chapter.chapterNumber
      const knowledge = this.repository.getKnowledgeWorkspace(context.project.id)
      const canon = knowledge.canonFacts
        .filter(fact => (chapterOrder.get(fact.chapterId) ?? Number.MAX_SAFE_INTEGER) <= currentOrder)
        .map(fact => `${fact.subject} ${fact.predicate} ${fact.valueJson}`).join('\n')
      const authorConstraints = (context.authorMemory ?? []).filter(item => item.state === 'active' && item.promptPolicy === 'auto' && ['constraint', 'continuity'].includes(item.category))
        .map(item => `${item.category}：${item.currentRevision.content}`).join('\n\n')
      const authorReferences = (context.authorMemory ?? []).filter(item => item.state === 'active' && item.promptPolicy === 'auto' && !['constraint', 'continuity'].includes(item.category))
        .map(item => `${item.category}：${item.currentRevision.content}`).join('\n\n')
      const confirmedRelationships = (context.confirmedRelationships ?? []).filter(item => item.status === 'active')
        .map(item => `${item.sourceEntityName} ${item.directionality === 'symmetric' ? '↔' : '→'} ${item.targetEntityName}：${item.label}（${item.factLayer}）`).join('\n')
      const retrievalConflicts = context.retrievalBundle?.conflicts.join('；') ?? ''
      const system = '你是 Novel Studio 的行内文字编辑。只重写用户明确选中的片段；不能续写整章，不能返回选区外文字，不能解释修改过程。已批准的项目设定、人物边界、时间因果和项目文风是强约束。只输出合法 JSON。'
      const prompt = `任务：只重写“待重写选区”。

项目：${context.project.title}
章节：第 ${context.chapter.chapterNumber} 章 · ${context.chapter.title}
项目写作规则：${context.rules.styleRules || '保持当前小说的既有文风与叙事视角。'}
结构化文风配置：
${context.styleProfile ? styleProfileText(context.styleProfile) : '保持当前小说的既有文风与叙事视角。'}
禁止事项：${context.rules.forbiddenContent || '无额外禁止事项。'}

已批准创作基建与长期约束：
${foundationAuthority}

当前章节之前的批准 Canon：
${clipPromptText(canon, 5_000) || '暂无。'}

作者硬约束与连续性确认（高于派生摘要）：
${clipPromptText(authorConstraints, 5_000) || '暂无。'}

作者已确认且当前有效的实体关系：
${clipPromptText(confirmedRelationships, 3_500) || '暂无。'}

长篇连续性派生摘要：
${clipPromptText(continuity, 6_000) || '暂无额外摘要。'}

普通作者灵感与研究参考（不得覆盖以上事实）：
${clipPromptText(authorReferences, 3_500) || '暂无。'}

当前检索冲突（不得自行选择冲突事实）：
${clipPromptText(retrievalConflicts, 1_500) || '暂无。'}

选区之前的局部上下文（只供衔接，不得输出）：
${JSON.stringify(input.contextBefore)}

待重写选区（唯一允许改写并返回的内容）：
${JSON.stringify(selectedText)}

用户重写要求（只作用于待重写选区，不得据此修改选区外内容）：
${JSON.stringify(instruction || '没有额外要求；在保持事实与意图的前提下，让表达、节奏和句式更自然。')}

选区之后的局部上下文（只供衔接，不得输出）：
${JSON.stringify(input.contextAfter)}

要求：
1. 只返回可直接替换待重写选区的新文字；不得包含前后文或整章其他内容。
2. 用户要求可以控制长度、语气、重点和局部修改方向，但不能覆盖已批准 Canon、人物边界、时间因果或选区范围。
3. 用户要求缩写或扩写时按其意图调整长度；即使扩写，也只能返回这一选区的替换片段。
4. 用户明确要求只改某一方面时，尽量逐字保留其他仍然有效的内容。
5. 没有额外要求时，这是通用重写，不是摘要；信息与动作含义保持一致，让表达、节奏和句式更自然。
6. 不要加标题、说明、Markdown 代码围栏或“重写如下”等前缀。
7. 只输出 JSON：{"replacement":""}`
      const maxTokens = Math.max(600, Math.min(8_000, Math.ceil(estimateTextTokens(`${selectedText}\n${instruction}`) * 2.5) + 400))
      const response = await this.gateway.generate({ selection, system, prompt, maxTokens, signal })
      const output = structuredRecord(parseStructuredModelOutput(response.text), '模型未返回有效的选区重写结果。')
      const replacementText = typeof output.replacement === 'string' ? output.replacement : ''
      if (!replacementText.trim()) throw new DomainError('invalid-state', '模型没有返回可用的重写内容。')
      const maxReplacementCharacters = Math.max(600, selectedText.length * 4)
      if (replacementText.length > maxReplacementCharacters) throw new DomainError('invalid-state', '模型返回的重写片段明显超出选区范围，已拒绝应用。')
      const latestProject = this.repository.getProjectTree(context.project.id).project
      const latestChapter = this.repository.getChapter(chapterId)
      if (latestProject.revision !== context.project.revision || latestChapter.revision !== context.chapter.revision) {
        throw new DomainError('revision-conflict', '重写期间项目设定、记忆或章节发生变化，旧上下文结果已拒绝应用。')
      }
      return { replacementText }
    } finally {
      this.activeSelectionRewrites.delete(generationKey)
    }
  }

  private async generateOnce(
    chapterId: string,
    purpose: GenerationPurpose,
    signal?: AbortSignal,
    workflowGuard?: { workflowRunId: string; workflowNodeRunId: string },
  ): Promise<GenerationResult> {
    let context = this.repository.getGenerationContext(chapterId, purpose)
    const selection = this.gateway.selection()
    const capacity = await this.resolveCapacity(selection, signal)
    const effectiveTargetWords = effectiveChapterTargetWords(context)
    const outputBudget = chapterDraftBudget(effectiveTargetWords, capacity.defaultMaxTokens)
    const maxTokens = purpose === 'scene-plan' ? 1800 : outputBudget.maxTokens
    if (this.gateway.resolveCapacity) context = await this.ensureFoundationMemory(context, selection, capacity, signal)
    const generationSelection = this.lowReasoningSelection(selection, capacity)
    const assembled = renderBudgetedGenerationPrompt(context, { contextWindow: capacity.contextWindow ?? FALLBACK_CONTEXT_WINDOW, contextWindowSource: capacity.contextWindowSource, maxOutputTokens: maxTokens, system: SYSTEM_PROMPT })
    const prompt = assembled.prompt
    const snapshot = {
      purpose,
      projectId: context.project.id,
      projectRevision: context.project.revision,
      chapterId: context.chapter.id,
      chapterRevision: context.chapter.revision,
      inputManuscriptVersionId: context.inputManuscriptVersionId,
      promptAssetVersionId: context.promptVersion.id,
      promptContentHash: context.promptVersion.contentHash,
      projectRulesRevision: context.rules.revision,
      styleProfile: context.styleProfile ? { profileId: context.styleProfile.profileId, presetId: context.styleProfile.presetId, revision: context.styleProfile.revision, sampleHash: context.styleProfile.sampleHash, name: context.styleProfile.name } : null,
      filesystemMemory: context.filesystemMemory?.map(file => ({ name: file.path.split(/[\\/]/).at(-1) ?? 'memory.md', hash: file.hash })) ?? [],
      foundationVersionIds: context.foundationVersions.map(version => version.id),
      foundationAssemblyHash: context.foundationAssemblyHash,
      scenePlanId: context.latestScenePlan?.id ?? null,
      retrievalBundleId: context.retrievalBundle?.id ?? null,
      knowledgeSelectionSnapshotId: context.retrievalBundle?.selectionSnapshotId ?? null,
      continuity: {
        mode: context.previousChapterContinuity ? 'continuation' : 'opening-or-no-approved-predecessor',
        previousChapter: context.previousChapterContinuity ? {
          chapterId: context.previousChapterContinuity.chapterId,
          chapterNumber: context.previousChapterContinuity.chapterNumber,
          approvedVersionId: context.previousChapterContinuity.approvedVersionId,
          summaryId: context.previousChapterContinuity.summary?.id ?? null,
        } : null,
        priorChapterSummaryIds: context.priorChapterSummaries.map(item => item.summary.id),
        priorApprovedVersionIds: context.priorChapterSummaries.map(item => item.approvedVersionId),
      },
      reasoningEffort: generationSelection.reasoningEffort ?? selection.reasoningEffort ?? null,
      effectiveTargetWords,
      outputBudget: purpose === 'chapter-draft' ? outputBudget : { targetWords: effectiveTargetWords, maxTokens },
      scenePlanWordBudgetAudit: purpose === 'chapter-draft' && context.latestScenePlan
        ? scenePlanWordBudgetAudit(context.latestScenePlan.contentJson, effectiveTargetWords)
        : null,
      workflowGuard: workflowGuard ?? null,
      promptAssemblyTrace: assembled.trace,
      renderedPrompt: prompt,
    }
    const run = this.repository.startModelRun(context, generationSelection, JSON.stringify(snapshot))
    let pendingTelemetry: GenerationTelemetry | undefined
    const streamWriter = purpose === 'chapter-draft'
      ? createThrottledStreamWriter(text => { this.repository.updateModelRunStream(run.id, text, pendingTelemetry) })
      : null
    try {
      let response: ModelGenerationResponse | null = null
      let output: Record<string, unknown> | null = null
      let advisory: GenerationAdvisory | null = null
      try {
        response = await this.generateWithRetry({
          selection: generationSelection, system: SYSTEM_PROMPT, prompt,
          maxTokens,
          signal,
          ...(streamWriter ? { onProgress: ({ text, telemetry }) => { pendingTelemetry = telemetry; streamWriter.push(extractStreamingJsonString(text, 'manuscript')) } } : {}),
        })
      } catch (cause) {
        if (cancellationError(cause)) throw cause
        if (purpose === 'scene-plan') {
          response = { text: '' }
          output = this.scenePlanFallback(context, effectiveTargetWords, cause)
        } else if (cause instanceof ModelOutputLimitError) {
          const recovered = await this.continueOutputLimitedDraft(context, generationSelection, cause.partialResponse, maxTokens, signal)
          response = recovered.response
          output = { manuscript: recovered.manuscript }
          advisory = recovered.advisory
        } else {
          throw cause
        }
      }
      if (!response) throw new DomainError('invalid-state', 'Model did not return a usable response.')
      if (streamWriter) {
        streamWriter.push(salvageTextField(response.text, ['manuscript']))
        streamWriter.flush()
      }
      if (!output) {
        try {
          const parsed = parseStructuredModelOutput(response.text)
          validateGenerationOutput(purpose, parsed)
          output = parsed
        } catch (cause) {
          if (purpose === 'scene-plan') {
            output = this.scenePlanFallback(context, effectiveTargetWords, cause)
          } else {
            const manuscript = salvageTextField(response.text, ['manuscript', 'content', 'text'])
            if (!manuscript.trim()) throw cause
            output = { manuscript }
            advisory = { kind: 'plain-text-recovery', message: '模型返回了可用正文但结构不够标准，系统已自动提取并保存为可审阅草稿。', requiresAuthorReview: false }
          }
        }
      }
      if (purpose === 'scene-plan') {
        const normalized = normalizeScenePlanWordBudget(output, effectiveTargetWords)
        const scenePlan = this.repository.completeScenePlan(run.id, normalized.output, response.usage, response.telemetry)
        return { modelRun: this.repository.listModelRuns(chapterId).find(item => item.id === run.id)!, scenePlan }
      }
      const manuscript = String(output.manuscript)
      const actualWords = manuscriptWordCount(manuscript)
      const modelOutput = { ...output }
      delete modelOutput._novelStudioLengthAdvisory
      delete modelOutput._novelStudioCompletionAdvisory
      const persistedOutput = {
        ...modelOutput,
        _novelStudioLengthAdvisory: chapterDraftLengthAdvisory(effectiveTargetWords, actualWords),
        ...(advisory ? { _novelStudioCompletionAdvisory: advisory } : {}),
      }
      const chapter = this.repository.completeGeneratedDraft(run.id, manuscript, persistedOutput, response.usage, response.telemetry)
      return { modelRun: this.repository.listModelRuns(chapterId).find(item => item.id === run.id)!, chapter }
    } catch (cause) {
      streamWriter?.flush()
      this.repository.failModelRun(run.id, cause)
      throw cause
    }
  }

  async generateProjectFoundation(projectId: string, kind: ProjectFoundationKind, brief = '', signal?: AbortSignal): Promise<ProjectFoundationWorkspace> {
    const workspace = this.repository.getProjectFoundation(projectId)
    const stage = workspace.stages.find(item => item.kind === kind)
    if (!stage) throw new DomainError('validation', `Unknown project foundation kind ${kind}.`)
    if (!stage.canGenerate) throw new DomainError('invalid-state', `请先批准：${stage.dependencies.map(item => FOUNDATION_LABELS[item]).join('、')}。`)
    const approved = workspace.stages.flatMap(item => item.approvedVersion ? [item.approvedVersion] : [])
    const prior = approved.map(version => `## ${FOUNDATION_LABELS[version.kind]} · 已批准 v${version.version}\n${version.content}`).join('\n\n') || '暂无前置基建。'
    const styleProfile = this.repository.getProjectStyleProfile(projectId)
    const prompt = `任务：生成项目创作基建—${FOUNDATION_LABELS[kind]}。\n\n项目：${workspace.project.title}\n题材：${workspace.project.genre ?? '未指定'}\n用户补充：${brief.trim() || '无'}\n\n项目文风（只影响表达方式，不改变事实）：\n${styleProfileText(styleProfile)}\n\n已批准前置基建（必须保持一致）：\n${prior}\n\n输出可直接约束后续章节生成的具体内容，避免空泛建议。只输出 JSON：{"title":"","content":""}`
    const selection = this.gateway.selection()
    const system = `你是 Novel Studio 的项目架构师。当前只生成${FOUNDATION_LABELS[kind]}，不写章节正文。已批准的前置基建是强约束。`
    const response = await this.gateway.generate({ selection, system, prompt, maxTokens: 4200, signal })
    const parsed = parseStructuredModelOutput(response.text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DomainError('invalid-state', '模型未返回有效的项目基建。')
    const output = parsed as Record<string, unknown>
    if (typeof output.title !== 'string' || typeof output.content !== 'string') throw new DomainError('invalid-state', '项目基建缺少 title 或 content。')
    return this.repository.createProjectFoundationVersion(projectId, kind, { title: output.title, content: output.content }, {
      provider: selection.provider, model: selection.model, promptVersion: FOUNDATION_PROMPT_VERSION,
      promptHash: createHash('sha256').update(`${system}\n${prompt}`).digest('hex'), outputJson: JSON.stringify(parsed),
    })
  }

  async planProjectFoundation(run: FoundationGenerationRun, signal?: AbortSignal): Promise<FoundationGenerationRun> {
    if (run.status !== 'planning') throw new DomainError('invalid-state', 'Foundation generation run is not planning.')
    const boundedStop = foundationPlanningStopReason(run)
    if (boundedStop) return this.repository.closeFoundationPlanning(run.id, boundedPlanningSummary(run, boundedStop), boundedStop)
    const { workspace, prior, currentDraft } = this.foundationContext(run)
    const label = FOUNDATION_LABELS[run.kind]
    const answeredHistory = this.foundationAnswerHistory(run)
    const hasUserAnswers = run.answers.length > 0
    const system = `你是 Novel Studio 的创作需求分析助手。当前不生成${label}正文。你必须先判断现有信息是否足以稳定生成可执行内容；信息不足时只追问真正缺失、会实质改变结果的决定，不能重复已经回答的问题。`
    const prompt = `任务：评估项目创作基建信息充分性—${label}。

项目：${workspace.project.title}
题材：${workspace.project.genre ?? '未指定'}
目标读者：${workspace.project.audience ?? '未指定'}
用户补充：${run.brief || '无'}

已批准前置基建（必须保持一致）：
${prior}

当前待审初稿（${currentDraft ? '用户已看过这一版，现在需要通过问题明确修改方向' : '暂无；这是首次需求梳理'}）：
${currentDraft ? `## ${currentDraft.title}\n${currentDraft.content}` : '暂无待审初稿。'}

用户已经确认的信息：
${answeredHistory}

检查与${label}有关的关键维度是否已经足够明确：${FOUNDATION_REVIEW_FOCUS[run.kind]}；以及用户明确的题材偏好和强约束。

规则：
1. 第一次评估必须提出至少一个问题，不能在用户尚未回答时判定充分。
2. ${currentDraft ? '用户选择了“需要调整”。你必须先读取待审初稿，只问会导致这一版明显变得不同的修改方向；不要要求用户重新口述整篇内容。' : `只询问现有资料和历史回答中仍缺失、且会明显改变${label}结果的决定。`}不要重复已确认内容。
3. 信息不足时返回 1 至 3 个问题；每题提供 2 至 3 个差异清楚的方向，其中最多一个推荐，并允许用户自定义。
4. 信息充分时 informationSufficient=true、questions=[]，并用 readinessSummary 简洁说明哪些关键方向已明确。
5. 不要询问技术实现、模型或输出格式。
6. 用户明确选择的题材偏好就是有效约束；不得因为它不符合传统写作建议而反复质疑，例如用户选择“无代价纯爽”后不得继续追问必须付出什么代价。
7. 当前已完成 ${run.planningRound} 轮、确认 ${run.answers.length} 项；整个采集最多 ${FOUNDATION_MAX_PLANNING_ROUNDS} 轮或 ${FOUNDATION_MAX_CONFIRMED_ANSWERS} 项确认。大纲草稿能够合理补全、且可在审批前修改的次要细节不能作为继续追问的理由。
8. 只有缺失内容会改变主线、核心人物关系、主要冲突、阶段结构或结局方向时才继续提问；卷内配比、单个场景执行方式、仪式细节、能力展示节点等应留给正式大纲生成。

只输出 JSON：{"informationSufficient":false,"readinessSummary":"","questions":[{"question":"","why":"","options":[{"label":"","description":"","recommended":true}]}]}`
    const promptHash = createHash('sha256').update(`${FOUNDATION_PLANNER_PROMPT_VERSION}\n${system}\n${prompt}`).digest('hex')
    const progressPhase = hasUserAnswers ? 'evaluating_information' : 'generating_questions'
    const progressStart = hasUserAnswers ? Math.max(run.progress, 35) : 15
    const progressLimit = hasUserAnswers ? 40 : 29
    const progressBase = run.streamedCharacters
    this.repository.updateFoundationGenerationRunProgress(run.id, progressPhase, progressStart, progressBase)
    let pendingProgress = progressStart
    let pendingCharacters = progressBase
    let pendingTelemetry: GenerationTelemetry | undefined
    const progressWriter = createThrottledStreamWriter(() => { this.repository.updateFoundationGenerationRunProgress(run.id, progressPhase, pendingProgress, pendingCharacters, pendingTelemetry) })
    const plannerSelection = { provider: run.provider, model: run.model }
    const plannerCapacity = await this.resolveCapacity(plannerSelection, signal)
    const response = await this.gateway.generate({
      selection: this.lowReasoningSelection(plannerSelection, plannerCapacity), system, prompt, maxTokens: 2400, signal,
      onProgress: ({ outputCharacters, text, telemetry }) => {
        pendingProgress = Math.min(progressLimit, progressStart + Math.floor(outputCharacters / 80))
        pendingCharacters = progressBase + outputCharacters
        pendingTelemetry = telemetry
        progressWriter.push(text)
      },
    }).finally(() => { progressWriter.flush() })
    if (response.telemetry) this.repository.updateFoundationGenerationRunProgress(run.id, progressPhase, pendingProgress, pendingCharacters, response.telemetry)
    const parsed = parseStructuredModelOutput(response.text)
    const evaluation = normalizedPlannerEvaluation(parsed, hasUserAnswers)
    if (evaluation.informationSufficient) return this.repository.setFoundationInformationReady(run.id, evaluation.readinessSummary, promptHash, JSON.stringify(parsed))
    const novelQuestions = removeRepeatedPlannerQuestions(evaluation.questions, run.questions)
    if (novelQuestions.length === 0) return this.repository.closeFoundationPlanning(run.id, boundedPlanningSummary(run, 'duplicate-only'), 'duplicate-only')
    return this.repository.setFoundationGenerationQuestions(run.id, novelQuestions, evaluation.readinessSummary, promptHash, JSON.stringify(parsed))
  }

  async generateProjectFoundationFromRun(run: FoundationGenerationRun, signal?: AbortSignal): Promise<FoundationGenerationRun> {
    if (run.status !== 'generating') throw new DomainError('invalid-state', 'Foundation generation run is not generating.')
    if (run.guided && !run.informationReady) throw new DomainError('invalid-state', 'AI 尚未确认创作信息充分，不能生成正式内容。')
    this.repository.resetFoundationGenerationStream(run.id)
    this.repository.updateFoundationGenerationRunProgress(run.id, 'assembling_context', 45, 0)
    const { workspace, prior, currentDraft } = this.foundationContext(run)
    const label = FOUNDATION_LABELS[run.kind]
    const answerText = run.guided ? this.foundationAnswerHistory(run) : currentDraft ? '用户选择不经提问，直接基于当前版本重写一版。' : '用户选择先生成一版可审阅初稿，尚未提供额外书面要求。'
    const system = `你是 Novel Studio 的项目架构师。当前只生成${label}，不写章节正文。已批准的前置基建和用户在规划阶段确认的方向都是强约束。`
    const prompt = `任务：生成项目创作基建—${label}。

项目：${workspace.project.title}
题材：${workspace.project.genre ?? '未指定'}
目标读者：${workspace.project.audience ?? '未指定'}
用户补充：${run.brief || '无'}

已批准前置基建（必须保持一致）：
${prior}

需要保留并修订的上一版初稿：
${currentDraft ? `## ${currentDraft.title}\n${currentDraft.content}` : '暂无；这是第一版可审阅初稿。'}

用户在规划阶段确认的方向：
${answerText}

AI 信息充分性判断：
${run.readinessSummary || '已确认信息充分。'}

	${currentDraft ? run.guided ? '这是一次基于用户回答的修订：保留未被要求改变的有效内容，只在已确认的方向上重组和补强。' : '这是一次直接重写：读取当前版本的有效约束，生成一份结构和表达明显不同的新草稿。' : '这是可以直接审阅的第一版初稿；未明确的细节使用与项目题材一致的保守假设。'}
输出可直接约束后续章节生成的具体内容，清楚写出人物、事件、规则、因果和边界，避免空泛建议。content 控制在约 2500 至 5000 个中文字符。只输出 JSON：{"title":"","content":""}`
    const promptHash = createHash('sha256').update(`${FOUNDATION_PROMPT_VERSION}\n${system}\n${prompt}`).digest('hex')
    this.repository.updateFoundationGenerationRunProgress(run.id, 'generating_content', 50, 0)
    let pendingProgress = 50
    let pendingCharacters = 0
    let pendingTelemetry: GenerationTelemetry | undefined
    const streamWriter = createThrottledStreamWriter(text => { this.repository.updateFoundationGenerationStream(run.id, text, pendingProgress, pendingCharacters, pendingTelemetry) })
    const foundationSelection = { provider: run.provider, model: run.model }
    const foundationCapacity = await this.resolveCapacity(foundationSelection, signal)
    const response = await this.gateway.generate({
      selection: this.lowReasoningSelection(foundationSelection, foundationCapacity), system, prompt, maxTokens: FOUNDATION_OUTPUT_MAX_TOKENS, signal,
      onProgress: ({ outputCharacters, text, telemetry }) => {
        pendingProgress = Math.min(88, 50 + Math.floor(outputCharacters / 110))
        pendingCharacters = outputCharacters
        pendingTelemetry = telemetry
        streamWriter.push(extractStreamingJsonString(text, 'content'))
      },
    }).finally(() => { streamWriter.flush() })
    streamWriter.push(extractStreamingJsonString(response.text, 'content'))
    streamWriter.flush()
    this.repository.updateFoundationGenerationRunProgress(run.id, 'validating_output', 92, response.text.length)
    const parsed = parseStructuredModelOutput(response.text)
    const output = structuredRecord(parsed, '模型未返回有效的项目基建。')
    if (typeof output.title !== 'string' || typeof output.content !== 'string') throw new DomainError('invalid-state', '项目基建缺少 title 或 content。')
    this.repository.updateFoundationGenerationRunProgress(run.id, 'saving_draft', 97, response.text.length)
    return this.repository.completeFoundationGenerationRun(run.id, { title: output.title, content: output.content }, {
      promptVersion: FOUNDATION_PROMPT_VERSION, promptHash, outputJson: JSON.stringify(parsed), usage: response.usage, telemetry: response.telemetry,
    })
  }

  async refreshLongNovelMemory(workflowRunId: string, signal?: AbortSignal): Promise<KnowledgeSummaryDraft[]> {
    const memory = this.repository.getKnowledgeRefreshContext(workflowRunId)
    const versionId = memory.approvedVersion.id
    const chapterNumber = memory.chapter.chapterNumber
    const foundationSourceId = this.repository.getProjectFoundation(memory.project.id).assemblyHash
    const expectedSources: Array<{ scope: KnowledgeSummary['scope']; sourceId: string }> = foundationSourceId ? [
      { scope: 'foundation', sourceId: foundationSourceId },
      { scope: 'chapter', sourceId: memory.chapter.id },
      { scope: 'arc', sourceId: `${memory.volumeId ?? memory.bookId}:arc:${Math.floor(Math.max(0, chapterNumber - 1) / 8) + 1}` },
      { scope: 'volume', sourceId: memory.volumeId ?? memory.bookId },
      { scope: 'book', sourceId: memory.bookId },
      { scope: 'project', sourceId: memory.project.id },
    ] : []
    const currentSummaries = this.repository.getKnowledgeWorkspace(memory.project.id).summaries
    const reusable = expectedSources.map(expected => currentSummaries.find(summary => summary.scope === expected.scope
      && summary.sourceId === expected.sourceId && summary.status === 'current' && summary.sourceVersionId === versionId))
    if (reusable.length === 6 && reusable.every((summary): summary is KnowledgeSummary => !!summary && !!summary.provider && !!summary.model && !!summary.promptHash)) {
      return reusable.map(summary => ({
        scope: summary.scope, sourceId: summary.sourceId, sourceVersionId: summary.sourceVersionId,
        structuredJson: summary.structuredJson, compactNarrative: summary.compactNarrative,
        sourceStartChapter: summary.sourceStartChapter, sourceEndChapter: summary.sourceEndChapter,
        sourceVersionIds: summary.sourceVersionIds, provider: summary.provider!, model: summary.model!, promptHash: summary.promptHash!,
      }))
    }
    const selection = this.gateway.selection()
    const foundationText = memory.previousFoundation?.compactNarrative || memory.foundationVersions.map(version => `${FOUNDATION_LABELS[version.kind]}：${version.content}`).join('\n\n')
    const previous = (summary: KnowledgeSummary | null) => summary?.compactNarrative || '暂无；这是该层级的第一次摘要。'
    const arcBaseline = memory.safePriorChapterSummaries.filter(item => item.bookId === memory.bookId
      && item.volumeId === memory.volumeId && item.chapterNumber >= memory.arcStartChapter)
    const volumeBaseline = memory.safePriorChapterSummaries.filter(item => item.bookId === memory.bookId && item.volumeId === memory.volumeId)
    const bookBaseline = memory.safePriorChapterSummaries.filter(item => item.bookId === memory.bookId)
    const projectBaseline = memory.safePriorChapterSummaries
    const baseline = (summary: KnowledgeSummary | null, items: typeof memory.safePriorChapterSummaries): string => summary
      ? '已有安全的上一版滚动摘要，本次无需从章节摘要重建。'
      : items.length > 0
        ? items.map(item => `第 ${item.chapterNumber} 章《${item.chapterTitle}》：${item.summary.compactNarrative || item.summary.content}`).join('\n')
        : '没有更早的已批准章节。'
    const system = '你是 Novel Studio 的长篇连续性编辑。只提炼已经批准的小说事实，不续写、不评价文风、不把推测写成事实。输出严格 JSON。'
    const prompt = `任务：提炼批准章节并增量更新长篇记忆。

项目：${memory.project.title}
当前章节：第 ${memory.chapter.chapterNumber} 章《${memory.chapter.title}》
创作基建精炼输入：
${foundationText}

上一版 Arc 摘要：
${previous(memory.previousArc)}
Arc 安全重建基线（仅在上一版不可用时使用）：
${baseline(memory.previousArc, arcBaseline)}

上一版 Volume 摘要：
${previous(memory.previousVolume)}
Volume 安全重建基线（仅在上一版不可用时使用）：
${baseline(memory.previousVolume, volumeBaseline)}

上一版 Book 摘要：
${previous(memory.previousBook)}
Book 安全重建基线（仅在上一版不可用时使用）：
${baseline(memory.previousBook, bookBaseline)}

上一版 Project 摘要：
${previous(memory.previousProject)}
Project 安全重建基线（仅在上一版不可用时使用）：
${baseline(memory.previousProject, projectBaseline)}

本章批准正文：
${memory.approvedVersion.content}

提炼规则：
1. 优先保留状态变化、决策与后果、新信息及知情人物、时间地点、关系变化、伏笔状态、未解决冲突。
2. chapter 只概括本章；arc/volume/book/project 在上一版可用时增量合并。上一版显示“暂无”时，只能用对应的安全重建基线与本章重建，绝不能引用当前章之后的内容。
3. foundation 只压缩已经批准的三项创作基建，保留主线强约束、人物边界、时间因果，以及其中已明确的世界规则与伏笔承诺。
4. 每层 compactNarrative 应可直接进入后续章节 Prompt；structuredSummary 使用数组字段，未知内容留空数组，不得编造。
5. Project 摘要必须保留早期仍影响当前故事的事实，不能因为章节变多就只保留最近事件。

只输出 JSON：{"foundation":{"compactNarrative":"","structuredSummary":{}},"chapter":{"compactNarrative":"","structuredSummary":{}},"arc":{"compactNarrative":"","structuredSummary":{}},"volume":{"compactNarrative":"","structuredSummary":{}},"book":{"compactNarrative":"","structuredSummary":{}},"project":{"compactNarrative":"","structuredSummary":{}}}`
    const promptHash = createHash('sha256').update(`${CHAPTER_MEMORY_PROMPT_VERSION}\n${system}\n${prompt}`).digest('hex')
    const capacity = await this.resolveCapacity(selection, signal)
    let response: Awaited<ReturnType<ModelGateway['generate']>>
    try {
      response = await this.gateway.generate({ selection: this.lowReasoningSelection(selection, capacity), system, prompt, maxTokens: 5200, signal })
    } catch (cause) {
      throwRegenerableGatewayError('memory-summary', cause)
    }
    let foundation: { compactNarrative: string; structuredJson: string }
    let chapter: { compactNarrative: string; structuredJson: string }
    let arc: { compactNarrative: string; structuredJson: string }
    let volume: { compactNarrative: string; structuredJson: string }
    let book: { compactNarrative: string; structuredJson: string }
    let project: { compactNarrative: string; structuredJson: string }
    try {
      const parsed = structuredRecord(parseStructuredModelOutput(response.text), '模型未返回有效的长篇记忆摘要。')
      const section = (key: 'foundation' | 'chapter' | 'arc' | 'volume' | 'book' | 'project'): { compactNarrative: string; structuredJson: string } => {
        const value = structuredRecord(parsed[key], `长篇记忆缺少 ${key} 摘要。`)
        const compactNarrative = typeof value.compactNarrative === 'string' ? value.compactNarrative.trim() : ''
        if (!compactNarrative) throw new DomainError('invalid-state', `长篇记忆 ${key} 摘要为空。`)
        return { compactNarrative, structuredJson: JSON.stringify(value.structuredSummary && typeof value.structuredSummary === 'object' ? value.structuredSummary : {}) }
      }
      foundation = section('foundation')
      chapter = section('chapter')
      arc = section('arc')
      volume = section('volume')
      book = section('book')
      project = section('project')
    } catch (cause) {
      if (!(cause instanceof DomainError)) throw cause
      throw new RegenerablePostProcessingError('memory-summary', 'invalid-model-output', cause)
    }
    const provider = selection.provider, model = selection.model
    const summary = (scope: KnowledgeSummaryDraft['scope'], sourceId: string, value: { compactNarrative: string; structuredJson: string }, start: number | null, end: number | null, sourceVersionIds: string[]): KnowledgeSummaryDraft => ({
      scope, sourceId, sourceVersionId: versionId, structuredJson: value.structuredJson, compactNarrative: value.compactNarrative,
      sourceStartChapter: start, sourceEndChapter: end, sourceVersionIds, provider, model, promptHash,
    })
    const dependencies = (previousSummary: KnowledgeSummary | null, items: typeof memory.safePriorChapterSummaries): string[] => [...new Set([
      ...(previousSummary?.sourceVersionIds ?? []), ...items.map(item => item.approvedVersionId), versionId,
    ])]
    return [
      summary('foundation', this.repository.getProjectFoundation(memory.project.id).assemblyHash!, foundation, null, null, memory.foundationVersions.map(version => version.id)),
      summary('chapter', memory.chapter.id, chapter, chapterNumber, chapterNumber, [versionId]),
      summary('arc', `${memory.volumeId ?? memory.bookId}:arc:${Math.floor(Math.max(0, chapterNumber - 1) / 8) + 1}`, arc, memory.arcStartChapter, chapterNumber, dependencies(memory.previousArc, arcBaseline)),
      summary('volume', memory.volumeId ?? memory.bookId, volume, memory.previousVolume?.sourceStartChapter ?? volumeBaseline[0]?.chapterNumber ?? chapterNumber, chapterNumber, dependencies(memory.previousVolume, volumeBaseline)),
      summary('book', memory.bookId, book, memory.previousBook?.sourceStartChapter ?? bookBaseline[0]?.chapterNumber ?? chapterNumber, chapterNumber, dependencies(memory.previousBook, bookBaseline)),
      summary('project', memory.project.id, project, memory.previousProject?.sourceStartChapter ?? projectBaseline[0]?.chapterNumber ?? chapterNumber, chapterNumber, dependencies(memory.previousProject, projectBaseline)),
    ]
  }

  private async resolveCapacity(selection: ModelSelection, signal?: AbortSignal): Promise<ResolvedModelCapacity> {
    if (!this.gateway.resolveCapacity) return { contextWindow: FALLBACK_CONTEXT_WINDOW, contextWindowSource: 'fallback', defaultMaxTokens: null, reasoningEfforts: [] }
    try { return await this.gateway.resolveCapacity(selection, signal) }
    catch { return { contextWindow: FALLBACK_CONTEXT_WINDOW, contextWindowSource: 'fallback', defaultMaxTokens: null, reasoningEfforts: [] } }
  }

  private lowReasoningSelection(selection: ModelSelection, capacity: ResolvedModelCapacity): ModelSelection {
    return capacity.reasoningEfforts.includes('off') ? { ...selection, reasoningEffort: 'off' } : selection
  }

  private async ensureFoundationMemory(context: GenerationContext, selection: ModelSelection, capacity: ResolvedModelCapacity, signal?: AbortSignal): Promise<GenerationContext> {
    if (context.longMemory.some(summary => summary.scope === 'foundation' && summary.sourceId === context.foundationAssemblyHash)) return context
    if (context.foundationVersions.length === 0) return context
    const system = '你是 Novel Studio 的创作圣经编辑。只压缩已经批准的项目基建，不续写章节，不改变任何批准事实。只输出 JSON。'
    const source = context.foundationVersions.map(version => `## ${FOUNDATION_LABELS[version.kind]}\n${version.content}`).join('\n\n')
    const prompt = `任务：把三项已批准创作基建提炼为后续 1000 章都可复用的创作圣经。

${source}

项目文风（只规定表达方式，不改变故事事实）：
${context.styleProfile ? styleProfileText(context.styleProfile) : '保持当前小说的既有文风与叙事视角。'}

必须保留：全书主线与阶段转折；人物目标、关系、知识边界和不可逆状态；世界规则与禁区；关键时间因果；伏笔埋设与回收条件；用户明确禁止偏离的边界。不得增加源材料没有的事实。

只输出 JSON：{"compactNarrative":"","structuredSummary":{"storySpine":[],"characterConstraints":[],"worldRules":[],"timelineConstraints":[],"foreshadowingCommitments":[],"forbiddenDeviations":[]}}`
    const promptHash = createHash('sha256').update(`${FOUNDATION_MEMORY_PROMPT_VERSION}\n${system}\n${prompt}`).digest('hex')
    let parsed: Record<string, unknown>
    let compactNarrative: string
    try {
      const response = await this.gateway.generate({ selection: this.lowReasoningSelection(selection, capacity), system, prompt, maxTokens: 3600, signal })
      parsed = structuredRecord(parseStructuredModelOutput(response.text), '模型未返回有效的创作圣经摘要。')
      compactNarrative = typeof parsed.compactNarrative === 'string' ? parsed.compactNarrative.trim() : ''
      if (!compactNarrative) throw new DomainError('invalid-state', '创作圣经摘要为空。')
    } catch (cause) {
      if (cancellationError(cause)) throw cause
      // The approved Foundation text is already assembled independently into
      // the prompt. Its derived digest is an optimization, never a gate.
      return context
    }
    this.repository.upsertKnowledgeSummary(context.project.id, {
      scope: 'foundation', sourceId: context.foundationAssemblyHash, sourceVersionId: context.foundationVersions.at(-1)?.id ?? null,
      structuredJson: JSON.stringify(parsed.structuredSummary && typeof parsed.structuredSummary === 'object' ? parsed.structuredSummary : {}), compactNarrative,
      sourceStartChapter: null, sourceEndChapter: null, sourceVersionIds: context.foundationVersions.map(version => version.id),
      provider: selection.provider, model: selection.model, promptHash,
    })
    return this.repository.getGenerationContext(context.chapter.id, context.purpose)
  }

  private foundationContext(run: FoundationGenerationRun): { workspace: ProjectFoundationWorkspace; prior: string; currentDraft: ProjectFoundationWorkspace['stages'][number]['latestVersion'] } {
    const workspace = this.repository.getProjectFoundation(run.projectId)
    const stage = workspace.stages.find(item => item.kind === run.kind)
    if (!stage?.canGenerate) throw new DomainError('invalid-state', `请先批准：${stage?.dependencies.map(item => FOUNDATION_LABELS[item]).join('、') ?? '前置创作基建'}。`)
    const dependencyVersions = stage.dependencies.map(kind => workspace.stages.find(item => item.kind === kind)?.approvedVersion).filter((value): value is NonNullable<typeof value> => Boolean(value))
    if (JSON.stringify(dependencyVersions.map(version => version.id)) !== JSON.stringify(run.dependencyVersionIds)) {
      throw new DomainError('revision-conflict', '前置创作基建已发生变化，请重新开始本次规划。')
    }
    const prior = dependencyVersions.map(version => `## ${FOUNDATION_LABELS[version.kind]} · 已批准 v${version.version}\n${version.content}`).join('\n\n') || '暂无前置基建。'
    const currentDraft = stage.latestVersion ?? stage.approvedVersion
    return { workspace, prior, currentDraft }
  }

  private foundationAnswerHistory(run: FoundationGenerationRun): string {
    const confirmed = run.questions.flatMap(question => {
      const answer = run.answers.find(item => item.questionId === question.id)
      if (!answer) return []
      const option = question.options.find(item => item.id === answer.optionId)
      const round = question.id.match(/^r(\d+)-/)?.[1] ?? '?'
      const direction = answer.skipped === true ? '用户跳过本题，未对该方向作出约束' : option ? `${option.label} — ${option.description}` : '自定义方向'
      return [`### 第 ${round} 轮确认回答\n问题：${question.question}\n确认方向：${direction}${answer.customText ? `\n用户补充：${answer.customText}` : ''}`]
    })
    return confirmed.join('\n\n') || '尚无用户回答。'
  }
}
