import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelGateway } from '../src/generation/model-gateway.js'
import { GenerationService } from '../src/generation/service.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []

function setup(title: string) {
  const root = mkdtempSync(join(tmpdir(), 'novel-studio-batch-planning-'))
  roots.push(root)
  const repository = new SqliteNovelRepository({ dataRoot: root })
  const project = repository.createProject({ title, chapterTargetWords: 2_000 }).project
  approveTestFoundation(repository, project.id)
  return { repository, project }
}

function revision(repository: SqliteNovelRepository, projectId: string): number {
  return repository.getProjectTree(projectId).project.revision
}

function approveWithoutLeavingWorkflow(repository: SqliteNovelRepository, chapterId: string, content: string) {
  const before = repository.getChapter(chapterId)
  const draft = repository.saveDraft(chapterId, { content, baseRevision: before.revision })
  const approved = repository.approveVersion(chapterId, draft.currentDraftVersionId!, draft.revision)
  for (const workflow of repository.listChapterWorkflows(chapterId)) {
    if (!['succeeded', 'cancelled', 'failed'].includes(workflow.status)) repository.setWorkflowStatus(workflow.id, 'cancel_requested')
  }
  return approved
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('bounded chapter batch planning', () => {
  it('plans selected chapters in isolated calls and freezes a bounded source trace', async () => {
    const { repository, project } = setup('逐章安全规划')
    const chapter1 = repository.createChapter(project.id, '第一章')
    const chapter2 = repository.createChapter(project.id, '第二章待重写')
    const chapter3 = repository.createChapter(project.id, '第三章')
    const chapter4 = repository.createChapter(project.id, '第四章待重写')
    const approved1 = approveWithoutLeavingWorkflow(repository, chapter1.id, '第一章批准事实：EARLY_FACT。')
    const approved3 = approveWithoutLeavingWorkflow(repository, chapter3.id, '第三章批准事实：FUTURE_FOR_CH2_BUT_VALID_FOR_CH4。')
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'chapter', sourceId: chapter1.id, sourceVersionId: approved1.currentApprovedVersionId!, structuredJson: '{}',
      compactNarrative: '第一章摘要 EARLY_FACT', sourceStartChapter: 1, sourceEndChapter: 1,
      sourceVersionIds: [approved1.currentApprovedVersionId!], provider: 'test', model: 'summary', promptHash: 'summary-1',
    })
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'chapter', sourceId: chapter3.id, sourceVersionId: approved3.currentApprovedVersionId!, structuredJson: '{}',
      compactNarrative: '第三章摘要 FUTURE_FOR_CH2_BUT_VALID_FOR_CH4', sourceStartChapter: 3, sourceEndChapter: 3,
      sourceVersionIds: [approved3.currentApprovedVersionId!], provider: 'test', model: 'summary', promptHash: 'summary-3',
    })
    const created = repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'auto', chapterIds: [chapter4.id, chapter2.id], count: 2,
    }, { provider: 'mock', model: 'planner' }, revision(repository, project.id))

    const prompts = new Map<string, string>()
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'planner' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      resolveCapacity: async () => ({ contextWindow: 12_000, contextWindowSource: 'provider', defaultMaxTokens: 4_000, reasoningEfforts: ['off'] }),
      async generate(request) {
        const target = request.prompt.includes(chapter4.id) ? chapter4 : chapter2
        prompts.set(target.id, request.prompt)
        return { text: JSON.stringify({ items: [{
          chapterId: 'model-must-not-control-binding', plannedTitle: `${target.title} · 新计划`, writingGoal: `规划 ${target.title}`,
          openingContinuity: '承接批准前文', endingHook: '形成新钩子', targetWords: 2_000,
        }] }) }
      },
    }

    const planned = await new GenerationService(repository, gateway).planChapterBatch(created.id)
    expect(prompts.size).toBe(2)
    expect(prompts.get(chapter2.id)).toContain('EARLY_FACT')
    expect(prompts.get(chapter2.id)).not.toContain('FUTURE_FOR_CH2_BUT_VALID_FOR_CH4')
    expect(prompts.get(chapter4.id)).toContain('FUTURE_FOR_CH2_BUT_VALID_FOR_CH4')
    expect(planned.items.map(item => item.chapterId)).toEqual([chapter4.id, chapter2.id])

    const snapshot = JSON.parse(planned.plan!.inputSnapshotJson) as any
    expect(snapshot).toMatchObject({ schemaVersion: 2, purpose: 'chapter-batch-plan', mode: 'selected' })
    expect(new Set(snapshot.targets.map((target: any) => target.chapterId))).toEqual(new Set([chapter2.id, chapter4.id]))
    for (const target of snapshot.targets) {
      const trace = target.trace
      expect(trace.estimatedInputTokens + trace.maxOutputTokens + trace.safetyTokens).toBeLessThanOrEqual(trace.contextWindow)
      expect(trace.sections).toEqual(expect.arrayContaining([expect.objectContaining({ key: expect.stringMatching(/^foundation:/), included: true })]))
      expect(target.authoritySnapshot).toBeDefined()
    }
    repository.createUserMemory(project.id, {
      content: '规划完成后新增的硬约束，旧计划必须失效。', scope: 'project', category: 'constraint', promptPolicy: 'auto',
    }, revision(repository, project.id))
    expect(() => repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
      id: item.id, plannedTitle: item.plannedTitle, writingGoal: item.writingGoal,
      openingContinuity: item.openingContinuity, endingHook: item.endingHook, targetWords: item.targetWords,
    })), revision(repository, project.id))).toThrow(/记忆|重新规划|revision/i)
    repository.close()
  })

  it('uses one call for a continuous batch and coalesces duplicate in-process planning', async () => {
    const { repository, project } = setup('连续批次单飞')
    const anchor = repository.createChapter(project.id, '连续起点')
    const created = repository.createChapterBatch(project.id, {
      mode: 'continuous', automationMode: 'auto', startChapterId: anchor.id, count: 3,
    }, { provider: 'mock', model: 'planner' }, revision(repository, project.id))
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'planner' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate() {
        calls += 1
        await gate
        return { text: JSON.stringify({ items: Array.from({ length: 3 }, (_, index) => ({
          chapterId: null, plannedTitle: `后续第 ${index + 1} 章`, writingGoal: '连续推进', openingContinuity: '承接前章', endingHook: '留下钩子', targetWords: 2_000,
        })) }) }
      },
    }
    const service = new GenerationService(repository, gateway)
    const first = service.planChapterBatch(created.id)
    const second = service.planChapterBatch(created.id)
    release()
    const [left, right] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(left.items).toHaveLength(3)
    expect(right.id).toBe(left.id)
    expect(JSON.parse(left.plan!.inputSnapshotJson).targets).toHaveLength(1)
    repository.close()
  })

  it.each([
    { label: 'provider failure', response: null },
    { label: 'malformed model JSON', response: '{"items":[' },
  ])('falls back to an editable local plan after $label', async ({ response }) => {
    const { repository, project } = setup('批次规划软护栏')
    const chapter = repository.createChapter(project.id, '待规划章节')
    const created = repository.createChapterBatch(project.id, {
      mode: 'selected', automationMode: 'auto', chapterIds: [chapter.id], count: 1,
    }, { provider: 'mock', model: 'fragile-planner' }, revision(repository, project.id))
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'fragile-planner' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate() {
        if (response === null) throw new Error('planner temporarily offline')
        return { text: response }
      },
    }

    const planned = await new GenerationService(repository, gateway).planChapterBatch(created.id)

    expect(planned).toMatchObject({
      status: 'awaiting_plan_approval',
      items: [expect.objectContaining({
        chapterId: chapter.id, queueState: 'planned', plannedTitle: chapter.title,
        writingGoal: expect.any(String), openingContinuity: expect.any(String), endingHook: expect.any(String), targetWords: 2_000,
      })],
    })
    expect(JSON.parse(planned.plan!.outputJson!)).toMatchObject({
      modelOutputs: [expect.objectContaining({
        chapterId: chapter.id,
        output: expect.objectContaining({
          _novelStudioPlanningAdvisory: expect.objectContaining({ kind: 'local-plan-fallback' }),
        }),
      })],
    })

    const approved = repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
      id: item.id, plannedTitle: '作者修改后的标题', writingGoal: `${item.writingGoal}，加入作者修改`,
      openingContinuity: item.openingContinuity, endingHook: item.endingHook, targetWords: item.targetWords,
    })), revision(repository, project.id))
    expect(approved).toMatchObject({
      status: 'queued',
      items: [expect.objectContaining({ plannedTitle: '作者修改后的标题', writingGoal: expect.stringContaining('作者修改') })],
    })
    repository.close()
  })
})
