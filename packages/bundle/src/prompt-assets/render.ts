import { DomainError, type GenerationContext, type PromptAssemblyTrace } from '../domain/model.js'
import { estimateTextTokens } from '../generation/tokens.js'
import { styleProfileText } from '../style/presets.js'
import { budgetedScenePlanJson, effectiveChapterTargetWords } from '../generation/chapter-budget.js'

const REQUIRED_VARIABLES = ['projectTitle', 'genre', 'chapterTitle', 'chapterGoal', 'styleRules', 'forbiddenContent', 'existingManuscript', 'scenePlan', 'targetWords'] as const
const FOUNDATION_LABELS = { outline: '全书大纲', characters: '人物体系', worldbuilding: '世界观与规则', timeline: '故事时间线', foreshadowing: '伏笔与回收计划' } as const

function renderBasePrompt(context: GenerationContext): string {
  const targetWords = effectiveChapterTargetWords(context)
  const styleInstructions = [context.rules.styleRules.trim(), context.styleProfile ? `结构化文风配置：\n${styleProfileText(context.styleProfile)}` : ''].filter(Boolean).join('\n\n')
  const values: Record<(typeof REQUIRED_VARIABLES)[number], string> = {
    projectTitle: context.project.title,
    genre: context.project.genre ?? '未指定',
    chapterTitle: context.chapter.title,
    chapterGoal: context.chapterBrief?.writingGoal || context.rules.chapterGoal || '推进当前章节冲突并形成明确变化',
    styleRules: styleInstructions || '语言清晰，保持人物视角稳定，避免模板化表达',
    forbiddenContent: context.rules.forbiddenContent || '无额外禁止事项',
    existingManuscript: context.inputManuscript || '尚无正文',
    scenePlan: context.latestScenePlan ? budgetedScenePlanJson(context.latestScenePlan.contentJson, targetWords) : '尚无场景计划，请根据章节目标拟定最小可行结构',
    targetWords: String(targetWords),
  }
  let output = context.promptVersion.template
  for (const variable of REQUIRED_VARIABLES) output = output.replaceAll(`{{${variable}}}`, values[variable])
  const previous = context.previousChapterContinuity
  const continuityContract = context.chapter.chapterNumber === 1
    ? `这是第 1 章，是当前故事的开篇。不得虚构不存在的“上一章事件”；应从已批准大纲、人物体系和故事时间线建立开局。`
    : previous
      ? `这是第 ${context.chapter.chapterNumber} 章，必须作为前文续写。紧邻的已批准前章是第 ${previous.chapterNumber} 章《${previous.chapterTitle}》。必须承接已经发生的事件、人物状态、关系变化、时间因果、资源变化和未解决线索；不得把人物、场景或冲突重置为初始状态。`
      : `这是第 ${context.chapter.chapterNumber} 章，但数据库中没有可用的前序批准章节。不得自行虚构上一章发生过什么；只能依据已批准创作基建、Canon 和当前任务生成。`
  const wordBudgetContract = context.purpose === 'scene-plan'
    ? `本章正文目标为 ${targetWords} 字。scenes[].estimatedWords 必须全部为正整数且合计恰好为 ${targetWords}；场景数量与细节必须能在该总字数内完成，不得把短章规划成长章。`
    : `manuscript 以 ${targetWords} 字为写作目标，建议参考 ${Math.max(1, Math.floor(targetWords * .85))}–${Math.ceil(targetWords * 1.05)} 字，但这不是硬性上下限；应优先保证情节自然、章节完整和 JSON 正确闭合，不得为凑字数重复内容或截断正文。场景计划中的 estimatedWords 仅用于分配篇幅。任何非空且完整返回的正文都会保存并交给作者审阅，偏长或偏短只记录提示。`
  return `${output}\n\n---\n章节字数与完整性约束（高于场景计划中的旧估算）：\n${wordBudgetContract}\n\n---\n前文连续性契约（场景计划与正文都必须遵守）：\n${continuityContract}`
}

