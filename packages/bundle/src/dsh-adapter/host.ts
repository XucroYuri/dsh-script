import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-questions'
import { join } from 'node:path'
import { handleNovelApi } from '../host-api/api.js'
import { SqliteNovelRepository } from '../storage-sqlite/database.js'
import { GenerationService } from '../generation/service.js'
import {
  FoundationGenerationRunner,
  FoundationInteractionCancelledError,
  FoundationInteractionDeferredError,
  type FoundationQuestionInteraction,
} from '../generation/foundation-runner.js'
import type { FoundationInteractionDriver } from '../generation/foundation-interaction.js'
import { DomainError, type FoundationGenerationRun, type FoundationPlannerAnswer, type ProjectFoundationKind } from '../domain/model.js'
import { WorkflowEngine } from '../workflow/engine.js'
import { WorkflowRunner } from '../workflow/runner.js'
import { ChapterBatchRunner } from '../workflow/batch-runner.js'
import { HarnessChapterBatchWorkflowPort, RepositoryChapterBatchStore } from '../workflow/batch-adapter.js'
import { HarnessModelGateway, registerCompositionTestModel } from './model.js'
import { compactHarnessSessionOnPressure, harnessCompactionCapability } from './compaction.js'
import {
  DOCTOR_ROUTE,
  DOCTOR_TOOL_SMOKE_ROUTE,
  NOVEL_API_ROUTE,
  NOVEL_STUDIO_VERSION,
  SUPPORTED_HARNESS_VERSION,
  type NovelDoctorReport,
} from './contract.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    novelStudioHealth: NovelStudioHealthService
  }
}

export class NovelStudioHealthService extends Service {
  private readonly startedAt = new Date()
  readonly repository = new SqliteNovelRepository({ dataRoot: join(resolveDshHome(), 'data', 'novel-studio') })
  readonly generation: GenerationService
  readonly foundationRunner: FoundationGenerationRunner
  readonly foundationInteraction: HarnessFoundationInteraction
  readonly workflows: WorkflowEngine
  readonly runner: WorkflowRunner
  readonly batchRunner: ChapterBatchRunner

  constructor(ctx: Context) {
    super(ctx, 'novelStudioHealth')
    this.generation = new GenerationService(this.repository, new HarnessModelGateway(ctx))
    this.foundationInteraction = new HarnessFoundationInteraction(ctx, this.repository)
    this.foundationRunner = new FoundationGenerationRunner(this.repository, this.generation, this.foundationInteraction)
    this.foundationInteraction.attach(this.foundationRunner)
    this.workflows = new WorkflowEngine(this.repository, this.generation)
    this.runner = new WorkflowRunner(this.repository, this.workflows)
    this.batchRunner = new ChapterBatchRunner(new RepositoryChapterBatchStore(this.repository), new HarnessChapterBatchWorkflowPort(this.runner, this.workflows))
    this.runner.setSettledHandler(async workflowRunId => {
      const batch = this.repository.reconcileChapterBatch(workflowRunId)
      if (batch) await this.batchRunner.reconcile(batch.id)
    })
    this.foundationRunner.recover()
    for (const batch of this.repository.listRecoverableChapterBatches()) {
      if (batch.status === 'planning') void this.generation.planChapterBatch(batch.id).then(() => this.batchRunner.reconcile(batch.id)).catch(() => undefined)
      else void this.batchRunner.reconcile(batch.id).catch(() => undefined)
    }
    this.runner.recover()
  }

  report(novelDoctorTool: boolean, knowledgeTools = false, recoveryTool = false): NovelDoctorReport {
    return {
      ok: true,
      service: 'novel-studio',
      phase: 5,
      bundleVersion: NOVEL_STUDIO_VERSION,
      harnessVersion: SUPPORTED_HARNESS_VERSION,
      host: {
        status: 'ready',
        startedAt: this.startedAt.toISOString(),
        uptimeMs: Math.max(0, Date.now() - this.startedAt.getTime()),
      },
      capabilities: {
        hostHealth: true,
        novelDoctorTool,
        clientSurface: true,
        database: true,
        workflows: true,
        knowledgeTools,
        recovery: recoveryTool,
        harnessCompaction: harnessCompactionCapability(this.ctx),
        longNovelMemory: true,
      },
      storage: this.repository.health(),
      model: this.generation.status(),
    }
  }
}

function nativeQuestionLabel(label: string, recommended: boolean): string {
  return recommended ? `${label} (Recommended)` : label
}

