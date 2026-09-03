import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelOutputLimitError, type ModelGateway } from '../src/generation/model-gateway.js'
import { GenerationService } from '../src/generation/service.js'
import { renderBudgetedGenerationPrompt, renderGenerationPrompt } from '../src/prompt-assets/render.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []
function setup(chapterTargetWords = 1200) {
  const root = mkdtempSync(join(tmpdir(), 'novel-studio-phase2-'))
  roots.push(root)
  const repository = new SqliteNovelRepository({ dataRoot: root })
  const project = repository.createProject({ title: 'Prompt 追溯', chapterTargetWords })
  approveTestFoundation(repository, project.project.id)
  const chapter = repository.createChapter(project.project.id, '生成章')
  return { repository, project: project.project, chapter }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Phase 2 Prompt Assets and generation trace', () => {
  it('recommends the ordered foundation but can generate from zero or partial approved versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-foundation-'))
    roots.push(root)
    const repository = new SqliteNovelRepository({ dataRoot: root })
    const project = repository.createProject({ title: '动态基建' })
    const chapter = repository.createChapter(project.project.id, '受约束章')
    const emptyContext = repository.getGenerationContext(chapter.id, 'scene-plan')
    expect(emptyContext.foundationVersions).toEqual([])
    expect(emptyContext.foundationAssemblyHash).toMatch(/^[a-f0-9]{64}$/)
    const first = repository.createProjectFoundationVersion(project.project.id, 'outline', { title: '已定大纲', content: '主角从封锁港口获得异常录音，并以追查姐姐失踪真相为全书主线。' }, { provider: 'test', model: 'm', promptVersion: 'v1', promptHash: 'h1', outputJson: '{}' })
    expect(() => repository.createProjectFoundationVersion(project.project.id, 'characters', { title: '人物', content: '这段内容不应在大纲批准前被允许写入项目基建版本中。' }, { provider: 'test', model: 'm', promptVersion: 'v1', promptHash: 'h2', outputJson: '{}' })).toThrow()
    repository.approveProjectFoundationVersion(project.project.id, 'outline', first.stages[0]!.latestVersion!.id)
    approveTestFoundationFrom(repository, project.project.id, 'characters')
    approveTestFoundationFrom(repository, project.project.id, 'timeline')
    const context = repository.getGenerationContext(chapter.id, 'scene-plan')
    const rendered = renderGenerationPrompt(context)
    expect(context.foundationVersions.map(version => version.kind)).toEqual(['outline','characters','timeline'])
    expect(context.foundationVersions.map(version => version.dependencyVersionIds.length)).toEqual([0,1,2])
    expect(rendered).toContain('项目创作基建')
    expect(rendered).toContain('主角从封锁港口获得异常录音')
    expect(rendered).toContain(context.foundationAssemblyHash)
    repository.close()
  })

  it('invalidates downstream approvals when an upstream foundation version changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-foundation-invalidation-'))
    roots.push(root)
    const repository = new SqliteNovelRepository({ dataRoot: root })
    const project = repository.createProject({ title: '一致性重锁' }).project
    approveTestFoundation(repository, project.id)
    const before = repository.getProjectFoundation(project.id)
    expect(before.readyForChapterGeneration).toBe(true)

    const regenerated = repository.createProjectFoundationVersion(project.id, 'outline', {
      title: '新大纲',
      content: '主线改为角色主动追查港口失踪案，并改变后续人物关系与时间因果。',
    }, { provider: 'test', model: 'm', promptVersion: 'v2', promptHash: 'outline-v2', outputJson: '{}' })
    const newOutline = regenerated.stages.find(stage => stage.kind === 'outline')!.latestVersion!
    const after = repository.approveProjectFoundationVersion(project.id, 'outline', newOutline.id)

    expect(after.readyForChapterGeneration).toBe(false)
    expect(after.stages.map(stage => stage.status)).toEqual(['approved','ready','locked'])
    expect(after.approvedVersionIds).toEqual([newOutline.id])
    expect(after.stages.find(stage => stage.kind === 'characters')!.approvedVersion).toBeNull()
    repository.close()
  })

  it('versions prompts and keeps prior versions immutable', () => {
    const { repository, project } = setup()
    const catalog = repository.getPromptCatalog(project.id)
    const asset = catalog.assets.find(item => item.purpose === 'scene-plan')!
    const originalId = catalog.selections['scene-plan']
    const custom = repository.createPromptVersion(asset.id, `${asset.versions[0]!.template}\n新增规则：保持悬念。`)
    const selected = repository.selectPromptVersion(project.id, 'scene-plan', custom.id)
    expect(selected.selections['scene-plan']).toBe(custom.id)
    expect(selected.assets.find(item => item.id === asset.id)?.versions.map(item => item.id)).toContain(originalId)
    expect(custom.version).toBe(2)
    repository.close()
  })

  it('requires every model Canon candidate to cite one unique exact manuscript excerpt', () => {
    const { repository, project } = setup()
    const catalog = repository.getPromptCatalog(project.id)
    const chapterDraft = catalog.assets.find(item => item.purpose === 'chapter-draft')!
    const activeVersionId = catalog.selections['chapter-draft']
    const activeVersion = chapterDraft.versions.find(version => version.id === activeVersionId)!
    const legacyVersion = chapterDraft.versions.find(version => version.id === 'prompt-chapter-draft-v1')!
    const scenePlan = catalog.assets.find(item => item.purpose === 'scene-plan')!

    expect(activeVersion).toMatchObject({ id: 'prompt-chapter-draft-v2', version: 2, source: 'builtin' })
    expect(activeVersion.template).toContain('evidenceExcerpt')
    expect(activeVersion.template).toContain('在正文中只出现一次')
    expect(activeVersion.template).toContain('找不到唯一逐字证据时不要输出该候选')
    expect(JSON.parse(activeVersion.outputSchemaJson).properties.canonCandidates.items).toMatchObject({
      required: expect.arrayContaining(['evidenceExcerpt']),
      properties: { evidenceExcerpt: { type: 'string', minLength: 6, maxLength: 300 } },
    })
    expect(legacyVersion).toMatchObject({ version: 1, source: 'builtin', contentHash: '928885cf1f03041fa8af6c8c96da0c38e7b20a8b2715534de163e7b783fcf487' })
    expect(legacyVersion.template).not.toContain('evidenceExcerpt')
    expect(scenePlan).toMatchObject({ activeVersionId: 'prompt-scene-plan-v1' })
    expect(scenePlan.versions.map(version => version.id)).toEqual(['prompt-scene-plan-v1'])
    repository.close()
  })

  it('persists project rules with revision protection', () => {
    const { repository, project } = setup()
    const before = repository.getPromptCatalog(project.id)
    const after = repository.updateProjectRules(project.id, { styleRules: '短句、克制。', chapterGoal: '发现失踪线索。', forbiddenContent: '禁止梦境解谜。' }, before.projectRules.revision)
    expect(after.projectRules).toMatchObject({ styleRules: '短句、克制。', chapterGoal: '发现失踪线索。', revision: 1 })
    expect(() => repository.updateProjectRules(project.id, { styleRules: '', chapterGoal: '', forbiddenContent: '' }, 0)).toThrow(/changed from revision/)
    repository.close()
  })

  it('records model, prompt and input versions for scene plan and generated draft', async () => {
    const { repository, chapter } = setup()
    const generatedManuscript = '模型生成的正文。'.repeat(53)
    let calls = 0
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'novelist-v1' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate() {
        calls++
        return calls === 1
          ? { text: JSON.stringify({ chapterGoal: '找到线索', scenes: [{ scenePurpose: '进入雾港' }], risks: [] }), usage: { inputTokens: 10, outputTokens: 20 } }
          : { text: JSON.stringify({ title: '生成章', manuscript: generatedManuscript, uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }), usage: { inputTokens: 30, outputTokens: 40 } }
      },
    }
    const service = new GenerationService(repository, gateway)
    const plan = await service.generate(chapter.id, 'scene-plan')
    expect(plan.modelRun).toMatchObject({ provider: 'mock', model: 'novelist-v1', status: 'succeeded' })
    const draft = await service.generate(chapter.id, 'chapter-draft')
    const generated = draft.chapter!.versions.find(version => version.modelRunId === draft.modelRun.id)!
    expect(generated).toMatchObject({ content: generatedManuscript, origin: 'model', createdBy: 'model', promptAssetVersionId: draft.modelRun.promptAssetVersionId })
    expect(JSON.parse(draft.modelRun.usageJson!)).toEqual({ inputTokens: 30, outputTokens: 40 })
    expect(draft.modelRun.streamedText).toBe(generatedManuscript)
    repository.close()
  })

  it.each([
    {
      label: 'non-standard JSON content field',
      response: (manuscript: string) => JSON.stringify({ title: '非标准结构章', content: manuscript }),
    },
    {
      label: 'plain Markdown text',
      response: (manuscript: string) => `\`\`\`markdown\n${manuscript}\n\`\`\``,
    },
  ])('recovers and saves reviewable prose from $label', async ({ response }) => {
    const { repository, chapter } = setup()
    const manuscript = '潮声推着薄雾越过旧码头，林舟沿着潮线继续追查失踪者留下的铜牌。'.repeat(18)
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'soft-json-recovery' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate() { return { text: response(manuscript) } },
    }

    const result = await new GenerationService(repository, gateway).generate(chapter.id, 'chapter-draft')

    expect(result.modelRun).toMatchObject({ status: 'succeeded', errorJson: null })
    expect(result.chapter!.versions).toEqual([
      expect.objectContaining({ content: manuscript, origin: 'model', modelRunId: result.modelRun.id }),
    ])
    expect(JSON.parse(result.modelRun.outputJson!)).toMatchObject({
      manuscript,
      _novelStudioCompletionAdvisory: { kind: 'plain-text-recovery', requiresAuthorReview: false },
    })
    repository.close()
  })

  it('assembles chapter three from approved chapters one and two for both scene planning and prose', async () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-chapter-continuity-'))
    roots.push(root)
    const repository = new SqliteNovelRepository({ dataRoot: root })
    const project = repository.createProject({ title: '连续性长篇', chapterTargetWords: 1200 }).project
    approveTestFoundation(repository, project.id)
    const chapter1 = repository.createChapter(project.id, '雾港来信')
    const chapter2 = repository.createChapter(project.id, '地下通道')
    const chapter3 = repository.createChapter(project.id, '暗号之后')
    const chapter4 = repository.createChapter(project.id, '未来泄漏')

    const approveText = (chapterId: string, revision: number, content: string) => {
      const draft = repository.saveDraft(chapterId, { content, baseRevision: revision })
      return repository.approveVersion(chapterId, draft.currentDraftVersionId!, draft.revision)
    }
    const approved1 = approveText(chapter1.id, chapter1.revision, '第一章正文：林舟与顾岚在雾港封锁后巡查旧码头，最后发现北岸走私者留下的血迹。')
    const oldApproved2 = approveText(chapter2.id, chapter2.revision, '第二章旧版本结尾：这段已经被新版本取代，不得进入第三章。')
    const approved2 = approveText(chapter2.id, oldApproved2.revision, `第二章正文：两人沿血迹找到地下通道，确认墙上刻着北岸暗号。\n${'通道深处只有潮湿的回声。'.repeat(120)}\n顾岚按住灯柄，对林舟说：“标记刚留下不久，对方还没有离开港区。”`)
    const approved4 = approveText(chapter4.id, chapter4.revision, '第四章未来内容：幕后联络人已经现身。这个事实绝不能泄漏给第三章。')

    const addSummary = (chapterId: string, chapterNumber: number, versionId: string, compactNarrative: string) => repository.upsertKnowledgeSummary(project.id, {
      scope: 'chapter', sourceId: chapterId, sourceVersionId: versionId, structuredJson: '{}', compactNarrative,
      sourceStartChapter: chapterNumber, sourceEndChapter: chapterNumber, sourceVersionIds: [versionId], provider: 'test', model: 'summary', promptHash: `summary-${chapterNumber}`,
    })
    addSummary(chapter1.id, 1, approved1.currentApprovedVersionId!, '第一章摘要：雾港封锁后，林舟与顾岚巡查旧码头并发现北岸走私者留下的血迹。')
    addSummary(chapter2.id, 2, approved2.currentApprovedVersionId!, '第二章摘要：两人发现地下通道和新刻的北岸暗号，顾岚判断对方尚未离开港区。')
    addSummary(chapter4.id, 4, approved4.currentApprovedVersionId!, '第四章未来摘要：幕后联络人已经现身。')
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'project', sourceId: project.id, sourceVersionId: approved4.currentApprovedVersionId!, structuredJson: '{}', compactNarrative: '未来全书摘要：第四章幕后联络人已经现身。',
      sourceStartChapter: 1, sourceEndChapter: 4, sourceVersionIds: [approved1.currentApprovedVersionId!, approved2.currentApprovedVersionId!, approved4.currentApprovedVersionId!], provider: 'test', model: 'summary', promptHash: 'future-project-summary',
    })

    const workflow = repository.startChapterWorkflow(chapter3.id)
    const retrieval = repository.createRetrievalBundle(workflow.id)
    expect(retrieval.items.map(item => item.content).join('\n')).toContain('第一章摘要')
    expect(retrieval.items.map(item => item.content).join('\n')).toContain('第二章摘要')
    expect(retrieval.items.map(item => item.content).join('\n')).not.toContain('第四章未来')
    expect(retrieval.items.map(item => item.content).join('\n')).not.toContain('未来全书摘要')
    repository.setWorkflowStatus(workflow.id, 'cancel_requested')

    const context = repository.getGenerationContext(chapter3.id, 'scene-plan')
    expect(context.priorChapterSummaries.map(item => item.chapterNumber)).toEqual([1, 2])
    expect(context.previousChapterContinuity).toMatchObject({ chapterId: chapter2.id, chapterNumber: 2, approvedVersionId: approved2.currentApprovedVersionId })
    expect(context.previousChapterContinuity?.approvedEndingExcerpt).toContain('标记刚留下不久，对方还没有离开港区')
    expect(context.previousChapterContinuity?.approvedEndingExcerpt).not.toContain('第二章旧版本结尾')
    expect(context.longMemory.map(item => item.compactNarrative)).not.toContain('第四章未来摘要：幕后联络人已经现身。')
    expect(context.longMemory.map(item => item.compactNarrative)).not.toContain('未来全书摘要：第四章幕后联络人已经现身。')

    const prompts: string[] = []
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'continuity-writer' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        prompts.push(request.prompt)
        return request.prompt.includes('任务：根据场景计划生成章节初稿')
          ? { text: JSON.stringify({ title: '暗号之后', manuscript: '第三章承接地下通道结尾继续推进。'.repeat(27), uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }) }
          : { text: JSON.stringify({ chapterGoal: '追踪刚离开的走私者', scenes: [{ scenePurpose: '承接地下通道结尾继续追踪' }], risks: [] }) }
      },
    }
    const service = new GenerationService(repository, gateway)
    const scenePlan = await service.generate(chapter3.id, 'scene-plan')
    const chapterDraft = await service.generate(chapter3.id, 'chapter-draft')

    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) {
      expect(prompt).toContain('前文连续性契约')
      expect(prompt).toContain('前文连续性 · 最近已批准章节摘要（从早到晚）')
      expect(prompt).toContain('第一章摘要：雾港封锁后')
      expect(prompt).toContain('第二章摘要：两人发现地下通道')
      expect(prompt.indexOf('第一章摘要：雾港封锁后')).toBeLessThan(prompt.indexOf('第二章摘要：两人发现地下通道'))
      expect(prompt).toContain('紧邻上一章结尾（续写起点）')
      expect(prompt).toContain('标记刚留下不久，对方还没有离开港区')
      expect(prompt).not.toContain('第二章旧版本结尾')
      expect(prompt).not.toContain('第四章未来摘要')
      expect(prompt).not.toContain('未来全书摘要')
    }

    for (const run of [scenePlan.modelRun, chapterDraft.modelRun]) {
      const snapshot = JSON.parse(run.inputSnapshotJson)
      expect(snapshot.continuity).toMatchObject({
        mode: 'continuation',
        previousChapter: { chapterId: chapter2.id, chapterNumber: 2, approvedVersionId: approved2.currentApprovedVersionId },
        priorApprovedVersionIds: [approved1.currentApprovedVersionId, approved2.currentApprovedVersionId],
      })
      expect(snapshot.promptAssemblyTrace.sections).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'continuity:prior-chapter-summaries', included: true }),
        expect.objectContaining({ key: 'continuity:previous-chapter-ending', included: true }),
      ]))
    }
    repository.close()
  })

  it('disables hidden reasoning and uses known provider capacity beyond the 16k fallback', async () => {
    const { repository, chapter } = setup(30_000)
    const selections: Array<{ purpose: string; reasoningEffort?: string; maxTokens: number }> = []
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'reasoning-model', model: 'flash' }),
      providers: () => [{ id: 'reasoning-model', name: 'Reasoning Model' }],
      resolveCapacity: async () => ({ contextWindow: 1_000_000, contextWindowSource: 'provider', defaultMaxTokens: 256_000, reasoningEfforts: ['off','low','high','max'] }),
      async generate(request) {
        if (request.prompt.startsWith('任务：把三项已批准创作基建提炼为后续 1000 章都可复用的创作圣经')) {
          return { text: JSON.stringify({ compactNarrative: '保留已批准主线、人物边界与时间因果。', structuredSummary: {} }) }
        }
        const purpose = request.prompt.includes('任务：根据场景计划生成章节初稿') ? 'chapter-draft' : 'scene-plan'
        selections.push({ purpose, reasoningEffort: request.selection.reasoningEffort, maxTokens: request.maxTokens })
        return purpose === 'chapter-draft'
          ? { text: JSON.stringify({ title: '可见正文', manuscript: '隐藏推理不会抢占本次正文预算。'.repeat(30), uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }) }
          : { text: JSON.stringify({ chapterGoal: '形成可见计划', scenes: [{ scenePurpose: '推进冲突' }], risks: [] }) }
      },
    }
    const service = new GenerationService(repository, gateway)
    const plan = await service.generate(chapter.id, 'scene-plan')
    await service.generate(chapter.id, 'chapter-draft')

    expect(selections).toEqual([
      { purpose: 'scene-plan', reasoningEffort: 'off', maxTokens: 1800 },
      { purpose: 'chapter-draft', reasoningEffort: 'off', maxTokens: 47_000 },
    ])
    expect(JSON.parse(plan.modelRun.inputSnapshotJson)).toMatchObject({ reasoningEffort: 'off' })
    repository.close()
  })

  it('rejects a duplicate generation request while the same chapter task is still running', async () => {
    const { repository, chapter } = setup()
    let release!: (value: { text: string }) => void
    const pending = new Promise<{ text: string }>(resolve => { release = resolve })
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'slow', model: 'single-flight' }), providers: () => [{ id: 'slow', name: 'Slow' }],
      generate: async () => pending,
    }
    const service = new GenerationService(repository, gateway)
    const first = service.generate(chapter.id, 'scene-plan')
    await expect(service.generate(chapter.id, 'scene-plan')).rejects.toThrow('正在规划场景')
    release({ text: JSON.stringify({ chapterGoal: '单次规划', scenes: [{ scenePurpose: '只调用一次' }], risks: [] }) })
    await first
    expect(repository.listModelRuns(chapter.id)).toHaveLength(1)
    repository.close()
  })

  it('atomically rejects deferred scene plans and drafts after any frozen authoring authority changes', async () => {
    const scenarios: Array<{
      label: string
      purpose: 'scene-plan' | 'chapter-draft'
      expectedMessage: RegExp
      mutate: (repository: SqliteNovelRepository, projectId: string) => void
    }> = [
      {
        label: 'Foundation', purpose: 'scene-plan', expectedMessage: /项目|创作基建/,
        mutate(repository, projectId) {
          const workspace = repository.createProjectFoundationVersion(projectId, 'outline', {
            title: '生成期间更新的大纲', content: '主角改变调查路线，并让后续人物行动与时间因果采用新的批准基建。',
          }, { provider: 'test', model: 'authority-race', promptVersion: 'v2', promptHash: 'authority-foundation', outputJson: '{}' })
          repository.approveProjectFoundationVersion(projectId, 'outline', workspace.stages.find(stage => stage.kind === 'outline')!.latestVersion!.id)
        },
      },
      {
        label: 'style', purpose: 'chapter-draft', expectedMessage: /文风/,
        mutate(repository, projectId) {
          const style = repository.getProjectStyleProfile(projectId)
          repository.setProjectStylePreset(projectId, 'suspense-cinematic', style.revision)
        },
      },
      {
        label: 'project rules', purpose: 'scene-plan', expectedMessage: /写作规则/,
        mutate(repository, projectId) {
          const rules = repository.getPromptCatalog(projectId).projectRules
          repository.updateProjectRules(projectId, {
            styleRules: `${rules.styleRules}\n生成期间新增规则。`,
            chapterGoal: rules.chapterGoal,
            forbiddenContent: rules.forbiddenContent,
          }, rules.revision)
        },
      },
      {
        label: 'Prompt selection', purpose: 'chapter-draft', expectedMessage: /Prompt/,
        mutate(repository, projectId) {
          const catalog = repository.getPromptCatalog(projectId)
          const asset = catalog.assets.find(item => item.purpose === 'chapter-draft')!
          const version = repository.createPromptVersion(asset.id, `${asset.versions[0]!.template}\n生成期间启用的新规则。`)
          repository.selectPromptVersion(projectId, 'chapter-draft', version.id)
        },
      },
    ]

    for (const scenario of scenarios) {
      const { repository, project, chapter } = setup()
      if (scenario.purpose === 'chapter-draft') {
        const planGateway: ModelGateway = {
          selection: () => ({ provider: 'mock', model: 'authority-race-plan' }),
          providers: () => [{ id: 'mock', name: 'Mock' }],
          generate: async () => ({ text: JSON.stringify({ chapterGoal: '先固定场景计划', scenes: [{ scenePurpose: '等待正文' }], risks: [] }) }),
        }
        await new GenerationService(repository, planGateway).generate(chapter.id, 'scene-plan')
      }

      let signalStarted!: () => void
      let release!: (value: { text: string }) => void
      const started = new Promise<void>(resolve => { signalStarted = resolve })
      const response = new Promise<{ text: string }>(resolve => { release = resolve })
      const gateway: ModelGateway = {
        selection: () => ({ provider: 'mock', model: `deferred-${scenario.label}` }),
        providers: () => [{ id: 'mock', name: 'Mock' }],
        async generate() {
          signalStarted()
          return response
        },
      }
      const versionCount = repository.getChapter(chapter.id).versions.length
      const pending = new GenerationService(repository, gateway).generate(chapter.id, scenario.purpose)
      await started
      scenario.mutate(repository, project.id)
      release({ text: scenario.purpose === 'scene-plan'
        ? JSON.stringify({ chapterGoal: '迟到计划', scenes: [{ scenePurpose: '不应落库' }], risks: [] })
        : JSON.stringify({ title: '迟到正文', manuscript: '这份正文使用了已经过期的作者权威输入。'.repeat(30), uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }) })

      let rejection: unknown
      try { await pending } catch (cause) { rejection = cause }
      expect(rejection, scenario.label).toMatchObject({ code: 'revision-conflict', message: expect.stringMatching(scenario.expectedMessage) })
      expect(repository.listModelRuns(chapter.id).find(run => run.model === `deferred-${scenario.label}`), scenario.label)
        .toMatchObject({ status: 'failed', errorJson: expect.stringContaining('revision-conflict') })
      expect(repository.getChapter(chapter.id).versions, scenario.label).toHaveLength(versionCount)
      if (scenario.purpose === 'scene-plan') expect(repository.getGenerationContext(chapter.id, 'scene-plan').latestScenePlan, scenario.label).toBeNull()
      repository.close()
    }
  })

  it('rewrites only a selected fragment with approved constraints and no manuscript mutation', async () => {
    const { repository, project, chapter } = setup()
    const foundation = repository.getProjectFoundation(project.id)
    const foundationVersions = repository.getApprovedProjectFoundationVersions(project.id)
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'foundation', sourceId: foundation.assemblyHash!, sourceVersionId: foundationVersions.at(-1)!.id,
      structuredJson: '{}', compactNarrative: 'REWRITE_FOUNDATION_DIGEST', sourceStartChapter: null, sourceEndChapter: null,
      sourceVersionIds: foundationVersions.map(version => version.id), provider: 'test', model: 'memory', promptHash: 'rewrite-digest',
    })
    const requests: Parameters<ModelGateway['generate']>[0][] = []
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'inline-editor' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      resolveCapacity: async () => ({ contextWindow: 128_000, contextWindowSource: 'provider', defaultMaxTokens: 8_000, reasoningEfforts: ['off','high'] }),
      async generate(request) {
        requests.push(request)
        return { text: JSON.stringify({ replacement: '雾从旧码头的石阶间缓慢漫上来。' }) }
      },
    }
    const before = repository.getChapter(chapter.id)
    const result = await new GenerationService(repository, gateway).rewriteSelection(chapter.id, {
      selectedText: '码头起雾了。', contextBefore: '潮声压得很低。', contextAfter: '林舟停下脚步。', instruction: '扩写环境感受，但不要改变人物动作。', baseRevision: chapter.revision,
    })

    expect(result).toEqual({ replacementText: '雾从旧码头的石阶间缓慢漫上来。' })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.selection.reasoningEffort).toBe('off')
    expect(requests[0]!.prompt).toContain(JSON.stringify('码头起雾了。'))
    expect(requests[0]!.prompt).toContain(JSON.stringify('潮声压得很低。'))
    expect(requests[0]!.prompt).toContain(JSON.stringify('扩写环境感受，但不要改变人物动作。'))
    expect(requests[0]!.prompt).toContain('已批准创作基建与长期约束')
    expect(requests[0]!.prompt).toContain('Approved outline foundation content')
    expect(requests[0]!.prompt).toContain('REWRITE_FOUNDATION_DIGEST')
    expect(repository.getChapter(chapter.id)).toEqual(before)
    expect(repository.listModelRuns(chapter.id)).toHaveLength(0)
    repository.close()
  })

  it('rejects stale and concurrent selection rewrites before applying anything', async () => {
    const { repository, chapter } = setup()
    let release!: (value: { text: string }) => void
    const pending = new Promise<{ text: string }>(resolve => { release = resolve })
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'slow-inline-editor' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => pending,
    }
    const service = new GenerationService(repository, gateway)
    const input = { selectedText: '原句。', contextBefore: '前文。', contextAfter: '后文。', instruction: '', baseRevision: chapter.revision }
    const first = service.rewriteSelection(chapter.id, input)
    await expect(service.rewriteSelection(chapter.id, input)).rejects.toThrow('已有选区正在重写')
    release({ text: JSON.stringify({ replacement: '新句。' }) })
    await expect(first).resolves.toEqual({ replacementText: '新句。' })
    await expect(service.rewriteSelection(chapter.id, { ...input, baseRevision: chapter.revision + 1 })).rejects.toThrow('章节版本已经变化')
    repository.close()
  })

  it('accepts a general rewrite without instructions and rejects oversized instructions before model I/O', async () => {
    const { repository, chapter } = setup()
    let calls = 0
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'instruction-validation' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate() { calls += 1; return { text: JSON.stringify({ replacement: '通用改写。' }) } },
    }
    const service = new GenerationService(repository, gateway)
    const input = { selectedText: '原句。', contextBefore: '', contextAfter: '', instruction: '', baseRevision: chapter.revision }
    await expect(service.rewriteSelection(chapter.id, input)).resolves.toEqual({ replacementText: '通用改写。' })
    await expect(service.rewriteSelection(chapter.id, { ...input, instruction: '改'.repeat(1_201) })).rejects.toThrow('重写要求最多 1200 个字符')
    expect(calls).toBe(1)
    repository.close()
  })

  it('keeps an interrupted chapter manuscript preview without creating a manuscript version', async () => {
    const { repository, chapter } = setup()
    const sceneGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'scene' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({ text: JSON.stringify({ chapterGoal: '准备实时正文', scenes: [{ scenePurpose: '进入港口' }], risks: [] }) }),
    }
    await new GenerationService(repository, sceneGateway).generate(chapter.id, 'scene-plan')
    const partial = '{"title":"实时章","manuscript":"潮声推着雾气越过旧码头。\\n林舟握紧录音机，继续向灯塔走去。'
    const interruptedGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'interrupted' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        request.onProgress?.({ outputCharacters: partial.length, text: partial })
        throw new Error('connection lost')
      },
    }
    const beforeVersions = repository.getChapter(chapter.id).versions.length
    await expect(new GenerationService(repository, interruptedGateway).generate(chapter.id, 'chapter-draft')).rejects.toThrow('connection lost')
    const failed = repository.listModelRuns(chapter.id)[0]!
    expect(failed).toMatchObject({ purpose: 'chapter-draft', status: 'failed', streamedText: '潮声推着雾气越过旧码头。\n林舟握紧录音机，继续向灯塔走去。' })
    expect(repository.getChapter(chapter.id).versions).toHaveLength(beforeVersions)
    repository.close()
  })

  it('injects the derived Foundation memory into the prompt and records real usage', async () => {
    const { repository, project, chapter } = setup()
    const foundation = repository.getProjectFoundation(project.id)
    const approved = repository.getApprovedProjectFoundationVersions(project.id)
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'foundation', sourceId: foundation.assemblyHash!, sourceVersionId: null,
      structuredJson: '{}', compactNarrative: 'FOUNDATION_DIGEST_TAIL 人物在潮汐钟响过三次前不得离开旧港。',
      sourceStartChapter: null, sourceEndChapter: null, sourceVersionIds: approved.map(version => version.id),
      provider: 'test', model: 'memory', promptHash: 'foundation-digest-test',
    })
    let prompt = ''
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'memory-aware' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        prompt = request.prompt
        return { text: JSON.stringify({ chapterGoal: '遵守压缩记忆', scenes: [{ scenePurpose: '检查潮汐钟约束' }], risks: [] }) }
      },
    }
    const result = await new GenerationService(repository, gateway).generate(chapter.id, 'scene-plan')
    expect(prompt).toContain('FOUNDATION_DIGEST_TAIL')
    const memory = repository.searchMemory(project.id, { origin: 'derived', scope: 'foundation' }).items.find(item => item.currentRevision.content.includes('FOUNDATION_DIGEST_TAIL'))
    expect(memory).toBeDefined()
    const usage = repository.getMemoryItem(memory!.id).recentUsages.find(item => item.modelRunId === result.modelRun.id)
    expect(usage).toMatchObject({ included: true, sectionKey: 'foundation' })
    expect(usage!.estimatedTokens).toBeGreaterThan(0)
    repository.close()
  })

  it('budgets every approved Foundation stage independently and keeps its tail trace truthful', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-foundation-budget-'))
    roots.push(root)
    const repository = new SqliteNovelRepository({ dataRoot: root })
    const project = repository.createProject({ title: '超长创作基建' }).project
    const tails = { outline: 'OUTLINE_UNIQUE_TAIL', characters: 'CHARACTERS_UNIQUE_TAIL', timeline: 'TIMELINE_UNIQUE_TAIL' } as const
    for (const kind of ['outline', 'characters', 'timeline'] as const) {
      const workspace = repository.createProjectFoundationVersion(project.id, kind, {
        title: kind, content: `${`${kind} approved constraint `.repeat(2_500)}${tails[kind]}`,
      }, { provider: 'test', model: 'long-foundation', promptVersion: 'v1', promptHash: `long-${kind}`, outputJson: '{}' })
      repository.approveProjectFoundationVersion(project.id, kind, workspace.stages.find(stage => stage.kind === kind)!.latestVersion!.id)
    }
    const foundation = repository.getProjectFoundation(project.id)
    const versions = repository.getApprovedProjectFoundationVersions(project.id)
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'foundation', sourceId: foundation.assemblyHash!, sourceVersionId: versions.at(-1)!.id,
      structuredJson: '{}', compactNarrative: 'FOUNDATION_DIGEST_SUPPLEMENT', sourceStartChapter: null, sourceEndChapter: null,
      sourceVersionIds: versions.map(version => version.id), provider: 'test', model: 'memory', promptHash: 'long-foundation-digest',
    })
    const chapter = repository.createChapter(project.id, '预算章')
    const context = repository.getGenerationContext(chapter.id, 'scene-plan')
    const assembled = renderBudgetedGenerationPrompt(context, {
      contextWindow: 64_000, contextWindowSource: 'provider', maxOutputTokens: 1_800, system: 'test-system',
    })

    for (const tail of Object.values(tails)) expect(assembled.prompt).toContain(tail)
    const foundationTraces = assembled.trace.sections.filter(section => section.key.startsWith('foundation:'))
    expect(foundationTraces).toHaveLength(3)
    expect(foundationTraces.every(section => section.included && section.truncated && section.sourceIds.length === 1)).toBe(true)
    const digest = context.longMemory.find(summary => summary.scope === 'foundation')!
    expect(assembled.trace.sections).toContainEqual(expect.objectContaining({ key: 'foundation', included: true, sourceIds: [digest.id] }))
    repository.close()
  })

  it('auto-continues an output-limited response and preserves a reviewable draft instead of failing', async () => {
    const { repository, chapter } = setup()
    const sceneGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'scene' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({ text: JSON.stringify({ chapterGoal: '准备有界正文', scenes: [{ scenePurpose: '进入旧港' }], risks: [] }) }),
    }
    await new GenerationService(repository, sceneGateway).generate(chapter.id, 'scene-plan')
    const beforeVersions = repository.getChapter(chapter.id).versions.length
    const partial = '{"title":"中断章","manuscript":"潮声越过旧港，林舟抬头看见潮汐钟。'
    const limitedGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'limited' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        request.onProgress?.({ outputCharacters: partial.length, text: partial })
        throw new ModelOutputLimitError({ text: partial, usage: { inputTokens: 900, outputTokens: 8_000 } }, request.maxTokens)
      },
    }
    const result = await new GenerationService(repository, limitedGateway).generate(chapter.id, 'chapter-draft')
    expect(result.modelRun).toMatchObject({ status: 'succeeded', errorJson: null })
    expect(result.modelRun.streamedText).toContain('潮声越过旧港')
    expect(JSON.parse(result.modelRun.outputJson!)).toMatchObject({
      _novelStudioCompletionAdvisory: { kind: 'incomplete-after-output-limit', requiresAuthorReview: true },
    })
    expect(repository.getChapter(chapter.id).versions).toEqual([
      ...Array.from({ length: beforeVersions }, () => expect.anything()),
      expect.objectContaining({ content: expect.stringContaining('潮声越过旧港'), modelRunId: result.modelRun.id }),
    ])
    repository.close()
  })

  it('saves a complete over-target model response and records only a non-blocking advisory', async () => {
    const { repository, chapter } = setup()
    const sceneGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'scene' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({ text: JSON.stringify({ chapterGoal: '准备 1200 字正文', scenes: [{ scenePurpose: '完成单章冲突' }], risks: [] }) }),
    }
    await new GenerationService(repository, sceneGateway).generate(chapter.id, 'scene-plan')
    const manuscript = '潮'.repeat(1_801)
    const overlongGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'overlong' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({
        text: JSON.stringify({ title: '过长章', manuscript, uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }),
        usage: { inputTokens: 100, outputTokens: 1_900 },
      }),
    }

    const result = await new GenerationService(repository, overlongGateway).generate(chapter.id, 'chapter-draft')
    expect(result.modelRun).toMatchObject({ status: 'succeeded', streamedText: manuscript, errorJson: null })
    expect(JSON.parse(result.modelRun.outputJson!)).toMatchObject({
      _novelStudioLengthAdvisory: {
        kind: 'longer-than-target', targetWords: 1_200, actualWords: 1_801,
        recommendedMinWords: 1_020, recommendedMaxWords: 1_260,
      },
    })
    expect(JSON.parse(result.modelRun.usageJson!)).toEqual({ inputTokens: 100, outputTokens: 1_900 })
    expect(result.chapter!.versions).toEqual([expect.objectContaining({ content: manuscript, wordCount: 1_801 })])
    repository.close()
  })

  it('saves any non-empty complete short response but still rejects a blank manuscript', async () => {
    const { repository, chapter } = setup()
    const sceneGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'scene' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({ text: JSON.stringify({ chapterGoal: '准备 1200 字正文', scenes: [{ scenePurpose: '完成单章冲突' }], risks: [] }) }),
    }
    await new GenerationService(repository, sceneGateway).generate(chapter.id, 'scene-plan')
    const manuscript = '潮'.repeat(419)
    const telemetry = {
      firstVisibleTokenAt: '2026-08-31T00:00:00.000Z', lastVisibleTokenAt: '2026-08-31T00:00:01.000Z',
      visibleCharacters: manuscript.length, estimatedOutputTokens: 420, estimatedTokensPerSecond: 420,
      finalOutputTokens: 420, finalReasoningTokens: 0, decodeSeconds: 1, finalTokensPerSecond: 420,
    }
    const tooShortGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'too-short' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({
        text: JSON.stringify({ title: '空壳章', manuscript, uncertainties: [], selfCheck: { goalAdvanced: false, scenePlanFollowed: false, knownContinuityRisks: ['正文未完成'] } }),
        usage: { inputTokens: 100, outputTokens: 420 },
        telemetry,
      }),
    }

    const shortResult = await new GenerationService(repository, tooShortGateway).generate(chapter.id, 'chapter-draft')
    expect(shortResult.modelRun).toMatchObject({ status: 'succeeded', streamedText: manuscript, errorJson: null })
    expect(JSON.parse(shortResult.modelRun.outputJson!)).toMatchObject({
      _novelStudioLengthAdvisory: {
        kind: 'shorter-than-target', targetWords: 1_200, actualWords: 419,
        recommendedMinWords: 1_020, recommendedMaxWords: 1_260,
      },
    })
    expect(JSON.parse(shortResult.modelRun.usageJson!)).toEqual({ inputTokens: 100, outputTokens: 420 })
    expect(shortResult.modelRun.generationTelemetry).toEqual(telemetry)
    expect(shortResult.chapter!.versions).toEqual([expect.objectContaining({ content: manuscript, wordCount: 419 })])

    const emptyGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'empty-shell' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({
        text: JSON.stringify({ title: '空白章', manuscript: ' \n\t ', uncertainties: [], selfCheck: { goalAdvanced: false, scenePlanFollowed: false, knownContinuityRisks: ['正文为空'] } }),
        usage: { inputTokens: 80, outputTokens: 12 },
      }),
    }
    await expect(new GenerationService(repository, emptyGateway).generate(chapter.id, 'chapter-draft')).rejects.toMatchObject({ code: 'invalid-state' })
    const emptyFailed = repository.listModelRuns(chapter.id).find(run => run.model === 'empty-shell')!
    expect(JSON.parse(emptyFailed.errorJson!)).toMatchObject({ code: 'invalid-state', message: expect.stringContaining('non-empty manuscript') })
    expect(emptyFailed.usageJson).toBeNull()
    expect(repository.getChapter(chapter.id).versions).toHaveLength(1)
    repository.close()
  })

  it('accepts a short complete draft even though it remains far below the recommended range', async () => {
    const { repository, chapter } = setup()
    const sceneGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'scene' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({ text: JSON.stringify({ chapterGoal: '准备 1200 字正文', scenes: [{ scenePurpose: '完成极短章节' }], risks: [] }) }),
    }
    await new GenerationService(repository, sceneGateway).generate(chapter.id, 'scene-plan')
    const boundaryManuscript = '潮'.repeat(420)
    const boundaryGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'minimum-boundary' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({ text: JSON.stringify({ title: '边界短章', manuscript: boundaryManuscript, uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }) }),
    }

    const result = await new GenerationService(repository, boundaryGateway).generate(chapter.id, 'chapter-draft')
    expect(result.modelRun.status).toBe('succeeded')
    expect(result.chapter!.versions).toEqual([expect.objectContaining({ content: boundaryManuscript, wordCount: 420 })])
    expect(JSON.parse(result.modelRun.outputJson!)).toMatchObject({ _novelStudioLengthAdvisory: { kind: 'shorter-than-target', actualWords: 420 } })
    expect(420).toBeLessThan(Math.floor(1_200 * .85))
    repository.close()
  })

  it('does not let a later Prompt update rewrite an old generation record', async () => {
    const { repository, project, chapter } = setup()
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'fixed' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: async () => ({ text: JSON.stringify({ chapterGoal: '旧版本生成', scenes: [{ scenePurpose: '保留旧提示词版本' }], risks: [] }) }),
    }
    const service = new GenerationService(repository, gateway)
    const result = await service.generate(chapter.id, 'scene-plan')
    const oldPromptId = result.modelRun.promptAssetVersionId
    const catalog = repository.getPromptCatalog(project.id)
    const asset = catalog.assets.find(item => item.purpose === 'scene-plan')!
    const newVersion = repository.createPromptVersion(asset.id, `${asset.versions[0]!.template}\n新规则。`)
    repository.selectPromptVersion(project.id, 'scene-plan', newVersion.id)
    expect(repository.listModelRuns(chapter.id)[0]?.promptAssetVersionId).toBe(oldPromptId)
    expect(oldPromptId).not.toBe(newVersion.id)
    repository.close()
  })
})

function approveTestFoundationFrom(repository: SqliteNovelRepository, projectId: string, kind: 'characters' | 'timeline') {
  const workspace = repository.createProjectFoundationVersion(projectId, kind, { title: `已定 ${kind}`, content: `${kind} 已经根据所有前置批准内容生成，并且会作为后续章节动态提示词的强约束。` }, { provider: 'test', model: 'm', promptVersion: 'v1', promptHash: `h-${kind}`, outputJson: '{}' })
  const version = workspace.stages.find(stage => stage.kind === kind)!.latestVersion!
  repository.approveProjectFoundationVersion(projectId, kind, version.id)
}