function chapterBriefText(context: GenerationContext): string {
  const brief = context.chapterBrief
  if (!brief) return ''
  return `写作目标：${brief.writingGoal}\n前章承接点：${brief.openingContinuity || '按已批准前文自然承接'}\n结尾钩子：${brief.endingHook || '形成明确变化并留下自然推进力'}\n目标字数：${brief.targetWords}`
}

type MemoryAuthorityTier = 'author-constraint' | 'derived-summary' | 'author-reference'
type RetrievalAuthority = NonNullable<GenerationContext['retrievalBundle']>['items'][number]['authority']

function memoryAuthorityTier(item: NonNullable<GenerationContext['authorMemory']>[number]): MemoryAuthorityTier {
  if (item.origin === 'derived') return 'derived-summary'
  return item.category === 'constraint' || item.category === 'continuity' ? 'author-constraint' : 'author-reference'
}

function eligibleMemory(context: GenerationContext, tier: MemoryAuthorityTier): NonNullable<GenerationContext['authorMemory']> {
  return (context.authorMemory ?? []).filter(item => item.state === 'active' && item.promptPolicy === 'auto' && memoryAuthorityTier(item) === tier)
}

function memoryText(context: GenerationContext, tier: MemoryAuthorityTier): string {
  return eligibleMemory(context, tier)
    .map(item => `### ${item.category} · ${item.origin === 'derived' ? '派生摘要' : tier === 'author-constraint' ? '作者硬约束' : '作者参考'} r${item.revision}\n${item.currentRevision.content}`)
    .join('\n\n')
}

function confirmedRelationshipText(context: GenerationContext): string {
  return (context.confirmedRelationships ?? []).filter(item => item.status === 'active')
    .map(item => `${item.sourceEntityName} ${item.directionality === 'symmetric' ? '↔' : '→'} ${item.targetEntityName}：${item.label}（${item.factLayer}${item.validFromStoryOrder === null && item.validToStoryOrder === null ? '' : `，有效区间 ${item.validFromStoryOrder ?? '起点'}–${item.validToStoryOrder ?? '当前'}`}）`).join('\n')
}

function fullFoundation(context: GenerationContext): string {
  return context.foundationVersions.map(version => `## ${FOUNDATION_LABELS[version.kind]} · 已批准 v${version.version}\n${version.content}`).join('\n\n')
}

function clipHeadTailCharacters(text: string, budget: number): string {
  if (text.length <= budget) return text
  const marker = '\n[中段已按预算省略；保留开头与结尾以避免丢失后置约束]\n'
  const usable = Math.max(0, budget - marker.length)
  const head = Math.ceil(usable * .62)
  return `${text.slice(0, head).trimEnd()}${marker}${text.slice(-(usable - head)).trimStart()}`
}

/**
 * A compact Foundation view for non-chapter operations such as selection
 * rewrite. Approved source text is always present and the derived digest is a
 * supplement, never a replacement for the authoritative versions.
 */
export function renderFoundationAuthorityExcerpt(context: GenerationContext, maxCharacters = 8_000): string {
  const digest = context.longMemory.find(summary => summary.scope === 'foundation' && summary.sourceId === context.foundationAssemblyHash)
  const rawBudget = Math.max(1_800, Math.floor(maxCharacters * (digest ? .72 : 1)))
  const perVersion = Math.max(500, Math.floor(rawBudget / Math.max(1, context.foundationVersions.length)))
  const approved = context.foundationVersions.map(version => {
    const heading = `### ${FOUNDATION_LABELS[version.kind]} · 已批准 v${version.version}\n`
    return `${heading}${clipHeadTailCharacters(version.content, Math.max(200, perVersion - heading.length))}`
  }).join('\n\n')
  if (!digest) return clipHeadTailCharacters(approved, maxCharacters)
  const digestHeading = '\n\n### 创作圣经压缩索引（仅作补充；冲突时以上批准原文优先）\n'
  const digestBudget = Math.max(500, maxCharacters - approved.length - digestHeading.length)
  return `${approved}${digestHeading}${clipHeadTailCharacters(digest.compactNarrative || digest.content, digestBudget)}`
}

function retrievalText(context: GenerationContext, authorities: RetrievalAuthority[]): string {
  const items = context.retrievalBundle?.items.filter(item => authorities.includes(item.authority)) ?? []
  return items.map((item, index) => `[${index + 1}] ${item.citationLabel}\n${item.content}`).join('\n\n')
}