class HarnessFoundationInteraction implements FoundationQuestionInteraction, FoundationInteractionDriver {
  private runner?: FoundationGenerationRunner

  constructor(private readonly ctx: Context, private readonly repository: SqliteNovelRepository) {}

  attach(runner: FoundationGenerationRunner): void { this.runner = runner }

  start(projectId: string, kind: ProjectFoundationKind, brief: string, sessionId: string): FoundationGenerationRun {
    const normalized = sessionId.trim()
    this.rootAgent(normalized)
    const stage = this.repository.getProjectFoundation(projectId).stages.find(item => item.kind === kind)
    if (stage?.latestVersion && !brief.trim()) {
      throw new DomainError('invalid-state', `“${stage.title}”已经有可审阅或已批准版本。从 Harness 对话重新梳理时，请先明确说明你希望修改什么；也可以在小说工作室里选择“需要调整”。`)
    }
    return this.requireRunner().create(projectId, kind, brief, true, normalized)
  }

  resume(runId: string, sessionId: string): FoundationGenerationRun {
    const normalized = sessionId.trim()
    this.rootAgent(normalized)
    return this.requireRunner().resumeInteraction(runId, normalized)
  }

  moveToInline(runId: string): FoundationGenerationRun { return this.requireRunner().moveToInline(runId) }

  cancel(runId: string): FoundationGenerationRun { return this.requireRunner().cancel(runId) }

  resumeSession(sessionId: string): void {
    if (!sessionId.trim()) return
    this.requireRunner().resumeWaitingForSession(sessionId)
  }

  async ask(run: FoundationGenerationRun, signal: AbortSignal): Promise<FoundationPlannerAnswer[]> {
    const sessionId = run.interactionSessionId
    if (!sessionId) throw new FoundationInteractionDeferredError('本次生成尚未绑定 Harness 对话，需要从对话中继续。')
    let agent
    try { agent = this.rootAgent(sessionId) }
    catch (cause) { throw new FoundationInteractionDeferredError(cause instanceof Error ? cause.message : String(cause)) }
    const questions = run.questions.filter(question => !run.answers.some(answer => answer.questionId === question.id))
    if (questions.length === 0) throw new Error('原生提问运行没有可回答的问题。')
    try {
      const response = await this.ctx.userQuestions.ask({
        agent,
        signal,
        questions: questions.map(question => ({
          id: question.id,
          header: `第 ${run.planningRound} 轮 · ${run.kind === 'outline' ? '大纲' : '创作基建'}`,
          question: question.question,
          detail: [run.readinessSummary, question.why].filter(Boolean).join('\n\n'),
          options: question.options.map(option => ({
            label: nativeQuestionLabel(option.label, option.recommended),
            description: option.description,
          })),
          multiSelect: false,
        })),
      })
      return questions.map(question => {
        const answer = response.answers.find(item => item.id === question.id)
        if (!answer) throw new Error(`Harness 原生提问未返回问题 ${question.id} 的答案。`)
        const option = question.options.find(item => answer.selected.includes(nativeQuestionLabel(item.label, item.recommended)))
        const customText = answer.custom?.trim() ?? ''
        return {
          questionId: question.id,
          optionId: customText ? null : option?.id ?? null,
          customText,
          ...(answer.selected.length === 0 && !customText ? { skipped: true } : {}),
        }
      })
    } catch (cause) {
      if (signal.aborted) throw new FoundationInteractionCancelledError('用户取消了本次大纲梳理。')
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code?: unknown }).code) : ''
      if (code === 'ASK_CANCELLED') throw new FoundationInteractionCancelledError('用户关闭了 Harness 原生提问。')
      if (code === 'CALLER_NOT_LIVE' || code === 'DELEGATED_CALLER') throw new FoundationInteractionDeferredError('Harness 对话已离线，请从项目页返回对话后继续。')
      throw cause
    }
  }

  async waitForTerminal(runId: string, signal?: AbortSignal): Promise<FoundationGenerationRun> {
    while (true) {
      const run = this.repository.getFoundationGenerationRun(runId)
      if (['succeeded','failed','cancelled'].includes(run.status)) return run
      if (signal?.aborted) return this.cancel(runId)
      await new Promise<void>(resolve => setTimeout(resolve, 120))
    }
  }

  private rootAgent(sessionId: string) {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (!agent || !this.ctx.agents.roots().includes(agent)) throw new Error('当前 Harness 对话不是可交互的存活根 Agent。')
    return agent
  }

  private requireRunner(): FoundationGenerationRunner {
    if (!this.runner) throw new Error('Novel Studio foundation interaction runner is not ready.')
    return this.runner
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(encoded))
  res.end(encoded)
}

