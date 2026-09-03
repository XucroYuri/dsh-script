import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  DomainError,
  isActiveProjectFoundationKind,
  type ChapterBatchItem,
  type CreateProjectInput,
  type FoundationPlannerAnswer,
  type HistoricalKnowledgeScope,
  type MemoryCategory,
  type MemoryItem,
  type MemoryPromptPolicy,
  type ProjectFoundationKind,
  type RelationshipCandidateBatchDecision,
  type RelationshipCandidateConfirmationInput,
  type RelationshipCategory,
  type RelationshipFactLayer,
  type RelationshipMode,
  type SaveDraftInput,
} from '../domain/model.js'
import type { ManuscriptImportInput } from '../domain/project-portability.js'
import type { NovelRepository } from '../storage/repository.js'
import type { GenerationService } from '../generation/service.js'
import type { FoundationGenerationRunner } from '../generation/foundation-runner.js'
import type { FoundationInteractionDriver } from '../generation/foundation-interaction.js'
import type { WorkflowEngine } from '../workflow/engine.js'
import type { WorkflowRunner } from '../workflow/runner.js'

const MAX_BODY_BYTES = 5 * 1024 * 1024
// JSON escaping can make a valid 32 MB manuscript or snapshot substantially larger on the wire.
// Only the import endpoint receives this allowance; the domain still enforces 32 MB decoded text.
const MAX_IMPORT_BODY_BYTES = 72 * 1024 * 1024
const AUTOMATION_MODES = ['auto', 'yolo'] as const
const RELATIONSHIP_MODES = ['off', ...AUTOMATION_MODES] as const
const MEMORY_SCOPES = ['foundation', 'chapter', 'arc', 'volume', 'book', 'project'] as const
const MEMORY_CATEGORIES = ['continuity', 'constraint', 'character', 'world', 'timeline', 'foreshadowing', 'idea', 'research', 'other'] as const
const MEMORY_PROMPT_POLICIES = ['auto', 'manual', 'excluded'] as const
const RELATIONSHIP_CATEGORIES = ['family', 'emotion', 'alliance', 'conflict', 'membership', 'possession', 'location', 'knowledge', 'causality', 'other'] as const
const RELATIONSHIP_FACT_LAYERS = ['planned', 'canon', 'author_asserted'] as const

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(encoded))
  res.end(encoded)
}

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > maxBytes) throw new DomainError('validation', `请求体不能超过 ${Math.floor(maxBytes / 1024 / 1024)} MB。`)
    chunks.push(value)
  }
  if (chunks.length === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object expected')
    return value as Record<string, unknown>
  } catch {
    throw new DomainError('validation', 'Request body must be a JSON object.')
  }
}

function stringValue(body: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = body[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') throw new DomainError('validation', `${key} must be text.`)
  return value
}

function numberValue(body: Record<string, unknown>, key: string, required = false): number | undefined {
  const value = body[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DomainError('validation', `${key} must be a non-negative integer.`)
  return value
}

function nullableNumberValue(body: Record<string, unknown>, key: string): number | null | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new DomainError('validation', `${key} must be a non-negative integer or null.`)
  return value
}

function enumValue<T extends string>(body: Record<string, unknown>, key: string, values: readonly T[], required = false): T | undefined {
  const value = stringValue(body, key, required)
  if (value === undefined) return undefined
  if (!values.includes(value as T)) throw new DomainError('validation', `${key} must be one of: ${values.join(', ')}.`)
  return value as T
}

function stringArrayValue(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new DomainError('validation', `${key} must be an array of text values.`)
  return value as string[]
}

function booleanValue(body: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
  const value = body[key]
  if (value === undefined) return defaultValue
  if (typeof value !== 'boolean') throw new DomainError('validation', `${key} must be true or false.`)
  return value
}

function bodyObjectArray(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = body[key]
  if (!Array.isArray(value)) throw new DomainError('validation', `${key} must be an array.`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new DomainError('validation', `${key}[${index}] must be an object.`)
    return item as Record<string, unknown>
  })
}

function batchApprovalItemsValue(body: Record<string, unknown>): Array<Pick<ChapterBatchItem, 'id' | 'plannedTitle' | 'writingGoal' | 'openingContinuity' | 'endingHook' | 'targetWords'>> {
  return bodyObjectArray(body, 'items').map(item => ({
    id: stringValue(item, 'id', true)!,
    plannedTitle: stringValue(item, 'plannedTitle', true)!,
    writingGoal: stringValue(item, 'writingGoal', true)!,
    openingContinuity: stringValue(item, 'openingContinuity') ?? '',
    endingHook: stringValue(item, 'endingHook') ?? '',
    targetWords: numberValue(item, 'targetWords', true)!,
  })).map((item, index) => {
    if (!item.id.trim()) throw new DomainError('validation', `items[${index}].id is required.`)
    return item
  })
}