function retrievalConflictsText(context: GenerationContext): string {
  return context.retrievalBundle?.conflicts.length ? context.retrievalBundle.conflicts.join('；') : ''
}

function priorChapterSummariesText(context: GenerationContext): string {
  return context.priorChapterSummaries.map(item => {
    const adjacent = item.chapterId === context.previousChapterContinuity?.chapterId ? ' · 紧邻上一章' : ''
    return `### 第 ${item.chapterNumber} 章《${item.chapterTitle}》${adjacent}\n${item.summary.compactNarrative || item.summary.content}`
  }).join('\n\n')
}

function previousChapterEndingText(context: GenerationContext): string {
  const previous = context.previousChapterContinuity
  if (!previous) return ''
  return `第 ${previous.chapterNumber} 章《${previous.chapterTitle}》批准正文的结尾节选：\n${previous.approvedEndingExcerpt || '[上一章批准正文为空]'}`
}

function assertResolved(output: string): string {
  const unresolved = output.match(/{{[a-zA-Z0-9_]+}}/g)
  if (unresolved) throw new DomainError('validation', `Prompt contains unresolved variables: ${unresolved.join(', ')}`)
  return output
}

export function renderGenerationPrompt(context: GenerationContext): string {
  let output = renderBasePrompt(context)
  output += `\n\n---\n项目创作基建（数据库已批准版本，是本次生成的强约束；如与临时推断冲突，以下内容为准）：\n${fullFoundation(context)}\n\n基建组装哈希：${context.foundationAssemblyHash}\n`
  const foundationDigest = context.longMemory.find(summary => summary.scope === 'foundation' && summary.sourceId === context.foundationAssemblyHash)
  if (foundationDigest) output += `\n\n---\n创作圣经压缩记忆（用于补足长基建尾部信息，不得覆盖上方批准原文）：\n${foundationDigest.compactNarrative || foundationDigest.content}\n`
  const approvedRetrieval = retrievalText(context, ['current_project_canon', 'current_project_approved'])
  if (approvedRetrieval) output += `\n\n---\n当前项目 Canon 与批准正文（高权威事实）：\n${approvedRetrieval}\n`
  const retrievalConflicts = retrievalConflictsText(context)
  if (retrievalConflicts) output += `\n\n---\n检索来源冲突（不得自行选择冲突事实）：\n${retrievalConflicts}\n`
  const previousEnding = previousChapterEndingText(context)
  if (previousEnding) output += `\n\n---\n前文连续性 · 紧邻上一章结尾（续写起点）：\n${previousEnding}\n`
  const brief = chapterBriefText(context)
  if (brief) output += `\n\n---\n当前章节已确认写作 Brief（服从批准事实与 Canon）：\n${brief}\n`
  const relationships = confirmedRelationshipText(context)
  if (relationships) output += `\n\n---\n作者已确认实体关系（候选关系不在此列）：\n${relationships}\n`
  const authorConstraints = memoryText(context, 'author-constraint')
  if (authorConstraints) output += `\n\n---\n作者硬约束（不得覆盖批准 Foundation、Canon 或正文）：\n${authorConstraints}\n`
  const priorSummaries = priorChapterSummariesText(context)
  if (priorSummaries) output += `\n\n---\n前文连续性 · 最近已批准章节摘要（从早到晚；必须承接，不得重置）：\n${priorSummaries}\n`
  const derivedMemory = memoryText(context, 'derived-summary')
  if (derivedMemory) output += `\n\n---\n派生摘要（只用于辅助连续性，不得覆盖更高权威事实）：\n${derivedMemory}\n`
  const summaryRetrieval = retrievalText(context, ['current_project_summary'])
  if (summaryRetrieval) output += `\n\n---\n当前项目派生摘要：\n${summaryRetrieval}\n`
  const authorReferences = memoryText(context, 'author-reference')
  if (authorReferences) output += `\n\n---\n普通作者参考（低于派生摘要及所有批准事实）：\n${authorReferences}\n`
  const historicalRetrieval = retrievalText(context, ['historical_reference'])
  if (historicalRetrieval) output += `\n\n---\n历史项目参考（不得当作当前项目事实，不得复制历史专名、连续原句或具体剧情）：\n${historicalRetrieval}\n`
  return assertResolved(output)
}

