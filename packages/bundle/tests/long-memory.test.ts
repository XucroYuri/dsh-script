import { describe, expect, it } from 'vitest'
import type { EntityRelationship, GenerationContext, KnowledgeSummary, MemoryItem, ProjectFoundationKind } from '../src/domain/model.js'
import { generationTelemetry } from '../src/generation/tokens.js'
import { renderBudgetedGenerationPrompt, renderGenerationPrompt } from '../src/prompt-assets/render.js'

function summary(scope: KnowledgeSummary['scope'], index: number, content: string): KnowledgeSummary {
  return {
    id: `summary-${scope}-${index}`, projectId: 'project-memory', scope, sourceId: `source-${scope}-${index}`, sourceVersionId: `version-${index}`,
    content, structuredJson: '{}', compactNarrative: content, sourceStartChapter: scope === 'foundation' ? null : index,
    sourceEndChapter: scope === 'foundation' ? null : index, sourceVersionIds: [`version-${index}`], contentHash: `hash-${index}`,
    provider: 'test', model: 'test', promptHash: 'prompt-hash', status: 'current', updatedAt: '2026-08-24T00:00:00.000Z',
  }
}

function memoryItem(
  id: string,
  content: string,
  overrides: Partial<Pick<MemoryItem, 'origin' | 'category' | 'state' | 'promptPolicy'>> = {},
): MemoryItem {
  const createdAt = '2026-08-24T00:00:00.000Z'
  return {
    id, projectId: 'project-memory', origin: overrides.origin ?? 'user', storage: 'database', scope: 'project',
    category: overrides.category ?? 'other', state: overrides.state ?? 'active', promptPolicy: overrides.promptPolicy ?? 'auto',
    sourceKey: `source-${id}`, revision: 1,
    currentRevision: {
      id: `revision-${id}`, itemId: id, revision: 1, content, structuredJson: '{}', contentHash: `hash-${id}`,
      actor: overrides.origin === 'derived' ? 'model' : 'user', parentRevisionId: null, provider: null, model: null, promptHash: null, createdAt,
    },
    sources: [], recentUsages: [], createdAt, updatedAt: createdAt,
  }
}

function relationship(): EntityRelationship {
  const createdAt = '2026-08-24T00:00:00.000Z'
  return {
    id: 'relationship-confirmed', projectId: 'project-memory', sourceEntityId: 'entity-hero', targetEntityId: 'entity-tower',
    sourceEntityName: '林舟', targetEntityName: '北塔', predicateKey: 'forbidden-from-entering', label: '不得进入', category: 'location',
    directionality: 'directed', factLayer: 'author_asserted', validFromStoryOrder: 1, validToStoryOrder: 12, status: 'active',
    supersedesRelationshipId: null, createdBy: 'user', fingerprint: 'relationship-fingerprint', revision: 1, evidenceCount: 1,
    createdAt, updatedAt: createdAt,
  }
}

