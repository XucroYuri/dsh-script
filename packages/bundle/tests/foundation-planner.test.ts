import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FoundationPlannerQuestion, ProjectFoundationKind } from '../src/domain/model.js'
import type { ModelGateway, ModelGenerationRequest } from '../src/generation/model-gateway.js'
import { FoundationGenerationRunner, FoundationInteractionCancelledError, FoundationInteractionDeferredError } from '../src/generation/foundation-runner.js'
import { GenerationService } from '../src/generation/service.js'
import { generationTelemetry } from '../src/generation/tokens.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'

const roots: string[] = []
const plannerRoundOne = JSON.stringify({
  informationSufficient: false,
  readinessSummary: '已知悬疑题材与主动调查方向，但核心冲突的承载方式仍未明确。',
  questions: [{ question: '核心冲突应优先落在哪里？', why: '它会改变全书推进方式。', options: [{ label: '人物变化', description: '围绕主角的选择与代价。', recommended: true }, { label: '情节推进', description: '围绕外部事件与危机。', recommended: false }] }],
})
const plannerRoundTwo = JSON.stringify({
  informationSufficient: false,
  readinessSummary: '核心冲突已经明确，但结局方向和最终代价仍会改变中后段结构。',
  questions: [{ question: '故事最终如何收束？', why: '结局会决定伏笔回收和主角最后的选择。', options: [{ label: '代价式胜利', description: '主角达成目标，但失去不可挽回的重要事物。', recommended: true }, { label: '开放结局', description: '解决眼前危机，保留更大的未知。', recommended: false }] }],
})
const plannerReady = JSON.stringify({
  informationSufficient: true,
  readinessSummary: '核心冲突、主角选择、不可逆代价和结局方向均已明确，可以生成全书大纲。',
  questions: [],
})
const foundationOutput = JSON.stringify({ title: '确认后的全书大纲', content: '主角在封锁港口追查失踪案，每次选择都会提高个人代价，并以代价式胜利完成全书主线。' })

function root() {
  const value = mkdtempSync(join(tmpdir(), 'novel-studio-planner-'))
  roots.push(value)
  return value
}

function gateway(prompts: string[], plannerOutputs = [plannerRoundOne, plannerRoundTwo, plannerReady]): ModelGateway {
  let plannerCalls = 0
  return {
    selection: () => ({ provider: 'mock', model: 'planner-v2' }),
    providers: () => [{ id: 'mock', name: 'Mock' }],
    async generate(request: ModelGenerationRequest) {
      prompts.push(request.prompt)
      const text = request.prompt.startsWith('任务：评估项目创作基建信息充分性')
        ? plannerOutputs[Math.min(plannerCalls++, plannerOutputs.length - 1)]!
        : foundationOutput
      request.onProgress?.({ outputCharacters: text.length, text })
      return { text }
    },
  }
}

async function waitFor<T>(read: () => T, accept: (value: T) => boolean, timeoutMs = 2500): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for persisted foundation generation state.')
}

function answerFirst(run: { questions: FoundationPlannerQuestion[] }, customText = '') {
  const question = run.questions.at(-1)!
  return [{ questionId: question.id, optionId: question.options[0]!.id, customText }]
}

function approveFoundation(repository: SqliteNovelRepository, projectId: string, kind: ProjectFoundationKind) {
  const created = repository.createProjectFoundationVersion(projectId, kind, { title: kind, content: `${kind} approved content` }, {
    provider: 'mock', model: 'setup', promptVersion: 'setup-v1', promptHash: `hash-${kind}`, outputJson: '{}',
  })
  const version = created.stages.find(stage => stage.kind === kind)!.latestVersion!
  repository.approveProjectFoundationVersion(projectId, kind, version.id)
}

afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('Multi-round project foundation intake', () => {
  it('uses one reusable interaction driver across the bounded native Harness question rounds', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '原生提问大纲', genre: '悬疑' }).project
    const askedRounds: number[] = []
    const interaction = {
      async ask(run: { planningRound: number; questions: FoundationPlannerQuestion[]; answers: unknown[] }) {
        askedRounds.push(run.planningRound)
        const question = run.questions.find(item => !run.answers.some((answer: any) => answer.questionId === item.id))!
        return [{ questionId: question.id, optionId: question.options[0]!.id, customText: run.planningRound === 1 ? '以人物代价作为冲突核心。' : '结局保留不可逆损失。' }]
      },
    }
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway([])), interaction)
    const started = runner.create(project.id, 'outline', '主角主动调查。', true, 'session-native-1')
    const completed = await waitFor(() => repository.getFoundationGenerationRun(started.id), run => run.status === 'succeeded')
    expect(askedRounds).toEqual([1, 2])
    expect(completed).toMatchObject({ interactionSessionId: 'session-native-1', planningRound: 2, informationReady: true })
    expect(completed.answers).toHaveLength(2)
    repository.close()
  })

  it('keeps a native question waiting when its Harness conversation is temporarily offline and resumes it later', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '对话恢复' }).project
    let available = false
    const interaction = {
      async ask(run: { questions: FoundationPlannerQuestion[]; answers: unknown[] }) {
        if (!available) throw new FoundationInteractionDeferredError('session offline')
        const question = run.questions.find(item => !run.answers.some((answer: any) => answer.questionId === item.id))!
        return [{ questionId: question.id, optionId: question.options[0]!.id, customText: '' }]
      },
    }
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway([], [plannerRoundOne, plannerReady])), interaction)
    const started = runner.create(project.id, 'outline', '', true, 'session-resume')
    const waiting = await waitFor(() => repository.getFoundationGenerationRun(started.id), run => run.status === 'waiting_input')
    expect(waiting.interactionSessionId).toBe('session-resume')
    available = true
    runner.resumeWaitingForSession('session-resume')
    const completed = await waitFor(() => repository.getFoundationGenerationRun(started.id), run => run.status === 'succeeded')
    expect(completed.informationReady).toBe(true)
    repository.close()
  })

  it('turns dismissal of the native Harness question card into a cancelled intake', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '关闭原生提问' }).project
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway([])), {
      async ask() { throw new FoundationInteractionCancelledError('question dismissed') },
    })
    const started = runner.create(project.id, 'outline', '', true, 'session-cancel')
    const cancelled = await waitFor(() => repository.getFoundationGenerationRun(started.id), run => run.status === 'cancelled')
    expect(cancelled).toMatchObject({ phase: 'cancelled', informationReady: false, interactionSessionId: 'session-cancel' })
    repository.close()
  })

  it('moves a pending native question into the inline studio composer without cancelling the intake', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '页面内接管' }).project
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway([], [plannerRoundOne, plannerReady])), {
      async ask(_run, signal) {
        return await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new FoundationInteractionCancelledError('native wait replaced by inline composer')) }, { once: true })
        })
      },
    })
    const started = runner.create(project.id, 'outline', '', true, 'session-inline-takeover')
    const waiting = await waitFor(() => repository.getFoundationGenerationRun(started.id), run => run.status === 'waiting_input')
    expect(waiting.interactionSessionId).toBe('session-inline-takeover')

    const inline = runner.moveToInline(waiting.id)
    expect(inline).toMatchObject({ status: 'waiting_input', interactionSessionId: null })
    runner.answer(inline.id, answerFirst(inline, '直接在小说工作室页面回答。'))

    const completed = await waitFor(() => repository.getFoundationGenerationRun(inline.id), run => run.status === 'succeeded')
    expect(completed).toMatchObject({ informationReady: true, interactionSessionId: null })
    expect(completed.answers[0]?.customText).toBe('直接在小说工作室页面回答。')
    repository.close()
  })

  it('persists multiple question rounds and only generates after AI marks the information ready', async () => {
    const dataRoot = root()
    const prompts: string[] = []
    const model = gateway(prompts)
    const firstRepository = new SqliteNovelRepository({ dataRoot })
    const project = firstRepository.createProject({ title: '可恢复规划', genre: '悬疑' }).project
    const firstService = new GenerationService(firstRepository, model)
    const created = firstRepository.createFoundationGenerationRun(project.id, 'outline', '主角必须主动调查。', true, firstService.status().selection)
    const firstWaiting = await firstService.planProjectFoundation(created)
    expect(firstWaiting).toMatchObject({ status: 'waiting_input', phase: 'awaiting_answers', planningRound: 1, informationReady: false })
    expect(firstWaiting.questions[0]).toMatchObject({ id: 'r1-q1', options: [{ id: 'r1-q1-o1', recommended: true }, { id: 'r1-q1-o2' }] })
    firstRepository.close()

    const reopened = new SqliteNovelRepository({ dataRoot })
    expect(reopened.getProjectFoundation(project.id).stages[0]?.activeGenerationRun?.readinessSummary).toContain('核心冲突')
    const runner = new FoundationGenerationRunner(reopened, new GenerationService(reopened, model))
    const evaluating = runner.answer(firstWaiting.id, answerFirst(firstWaiting, '人物胜利必须付出不可逆代价。'))
    expect(evaluating).toMatchObject({ status: 'planning', phase: 'evaluating_information', informationReady: false })

    const secondWaiting = await waitFor(() => reopened.getFoundationGenerationRun(firstWaiting.id), run => run.status === 'waiting_input' && run.planningRound === 2)
    expect(secondWaiting.questions.map(question => question.id)).toEqual(['r1-q1', 'r2-q1'])
    expect(secondWaiting.answers).toHaveLength(1)
    runner.answer(secondWaiting.id, answerFirst({ questions: secondWaiting.questions.filter(question => question.id.startsWith('r2-')) }, '结尾不能撤销已经付出的代价。'))

    const completed = await waitFor(() => reopened.getFoundationGenerationRun(firstWaiting.id), run => run.status === 'succeeded')
    expect(completed).toMatchObject({ phase: 'complete', progress: 100, informationReady: true, planningRound: 2 })
    expect(completed.readinessSummary).toContain('可以生成全书大纲')
    const formalPrompt = prompts.find(prompt => prompt.startsWith('任务：生成项目创作基建'))!
    expect(formalPrompt).toContain('人物变化 — 围绕主角的选择与代价。')
    expect(formalPrompt).toContain('代价式胜利 — 主角达成目标')
    expect(formalPrompt).toContain('AI 信息充分性判断')
    const draft = reopened.getProjectFoundation(project.id).stages[0]?.latestVersion
    expect(draft).toMatchObject({ title: '确认后的全书大纲', generationRunId: firstWaiting.id, status: 'draft' })
    reopened.close()
  })

  it('rejects a first-round model response that tries to skip user questions', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '必须先问' }).project
    const service = new GenerationService(repository, gateway([], [plannerReady]))
    const run = repository.createFoundationGenerationRun(project.id, 'outline', '', true, service.status().selection)
    await expect(service.planProjectFoundation(run)).rejects.toThrow('首次规划必须先向用户提问')
    expect(repository.getFoundationGenerationRun(run.id).informationReady).toBe(false)
    repository.close()
  })

  it('requires every unanswered question in the current round before reevaluating', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '回答门槛' }).project
    const service = new GenerationService(repository, gateway([]))
    const waiting = await service.planProjectFoundation(repository.createFoundationGenerationRun(project.id, 'outline', '', true, service.status().selection))
    const runner = new FoundationGenerationRunner(repository, service)
    expect(() => runner.answer(waiting.id, [])).toThrow('请回答全部规划问题')
    expect(repository.getFoundationGenerationRun(waiting.id).status).toBe('waiting_input')
    repository.close()
  })

  it('recovers an in-progress information evaluation after the Host repository restarts', async () => {
    const dataRoot = root()
    const firstRepository = new SqliteNovelRepository({ dataRoot })
    const project = firstRepository.createProject({ title: '评估重启恢复' }).project
    const firstService = new GenerationService(firstRepository, gateway([]))
    const waiting = await firstService.planProjectFoundation(firstRepository.createFoundationGenerationRun(project.id, 'outline', '', true, firstService.status().selection))
    const answer = answerFirst(waiting, '重启后仍要保留这条回答。')[0]!
    const evaluating = firstRepository.answerFoundationGenerationQuestion(waiting.id, answer)
    expect(evaluating).toMatchObject({ status: 'planning', phase: 'evaluating_information', informationReady: false })
    firstRepository.close()

    const reopened = new SqliteNovelRepository({ dataRoot })
    const runner = new FoundationGenerationRunner(reopened, new GenerationService(reopened, gateway([], [plannerReady])))
    runner.recover()
    const completed = await waitFor(() => reopened.getFoundationGenerationRun(waiting.id), run => run.status === 'succeeded')
    expect(completed).toMatchObject({ informationReady: true, planningRound: 1 })
    expect(completed.answers[0]).toMatchObject({ questionId: 'r1-q1', customText: '重启后仍要保留这条回答。' })
    reopened.close()
  })

  it('generates the first outline draft without a brief or intake questions', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '初稿优先大纲' }).project
    const prompts: string[] = []
    const service = new GenerationService(repository, gateway(prompts))
    const runner = new FoundationGenerationRunner(repository, service)
    const started = runner.create(project.id, 'outline', '', false)
    const completed = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'succeeded')
    expect(completed.questions).toEqual([])
    expect(completed.informationReady).toBe(false)
    expect(completed.brief).toBe('')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('这是可以直接审阅的第一版初稿')
    expect(repository.getProjectFoundation(project.id).stages[0]?.latestVersion).toMatchObject({ status: 'draft', generationRunId: started.id })
    repository.close()
  })

  it('uses the current draft as context when the user asks for a guided revision', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '草稿后反馈修订' }).project
    const prompts: string[] = []
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway(prompts, [plannerRoundOne, plannerReady])))
    const initial = runner.create(project.id, 'outline', '', false)
    await waitFor(() => repository.getFoundationGenerationRun(initial.id), value => value.status === 'succeeded')
    const firstDraft = repository.getProjectFoundation(project.id).stages[0]?.latestVersion
    expect(firstDraft?.content).toContain('主角在封锁港口追查失踪案')

    const revision = runner.create(project.id, 'outline', '', true)
    const waiting = await waitFor(() => repository.getFoundationGenerationRun(revision.id), value => value.status === 'waiting_input')
    const plannerPrompt = prompts.find(prompt => prompt.startsWith('任务：评估项目创作基建信息充分性'))!
    expect(plannerPrompt).toContain('用户已看过这一版')
    expect(plannerPrompt).toContain(firstDraft!.content)
    runner.answer(waiting.id, answerFirst(waiting, '保留港口调查，但强化主角与姐姐的关系。'))
    await waitFor(() => repository.getFoundationGenerationRun(revision.id), value => value.status === 'succeeded')
    const formalPrompts = prompts.filter(prompt => prompt.startsWith('任务：生成项目创作基建'))
    expect(formalPrompts).toHaveLength(2)
    expect(formalPrompts[1]).toContain('需要保留并修订的上一版初稿')
    expect(formalPrompts[1]).toContain(firstDraft!.content)
    expect(formalPrompts[1]).toContain('强化主角与姐姐的关系')
    expect(repository.getProjectFoundation(project.id).stages[0]?.latestVersion?.version).toBe(2)
    repository.close()
  })

  it('streams visible text and generation pulse for characters and timeline', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '人物时间线实时生成' }).project
    approveFoundation(repository, project.id, 'outline')
    const requests: ModelGenerationRequest[] = []
    const outputs = {
      characters: { title: '人物体系', content: '林舟主动追查失踪案，他与姐姐的旧线索构成主要关系张力。' },
      timeline: { title: '故事时间线', content: '封港当夜收到录音，三日后进入灯塔，七日后揭开失踪真相。' },
    } as const
    const liveGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'live-foundation' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      resolveCapacity: async () => ({ contextWindow: 128_000, contextWindowSource: 'provider', defaultMaxTokens: 32_000, reasoningEfforts: ['off', 'high'] }),
      async generate(request) {
        requests.push(request)
        const kind = request.prompt.includes('故事时间线') ? 'timeline' : 'characters'
        const output = outputs[kind]
        const partial = `{"title":"${output.title}","content":"${output.content.slice(0, 16)}`
        request.onProgress?.({ outputCharacters: partial.length, text: partial, telemetry: generationTelemetry(partial, 1_000, 2_000) })
        await new Promise(resolve => setTimeout(resolve, 220))
        const text = JSON.stringify(output)
        const usage = { inputTokens: 80, outputTokens: 120 }
        const telemetry = generationTelemetry(text, 1_000, 3_000, 4_000, usage)
        request.onProgress?.({ outputCharacters: text.length, text, telemetry: generationTelemetry(text, 1_000, 3_000) })
        return { text, usage, telemetry }
      },
    }
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, liveGateway))
    for (const kind of ['characters', 'timeline'] as const) {
      const started = runner.create(project.id, kind, '', false)
      const live = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'generating' && value.streamedText.length > 0)
      expect(live.streamedText.startsWith('{')).toBe(false)
      expect(live.generationTelemetry.estimatedTokensPerSecond).toBeGreaterThan(0)
      const completed = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'succeeded')
      expect(completed.streamedText).toBe(outputs[kind].content)
      expect(completed.generationTelemetry).toMatchObject({ finalOutputTokens: 120, finalTokensPerSecond: 40 })
      const stage = repository.getProjectFoundation(project.id).stages.find(item => item.kind === kind)!
      repository.approveProjectFoundationVersion(project.id, kind, stage.latestVersion!.id)
    }
    expect(repository.getProjectFoundation(project.id)).toMatchObject({ readyForChapterGeneration: true })
    expect(requests.length).toBe(2)
    expect(requests.every(request => request.selection.reasoningEffort === 'off')).toBe(true)
    expect(requests.every(request => request.maxTokens === 12_000)).toBe(true)
    repository.close()
  })

  it('cancels an active intake model stream and keeps the run cancelled', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '取消生成' }).project
    const slowGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'slow' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      generate: request => new Promise((_resolve, reject) => {
        request.onProgress?.({ outputCharacters: 12, text: '{"content":"中断前文字' })
        request.signal?.addEventListener('abort', () => { reject(new Error('aborted by user')) }, { once: true })
      }),
    }
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, slowGateway))
    const run = runner.create(project.id, 'outline', '', true)
    await waitFor(() => repository.getFoundationGenerationRun(run.id), value => value.phase === 'generating_questions')
    runner.cancel(run.id)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(repository.getFoundationGenerationRun(run.id)).toMatchObject({ status: 'cancelled', phase: 'cancelled', informationReady: false })
    expect(repository.getProjectFoundation(project.id).stages[0]?.latestVersion).toBeNull()
    repository.close()
  })

  it('retries formal generation with the complete persisted intake history', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '保留选择重试' }).project
    let plannerCalls = 0
    let formalAttempts = 0
    const retryGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'retry' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        if (request.prompt.startsWith('任务：评估项目创作基建信息充分性')) return { text: plannerCalls++ === 0 ? plannerRoundOne : plannerReady }
        formalAttempts++
        if (formalAttempts === 1) throw new Error('temporary output limit')
        expect(request.prompt).toContain('结尾必须保留已确认代价')
        return { text: foundationOutput }
      },
    }
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, retryGateway))
    const started = runner.create(project.id, 'outline', '', true)
    const waiting = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'waiting_input')
    runner.answer(waiting.id, answerFirst(waiting, '结尾必须保留已确认代价。'))
    const failed = await waitFor(() => repository.getFoundationGenerationRun(waiting.id), value => value.status === 'failed')
    expect(failed).toMatchObject({ informationReady: true, phase: 'failed' })
    const retried = runner.retry(failed.id)
    expect(retried).toMatchObject({ status: 'generating', phase: 'assembling_context', informationReady: true })
    const completed = await waitFor(() => repository.getFoundationGenerationRun(waiting.id), value => value.status === 'succeeded')
    expect(completed.answers[0]?.customText).toBe('结尾必须保留已确认代价。')
    expect(formalAttempts).toBe(2)
    repository.close()
  })

  it('persists a formal live manuscript, keeps it on failure, and resets it before retry', async () => {
    const dataRoot = root()
    const repository = new SqliteNovelRepository({ dataRoot })
    const project = repository.createProject({ title: '实时基建手稿' }).project
    approveFoundation(repository, project.id, 'outline')
    const partial = '{"title":"人物体系","content":"林舟先在港口收到姐姐留下的录音，然后决定主动追查。'
    const failingGateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'live-failure' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        request.onProgress?.({ outputCharacters: partial.length, text: partial })
        throw new Error('stream disconnected')
      },
    }
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, failingGateway))
    const started = runner.create(project.id, 'characters', '', false)
    const failed = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'failed')
    expect(failed.streamedText).toBe('林舟先在港口收到姐姐留下的录音，然后决定主动追查。')
    expect(repository.getProjectFoundation(project.id).stages[1]?.latestVersion).toBeNull()

    const reopened = new SqliteNovelRepository({ dataRoot })
    expect(reopened.getFoundationGenerationRun(started.id).streamedText).toBe(failed.streamedText)
    reopened.close()

    const retried = repository.retryFoundationGenerationRun(started.id)
    expect(retried).toMatchObject({ status: 'generating', streamedCharacters: 0, streamedText: '', streamedTextUpdatedAt: null })
    repository.cancelFoundationGenerationRun(started.id)
    const late = repository.updateFoundationGenerationStream(started.id, `${failed.streamedText}迟到内容`)
    expect(late).toMatchObject({ status: 'cancelled', streamedText: '' })
    repository.close()
  })

  it('stops an always-insufficient planner after four rounds and generates from the confirmed answers', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '有界大纲规划' }).project
    const prompts: string[] = []
    const decisions = ['全书核心冲突采用什么形态？', '主角与主要对手是什么关系？', '故事分成哪些主要阶段？', '最终结局落在什么方向？']
    const outputs = Array.from({ length: 4 }, (_, index) => JSON.stringify({
      informationSufficient: false,
      readinessSummary: `第 ${index + 1} 轮仍有一个真正改变骨架的方向。`,
      questions: [{
        question: decisions[index],
        why: '这个选择会改变主线结构。',
        options: [{ label: `方向 ${index + 1}A`, description: '采用第一种骨架。', recommended: true }, { label: `方向 ${index + 1}B`, description: '采用第二种骨架。', recommended: false }],
      }],
    }))
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway(prompts, outputs)))
    const started = runner.create(project.id, 'outline', '', true)
    for (let round = 1; round <= 4; round += 1) {
      const waiting = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'waiting_input' && value.planningRound === round)
      runner.answer(waiting.id, answerFirst(waiting, `确认第 ${round} 个骨架方向。`))
    }
    const completed = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'succeeded')
    expect(completed).toMatchObject({ informationReady: true, planningRound: 4 })
    expect(completed.answers).toHaveLength(4)
    expect(completed.readinessSummary).toContain('有界需求采集已达到 4 轮或 12 项确认上限')
    expect(prompts.filter(prompt => prompt.startsWith('任务：评估项目创作基建信息充分性'))).toHaveLength(4)
    repository.close()
  })

  it('closes a legacy over-limit waiting run during recovery without discarding prior answers', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '旧循环恢复' }).project
    const service = new GenerationService(repository, gateway([]))
    let run = repository.createFoundationGenerationRun(project.id, 'outline', '', true, service.status().selection)
    for (let round = 1; round <= 5; round += 1) {
      run = repository.setFoundationGenerationQuestions(run.id, [{
        id: 'q1', question: `旧版本第 ${round} 轮问题？`, why: '旧版本仍会继续追问。',
        options: [{ id: 'q1-o1', label: '确认', description: '确认这个方向。', recommended: true }, { id: 'q1-o2', label: '调整', description: '调整这个方向。', recommended: false }],
      }], `旧版本第 ${round} 轮判断。`, `hash-${round}`, '{}')
      if (round < 5) run = repository.answerFoundationGenerationQuestion(run.id, { questionId: run.questions.at(-1)!.id, optionId: run.questions.at(-1)!.options[0]!.id, customText: '' })
    }
    expect(run).toMatchObject({ status: 'waiting_input', planningRound: 5 })
    expect(run.answers).toHaveLength(4)
    const runner = new FoundationGenerationRunner(repository, service)
    runner.recover()
    const completed = await waitFor(() => repository.getFoundationGenerationRun(run.id), value => value.status === 'succeeded')
    expect(completed.answers).toHaveLength(4)
    expect(completed.readinessSummary).toContain('剩余 1 个未回答细节不再阻塞生成')
    repository.close()
  })

  it('treats repeated planner questions as non-blocking and proceeds to the formal draft', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '重复问题收口' }).project
    const repeated = JSON.stringify({
      informationSufficient: false,
      readinessSummary: '模型试图继续追问已经确认的内容。',
      questions: [{ question: '核心冲突应优先落在哪里？', why: '重复追问。', options: [{ label: '人物变化', description: '围绕人物。', recommended: true }, { label: '情节推进', description: '围绕事件。', recommended: false }] }],
    })
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway([], [plannerRoundOne, repeated])))
    const started = runner.create(project.id, 'outline', '', true)
    const waiting = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'waiting_input')
    runner.answer(waiting.id, answerFirst(waiting))
    const completed = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'succeeded')
    expect(completed.readinessSummary).toContain('AI 新提出的问题与已确认内容重复')
    expect(completed.questions).toHaveLength(1)
    repository.close()
  })

  it('lets the user stop questioning and generate from the answers already confirmed', async () => {
    const repository = new SqliteNovelRepository({ dataRoot: root() })
    const project = repository.createProject({ title: '用户主动收口' }).project
    const runner = new FoundationGenerationRunner(repository, new GenerationService(repository, gateway([])))
    const started = runner.create(project.id, 'outline', '', true)
    const firstWaiting = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'waiting_input')
    runner.answer(firstWaiting.id, answerFirst(firstWaiting))
    const secondWaiting = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'waiting_input' && value.planningRound === 2)
    const generating = runner.finishPlanning(secondWaiting.id)
    expect(generating).toMatchObject({ status: 'generating', informationReady: true })
    const completed = await waitFor(() => repository.getFoundationGenerationRun(started.id), value => value.status === 'succeeded')
    expect(completed.answers).toHaveLength(1)
    expect(completed.readinessSummary).toContain('你已确认现有信息足够进入草稿')
    repository.close()
  })
})