async function continuePersistedChapterBatchPlan(
  batchId: string,
  repository: NovelRepository,
  generation: GenerationService,
  runner: WorkflowRunner,
): Promise<void> {
  let planned = await generation.planChapterBatch(batchId)
  if (planned.automationMode !== 'yolo' || planned.status !== 'awaiting_plan_approval') return
  const projectRevision = repository.getProjectTree(planned.projectId).project.revision
  planned = repository.approveChapterBatchPlan(planned.id, planned.items.map(item => ({
    id: item.id,
    plannedTitle: item.plannedTitle,
    writingGoal: item.writingGoal,
    openingContinuity: item.openingContinuity,
    endingHook: item.endingHook,
    targetWords: item.targetWords,
  })), projectRevision)
  repository.setChapterBatchStatus(planned.id, 'start', repository.getProjectTree(planned.projectId).project.revision)
  const dispatched = repository.dispatchNextBatchItem(planned.id)
  if (dispatched.workflow) runner.resume(dispatched.workflow.id)
}

function schedulePersistedChapterBatchPlan(batchId: string, repository: NovelRepository, generation: GenerationService, runner: WorkflowRunner): void {
  queueMicrotask(() => { void continuePersistedChapterBatchPlan(batchId, repository, generation, runner).catch(() => undefined) })
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost')
}

function queryInteger(url: URL, key: string, minimum: number, maximum: number): number | undefined {
  const raw = url.searchParams.get(key)
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new DomainError('validation', `${key} must be an integer between ${minimum} and ${maximum}.`)
  return value
}

function queryList(url: URL, key: string): string[] | undefined {
  const values = url.searchParams.getAll(key).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean)
  return values.length > 0 ? values : undefined
}

function queryEnum<T extends string>(url: URL, key: string, values: readonly T[]): T | undefined {
  const value = url.searchParams.get(key)
  if (value === null || value === '') return undefined
  if (!values.includes(value as T)) throw new DomainError('validation', `${key} must be one of: ${values.join(', ')}.`)
  return value as T
}

function relationshipInputValue(body: Record<string, unknown>) {
  return {
    predicateKey: stringValue(body, 'predicateKey', true)!,
    label: stringValue(body, 'label', true)!,
    category: enumValue(body, 'category', RELATIONSHIP_CATEGORIES, true)! as RelationshipCategory,
    directionality: enumValue(body, 'directionality', ['directed', 'symmetric'] as const, true)!,
    factLayer: enumValue(body, 'factLayer', RELATIONSHIP_FACT_LAYERS, true)! as RelationshipFactLayer,
    validFromStoryOrder: nullableNumberValue(body, 'validFromStoryOrder'),
    validToStoryOrder: nullableNumberValue(body, 'validToStoryOrder'),
  }
}

function relationshipCandidateConfirmationValue(body: Record<string, unknown>): RelationshipCandidateConfirmationInput {
  return {
    sourceEntityId: stringValue(body, 'sourceEntityId'),
    targetEntityId: stringValue(body, 'targetEntityId'),
    predicateKey: stringValue(body, 'predicateKey'),
    label: stringValue(body, 'label'),
    category: enumValue(body, 'category', RELATIONSHIP_CATEGORIES) as RelationshipCategory | undefined,
    directionality: enumValue(body, 'directionality', ['directed', 'symmetric'] as const),
    factLayer: enumValue(body, 'factLayer', RELATIONSHIP_FACT_LAYERS) as RelationshipFactLayer | undefined,
    validFromStoryOrder: nullableNumberValue(body, 'validFromStoryOrder'),
    validToStoryOrder: nullableNumberValue(body, 'validToStoryOrder'),
  }
}

function relationshipCandidateBatchDecisionsValue(body: Record<string, unknown>): RelationshipCandidateBatchDecision[] {
  return bodyObjectArray(body, 'decisions').map((item, index) => {
    const candidateId = stringValue(item, 'candidateId', true)!.trim()
    if (!candidateId) throw new DomainError('validation', `decisions[${index}].candidateId is required.`)
    const decision = enumValue(item, 'decision', ['confirm', 'reject'] as const, true)!
    return { candidateId, decision, ...(decision === 'confirm' ? { input: relationshipCandidateConfirmationValue(item) } : {}) }
  })
}

function memorySearchQuery(url: URL) {
  const value = (key: string): string | undefined => {
    const raw = url.searchParams.get(key)?.trim()
    return raw ? raw : undefined
  }
  return {
    q: value('q'),
    origin: value('origin'),
    scope: value('scope'),
    category: value('category'),
    state: value('state'),
    storage: value('storage'),
    promptPolicy: value('promptPolicy'),
    used: value('used'),
    cursor: value('cursor'),
    limit: queryInteger(url, 'limit', 1, 100),
  }
}