function registerDoctorRoutes(ctx: Context): () => void {
  const disposeHealth = ctx.webServer.register({
    kind: 'exact',
    path: DOCTOR_ROUTE,
    handler(req: IncomingMessage, res: ServerResponse) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD')
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (req.method === 'HEAD') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end()
        return
      }
      const toolVisible = ctx.tools.schemas().some(schema => schema.name === 'novel_doctor')
      const knowledgeTools = ['novel_knowledge_sources_list','novel_knowledge_selection_create','novel_knowledge_search'].every(name => ctx.tools.schemas().some(schema => schema.name === name))
      const recoveryTool = ctx.tools.schemas().some(schema => schema.name === 'novel_resume_context')
      sendJson(res, 200, ctx.novelStudioHealth.report(toolVisible, knowledgeTools, recoveryTool))
    },
  })
  const disposeToolSmoke = ctx.webServer.register({
    kind: 'exact',
    path: DOCTOR_TOOL_SMOKE_ROUTE,
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => { controller.abort() })
      const result = await ctx.tools.execute({
        callId: CallId(`novel-doctor-smoke-${Date.now()}`),
        name: 'novel_doctor',
        arguments: {},
        signal: controller.signal,
      })
      if (result.isError) {
        sendJson(res, 500, { ok: false, error: result.error.message })
        return
      }
      sendJson(res, 200, result.value)
    },
  })
  const disposeApi = ctx.webServer.register({
    kind: 'prefix',
    path: NOVEL_API_ROUTE,
    handler(req: IncomingMessage, res: ServerResponse) {
      return handleNovelApi(req, res, ctx.novelStudioHealth.repository, ctx.novelStudioHealth.generation, ctx.novelStudioHealth.foundationRunner, ctx.novelStudioHealth.foundationInteraction, ctx.novelStudioHealth.workflows, ctx.novelStudioHealth.runner, NOVEL_API_ROUTE)
    },
  })
  return () => {
    disposeApi()
    disposeToolSmoke()
    disposeHealth()
    ctx.novelStudioHealth.repository.close()
  }
}

function registerDoctorTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'novel_doctor',
    description: 'Inspect the installed Novel Studio Bundle and report its current Harness integration health.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          service: { type: 'string', required: true },
          phase: { type: 'integer', required: true },
          bundleVersion: { type: 'string', required: true },
          harnessVersion: { type: 'string', required: true },
          host: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              status: { type: 'string', required: true },
              startedAt: { type: 'string', required: true },
              uptimeMs: { type: 'integer', required: true },
            },
          },
          capabilities: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              hostHealth: { type: 'boolean', required: true },
              novelDoctorTool: { type: 'boolean', required: true },
              clientSurface: { type: 'boolean', required: true },
              database: { type: 'boolean', required: true },
              workflows: { type: 'boolean', required: true },
              knowledgeTools: { type: 'boolean', required: true },
              recovery: { type: 'boolean', required: true },
              harnessCompaction: {
                type: 'object', required: true, additionalProperties: false,
                properties: { available: { type: 'boolean', required: true }, status: { type: 'string', required: true } },
              },
              longNovelMemory: { type: 'boolean', required: true },
            },
          },
          storage: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              ready: { type: 'boolean', required: true },
              schemaVersion: { type: 'integer', required: true },
              expectedSchemaVersion: { type: 'integer', required: true },
              journalMode: { type: 'string', required: true },
              foreignKeys: { type: 'boolean', required: true },
              dataHome: { type: 'string', required: true },
            },
          },
          model: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              selection: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  provider: { type: 'string', required: true },
                  model: { type: 'string', required: true },
                  reasoningEffort: { type: 'string' },
                },
              },
              providers: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                  },
                },
              },
              ready: { type: 'boolean', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Novel Studio is ${value.ok ? 'healthy' : 'unhealthy'} on Harness ${value.harnessVersion}.`,
      }],
    },
    async execute() {
      const toolVisible = ctx.tools.schemas().some(schema => schema.name === 'novel_doctor')
      const knowledgeTools = ['novel_knowledge_sources_list','novel_knowledge_selection_create','novel_knowledge_search'].every(name => ctx.tools.schemas().some(schema => schema.name === name))
      const recoveryTool = ctx.tools.schemas().some(schema => schema.name === 'novel_resume_context')
      return ctx.novelStudioHealth.report(toolVisible, knowledgeTools, recoveryTool)
    },
  }))
}

function registerKnowledgeTools(ctx: Context): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'novel_knowledge_sources_list',
      description: 'List current-project Canon knowledge and historical projects that may be explicitly enabled as references.',
      parameters: { projectId: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      isConcurrencySafe: () => true,
      async execute(args) {
        const knowledge = ctx.novelStudioHealth.repository.getKnowledgeWorkspace(args.projectId)
        return JSON.stringify({ project: { id: knowledge.project.id, title: knowledge.project.title }, canonFactCount: knowledge.canonFacts.length, summaryCount: knowledge.summaries.length, historicalSources: knowledge.historicalSources.map(item => ({ projectId: item.sourceProject.id, title: item.sourceProject.title, enabled: item.enabled, scopes: item.scopes })) })
      },
    })),
    ctx.tools.register(defineTool({
      name: 'novel_knowledge_selection_create',
      description: 'Configure which scopes of one historical novel may be used by future Novel Studio workflow snapshots. Historical original text and names remain disabled unless explicitly included.',
      parameters: {
        projectId: { type: 'string', required: true }, sourceProjectId: { type: 'string', required: true }, enabled: { type: 'boolean', required: true },
        scopes: { type: 'array', required: true, items: { type: 'string', enum: ['structure_summary','pacing_statistics','style_features','writing_experience','worldbuilding_method','original_excerpt','names_and_entities','specific_plot'] } },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const knowledge = ctx.novelStudioHealth.repository.configureHistoricalSource(args.projectId, args.sourceProjectId, args.enabled, args.scopes)
        const source = knowledge.historicalSources.find(item => item.sourceProject.id === args.sourceProjectId)
        return JSON.stringify({ projectId: args.projectId, sourceProjectId: args.sourceProjectId, enabled: source?.enabled ?? false, scopes: source?.scopes ?? [] })
      },
    })),
    ctx.tools.register(defineTool({
      name: 'novel_knowledge_search',
      description: 'Search current Canon, summaries, approved manuscript indexes, and only explicitly enabled historical sources. Every result includes authority and citation metadata.',
      parameters: { projectId: { type: 'string', required: true }, query: { type: 'string', required: true }, limit: { type: 'integer' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      isConcurrencySafe: () => true,
      async execute(args) { return JSON.stringify({ query: args.query, results: ctx.novelStudioHealth.repository.searchKnowledge(args.projectId, args.query, args.limit) }) },
    })),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

function recoverySummary(ctx: Context, sessionId: string): string {
  try {
    const resumed = ctx.novelStudioHealth.repository.getResumeContext(sessionId)
    const pending = resumed.capsule.pendingUserDecisions.join('; ') || 'none'
    return `[Novel Studio workspace]\nProject: ${resumed.project.title} (${resumed.project.id}), revision ${resumed.project.revision}\nCurrent chapter: ${resumed.chapter ? `${resumed.chapter.title} (${resumed.chapter.id})` : 'none selected'}\nActive draft: ${resumed.capsule.activeDraftVersionId ?? 'none'}\nWorkflow: ${resumed.workflow ? `${resumed.workflow.id} / ${resumed.workflow.status} / ${resumed.workflow.currentNodeKey ?? 'complete'}` : 'none'}\nPending decision: ${pending}\nKnowledge snapshot: ${resumed.capsule.knowledgeSelectionSnapshotId ?? 'none'}\nDo not infer story facts from this pointer summary. Use novel_* tools for details, and do not repeat already committed workflow nodes.`
  } catch {
    return ''
  }
}

function registerRecoveryIntegration(ctx: Context): () => void {
  const disposeContext = ctx.systemPrompt.context({
    name: 'novel-studio:recovery',
    order: 260,
    text: assemble => assemble.agent ? recoverySummary(ctx, assemble.agent.id) : '',
  })
  const disposeTool = ctx.tools.register(defineTool({
    name: 'novel_resume_context',
    description: 'Select or resume a Novel Studio project for the current Harness Session. Returns only compact pointers, revisions, pending approvals, and suggested next actions; never manuscript text.',
    parameters: {
      sessionId: { type: 'string' },
      projectId: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => true,
    async execute(args) {
      const sessionId = args.sessionId ?? ctx.agents.currentInitiator()?.id
      if (!sessionId) throw new Error('novel_resume_context requires a current Harness Session or an explicit sessionId.')
      return JSON.stringify(ctx.novelStudioHealth.repository.getResumeContext(sessionId, args.projectId))
    },
  }))
  const disposeTurn = ctx.on('agent/turn-stopping', async payload => {
    try { ctx.novelStudioHealth.repository.getResumeContext(payload.agent.id) }
    catch { return /* unbound Sessions are expected */ }
    try { await compactHarnessSessionOnPressure(ctx, payload.agent, new AbortController().signal) }
    catch { /* Optional compaction must never block Session recovery or turn shutdown. */ }
  })
  return () => { disposeTurn(); disposeTool(); disposeContext() }
}

function registerFoundationInteractionIntegration(ctx: Context): () => void {
  const interaction = ctx.novelStudioHealth.foundationInteraction
  const disposePrompt = ctx.systemPrompt.context({
    name: 'novel-studio:native-foundation-intake',
    order: 255,
    text: assemble => assemble.agent ? `Only when the user explicitly asks to create, revise, or regenerate a named Novel Studio foundation, use novel_foundation_intake. Never infer that intent from an isolated number, a generic "continue", or an unrelated reply. The active foundation set is full-book outline, characters, and timeline. The studio page normally generates a reviewable first draft before asking revision questions; this native tool is for an explicit conversational revision request. It uses DeepSeek Harness native option questions and stops after at most 4 rounds or 12 confirmed answers. Do not imitate those option questions in ordinary prose before calling the tool.` : '',
  })
  const disposeTool = ctx.tools.register(defineTool({
    name: 'novel_foundation_intake',
    description: 'Create or regenerate one Novel Studio project foundation through DeepSeek Harness native interactive questions. Intake is bounded to at most 4 rounds or 12 confirmed answers, preserves explicit genre preferences, and then generates through the persisted readiness gate.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Novel Studio project id.' },
      kind: { type: 'string', required: true, enum: ['outline','characters','timeline'], description: 'Foundation content to generate.' },
      brief: { type: 'string', description: 'Known story requirements or constraints supplied by the user.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('novel_foundation_intake requires a live root Harness Agent so native questions have an owner conversation.')
      await compactHarnessSessionOnPressure(ctx, exec.agent, exec.signal)
      const run = interaction.start(args.projectId, args.kind as ProjectFoundationKind, args.brief ?? '', exec.agent.id)
      const completed = await interaction.waitForTerminal(run.id, exec.signal)
      if (completed.status === 'failed') throw new Error(completed.error ?? '创作基建生成失败。')
      if (completed.status === 'cancelled') return JSON.stringify({ status: 'cancelled', runId: completed.id, projectId: completed.projectId, kind: completed.kind })
      return JSON.stringify({
        status: completed.status,
        runId: completed.id,
        projectId: completed.projectId,
        kind: completed.kind,
        planningRounds: completed.planningRound,
        readinessSummary: completed.readinessSummary,
        resultVersionId: completed.resultVersionId,
      })
    },
  }))
  const disposeCreated = ctx.on('agent/created', payload => { interaction.resumeSession(payload.agent.id) })
  for (const agent of ctx.agents.roots()) interaction.resumeSession(agent.id)
  return () => { disposeCreated(); disposeTool(); disposePrompt() }
}

export const name = 'novel-studio-host'
// `credentials-local` reads $DSH_HOME/.credentials.yaml asynchronously during
// service activation. Declaring the public credentials seam as a dependency
// prevents startup recovery from issuing an LLM request against its initial
// empty snapshot. This is deliberately readiness ordering, not model retry.
export const inject = ['tools', 'webServer', 'llm', 'credentials', 'agentDefaultModel', 'agents', 'systemPrompt', 'userQuestions']

export function apply(ctx: Context): void {
  ctx.effect(() => registerCompositionTestModel(ctx), 'novel-studio: composition test model')
  ctx.plugin(NovelStudioHealthService)
  ctx.inject(['novelStudioHealth'], (readyCtx) => {
    readyCtx.effect(() => registerDoctorRoutes(readyCtx), 'novel-studio: doctor HTTP routes')
    readyCtx.effect(() => registerDoctorTool(readyCtx), 'novel-studio: novel_doctor tool')
    readyCtx.effect(() => registerKnowledgeTools(readyCtx), 'novel-studio: knowledge tools')
    readyCtx.effect(() => registerRecoveryIntegration(readyCtx), 'novel-studio: Session recovery')
    readyCtx.effect(() => registerFoundationInteractionIntegration(readyCtx), 'novel-studio: native foundation interaction')
  })
}