interface BudgetedPromptOptions {
  contextWindow: number
  contextWindowSource: 'provider' | 'fallback'
  maxOutputTokens: number
  system: string
}

interface MemorySection {
  key: string
  label: string
  content: string
  priority: number
  maxTokens: number
  sourceIds: string[]
  exclusionReason?: string
}

function truncateToTokenBudget(text: string, budget: number): { text: string; truncated: boolean } {
  if (estimateTextTokens(text) <= budget) return { text, truncated: false }
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTextTokens(text.slice(0, middle)) <= budget) low = middle
    else high = middle - 1
  }
  return { text: `${text.slice(0, low).trimEnd()}\n[本区段已按 Token 预算截断]`, truncated: true }
}

function truncateHeadTailToTokenBudget(text: string, budget: number): { text: string; truncated: boolean } {
  if (estimateTextTokens(text) <= budget) return { text, truncated: false }
  const marker = '\n[本区段中段已按 Token 预算省略；保留开头与结尾]\n'
  const markerTokens = estimateTextTokens(marker)
  const usable = Math.max(0, budget - markerTokens)
  const headBudget = Math.max(1, Math.floor(usable * .62))
  const tailBudget = Math.max(1, usable - headBudget)
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
  const head = fitPrefix(text, headBudget).trimEnd()
  const reversedTail = fitPrefix([...text].reverse().join(''), tailBudget)
  const tail = [...reversedTail].reverse().join('').trimStart()
  return { text: `${head}${marker}${tail}`, truncated: true }
}