function plannerAnswersValue(body: Record<string, unknown>): FoundationPlannerAnswer[] {
  const value = body.answers
  if (!Array.isArray(value)) throw new DomainError('validation', 'answers must be an array.')
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new DomainError('validation', 'Each planner answer must be an object.')
    const answer = item as Record<string, unknown>
    if (typeof answer.questionId !== 'string') throw new DomainError('validation', 'Each planner answer needs questionId.')
    if (answer.optionId !== null && answer.optionId !== undefined && typeof answer.optionId !== 'string') throw new DomainError('validation', 'optionId must be text or null.')
    if (answer.customText !== undefined && typeof answer.customText !== 'string') throw new DomainError('validation', 'customText must be text.')
    if (answer.skipped !== undefined && typeof answer.skipped !== 'boolean') throw new DomainError('validation', 'skipped must be boolean when provided.')
    return { questionId: answer.questionId, optionId: typeof answer.optionId === 'string' ? answer.optionId : null, customText: typeof answer.customText === 'string' ? answer.customText : '', ...(answer.skipped === true ? { skipped: true } : {}) }
  })
}

function routeParts(req: IncomingMessage, basePath: string): string[] {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.pathname.slice(basePath.length).split('/').filter(Boolean).map(decodeURIComponent)
}

function foundationKind(value: string): ProjectFoundationKind {
  if (!isActiveProjectFoundationKind(value)) throw new DomainError('validation', '当前创作基建只包含全书大纲、人物体系和故事时间线。')
  return value as ProjectFoundationKind
}

