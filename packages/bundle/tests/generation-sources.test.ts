import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { renderBudgetedGenerationPrompt } from '../src/prompt-assets/render.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'novel-studio-generation-sources-'))
  roots.push(root)
  const repository = new SqliteNovelRepository({ dataRoot: root })
  const project = repository.createProject({ title: '资料追溯', stylePresetId: 'literary-calm' }).project
  approveTestFoundation(repository, project.id)
  const chapter1 = repository.createChapter(project.id, '雾港来信')
  const chapter2 = repository.createChapter(project.id, '地下通道')
  const chapter3 = repository.createChapter(project.id, '暗号之后')
  const approve = (chapterId: string, content: string) => {
    const chapter = repository.getChapter(chapterId)
    const draft = repository.saveDraft(chapterId, { content, baseRevision: chapter.revision })
    return repository.approveVersion(chapterId, draft.currentDraftVersionId!, draft.revision)
  }
  const approved1 = approve(chapter1.id, '第一章：林舟在雾港发现一封没有署名的信。')
  const approved2 = approve(chapter2.id, '第二章：林舟沿着信上的暗号走进地下通道。')
  repository.upsertKnowledgeSummary(project.id, {
    scope: 'chapter', sourceId: chapter1.id, sourceVersionId: approved1.currentApprovedVersionId, structuredJson: '{}',
    compactNarrative: '第一章摘要：林舟在雾港发现一封没有署名的信。', sourceStartChapter: 1, sourceEndChapter: 1,
    sourceVersionIds: [approved1.currentApprovedVersionId!], provider: 'test', model: 'summary', promptHash: 'summary-1',
  })
  repository.upsertKnowledgeSummary(project.id, {
    scope: 'chapter', sourceId: chapter2.id, sourceVersionId: approved2.currentApprovedVersionId, structuredJson: '{}',
    compactNarrative: '第二章摘要：林舟沿着信上的暗号走进地下通道。', sourceStartChapter: 2, sourceEndChapter: 2,
    sourceVersionIds: [approved2.currentApprovedVersionId!], provider: 'test', model: 'summary', promptHash: 'summary-2',
  })
  return { repository, project, chapter3 }
}