export function renderBudgetedGenerationPrompt(context: GenerationContext, options: BudgetedPromptOptions): { prompt: string; trace: PromptAssemblyTrace } {
  const base = renderBasePrompt(context)
  const targetWords = effectiveChapterTargetWords(context)
  const finalOutputBoundary = context.purpose === 'chapter-draft'
    ? `最终输出边界：只输出带有开端、推进和收束的非空 manuscript，并完整闭合 JSON。${targetWords} 字及 ${Math.max(1, Math.floor(targetWords * .85))}–${Math.ceil(targetWords * 1.05)} 字范围都只是写作建议，不是保存门槛；不要为了字数牺牲完整性。`
    : `最终输出边界：场景 estimatedWords 合计必须恰好为 ${targetWords}，并完整闭合 JSON。`
  const foundationDigest = context.longMemory.find(summary => summary.scope === 'foundation' && summary.sourceId === context.foundationAssemblyHash)
  const sections: MemorySection[] = []
  const foundationPerVersionTokens = Math.max(1_200, Math.min(3_000, Math.floor(7_200 / Math.max(1, context.foundationVersions.length))))
  for (const version of context.foundationVersions) sections.push({
    key: `foundation:${version.kind}:${version.id}`,
    label: `${FOUNDATION_LABELS[version.kind]} · 已批准 v${version.version}`,
    priority: 500, maxTokens: foundationPerVersionTokens,
    content: version.content,
    sourceIds: [version.id],
  })
  if (foundationDigest) sections.push({
    // Keep the historical key so existing Memory usage history remains easy
    // to compare, while the raw Foundation stages now have independent trace.
    key: 'foundation',
    label: '创作圣经压缩索引（只作补充，不能覆盖批准原文）',
    priority: 450, maxTokens: 1_800,
    content: foundationDigest.compactNarrative || foundationDigest.content,
    sourceIds: [foundationDigest.id],
  })
  const retrievalConflicts = retrievalConflictsText(context)
  if (retrievalConflicts && context.retrievalBundle) sections.push({
    key: 'retrieval:conflicts', label: '检索来源冲突（不得自行选择冲突事实）', priority: 495, maxTokens: 900,
    content: retrievalConflicts, sourceIds: [context.retrievalBundle.id],
  })
  const brief = chapterBriefText(context)
  if (brief) sections.push({
    key: `chapter-brief:${context.chapter.id}`, label: '当前章节已确认写作 Brief', priority: 420, maxTokens: 1800,
    content: brief, sourceIds: [context.chapterBrief?.batchItemId ?? context.chapter.id],
  })
  const explicitChapterSummaryIds = new Set(context.priorChapterSummaries.map(item => item.summary.id))
  const priorSummaries = priorChapterSummariesText(context)
  if (priorSummaries) sections.push({
    key: 'continuity:prior-chapter-summaries', label: '前文连续性 · 最近已批准章节摘要（从早到晚）', priority: 320, maxTokens: 4800,
    content: priorSummaries,
    sourceIds: context.priorChapterSummaries.flatMap(item => [item.summary.id, item.chapterId, item.approvedVersionId, ...item.summary.sourceVersionIds]),
  })
  const previousEnding = previousChapterEndingText(context)
  if (previousEnding && context.previousChapterContinuity) sections.push({
    key: 'continuity:previous-chapter-ending', label: '前文连续性 · 紧邻上一章结尾（续写起点）', priority: 480, maxTokens: 3000,
    content: previousEnding,
    sourceIds: [context.previousChapterContinuity.chapterId, context.previousChapterContinuity.approvedVersionId],
  })
  const scopePriority = { project: 300, book: 290, volume: 280, arc: 270, chapter: 260, foundation: 310 } as const
  const scopeLabel = { project: '全书滚动摘要', book: 'Book 摘要', volume: '当前卷摘要', arc: '当前阶段摘要', chapter: '邻近章节摘要', foundation: '创作基建精炼版' } as const
  const representedSummaryIds = new Set(explicitChapterSummaryIds)
  if (foundationDigest) representedSummaryIds.add(foundationDigest.id)
  for (const summary of context.longMemory) {
    const alreadyRepresented = representedSummaryIds.has(summary.id)
    representedSummaryIds.add(summary.id)
    if (alreadyRepresented) continue
    if (summary.id === foundationDigest?.id) continue
    if (explicitChapterSummaryIds.has(summary.id)) continue
    sections.push({ key: `${summary.scope}:${summary.id}`, label: scopeLabel[summary.scope], content: summary.compactNarrative || summary.content, priority: scopePriority[summary.scope], maxTokens: summary.scope === 'chapter' ? 1400 : 3600, sourceIds: [summary.id, ...summary.sourceVersionIds] })
  }
  if (context.retrievalBundle) {
    for (const item of context.retrievalBundle.items) {
      if (item.kind === 'approved_excerpt' && item.sourceVersionId === context.previousChapterContinuity?.approvedVersionId) continue
      const summaryBacked = item.kind === 'summary' || item.kind === 'historical_summary'
      const duplicateSummary = summaryBacked && representedSummaryIds.has(item.sourceId)
      const section: MemorySection = {
        key: `retrieval:${item.id}`, label: item.citationLabel, content: item.content,
        priority: item.authority === 'current_project_canon' ? 490 : item.authority === 'current_project_approved' ? 480 : item.authority === 'current_project_summary' ? 285 : 100,
        maxTokens: item.kind === 'approved_excerpt' ? 900 : 1200,
        sourceIds: [item.id, item.sourceId, ...(item.sourceVersionId ? [item.sourceVersionId] : [])],
        ...(duplicateSummary ? { exclusionReason: '同一 KnowledgeSummary 已由长期记忆或前文摘要区段表示' } : {}),
      }
      sections.push(section)
      if (summaryBacked) representedSummaryIds.add(item.sourceId)
    }
  }
  const relationships = confirmedRelationshipText(context)
  if (relationships) sections.push({
    key: 'relationships:confirmed', label: '作者已确认实体关系（候选关系永不进入 Prompt）', content: relationships,
    priority: 475, maxTokens: 3600, sourceIds: context.confirmedRelationships?.filter(item => item.status === 'active').map(item => item.id) ?? [],
  })
  for (const item of context.authorMemory ?? []) {
    if (item.state !== 'active' || item.promptPolicy !== 'auto') continue
    const tier = memoryAuthorityTier(item)
    sections.push({
      key: `memory:${item.id}`, label: `${tier === 'author-constraint' ? '作者硬约束' : tier === 'derived-summary' ? '派生摘要' : '作者参考'} · ${item.category}`,
      content: item.currentRevision.content,
      priority: tier === 'author-constraint' ? 470 : tier === 'derived-summary' ? 275 : 180,
      maxTokens: tier === 'author-constraint' ? 2200 : tier === 'derived-summary' ? 1800 : 1200,
      sourceIds: [item.id, item.currentRevision.id],
    })
  }
  sections.sort((left, right) => right.priority - left.priority)

  const safetyTokens = Math.max(2048, Math.min(8192, Math.floor(options.contextWindow * 0.06)))
  const systemTokens = estimateTextTokens(options.system)
  const basePromptTokens = estimateTextTokens(`${base}\n\n${finalOutputBoundary}`)
  const memoryBudgetTokens = Math.max(0, options.contextWindow - options.maxOutputTokens - safetyTokens - systemTokens - basePromptTokens)
  let remaining = memoryBudgetTokens
  let selectedMemoryTokens = 0
  const selected: string[] = []
  const traces: PromptAssemblyTrace['sections'] = []
  for (const section of sections) {
    if (section.exclusionReason) {
      traces.push({ key: section.key, label: section.label, estimatedTokens: estimateTextTokens(section.content), included: false, truncated: false, reason: section.exclusionReason, sourceIds: section.sourceIds })
      continue
    }
    if (remaining < 80) {
      traces.push({ key: section.key, label: section.label, estimatedTokens: estimateTextTokens(section.content), included: false, truncated: false, reason: '输入预算已用尽', sourceIds: section.sourceIds })
      continue
    }
    const allowance = Math.min(section.maxTokens, remaining)
    const fitted = section.key.startsWith('foundation:')
      ? truncateHeadTailToTokenBudget(section.content, allowance)
      : truncateToTokenBudget(section.content, allowance)
    const used = estimateTextTokens(fitted.text)
    if (used <= 0) {
      traces.push({ key: section.key, label: section.label, estimatedTokens: 0, included: false, truncated: false, reason: '区段为空', sourceIds: section.sourceIds })
      continue
    }
    selected.push(`## ${section.label}\n${fitted.text}`)
    remaining -= used
    selectedMemoryTokens += used
    traces.push({ key: section.key, label: section.label, estimatedTokens: used, included: true, truncated: fitted.truncated, reason: fitted.truncated ? '按区段上限或剩余预算截断' : '按优先级进入本次 Prompt', sourceIds: section.sourceIds })
  }
  const prompt = assertResolved(`${base}\n\n---\n长篇连续性记忆（批准事实与高层摘要优先；摘要不能覆盖更高权威的批准基建或 Canon）：\n${selected.join('\n\n') || '本次没有可用的长期记忆区段。'}\n\n基建组装哈希：${context.foundationAssemblyHash}\n\n---\n${finalOutputBoundary}`)
  return {
    prompt,
    trace: {
      contextWindow: options.contextWindow, contextWindowSource: options.contextWindowSource, maxOutputTokens: options.maxOutputTokens,
      safetyTokens, systemTokens, basePromptTokens, memoryBudgetTokens, selectedMemoryTokens,
      estimatedInputTokens: estimateTextTokens(prompt) + systemTokens, sections: traces,
    },
  }
}

export function parseStructuredModelOutput(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(trimmed) as unknown } catch { throw new DomainError('invalid-state', 'Model output was not valid JSON.') }
}

export function validateGenerationOutput(purpose: 'scene-plan' | 'chapter-draft', output: unknown): asserts output is Record<string, unknown> {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new DomainError('invalid-state', 'Model output must be a JSON object.')
  const record = output as Record<string, unknown>
  if (purpose === 'scene-plan') {
    if (!Array.isArray(record.scenes) || record.scenes.length === 0 || typeof record.chapterGoal !== 'string') throw new DomainError('invalid-state', 'Scene plan is missing chapterGoal or non-empty scenes.')
  } else if (typeof record.manuscript !== 'string' || !record.manuscript.trim()) {
    throw new DomainError('invalid-state', 'Chapter draft is missing non-empty manuscript text.')
  }
}