function context(): GenerationContext {
  const foundationKinds: ProjectFoundationKind[] = ['outline','characters','timeline']
  return {
    purpose: 'chapter-draft',
    project: { id: 'project-memory', title: '千章连续性', slug: 'memory', language: 'zh-CN', genre: '悬疑', audience: null, status: 'active', targetWordCount: 1_000_000, chapterTargetWords: 2000, currentBookId: 'book-1', revision: 10, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' },
    chapter: { id: 'chapter-1000', projectId: 'project-memory', bookId: 'book-1', volumeId: 'volume-100', chapterNumber: 1000, title: '回到第一枚钥匙', status: 'draft', currentDraftVersionId: null, currentApprovedVersionId: null, revision: 0, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', versions: [] },
    rules: { projectId: 'project-memory', styleRules: '克制、连续。', chapterGoal: '兑现第一章的钥匙。', forbiddenContent: '不得遗忘既有事实。', revision: 1, updatedAt: '2026-08-24T00:00:00.000Z' },
    promptVersion: { id: 'prompt-v1', promptAssetId: 'asset', version: 1, locale: 'zh-CN', template: '任务：根据场景计划生成章节初稿。\n项目：{{projectTitle}}\n章节：{{chapterTitle}}\n目标：{{chapterGoal}}\n规则：{{styleRules}}\n禁止：{{forbiddenContent}}\n现有正文：{{existingManuscript}}\n场景：{{scenePlan}}\n目标字数：{{targetWords}}', inputSchemaJson: '{}', outputSchemaJson: '{}', source: 'builtin', contentHash: 'prompt-hash', createdAt: '2026-08-24T00:00:00.000Z' },
    inputManuscriptVersionId: null, inputManuscript: '', latestScenePlan: null, retrievalBundle: null,
    foundationVersions: foundationKinds.map((kind, index) => ({ id: `foundation-${kind}`, projectId: 'project-memory', kind, version: 1, title: kind, content: `${kind} approved`, contentHash: kind, status: 'approved', provider: 'test', model: 'test', promptVersion: 'v1', promptHash: 'h', dependencyVersionIds: foundationKinds.slice(0, index).map(value => `foundation-${value}`), generationRunId: null, createdAt: '2026-08-24T00:00:00.000Z', approvedAt: '2026-08-24T00:00:00.000Z' })),
    foundationAssemblyHash: 'foundation-assembly',
    priorChapterSummaries: [],
    previousChapterContinuity: null,
    longMemory: [
      { ...summary('foundation', 0, '创作圣经：所有批准规则保持稳定。'), sourceId: 'foundation-assembly' },
      summary('project', 1, '第一章确定的长期事实：青铜钥匙只能打开北塔地下室，这一事实到第1000章仍未失效。'),
      ...Array.from({ length: 1000 }, (_, index) => summary('chapter', index + 1, `第${index + 1}章摘要：状态变化 ${'连续性事实'.repeat(80)}`)),
    ],
  }
}

describe('Phase 5.12 generation pulse and long-novel prompt budget', () => {
  it('uses estimated live throughput and official final output tokens for exact throughput', () => {
    const live = generationTelemetry('模型正在连续输出新的文字。', 1_000, 2_000)
    expect(live.estimatedTokensPerSecond).toBeGreaterThan(0)
    expect(live.finalTokensPerSecond).toBeNull()
    const completed = generationTelemetry('模型正在连续输出新的文字。', 1_000, 2_000, 3_000, { inputTokens: 50, outputTokens: 100, reasoningTokens: 20 })
    expect(completed).toMatchObject({ finalOutputTokens: 100, finalReasoningTokens: 20, decodeSeconds: 2, finalTokensPerSecond: 50 })
  })

  it('keeps a 1000-chapter candidate set bounded while retaining an early long-range fact', () => {
    const assembled = renderBudgetedGenerationPrompt(context(), { contextWindow: 32_000, contextWindowSource: 'provider', maxOutputTokens: 4_000, system: 'Novel Studio system prompt' })
    expect(assembled.prompt).toContain('青铜钥匙只能打开北塔地下室')
    expect(assembled.trace.estimatedInputTokens).toBeLessThan(assembled.trace.contextWindow - assembled.trace.maxOutputTokens)
    expect(assembled.trace.sections.some(section => !section.included && section.reason === '输入预算已用尽')).toBe(true)
    expect(assembled.prompt.length).toBeLessThan(120_000)
  })

  it('spends a tight token budget in strict authority order before ordinary author references', () => {
    const authorityContext = context()
    const approvedVersionId = 'approved-version-999'
    authorityContext.longMemory = [summary('project', 7, `DERIVED_SUMMARY ${'派生连续性'.repeat(5_000)}`)]
    authorityContext.previousChapterContinuity = {
      chapterId: 'chapter-999', chapterNumber: 999, chapterTitle: '北塔门外', approvedVersionId,
      summary: null, approvedEndingExcerpt: 'APPROVED_BODY 林舟停在北塔门外，没有跨过门槛。',
    }
    authorityContext.confirmedRelationships = [relationship()]
    authorityContext.authorMemory = [
      memoryItem('hard-constraint', 'AUTHOR_CONSTRAINT 第十二章前不得进入北塔。', { category: 'constraint' }),
      memoryItem('derived-memory', 'DERIVED_MEMORY 林舟仍在北塔门外。', { origin: 'derived', category: 'constraint' }),
      memoryItem('ordinary-reference', 'ORDINARY_REFERENCE 可以考虑加入雨景。', { category: 'idea' }),
    ]
    authorityContext.retrievalBundle = {
      id: 'retrieval-authority', workflowRunId: 'workflow-authority', purpose: 'chapter_draft', projectRevision: 10,
      selectionSnapshotId: 'selection-authority', conflicts: [], truncated: false, createdAt: '2026-08-24T00:00:00.000Z',
      items: [
        { id: 'canon', kind: 'canon_fact', content: 'CANON_FACT 北塔入口已被封锁。', sourceId: 'canon-fact', sourceVersionId: 'canon-version', sourceProjectId: 'project-memory', sourceProjectTitle: '千章连续性', authority: 'current_project_canon', citationLabel: '当前 Canon · 北塔', rank: 1 },
        { id: 'approved', kind: 'approved_excerpt', content: 'APPROVED_EXCERPT 林舟从未进入北塔。', sourceId: 'approved-version-998', sourceVersionId: 'approved-version-998', sourceProjectId: 'project-memory', sourceProjectTitle: '千章连续性', authority: 'current_project_approved', citationLabel: '批准正文 · 北塔门外', rank: 2 },
      ],
    }

    authorityContext.foundationVersions[0] = { ...authorityContext.foundationVersions[0]!, content: 'FOUNDATION_AUTHORITY 已批准基建。' }
    const unbudgeted = renderGenerationPrompt(authorityContext)
    const unbudgetedMarkers = [
      'FOUNDATION_AUTHORITY', 'CANON_FACT', 'APPROVED_EXCERPT', 'APPROVED_BODY',
      '林舟 → 北塔：不得进入', 'AUTHOR_CONSTRAINT', 'DERIVED_MEMORY', 'ORDINARY_REFERENCE',
    ]
    for (let index = 1; index < unbudgetedMarkers.length; index += 1) {
      expect(unbudgeted.indexOf(unbudgetedMarkers[index - 1]!)).toBeLessThan(unbudgeted.indexOf(unbudgetedMarkers[index]!))
    }

    const assembled = renderBudgetedGenerationPrompt(authorityContext, {
      contextWindow: 5_000, contextWindowSource: 'provider', maxOutputTokens: 600, system: 'Novel Studio system prompt',
    })
    const keys = assembled.trace.sections.map(section => section.key)
    const before = (higher: string, lower: string) => expect(keys.indexOf(higher), `${higher} should precede ${lower}`).toBeLessThan(keys.indexOf(lower))

    before('foundation', 'retrieval:canon')
    before('retrieval:canon', 'continuity:previous-chapter-ending')
    before('continuity:previous-chapter-ending', 'retrieval:approved')
    before('retrieval:approved', 'relationships:confirmed')
    before('relationships:confirmed', 'memory:hard-constraint')
    before('memory:hard-constraint', 'project:summary-project-7')
    before('project:summary-project-7', 'memory:derived-memory')
    before('memory:derived-memory', 'memory:ordinary-reference')
    expect(assembled.trace.sections.find(section => section.key === 'project:summary-project-7')).toMatchObject({ included: true, truncated: true })
    expect(assembled.trace.sections.find(section => section.key === 'memory:ordinary-reference')).toMatchObject({ included: false, reason: '输入预算已用尽' })
    expect(assembled.prompt).toContain('AUTHOR_CONSTRAINT')
    expect(assembled.prompt).not.toContain('ORDINARY_REFERENCE')
  })

  it('excludes non-auto, archived, conflicted, and raw Markdown memory from every prompt path', () => {
    const safeContext = context()
    safeContext.longMemory = []
    safeContext.authorMemory = [
      memoryItem('eligible', 'ELIGIBLE_MEMORY 必须保持人物左手受伤。', { category: 'constraint' }),
      memoryItem('manual', 'MANUAL_MEMORY 不应自动进入。', { category: 'research', promptPolicy: 'manual' }),
      memoryItem('excluded', 'EXCLUDED_MEMORY 永不进入。', { category: 'constraint', promptPolicy: 'excluded' }),
      memoryItem('archived', 'ARCHIVED_MEMORY 已归档。', { category: 'constraint', state: 'archived' }),
      memoryItem('conflicted', 'CONFLICTED_MEMORY 尚未解决。', { category: 'constraint', state: 'conflicted' }),
    ]
    safeContext.filesystemMemory = [{ path: 'G:/Novel/memory/manual.md', content: 'RAW_MARKDOWN_MEMORY 绕过策略。', hash: 'raw-markdown-hash' }]

    const unbudgeted = renderGenerationPrompt(safeContext)
    const budgeted = renderBudgetedGenerationPrompt(safeContext, {
      contextWindow: 32_000, contextWindowSource: 'provider', maxOutputTokens: 4_000, system: 'Novel Studio system prompt',
    })
    for (const prompt of [unbudgeted, budgeted.prompt]) {
      expect(prompt).toContain('ELIGIBLE_MEMORY')
      expect(prompt).not.toContain('MANUAL_MEMORY')
      expect(prompt).not.toContain('EXCLUDED_MEMORY')
      expect(prompt).not.toContain('ARCHIVED_MEMORY')
      expect(prompt).not.toContain('CONFLICTED_MEMORY')
      expect(prompt).not.toContain('RAW_MARKDOWN_MEMORY')
    }
    const sectionKeys = budgeted.trace.sections.map(section => section.key)
    for (const excludedKey of ['memory:manual', 'memory:excluded', 'memory:archived', 'memory:conflicted', 'filesystem:memory']) {
      expect(sectionKeys).not.toContain(excludedKey)
    }
  })

  it('renders one stable KnowledgeSummary once when retrieval returns the same summary', () => {
    const duplicateContext = context()
    const sharedSummary = summary('project', 77, 'UNIQUE_SHARED_SUMMARY_9f2c 铜牌的日期仍未破解。')
    duplicateContext.longMemory = [sharedSummary]
    duplicateContext.retrievalBundle = {
      id: 'retrieval-summary-dedup', workflowRunId: 'workflow-summary-dedup', purpose: 'chapter_draft', projectRevision: 10,
      selectionSnapshotId: 'selection-summary-dedup', conflicts: [], truncated: false, createdAt: '2026-08-24T00:00:00.000Z',
      items: [{
        id: 'retrieval-item-summary-dedup', kind: 'summary', content: sharedSummary.compactNarrative,
        sourceId: sharedSummary.id, sourceVersionId: sharedSummary.sourceVersionId,
        sourceProjectId: sharedSummary.projectId, sourceProjectTitle: '千章连续性', authority: 'current_project_summary',
        citationLabel: '全书滚动摘要', rank: 1,
      }],
    }

    const assembled = renderBudgetedGenerationPrompt(duplicateContext, {
      contextWindow: 32_000, contextWindowSource: 'provider', maxOutputTokens: 4_000, system: 'Novel Studio system prompt',
    })
    expect(assembled.prompt.split('UNIQUE_SHARED_SUMMARY_9f2c')).toHaveLength(2)
    expect(assembled.trace.sections.find(section => section.key === `project:${sharedSummary.id}`)).toMatchObject({ included: true })
    expect(assembled.trace.sections.find(section => section.key === 'retrieval:retrieval-item-summary-dedup')).toMatchObject({
      included: false, truncated: false, reason: expect.stringContaining('KnowledgeSummary'),
      sourceIds: expect.arrayContaining(['retrieval-item-summary-dedup', sharedSummary.id]),
    })
  })
})