describe('chapter generation source trace', () => {
  it('does not show a fabricated source list before a chapter draft run exists', () => {
    const { repository, chapter3 } = setup()
    expect(repository.getChapterGenerationSources(chapter3.id)).toEqual({ modelRunId: null, purpose: 'chapter-draft', status: 'unavailable', createdAt: null, items: [], truncated: false })
    repository.close()
  })

  it('aggregates the frozen foundation, prior summaries, retrieval citations and style used by the run', () => {
    const { repository, project, chapter3 } = setup()
    const workflow = repository.startChapterWorkflow(chapter3.id)
    const retrieval = repository.createRetrievalBundle(workflow.id)
    const generationNode = repository.prepareWorkflowNode(workflow.id, 'generate_draft', {})
    const context = repository.getGenerationContext(chapter3.id, 'chapter-draft')
    const snapshot = {
      purpose: 'chapter-draft', projectId: project.id, projectRevision: project.revision, chapterId: chapter3.id, chapterRevision: chapter3.revision,
      foundationVersionIds: context.foundationVersions.map(version => version.id), foundationAssemblyHash: context.foundationAssemblyHash,
      retrievalBundleId: retrieval.id, styleProfile: { profileId: context.styleProfile?.profileId, presetId: context.styleProfile?.presetId, revision: context.styleProfile?.revision, sampleHash: context.styleProfile?.sampleHash, name: context.styleProfile?.name },
      filesystemMemory: [], continuity: { priorChapterSummaryIds: context.priorChapterSummaries.map(item => item.summary.id), priorApprovedVersionIds: context.priorChapterSummaries.map(item => item.approvedVersionId) },
      promptAssemblyTrace: { sections: [
        { key: 'foundation', included: true, sourceIds: context.foundationVersions.map(version => version.id) },
        { key: 'continuity:prior-chapter-summaries', included: true, sourceIds: context.priorChapterSummaries.map(item => item.summary.id) },
        ...retrieval.items.map(item => ({ key: `retrieval:${item.id}`, included: true, sourceIds: [item.id, item.sourceId] })),
      ] },
      workflowGuard: { workflowRunId: workflow.id, workflowNodeRunId: generationNode.nodeRunId },
    }
    const run = repository.startModelRun(context, { provider: 'test', model: 'source-audit' }, JSON.stringify(snapshot))
    const sources = repository.getChapterGenerationSources(chapter3.id)

    expect(sources).toMatchObject({ modelRunId: run.id, purpose: 'chapter-draft', status: 'running', truncated: false })
    expect(sources.items.map(item => item.label)).toEqual(expect.arrayContaining([
      '全书大纲 v1', '人物体系 v1', '故事时间线 v1', '第 1 章摘要', '第 2 章摘要', '项目文风：克制文学叙事',
    ]))
    expect(sources.items.some(item => item.label.startsWith('批准正文 ·'))).toBe(true)
    expect(sources.items.every(item => item.used)).toBe(true)
    repository.failModelRun(run.id, new Error('test failure'))
    expect(repository.getChapterGenerationSources(chapter3.id).status).toBe('failed')
    repository.close()
  })

  it('keeps same-label memories as distinct auditable sources', () => {
    const { repository, project, chapter3 } = setup()
    const first = repository.createUserMemory(project.id, {
      content: '硬约束 A：主角不知道灯塔密码。', scope: 'project', category: 'constraint', promptPolicy: 'auto',
    }, repository.getProjectTree(project.id).project.revision)
    const second = repository.createUserMemory(project.id, {
      content: '硬约束 B：潮汐钟只能响三次。', scope: 'project', category: 'constraint', promptPolicy: 'auto',
    }, repository.getProjectTree(project.id).project.revision)
    const context = repository.getGenerationContext(chapter3.id, 'chapter-draft')
    const run = repository.startModelRun(context, { provider: 'test', model: 'same-label-audit' }, JSON.stringify({
      promptAssemblyTrace: { sections: [first, second].map(item => ({
        key: `memory:${item.id}`, label: '作者硬约束 · constraint', included: true, truncated: false,
        estimatedTokens: 20, reason: '按优先级进入本次 Prompt', sourceIds: [item.id, item.currentRevision.id],
      })) },
    }))
    const sameLabel = repository.getChapterGenerationSources(chapter3.id).items.filter(item => item.label.startsWith('作者硬约束 · constraint'))
    expect(sameLabel).toHaveLength(2)
    expect(new Set(sameLabel.map(item => item.id)).size).toBe(2)
    expect(sameLabel.every(item => item.used)).toBe(true)
    expect(sameLabel.every(item => item.kind === 'memory' && item.detail?.includes('20 tokens'))).toBe(true)
    repository.failModelRun(run.id, new Error('test complete'))
    repository.close()
  })

  it('shows the derived Foundation memory beside the approved raw Foundation sources', () => {
    const { repository, project, chapter3 } = setup()
    const contextBeforeMemory = repository.getGenerationContext(chapter3.id, 'chapter-draft')
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'foundation', sourceId: contextBeforeMemory.foundationAssemblyHash, sourceVersionId: contextBeforeMemory.foundationVersions[0]!.id,
      structuredJson: '{}', compactNarrative: '创作基建精炼摘要。', sourceStartChapter: null, sourceEndChapter: null,
      sourceVersionIds: contextBeforeMemory.foundationVersions.map(version => version.id), provider: 'test', model: 'summary', promptHash: 'foundation-summary',
    })
    const context = repository.getGenerationContext(chapter3.id, 'chapter-draft')
    const memory = repository.searchMemory(project.id, { origin: 'derived', scope: 'foundation' }).items[0]
    if (!memory) throw new Error('Expected the derived Foundation memory to be available')
    const run = repository.startModelRun(context, { provider: 'test', model: 'foundation-memory-audit' }, JSON.stringify({
      foundationVersionIds: context.foundationVersions.map(version => version.id),
      promptAssemblyTrace: { sections: [
        ...context.foundationVersions.map(version => ({ key: `foundation:${version.kind}:${version.id}`, included: true, truncated: false, estimatedTokens: 100, sourceIds: [version.id] })),
        { key: 'foundation', label: '创作基建精炼摘要', included: true, truncated: false, estimatedTokens: 37, reason: '按优先级进入本次 Prompt', sourceIds: [memory.sourceKey, memory.id, memory.currentRevision.id] },
      ] },
    }))
    const sources = repository.getChapterGenerationSources(chapter3.id)
    const derived = sources.items.find(item => item.kind === 'memory' && item.label === '创作基建精炼记忆')
    expect(sources.items.filter(item => item.kind === 'foundation')).toHaveLength(3)
    expect(derived).toMatchObject({ used: true })
    expect(derived?.detail).toContain('37 tokens')
    repository.failModelRun(run.id, new Error('test complete'))
    repository.close()
  })

  it('does not report a deduplicated retrieval summary as used through a shared summary id', () => {
    const { repository, project, chapter3 } = setup()
    const workflow = repository.startChapterWorkflow(chapter3.id)
    const retrieval = repository.createRetrievalBundle(workflow.id)
    const generationNode = repository.prepareWorkflowNode(workflow.id, 'generate_draft', {})
    const context = repository.getGenerationContext(chapter3.id, 'chapter-draft')
    const duplicate = retrieval.items.find(item => item.kind === 'summary' && context.longMemory.some(summary => summary.id === item.sourceId))
    expect(duplicate).toBeDefined()
    const assembled = renderBudgetedGenerationPrompt(context, {
      contextWindow: 32_000, contextWindowSource: 'provider', maxOutputTokens: 4_000, system: 'Novel Studio system prompt',
    })
    expect(assembled.trace.sections.find(section => section.key === `retrieval:${duplicate!.id}`)).toMatchObject({
      included: false, reason: expect.stringContaining('KnowledgeSummary'),
    })
    const run = repository.startModelRun(context, { provider: 'test', model: 'summary-dedup-audit' }, JSON.stringify({
      retrievalBundleId: retrieval.id,
      promptAssemblyTrace: assembled.trace,
      workflowGuard: { workflowRunId: workflow.id, workflowNodeRunId: generationNode.nodeRunId },
    }))
    const source = repository.getChapterGenerationSources(chapter3.id).items.find(item => item.id === `retrieval:${duplicate!.id}`)
    expect(source).toMatchObject({ used: false, detail: expect.stringContaining('KnowledgeSummary') })
    repository.failModelRun(run.id, new Error('test complete'))
    repository.close()
  })
})