export async function handleNovelApi(req: IncomingMessage, res: ServerResponse, repository: NovelRepository, generation: GenerationService, foundationRunner: FoundationGenerationRunner, foundationInteraction: FoundationInteractionDriver, workflows: WorkflowEngine, runner: WorkflowRunner, basePath: string): Promise<void> {
  try {
    const parts = routeParts(req, basePath)
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'workspace') {
      sendJson(res, 200, repository.getWorkspace())
      return
    }
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'studio') {
      sendJson(res, 200, repository.getStudioOverview())
      return
    }
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'library') {
      sendJson(res, 200, repository.getLibraryOverview())
      return
    }
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'imports') {
      const body = await readJson(req, MAX_IMPORT_BODY_BYTES)
      if (body.format === 'markdown' || body.format === 'txt') {
        const input: ManuscriptImportInput = {
          format: body.format,
          sourceName: stringValue(body, 'sourceName', true)!,
          content: stringValue(body, 'content', true)!,
          title: stringValue(body, 'title'),
          language: stringValue(body, 'language'),
          genre: stringValue(body, 'genre'),
          audience: stringValue(body, 'audience'),
          targetWordCount: numberValue(body, 'targetWordCount'),
          chapterTargetWords: numberValue(body, 'chapterTargetWords'),
        }
        sendJson(res, 201, repository.importManuscript(input))
        return
      }
      const snapshot = body.snapshot ?? body.content ?? body
      if (body.snapshot !== undefined && (!body.snapshot || typeof body.snapshot !== 'object' || Array.isArray(body.snapshot))) {
        throw new DomainError('validation', 'snapshot 必须是项目快照对象。')
      }
      sendJson(res, 201, repository.restoreProjectSnapshot(snapshot, stringValue(body, 'title')))
      return
    }
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'projects') {
      const body = await readJson(req)
      const input: CreateProjectInput = {
        title: stringValue(body, 'title', true)!, language: stringValue(body, 'language'), genre: stringValue(body, 'genre'), audience: stringValue(body, 'audience'),
        targetWordCount: numberValue(body, 'targetWordCount'), chapterTargetWords: numberValue(body, 'chapterTargetWords'), stylePresetId: stringValue(body, 'stylePresetId'),
        workspacePath: stringValue(body, 'workspacePath'), markdownSyncEnabled: booleanValue(body, 'markdownSyncEnabled', false),
      }
      sendJson(res, 201, repository.createProject(input))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'batches') {
      sendJson(res, 200, repository.listChapterBatches(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'batches') {
      const body = await readJson(req)
      const mode = enumValue(body, 'mode', ['selected', 'continuous'] as const, true)!
      const automationMode = enumValue(body, 'automationMode', AUTOMATION_MODES) ?? 'auto'
      const chapterIds = stringArrayValue(body, 'chapterIds')
      const count = numberValue(body, 'count') ?? (mode === 'selected' ? chapterIds.length : 5)
      if (count < 1 || count > 20) throw new DomainError('validation', 'count must be between 1 and 20.')
      if (mode === 'selected' && (chapterIds.length !== count || new Set(chapterIds).size !== count)) {
        throw new DomainError('validation', 'Selected batches need exactly count unique chapterIds in queue order.')
      }
      const startChapterId = mode === 'continuous' ? stringValue(body, 'startChapterId', true)! : undefined
      if ((automationMode === 'yolo' || count >= 10) && !booleanValue(body, 'confirmed', false)) {
        throw new DomainError('validation', 'YOLO batches and batches of 10 or more chapters require confirmed=true.')
      }
      const selection = generation.status().selection
      const batch = repository.createChapterBatch(parts[1]!, { mode, automationMode, chapterIds: mode === 'selected' ? chapterIds : undefined, startChapterId, count }, selection, numberValue(body, 'projectRevision', true)!)
      schedulePersistedChapterBatchPlan(batch.id, repository, generation, runner)
      sendJson(res, 202, batch)
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'memory') {
      const query = memorySearchQuery(requestUrl(req))
      sendJson(res, 200, repository.searchMemory(parts[1]!, query))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'memory' && parts[3] === 'facets') {
      const page = repository.searchMemory(parts[1]!, memorySearchQuery(requestUrl(req)))
      sendJson(res, 200, page.facets)
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'memory') {
      const body = await readJson(req)
      sendJson(res, 201, repository.createUserMemory(parts[1]!, {
        content: stringValue(body, 'content', true)!,
        scope: enumValue(body, 'scope', MEMORY_SCOPES, true)! as MemoryItem['scope'],
        category: enumValue(body, 'category', MEMORY_CATEGORIES, true)! as MemoryCategory,
        promptPolicy: enumValue(body, 'promptPolicy', MEMORY_PROMPT_POLICIES) as MemoryPromptPolicy | undefined,
        sourceItemId: stringValue(body, 'sourceItemId'),
      }, numberValue(body, 'projectRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'memory' && parts[3] === 'rescan') {
      const body = await readJson(req)
      sendJson(res, 200, repository.rescanMemoryMarkdown(parts[1]!, numberValue(body, 'projectRevision', true)!))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'memory' && parts[3] === 'conflicts') {
      sendJson(res, 200, repository.listMemoryConflicts(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[3] === 'mode') {
      sendJson(res, 200, { mode: repository.getRelationshipMode(parts[1]!) })
      return
    }
    if (req.method === 'POST' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[3] === 'mode') {
      const body = await readJson(req)
      const mode = enumValue(body, 'mode', RELATIONSHIP_MODES, true)! as RelationshipMode
      sendJson(res, 200, { mode: repository.setRelationshipMode(parts[1]!, mode, numberValue(body, 'baseRevision', true)!) })
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'relationships') {
      const url = requestUrl(req)
      const categories = queryList(url, 'categories')
      const factLayers = queryList(url, 'factLayers')
      if (categories?.some(value => !RELATIONSHIP_CATEGORIES.includes(value as RelationshipCategory))) throw new DomainError('validation', 'categories contains an unsupported relationship category.')
      if (factLayers?.some(value => !RELATIONSHIP_FACT_LAYERS.includes(value as RelationshipFactLayer))) throw new DomainError('validation', 'factLayers contains an unsupported fact layer.')
      sendJson(res, 200, repository.listEntityRelationships(parts[1]!, {
        q: url.searchParams.get('q')?.trim() || undefined,
        categories: categories as RelationshipCategory[] | undefined,
        factLayers: factLayers as RelationshipFactLayer[] | undefined,
        atStoryOrder: queryInteger(url, 'atStoryOrder', 0, Number.MAX_SAFE_INTEGER),
        cursor: url.searchParams.get('cursor')?.trim() || undefined,
        limit: queryInteger(url, 'limit', 1, 100),
      }))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[3] === 'runs') {
      sendJson(res, 200, repository.listRelationshipExtractionRuns(parts[1]!, queryInteger(requestUrl(req), 'limit', 1, 100)))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[3] === 'graph') {
      const url = requestUrl(req)
      const categories = queryList(url, 'categories')
      const factLayers = queryList(url, 'factLayers')
      if (categories?.some(value => !RELATIONSHIP_CATEGORIES.includes(value as RelationshipCategory))) throw new DomainError('validation', 'categories contains an unsupported relationship category.')
      if (factLayers?.some(value => !RELATIONSHIP_FACT_LAYERS.includes(value as RelationshipFactLayer))) throw new DomainError('validation', 'factLayers contains an unsupported fact layer.')
      sendJson(res, 200, repository.getRelationshipGraph(parts[1]!, {
        rootEntityId: url.searchParams.get('rootEntityId')?.trim() || undefined,
        depth: queryInteger(url, 'depth', 1, 2) as 1 | 2 | undefined,
        categories: categories as RelationshipCategory[] | undefined,
        factLayers: factLayers as RelationshipFactLayer[] | undefined,
        atStoryOrder: queryInteger(url, 'atStoryOrder', 0, Number.MAX_SAFE_INTEGER),
        limitNodes: queryInteger(url, 'limitNodes', 1, 80),
        limitEdges: queryInteger(url, 'limitEdges', 1, 180),
      }))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[3] === 'candidates') {
      const status = queryEnum(requestUrl(req), 'status', ['pending', 'ambiguous', 'confirmed', 'rejected'] as const)
      sendJson(res, 200, repository.listRelationshipCandidates(parts[1]!, status))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'relationships') {
      const body = await readJson(req)
      sendJson(res, 201, repository.createEntityRelationship(parts[1]!, {
        sourceEntityId: stringValue(body, 'sourceEntityId', true)!,
        targetEntityId: stringValue(body, 'targetEntityId', true)!,
        ...relationshipInputValue(body),
      }, numberValue(body, 'baseRevision', true)!))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'projects') {
      sendJson(res, 200, repository.getProjectTree(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'archive') {
      const body = await readJson(req)
      sendJson(res, 200, repository.archiveProject(parts[1]!, numberValue(body, 'baseRevision')))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'restore') {
      const body = await readJson(req)
      sendJson(res, 200, repository.restoreProject(parts[1]!, numberValue(body, 'baseRevision')))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'exports' && parts[3] === 'markdown') {
      sendJson(res, 200, repository.exportProjectMarkdown(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'exports' && parts[3] === 'snapshot') {
      sendJson(res, 200, repository.exportProjectSnapshot(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'knowledge') {
      sendJson(res, 200, repository.getKnowledgeWorkspace(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'styles') {
      sendJson(res, 200, { profile: repository.getProjectStyleProfile(parts[1]!), presets: repository.listStylePresets(), rulesRevision: repository.getPromptCatalog(parts[1]!).projectRules.revision })
      return
    }
    if (req.method === 'POST' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'styles' && parts[3] === 'preset') {
      const body = await readJson(req)
      sendJson(res, 200, repository.setProjectStylePreset(parts[1]!, stringValue(body, 'presetId', true)!, numberValue(body, 'baseRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'styles' && parts[3] === 'extract') {
      const body = await readJson(req)
      const controller = new AbortController()
      req.once('aborted', () => { controller.abort() })
      sendJson(res, 200, await generation.extractWritingStyle(parts[1]!, stringValue(body, 'name') ?? '', stringValue(body, 'sampleText', true)!, numberValue(body, 'baseRevision', true)!, controller.signal))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'growth') {
      sendJson(res, 200, repository.getStoryGrowthMap(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'statistics') {
      sendJson(res, 200, repository.getProjectGenerationStatistics(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'foundation') {
      sendJson(res, 200, repository.getProjectFoundation(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'projects' && parts[2] === 'foundation' && parts[4] === 'generate') {
      const body = await readJson(req)
      const controller = new AbortController()
      req.once('aborted', () => { controller.abort() })
      sendJson(res, 201, await generation.generateProjectFoundation(parts[1]!, foundationKind(parts[3]!), stringValue(body, 'brief') ?? '', controller.signal))
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'projects' && parts[2] === 'foundation' && parts[4] === 'runs') {
      const body = await readJson(req)
      const kind = foundationKind(parts[3]!)
      const guided = booleanValue(body, 'guided', true)
      sendJson(res, 201, foundationRunner.create(parts[1]!, kind, stringValue(body, 'brief') ?? '', guided))
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'projects' && parts[2] === 'foundation' && parts[4] === 'native-runs') {
      const body = await readJson(req)
      const kind = foundationKind(parts[3]!)
      sendJson(res, 201, foundationInteraction.start(parts[1]!, kind, stringValue(body, 'brief') ?? '', stringValue(body, 'sessionId', true)!))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'foundation-runs') {
      sendJson(res, 200, repository.getFoundationGenerationRun(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'foundation-runs' && parts[2] === 'answers') {
      const body = await readJson(req)
      sendJson(res, 202, foundationRunner.answer(parts[1]!, plannerAnswersValue(body)))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'foundation-runs' && parts[2] === 'finish-planning') {
      sendJson(res, 202, foundationRunner.finishPlanning(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'foundation-runs' && parts[2] === 'cancel') {
      sendJson(res, 200, foundationInteraction.cancel(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'foundation-runs' && parts[2] === 'native-resume') {
      const body = await readJson(req)
      sendJson(res, 202, foundationInteraction.resume(parts[1]!, stringValue(body, 'sessionId', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'foundation-runs' && parts[2] === 'inline') {
      sendJson(res, 202, foundationInteraction.moveToInline(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'foundation-runs' && parts[2] === 'retry') {
      sendJson(res, 202, foundationRunner.retry(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'projects' && parts[2] === 'foundation' && parts[4] === 'approve') {
      const body = await readJson(req)
      sendJson(res, 200, repository.approveProjectFoundationVersion(parts[1]!, foundationKind(parts[3]!), stringValue(body, 'versionId', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'knowledge-sources') {
      const body = await readJson(req)
      sendJson(res, 200, repository.configureHistoricalSource(parts[1]!, parts[3]!, body.enabled === true, stringArrayValue(body, 'scopes') as HistoricalKnowledgeScope[]))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'batches') {
      sendJson(res, 200, repository.getChapterBatch(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'batches' && parts[2] === 'approve-plan') {
      const body = await readJson(req)
      const batch = repository.getChapterBatch(parts[1]!)
      const baseRevision = numberValue(body, 'baseRevision', true)!
      if (batch.revision !== baseRevision) throw new DomainError('revision-conflict', `Batch changed from revision ${baseRevision} to ${batch.revision}.`)
      const projectRevision = numberValue(body, 'projectRevision', true)!
      sendJson(res, 200, repository.approveChapterBatchPlan(parts[1]!, batchApprovalItemsValue(body), projectRevision))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'batches' && parts[2] === 'reorder') {
      const body = await readJson(req)
      const batch = repository.getChapterBatch(parts[1]!)
      const baseRevision = numberValue(body, 'baseRevision', true)!
      if (batch.revision !== baseRevision) throw new DomainError('revision-conflict', `Batch changed from revision ${baseRevision} to ${batch.revision}.`)
      const projectRevision = numberValue(body, 'projectRevision', true)!
      sendJson(res, 200, repository.reorderChapterBatch(parts[1]!, stringArrayValue(body, 'itemIds'), projectRevision))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'batches' && parts[2] === 'start') {
      const body = await readJson(req)
      repository.setChapterBatchStatus(parts[1]!, 'start', numberValue(body, 'projectRevision', true)!)
      const dispatched = repository.dispatchNextBatchItem(parts[1]!)
      if (dispatched.workflow) runner.resume(dispatched.workflow.id)
      sendJson(res, 202, repository.getChapterBatch(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'batches' && parts[2] === 'pause') {
      const body = await readJson(req)
      sendJson(res, 200, repository.setChapterBatchStatus(parts[1]!, 'pause', numberValue(body, 'projectRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'batches' && parts[2] === 'resume') {
      const body = await readJson(req)
      repository.setChapterBatchStatus(parts[1]!, 'resume', numberValue(body, 'projectRevision', true)!)
      const batch = repository.getChapterBatch(parts[1]!)
      const active = batch.items.find(item => item.workflowRunId && item.workflow && ['paused', 'running'].includes(item.workflow.status))
      if (active?.workflowRunId) runner.resume(active.workflowRunId)
      else {
        const dispatched = repository.dispatchNextBatchItem(parts[1]!)
        if (dispatched.workflow) runner.resume(dispatched.workflow.id)
      }
      sendJson(res, 202, repository.getChapterBatch(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'batches' && parts[2] === 'retry') {
      const body = await readJson(req)
      const batch = repository.getChapterBatch(parts[1]!)
      const blocked = batch.items.find(item => item.queueState === 'blocked')
      if (!blocked && batch.status === 'blocked' && batch.items.length === 0 && batch.plan?.status === 'failed') {
        const projectRevision = numberValue(body, 'projectRevision', true)!
        const project = repository.getProjectTree(batch.projectId).project
        if (project.revision !== projectRevision) throw new DomainError('revision-conflict', `项目已从版本 ${projectRevision} 更新到 ${project.revision}。`)
        const planning = repository.setChapterBatchRuntimeStatus(batch.id, 'planning')
        schedulePersistedChapterBatchPlan(batch.id, repository, generation, runner)
        sendJson(res, 202, planning)
        return
      }
      if (!blocked) throw new DomainError('invalid-state', 'This batch has no blocked chapter to retry.')
      const retried = repository.retryChapterBatchItem(parts[1]!, blocked.id, numberValue(body, 'projectRevision', true)!)
      if (retried.workflow) runner.resume(retried.workflow.id)
      else {
        const dispatched = repository.dispatchNextBatchItem(parts[1]!)
        if (dispatched.workflow) runner.resume(dispatched.workflow.id)
      }
      sendJson(res, 202, repository.getChapterBatch(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'batches' && parts[2] === 'cancel') {
      const body = await readJson(req)
      const cancelled = repository.setChapterBatchStatus(parts[1]!, 'cancel', numberValue(body, 'projectRevision', true)!)
      sendJson(res, 200, cancelled)
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'batches' && parts[2] === 'items' && parts[4] === 'skip') {
      const body = await readJson(req)
      const batch = repository.skipChapterBatchItem(parts[1]!, parts[3]!, numberValue(body, 'projectRevision', true)!)
      if (batch.status === 'running') {
        const dispatched = repository.dispatchNextBatchItem(parts[1]!)
        if (dispatched.workflow) runner.resume(dispatched.workflow.id)
      }
      sendJson(res, 200, repository.getChapterBatch(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'memory') {
      sendJson(res, 200, repository.getMemoryItem(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'memory' && parts[2] === 'revisions') {
      sendJson(res, 200, repository.listMemoryRevisions(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'memory' && parts[2] === 'usages') {
      const url = requestUrl(req)
      sendJson(res, 200, repository.listMemoryUsages(parts[1]!, {
        cursor: url.searchParams.get('cursor')?.trim() || undefined,
        limit: queryInteger(url, 'limit', 1, 100),
      }))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'memory' && parts[2] === 'diff') {
      const url = requestUrl(req)
      const from = url.searchParams.get('from')?.trim()
      const to = url.searchParams.get('to')?.trim()
      if (!from || !to) throw new DomainError('validation', 'Memory diff requires from and to revision IDs.')
      sendJson(res, 200, repository.getMemoryRevisionDiff(parts[1]!, from, to))
      return
    }
    if (req.method === 'POST' && parts.length === 2 && parts[0] === 'memory') {
      const body = await readJson(req)
      sendJson(res, 200, repository.updateUserMemory(parts[1]!, {
        content: stringValue(body, 'content'),
        category: enumValue(body, 'category', MEMORY_CATEGORIES) as MemoryCategory | undefined,
        promptPolicy: enumValue(body, 'promptPolicy', MEMORY_PROMPT_POLICIES) as MemoryPromptPolicy | undefined,
        baseRevision: numberValue(body, 'baseRevision', true)!,
        projectRevision: numberValue(body, 'projectRevision', true)!,
      }))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'memory' && parts[2] === 'restore') {
      const body = await readJson(req)
      sendJson(res, 200, repository.restoreMemoryRevision(parts[1]!, stringValue(body, 'revisionId', true)!, numberValue(body, 'baseRevision', true)!, numberValue(body, 'projectRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'memory' && parts[2] === 'archive') {
      const body = await readJson(req)
      sendJson(res, 200, repository.setMemoryItemArchived(parts[1]!, booleanValue(body, 'archived', true), numberValue(body, 'baseRevision', true)!, numberValue(body, 'projectRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'memory' && parts[2] === 'conflicts' && parts[4] === 'resolve') {
      const body = await readJson(req)
      const resolution = enumValue(body, 'resolution', ['database', 'file', 'merged', 'both'] as const, true)!
      sendJson(res, 200, repository.resolveMemoryConflict(parts[1]!, parts[3]!, resolution, numberValue(body, 'baseRevision', true)!, numberValue(body, 'projectRevision', true)!, stringValue(body, 'mergedContent')))
      return
    }
    if (req.method === 'POST' && parts.length === 6 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[3] === 'candidates' && (parts[5] === 'confirm' || parts[5] === 'reject')) {
      const body = await readJson(req)
      const decision = parts[5] === 'confirm' ? 'confirm' : 'reject'
      sendJson(res, 200, repository.decideRelationshipCandidate(parts[1]!, parts[4]!, decision, decision === 'confirm' ? relationshipCandidateConfirmationValue(body) : undefined, numberValue(body, 'projectRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[3] === 'candidates' && parts[4] === 'batch') {
      const body = await readJson(req)
      sendJson(res, 200, repository.decideRelationshipCandidates(parts[1]!, relationshipCandidateBatchDecisionsValue(body), numberValue(body, 'projectRevision', true)!))
      return
    }
    if (req.method === 'GET' && parts.length === 5 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[4] === 'evidence') {
      sendJson(res, 200, repository.getRelationshipEvidence(parts[1]!, parts[3]!))
      return
    }
    if (req.method === 'POST' && parts.length === 5 && parts[0] === 'projects' && parts[2] === 'relationships' && parts[4] === 'revise') {
      const body = await readJson(req)
      sendJson(res, 200, repository.reviseEntityRelationship(parts[1]!, parts[3]!, relationshipInputValue(body), numberValue(body, 'baseRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'chapters') {
      const body = await readJson(req)
      sendJson(res, 201, repository.createChapter(parts[1]!, stringValue(body, 'title')))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'chapters') {
      sendJson(res, 200, repository.getChapter(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'drafts') {
      const body = await readJson(req)
      const input: SaveDraftInput = {
        content: stringValue(body, 'content', true)!, baseRevision: numberValue(body, 'baseRevision', true)!,
        origin: body.origin === 'autosave' ? 'autosave' : 'user',
      }
      sendJson(res, 201, repository.saveDraft(parts[1]!, input))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'rewrite-selection') {
      const body = await readJson(req)
      const controller = new AbortController()
      req.once('aborted', () => { controller.abort() })
      sendJson(res, 200, await generation.rewriteSelection(parts[1]!, {
        selectedText: stringValue(body, 'selectedText', true)!,
        contextBefore: stringValue(body, 'contextBefore') ?? '',
        contextAfter: stringValue(body, 'contextAfter') ?? '',
        instruction: stringValue(body, 'instruction') ?? '',
        baseRevision: numberValue(body, 'baseRevision', true)!,
      }, controller.signal))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'approve') {
      const body = await readJson(req)
      const approved = repository.approveVersionAndStartPostProcessing(parts[1]!, stringValue(body, 'versionId', true)!, numberValue(body, 'baseRevision', true)!)
      runner.resume(approved.workflow.id)
      // Preserve the existing public response shape while the durable
      // post-approval workflow remains visible through chapter workflows.
      sendJson(res, 200, approved.chapter)
      return
    }
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'workspace') {
      const body = await readJson(req)
      const projectId = body.projectId === null ? null : stringValue(body, 'projectId') ?? null
      const chapterId = body.chapterId === null ? null : stringValue(body, 'chapterId') ?? null
      const sessionId = stringValue(body, 'sessionId')
      sendJson(res, 200, repository.selectWorkspace(projectId, chapterId, sessionId))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'recovery') {
      sendJson(res, 200, repository.getResumeContext(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 2 && parts[0] === 'recovery') {
      const body = await readJson(req)
      sendJson(res, 200, repository.getResumeContext(parts[1]!, stringValue(body, 'projectId', true)!))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'prompts') {
      sendJson(res, 200, repository.getPromptCatalog(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'rules') {
      const body = await readJson(req)
      sendJson(res, 200, repository.updateProjectRules(parts[1]!, {
        styleRules: stringValue(body, 'styleRules', true)!, chapterGoal: stringValue(body, 'chapterGoal', true)!, forbiddenContent: stringValue(body, 'forbiddenContent', true)!,
      }, numberValue(body, 'baseRevision', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'prompts' && parts[2] === 'versions') {
      const body = await readJson(req)
      sendJson(res, 201, repository.createPromptVersion(parts[1]!, stringValue(body, 'template', true)!))
      return
    }
    if (req.method === 'POST' && parts.length === 4 && parts[0] === 'projects' && parts[2] === 'prompts' && parts[3] === 'select') {
      const body = await readJson(req)
      const purpose = stringValue(body, 'purpose', true)
      if (purpose !== 'scene-plan' && purpose !== 'chapter-draft') throw new DomainError('validation', 'purpose must be scene-plan or chapter-draft.')
      sendJson(res, 200, repository.selectPromptVersion(parts[1]!, purpose, stringValue(body, 'promptAssetVersionId', true)!))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'model' && parts[1] === 'status') {
      sendJson(res, 200, generation.status())
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'model-runs') {
      sendJson(res, 200, repository.listModelRuns(parts[1]!))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'generation-sources') {
      sendJson(res, 200, repository.getChapterGenerationSources(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'generate') {
      if (process.env.NOVEL_STUDIO_COMPOSITION_MODEL !== '1') {
        throw new DomainError('invalid-state', '直接生成接口已停用；请创建章节工作流，以便冻结检索、场景计划、审批和 Memory/Canon 写入边界。')
      }
      const body = await readJson(req)
      const purpose = stringValue(body, 'purpose', true)
      if (purpose !== 'scene-plan' && purpose !== 'chapter-draft') throw new DomainError('validation', 'purpose must be scene-plan or chapter-draft.')
      const controller = new AbortController()
      req.once('aborted', () => { controller.abort() })
      sendJson(res, 201, await generation.generate(parts[1]!, purpose, controller.signal))
      return
    }
    if (req.method === 'GET' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'workflows') {
      sendJson(res, 200, repository.listChapterWorkflows(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'chapters' && parts[2] === 'workflows') {
      const body = await readJson(req)
      const stopAfterNode = stringValue(body, 'stopAfterNode')
      const excludedSourceIds = stringArrayValue(body, 'excludedSourceIds')
      sendJson(res, 201, stopAfterNode ? await workflows.start(parts[1]!, stopAfterNode) : runner.create(parts[1]!, excludedSourceIds))
      return
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'workflows') {
      sendJson(res, 200, repository.getWorkflowRun(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'workflows' && parts[2] === 'resume') {
      sendJson(res, 202, runner.resume(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'workflows' && parts[2] === 'pause') {
      sendJson(res, 200, workflows.pause(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'workflows' && parts[2] === 'cancel') {
      sendJson(res, 200, workflows.cancel(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'workflows' && parts[2] === 'retry') {
      sendJson(res, 202, runner.retry(parts[1]!))
      return
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'workflows' && parts[2] === 'approval') {
      const body = await readJson(req)
      const decision = stringValue(body, 'decision', true)
      if (decision !== 'approved' && decision !== 'rejected') throw new DomainError('validation', 'decision must be approved or rejected.')
      sendJson(res, decision === 'approved' ? 202 : 200, runner.decide(parts[1]!, decision, stringValue(body, 'note') ?? ''))
      return
    }
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'Novel Studio API route was not found.' } })
  } catch (cause) {
    if (cause instanceof DomainError) {
      const status = cause.code === 'not-found' ? 404 : cause.code === 'revision-conflict' ? 409 : 400
      sendJson(res, status, { ok: false, error: { code: cause.code, message: cause.message } })
      return
    }
    sendJson(res, 500, { ok: false, error: { code: 'internal', message: cause instanceof Error ? cause.message : String(cause) } })
  }
}
