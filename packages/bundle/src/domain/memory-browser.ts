import { createHash } from 'node:crypto'

export const MEMORY_BROWSER_DEFAULT_PAGE_SIZE = 30
export const MEMORY_BROWSER_MAX_PAGE_SIZE = 100
export const MEMORY_BROWSER_MAX_QUERY_LENGTH = 256
export const MEMORY_BROWSER_MAX_QUERY_TERMS = 16
export const MEMORY_BROWSER_MAX_TERM_LENGTH = 64
export const MEMORY_BROWSER_MAX_CONTENT_BYTES = 256 * 1024
export const MEMORY_BROWSER_MAX_STRUCTURED_JSON_BYTES = 256 * 1024
export const MEMORY_BROWSER_MAX_REVISION = 1_000_000

export const MEMORY_ORIGINS = ['derived', 'user'] as const
export const MEMORY_STORAGES = ['database', 'markdown'] as const
export const MEMORY_SCOPES = ['foundation', 'chapter', 'arc', 'volume', 'book', 'project'] as const
export const MEMORY_CATEGORIES = ['summary', 'constraint', 'continuity', 'idea', 'research', 'other'] as const
export const MEMORY_ITEM_STATES = ['active', 'stale', 'archived', 'conflicted'] as const
export const MEMORY_PROMPT_POLICIES = ['auto', 'manual', 'never'] as const
export const MEMORY_REVISION_ACTORS = ['model', 'user', 'filesystem', 'migration', 'restore'] as const
export const MEMORY_REVISION_KINDS = ['committed', 'conflict-candidate'] as const
export const MEMORY_SOURCE_KINDS = [
  'foundation-version',
  'manuscript-version',
  'canon-fact',
  'memory-revision',
  'chapter',
  'book',
  'volume',
  'project',
  'markdown-file',
] as const
export const MEMORY_USAGE_REASONS = [
  'selected',
  'policy-excluded',
  'stale',
  'conflict',
  'budget',
  'manual-not-selected',
] as const

export type MemoryOrigin = typeof MEMORY_ORIGINS[number]
export type MemoryStorage = typeof MEMORY_STORAGES[number]
export type MemoryScope = typeof MEMORY_SCOPES[number]
export type MemoryCategory = typeof MEMORY_CATEGORIES[number]
export type MemoryItemState = typeof MEMORY_ITEM_STATES[number]
export type MemoryPromptPolicy = typeof MEMORY_PROMPT_POLICIES[number]
export type MemoryRevisionActor = typeof MEMORY_REVISION_ACTORS[number]
export type MemoryRevisionKind = typeof MEMORY_REVISION_KINDS[number]
export type MemorySourceKind = typeof MEMORY_SOURCE_KINDS[number]
export type MemoryUsageReason = typeof MEMORY_USAGE_REASONS[number]

export type MemoryBrowserErrorCode = 'validation' | 'revision-conflict' | 'invalid-state'

export class MemoryBrowserError extends Error {
  constructor(readonly code: MemoryBrowserErrorCode, message: string) {
    super(message)
    this.name = 'MemoryBrowserError'
  }
}

export interface MemoryBrowserItem {
  readonly id: string
  readonly projectId: string
  readonly origin: MemoryOrigin
  readonly storage: MemoryStorage
  readonly stableKey: string
  readonly scope: MemoryScope
  readonly targetId: string | null
  readonly title: string
  readonly category: MemoryCategory
  readonly state: MemoryItemState
  readonly promptPolicy: MemoryPromptPolicy
  readonly currentRevision: number
  readonly currentRevisionId: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MemoryBrowserRevision {
  readonly id: string
  readonly itemId: string
  readonly revision: number
  readonly parentRevisionId: string | null
  readonly kind: MemoryRevisionKind
  readonly content: string
  readonly structuredJson: string | null
  readonly contentHash: string
  readonly actor: MemoryRevisionActor
  readonly provider: string | null
  readonly model: string | null
  readonly promptHash: string | null
  readonly workflowRunId: string | null
  readonly restoredFromRevisionId: string | null
  readonly changeNote: string | null
  readonly createdAt: string
}

export interface MemoryBrowserSource {
  readonly id: string
  readonly revisionId: string
  readonly kind: MemorySourceKind
  readonly sourceId: string
  readonly sourceVersionId: string | null
  readonly label: string | null
  readonly contentHash: string | null
  readonly relativePath: string | null
  readonly position: number
}

export interface MemoryBrowserUsage {
  readonly id: string
  readonly projectId: string
  readonly itemId: string
  readonly revisionId: string
  readonly modelRunId: string
  readonly sectionKey: string
  readonly included: boolean
  readonly truncated: boolean
  readonly reason: MemoryUsageReason
  readonly authority: MemoryPromptAuthority
  readonly estimatedTokens: number
  readonly createdAt: string
}

export interface CreateMemoryRevisionInput {
  id: string
  itemId: string
  content: string
  structuredJson?: string | null
  actor: MemoryRevisionActor
  kind?: MemoryRevisionKind
  provider?: string | null
  model?: string | null
  promptHash?: string | null
  workflowRunId?: string | null
  changeNote?: string | null
  createdAt: string
}

export interface AppendMemoryRevisionInput extends Omit<CreateMemoryRevisionInput, 'itemId'> {
  expectedRevision: number
}

export interface RestoreMemoryRevisionInput {
  id: string
  expectedRevision: number
  createdAt: string
  changeNote?: string | null
}

export function memoryContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function defaultMemoryPromptPolicy(origin: MemoryOrigin, category: MemoryCategory): MemoryPromptPolicy {
  if (origin === 'derived') return 'auto'
  if (category === 'constraint' || category === 'continuity') return 'auto'
  return 'manual'
}

export function validateMemoryBrowserItem(item: MemoryBrowserItem): Readonly<MemoryBrowserItem> {
  const normalized: MemoryBrowserItem = {
    id: requiredText(item.id, 'item.id', 200),
    projectId: requiredText(item.projectId, 'item.projectId', 200),
    origin: enumValue(item.origin, MEMORY_ORIGINS, 'item.origin'),
    storage: enumValue(item.storage, MEMORY_STORAGES, 'item.storage'),
    stableKey: requiredText(item.stableKey, 'item.stableKey', 300),
    scope: enumValue(item.scope, MEMORY_SCOPES, 'item.scope'),
    targetId: optionalText(item.targetId, 'item.targetId', 200),
    title: requiredText(item.title, 'item.title', 200),
    category: enumValue(item.category, MEMORY_CATEGORIES, 'item.category'),
    state: enumValue(item.state, MEMORY_ITEM_STATES, 'item.state'),
    promptPolicy: enumValue(item.promptPolicy, MEMORY_PROMPT_POLICIES, 'item.promptPolicy'),
    currentRevision: boundedInteger(item.currentRevision, 'item.currentRevision', 1, MEMORY_BROWSER_MAX_REVISION),
    currentRevisionId: requiredText(item.currentRevisionId, 'item.currentRevisionId', 200),
    createdAt: timestamp(item.createdAt, 'item.createdAt'),
    updatedAt: timestamp(item.updatedAt, 'item.updatedAt'),
  }

  if (normalized.origin === 'derived' && normalized.category !== 'summary') {
    throw validation('派生记忆必须使用 summary 分类。')
  }
  if (normalized.origin === 'derived' && normalized.storage !== 'database') {
    throw validation('派生记忆的权威副本必须保存在数据库；Markdown 只能作为镜像。')
  }
  if (normalized.origin === 'user' && normalized.category === 'summary') {
    throw validation('作者记忆不能伪装成派生 summary，请选择约束、连续性、想法、研究或其他分类。')
  }
  if (Date.parse(normalized.createdAt) > Date.parse(normalized.updatedAt)) {
    throw validation('item.createdAt 不能晚于 item.updatedAt。')
  }
  return Object.freeze(normalized)
}

export function createInitialMemoryRevision(input: CreateMemoryRevisionInput): Readonly<MemoryBrowserRevision> {
  return makeRevision({
    ...input,
    revision: 1,
    parentRevisionId: null,
    restoredFromRevisionId: null,
  })
}

export function appendMemoryRevision(
  current: MemoryBrowserRevision,
  input: AppendMemoryRevisionInput,
): Readonly<MemoryBrowserRevision> {
  const validatedCurrent = assertMemoryRevisionIntegrity(current)
  const expectedRevision = boundedInteger(input.expectedRevision, 'expectedRevision', 1, MEMORY_BROWSER_MAX_REVISION)
  if (validatedCurrent.revision !== expectedRevision) {
    throw new MemoryBrowserError('revision-conflict', `记忆已更新：预期版本 ${expectedRevision}，当前版本 ${validatedCurrent.revision}。`)
  }
  if (validatedCurrent.revision >= MEMORY_BROWSER_MAX_REVISION) {
    throw validation(`记忆版本数不能超过 ${MEMORY_BROWSER_MAX_REVISION}。`)
  }
  return makeRevision({
    ...input,
    itemId: validatedCurrent.itemId,
    revision: validatedCurrent.revision + 1,
    parentRevisionId: validatedCurrent.id,
    restoredFromRevisionId: null,
  })
}

export function restoreMemoryRevision(
  current: MemoryBrowserRevision,
  target: MemoryBrowserRevision,
  input: RestoreMemoryRevisionInput,
): Readonly<MemoryBrowserRevision> {
  const validatedCurrent = assertMemoryRevisionIntegrity(current)
  const validatedTarget = assertMemoryRevisionIntegrity(target)
  if (validatedCurrent.itemId !== validatedTarget.itemId) {
    throw validation('只能恢复同一记忆条目中的历史版本。')
  }
  if (validatedTarget.kind !== 'committed') {
    throw new MemoryBrowserError('invalid-state', '冲突候选版本不能直接恢复，必须先完成冲突处理。')
  }
  const restored = appendMemoryRevision(validatedCurrent, {
    id: input.id,
    expectedRevision: input.expectedRevision,
    content: validatedTarget.content,
    structuredJson: validatedTarget.structuredJson,
    actor: 'restore',
    kind: 'committed',
    changeNote: input.changeNote ?? `恢复到版本 ${validatedTarget.revision}`,
    createdAt: input.createdAt,
  })
  return Object.freeze({ ...restored, restoredFromRevisionId: validatedTarget.id })
}

export function assertMemoryRevisionIntegrity(revision: MemoryBrowserRevision): Readonly<MemoryBrowserRevision> {
  const normalized = makeRevision({
    ...revision,
    restoredFromRevisionId: revision.restoredFromRevisionId,
  })
  if (normalized.contentHash !== normalizeHash(revision.contentHash, 'revision.contentHash')) {
    throw validation('revision.contentHash 格式无效。')
  }
  if (memoryContentHash(normalized.content) !== normalized.contentHash) {
    throw validation('记忆版本正文与 contentHash 不一致。')
  }
  if (normalized.revision === 1 && normalized.parentRevisionId !== null) {
    throw validation('首个记忆版本不能有父版本。')
  }
  if (normalized.revision > 1 && normalized.parentRevisionId === null) {
    throw validation('非首个记忆版本必须指向父版本。')
  }
  return normalized
}

export function advanceMemoryItem(
  item: MemoryBrowserItem,
  revision: MemoryBrowserRevision,
): Readonly<MemoryBrowserItem> {
  const validatedItem = validateMemoryBrowserItem(item)
  const validatedRevision = assertMemoryRevisionIntegrity(revision)
  if (validatedItem.id !== validatedRevision.itemId) throw validation('版本不属于指定记忆条目。')
  if (validatedRevision.kind !== 'committed') {
    throw new MemoryBrowserError('invalid-state', '冲突候选版本不能成为记忆条目的当前版本。')
  }
  if (validatedRevision.revision !== validatedItem.currentRevision + 1) {
    throw new MemoryBrowserError('revision-conflict', '新版本必须紧接记忆条目的当前版本。')
  }
  return validateMemoryBrowserItem({
    ...validatedItem,
    currentRevision: validatedRevision.revision,
    currentRevisionId: validatedRevision.id,
    updatedAt: validatedRevision.createdAt,
  })
}

export function validateMemoryBrowserSource(source: MemoryBrowserSource): Readonly<MemoryBrowserSource> {
  const normalized: MemoryBrowserSource = {
    id: requiredText(source.id, 'source.id', 200),
    revisionId: requiredText(source.revisionId, 'source.revisionId', 200),
    kind: enumValue(source.kind, MEMORY_SOURCE_KINDS, 'source.kind'),
    sourceId: requiredText(source.sourceId, 'source.sourceId', 400),
    sourceVersionId: optionalText(source.sourceVersionId, 'source.sourceVersionId', 200),
    label: optionalText(source.label, 'source.label', 300),
    contentHash: source.contentHash === null ? null : normalizeHash(source.contentHash, 'source.contentHash'),
    relativePath: source.relativePath === null ? null : safeRelativePath(source.relativePath),
    position: boundedInteger(source.position, 'source.position', 0, 1_000_000),
  }
  if (normalized.kind === 'markdown-file' && normalized.relativePath === null) {
    throw validation('Markdown 来源必须记录项目内相对路径。')
  }
  if (normalized.kind !== 'markdown-file' && normalized.relativePath !== null) {
    throw validation('只有 Markdown 来源可以记录 relativePath。')
  }
  return Object.freeze(normalized)
}

export function validateMemoryBrowserUsage(usage: MemoryBrowserUsage): Readonly<MemoryBrowserUsage> {
  const normalized: MemoryBrowserUsage = {
    id: requiredText(usage.id, 'usage.id', 200),
    projectId: requiredText(usage.projectId, 'usage.projectId', 200),
    itemId: requiredText(usage.itemId, 'usage.itemId', 200),
    revisionId: requiredText(usage.revisionId, 'usage.revisionId', 200),
    modelRunId: requiredText(usage.modelRunId, 'usage.modelRunId', 200),
    sectionKey: requiredText(usage.sectionKey, 'usage.sectionKey', 200),
    included: booleanValue(usage.included, 'usage.included'),
    truncated: booleanValue(usage.truncated, 'usage.truncated'),
    reason: enumValue(usage.reason, MEMORY_USAGE_REASONS, 'usage.reason'),
    authority: enumValue(usage.authority, MEMORY_PROMPT_AUTHORITIES, 'usage.authority'),
    estimatedTokens: boundedInteger(usage.estimatedTokens, 'usage.estimatedTokens', 0, 100_000_000),
    createdAt: timestamp(usage.createdAt, 'usage.createdAt'),
  }
  if (normalized.included && normalized.reason !== 'selected' && normalized.reason !== 'budget') {
    throw validation('已注入 Prompt 的记忆只能标记为 selected 或 budget（截断）。')
  }
  if (!normalized.included && normalized.reason === 'selected') {
    throw validation('未注入 Prompt 的记忆不能标记为 selected。')
  }
  if (normalized.truncated && (!normalized.included || normalized.reason !== 'budget')) {
    throw validation('只有因预算截断且实际注入的记忆可以标记 truncated。')
  }
  return Object.freeze(normalized)
}

export type MemoryUsedFilter = 'any' | 'used' | 'unused'
export type MemoryBrowserSort = 'relevance' | 'updated-desc' | 'updated-asc'

export interface MemoryBrowserQuery {
  readonly q: string | null
  readonly origins: readonly MemoryOrigin[]
  readonly storages: readonly MemoryStorage[]
  readonly scopes: readonly MemoryScope[]
  readonly categories: readonly MemoryCategory[]
  readonly states: readonly MemoryItemState[]
  readonly promptPolicies: readonly MemoryPromptPolicy[]
  readonly used: MemoryUsedFilter
  readonly sort: MemoryBrowserSort
  readonly cursor: string | null
  readonly limit: number
}

export function normalizeMemoryBrowserQuery(input: unknown): Readonly<MemoryBrowserQuery> {
  const record = objectValue(input, 'query')
  const q = optionalSearchText(record.q)
  const sortValue = record.sort === undefined ? (q ? 'relevance' : 'updated-desc') : record.sort
  const sort = enumValue(sortValue, ['relevance', 'updated-desc', 'updated-asc'] as const, 'query.sort')
  const normalized: MemoryBrowserQuery = {
    q,
    origins: enumList(record.origins, MEMORY_ORIGINS, 'query.origins'),
    storages: enumList(record.storages, MEMORY_STORAGES, 'query.storages'),
    scopes: enumList(record.scopes, MEMORY_SCOPES, 'query.scopes'),
    categories: enumList(record.categories, MEMORY_CATEGORIES, 'query.categories'),
    states: enumList(record.states, MEMORY_ITEM_STATES, 'query.states'),
    promptPolicies: enumList(record.promptPolicies, MEMORY_PROMPT_POLICIES, 'query.promptPolicies'),
    used: enumValue(record.used ?? 'any', ['any', 'used', 'unused'] as const, 'query.used'),
    sort: sort === 'relevance' && q === null ? 'updated-desc' : sort,
    cursor: optionalText(record.cursor, 'query.cursor', 512),
    limit: record.limit === undefined
      ? MEMORY_BROWSER_DEFAULT_PAGE_SIZE
      : boundedInteger(record.limit, 'query.limit', 1, MEMORY_BROWSER_MAX_PAGE_SIZE),
  }
  return Object.freeze({
    ...normalized,
    origins: Object.freeze([...normalized.origins]),
    storages: Object.freeze([...normalized.storages]),
    scopes: Object.freeze([...normalized.scopes]),
    categories: Object.freeze([...normalized.categories]),
    states: Object.freeze([...normalized.states]),
    promptPolicies: Object.freeze([...normalized.promptPolicies]),
  })
}

export interface MemoryFtsQuerySpec {
  readonly normalized: string
  readonly terms: readonly string[]
  readonly matchExpression: string
  readonly fallbackLikePattern: string
  readonly escapeCharacter: '\\'
}

export function buildMemoryFtsQuery(query: string): Readonly<MemoryFtsQuerySpec> {
  const normalized = requiredSearchText(query)
  const terms = tokenizeSearchQuery(normalized)
  if (terms.length === 0) throw validation('搜索词不能为空。')
  if (terms.length > MEMORY_BROWSER_MAX_QUERY_TERMS) {
    throw validation(`搜索词最多包含 ${MEMORY_BROWSER_MAX_QUERY_TERMS} 个词组。`)
  }
  for (const term of terms) {
    if (term.length > MEMORY_BROWSER_MAX_TERM_LENGTH) {
      throw validation(`单个搜索词组不能超过 ${MEMORY_BROWSER_MAX_TERM_LENGTH} 个字符。`)
    }
  }
  const uniqueTerms = [...new Map(terms.map(term => [term.toLocaleLowerCase(), term])).values()]
  const matchExpression = uniqueTerms.map(term => `"${term.replaceAll('"', '""')}"`).join(' AND ')
  const fallbackText = uniqueTerms.join(' ')
  return Object.freeze({
    normalized,
    terms: Object.freeze(uniqueTerms),
    matchExpression,
    fallbackLikePattern: `%${fallbackText.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
    escapeCharacter: '\\' as const,
  })
}

export type AuthorMemoryMutationPlan =
  | { readonly action: 'append-revision' }
  | { readonly action: 'create-user-override'; readonly sourceItemId: string; readonly sourceRevisionId: string }
  | { readonly action: 'deny'; readonly reason: string }

export function planAuthorMemoryMutation(item: MemoryBrowserItem): AuthorMemoryMutationPlan {
  const normalized = validateMemoryBrowserItem(item)
  if (normalized.state === 'archived') return { action: 'deny', reason: '已归档记忆不能编辑，请先恢复。' }
  if (normalized.state === 'conflicted') return { action: 'deny', reason: '记忆存在未解决冲突，请先处理冲突候选。' }
  if (normalized.origin === 'derived') {
    return {
      action: 'create-user-override',
      sourceItemId: normalized.id,
      sourceRevisionId: normalized.currentRevisionId,
    }
  }
  return { action: 'append-revision' }
}

export interface CreateAuthorOverrideInput {
  itemId: string
  revisionId: string
  sourceLinkId: string
  stableKey: string
  title: string
  category: Exclude<MemoryCategory, 'summary'>
  content: string
  structuredJson?: string | null
  storage?: MemoryStorage
  promptPolicy?: MemoryPromptPolicy
  createdAt: string
}

export interface AuthorMemoryOverride {
  readonly item: Readonly<MemoryBrowserItem>
  readonly revision: Readonly<MemoryBrowserRevision>
  readonly source: Readonly<MemoryBrowserSource>
}

export function createAuthorMemoryOverride(
  sourceItem: MemoryBrowserItem,
  input: CreateAuthorOverrideInput,
): Readonly<AuthorMemoryOverride> {
  const source = validateMemoryBrowserItem(sourceItem)
  if (source.origin !== 'derived') throw new MemoryBrowserError('invalid-state', '只有派生记忆需要创建作者覆盖项。')
  if (source.state === 'archived') throw new MemoryBrowserError('invalid-state', '已归档派生记忆不能创建覆盖项。')
  const category = enumValue(input.category, ['constraint', 'continuity', 'idea', 'research', 'other'] as const, 'override.category')
  const revision = createInitialMemoryRevision({
    id: input.revisionId,
    itemId: input.itemId,
    content: input.content,
    structuredJson: input.structuredJson,
    actor: 'user',
    changeNote: `覆盖派生记忆：${source.title}`,
    createdAt: input.createdAt,
  })
  const item = validateMemoryBrowserItem({
    id: input.itemId,
    projectId: source.projectId,
    origin: 'user',
    storage: input.storage ?? 'database',
    stableKey: input.stableKey,
    scope: source.scope,
    targetId: source.targetId,
    title: input.title,
    category,
    state: 'active',
    promptPolicy: input.promptPolicy ?? defaultMemoryPromptPolicy('user', category),
    currentRevision: 1,
    currentRevisionId: revision.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
  const sourceLink = validateMemoryBrowserSource({
    id: input.sourceLinkId,
    revisionId: revision.id,
    kind: 'memory-revision',
    sourceId: source.id,
    sourceVersionId: source.currentRevisionId,
    label: source.title,
    contentHash: null,
    relativePath: null,
    position: 0,
  })
  return Object.freeze({ item, revision, source: sourceLink })
}

export const MEMORY_PROMPT_AUTHORITY_PRIORITY = {
  'approved-foundation': 120,
  'current-canon': 119,
  'approved-continuity': 118,
  'derived-foundation': 116,
  'user-constraint': 115,
  'derived-project': 114,
  'derived-book': 112,
  'derived-volume': 110,
  'derived-arc': 108,
  'derived-chapter': 106,
  'user-reference': 72,
  'historical-reference': 54,
} as const

export const MEMORY_PROMPT_AUTHORITIES = Object.keys(MEMORY_PROMPT_AUTHORITY_PRIORITY) as MemoryPromptAuthority[]
export type MemoryPromptAuthority = keyof typeof MEMORY_PROMPT_AUTHORITY_PRIORITY

export interface MemoryPromptCandidate {
  readonly id: string
  readonly authority: MemoryPromptAuthority
  readonly updatedAt: string
}

export function memoryPromptAuthority(item: MemoryBrowserItem): MemoryPromptAuthority {
  const normalized = validateMemoryBrowserItem(item)
  if (normalized.state !== 'active') return 'historical-reference'
  if (normalized.origin === 'user') {
    return normalized.category === 'constraint' || normalized.category === 'continuity'
      ? 'user-constraint'
      : 'user-reference'
  }
  switch (normalized.scope) {
    case 'foundation': return 'derived-foundation'
    case 'project': return 'derived-project'
    case 'book': return 'derived-book'
    case 'volume': return 'derived-volume'
    case 'arc': return 'derived-arc'
    case 'chapter': return 'derived-chapter'
  }
}

export function memoryPromptEligible(item: MemoryBrowserItem, explicitlySelected = false): boolean {
  const normalized = validateMemoryBrowserItem(item)
  if (normalized.state !== 'active' || normalized.promptPolicy === 'never') return false
  if (normalized.promptPolicy === 'manual') return explicitlySelected
  return true
}

export function memoryPromptCandidate(item: MemoryBrowserItem): Readonly<MemoryPromptCandidate> {
  const normalized = validateMemoryBrowserItem(item)
  return Object.freeze({
    id: normalized.id,
    authority: memoryPromptAuthority(normalized),
    updatedAt: normalized.updatedAt,
  })
}

export function compareMemoryPromptCandidates(left: MemoryPromptCandidate, right: MemoryPromptCandidate): number {
  const leftAuthority = MEMORY_PROMPT_AUTHORITY_PRIORITY[enumValue(left.authority, MEMORY_PROMPT_AUTHORITIES, 'candidate.authority')]
  const rightAuthority = MEMORY_PROMPT_AUTHORITY_PRIORITY[enumValue(right.authority, MEMORY_PROMPT_AUTHORITIES, 'candidate.authority')]
  if (leftAuthority !== rightAuthority) return rightAuthority - leftAuthority
  const timeOrder = Date.parse(timestamp(right.updatedAt, 'candidate.updatedAt')) - Date.parse(timestamp(left.updatedAt, 'candidate.updatedAt'))
  if (timeOrder !== 0) return timeOrder
  return requiredText(left.id, 'candidate.id', 200).localeCompare(requiredText(right.id, 'candidate.id', 200))
}

export type MarkdownMemoryOwnership = 'user' | 'derived-mirror'
export type MarkdownThreeWayAction =
  | 'clean'
  | 'register-file'
  | 'write-new-file'
  | 'import-file'
  | 'export-database'
  | 'preserve-database'
  | 'capture-author-override'
  | 'conflict'

export interface MarkdownThreeWayInput {
  ownership: MarkdownMemoryOwnership
  baseHash: string | null
  databaseHash: string | null
  filesystemHash: string | null
}

export interface MarkdownThreeWayDecision {
  readonly action: MarkdownThreeWayAction
  readonly databaseChanged: boolean
  readonly filesystemChanged: boolean
  readonly reason: string
}

export function decideMarkdownMemorySync(input: MarkdownThreeWayInput): Readonly<MarkdownThreeWayDecision> {
  const ownership = enumValue(input.ownership, ['user', 'derived-mirror'] as const, 'ownership')
  const baseHash = nullableHash(input.baseHash, 'baseHash')
  const databaseHash = nullableHash(input.databaseHash, 'databaseHash')
  const filesystemHash = nullableHash(input.filesystemHash, 'filesystemHash')
  const databaseChanged = databaseHash !== baseHash
  const filesystemChanged = filesystemHash !== baseHash
  const decision = (action: MarkdownThreeWayAction, reason: string): Readonly<MarkdownThreeWayDecision> => Object.freeze({
    action,
    databaseChanged,
    filesystemChanged,
    reason,
  })

  if (baseHash === null) {
    if (databaseHash === null && filesystemHash === null) return decision('clean', '数据库与文件均无内容。')
    if (databaseHash === null && filesystemHash !== null) {
      return ownership === 'derived-mirror'
        ? decision('capture-author-override', '未登记的派生镜像改动必须另存为作者覆盖项。')
        : decision('register-file', '发现新的作者 Markdown 文件。')
    }
    if (databaseHash !== null && filesystemHash === null) return decision('write-new-file', '数据库作者记忆尚未建立 Markdown 文件。')
    if (databaseHash === filesystemHash) return decision('clean', '数据库与文件一致，可登记共同基线。')
    return decision('conflict', '数据库与文件都存在，但没有共同基线。')
  }

  if (databaseHash === null) return decision('conflict', '已登记记忆的数据库副本缺失，不能自动删除或导入。')
  if (filesystemHash === null) return decision('preserve-database', 'Markdown 文件缺失；保留数据库内容并等待作者处理。')
  if (databaseHash === filesystemHash) return decision('clean', '数据库与文件内容一致。')
  if (!databaseChanged && filesystemChanged) {
    return ownership === 'derived-mirror'
      ? decision('capture-author-override', '作者修改了派生镜像，必须创建独立作者覆盖项。')
      : decision('import-file', '仅 Markdown 文件发生变化。')
  }
  if (databaseChanged && !filesystemChanged) return decision('export-database', '仅数据库内容发生变化。')
  if (ownership === 'derived-mirror') {
    return decision('capture-author-override', '派生数据库与镜像同时变化；保留派生版本并捕获作者覆盖。')
  }
  return decision('conflict', '数据库与 Markdown 文件都偏离共同基线，必须人工选择。')
}

interface InternalRevisionInput extends CreateMemoryRevisionInput {
  revision: number
  parentRevisionId: string | null
  restoredFromRevisionId: string | null
  contentHash?: string
}

function makeRevision(input: InternalRevisionInput): Readonly<MemoryBrowserRevision> {
  const content = contentValue(input.content)
  const structuredJson = structuredJsonValue(input.structuredJson ?? null)
  const generatedHash = memoryContentHash(content)
  const suppliedHash = input.contentHash === undefined ? generatedHash : normalizeHash(input.contentHash, 'revision.contentHash')
  const revision: MemoryBrowserRevision = {
    id: requiredText(input.id, 'revision.id', 200),
    itemId: requiredText(input.itemId, 'revision.itemId', 200),
    revision: boundedInteger(input.revision, 'revision.revision', 1, MEMORY_BROWSER_MAX_REVISION),
    parentRevisionId: optionalText(input.parentRevisionId, 'revision.parentRevisionId', 200),
    kind: enumValue(input.kind ?? 'committed', MEMORY_REVISION_KINDS, 'revision.kind'),
    content,
    structuredJson,
    contentHash: suppliedHash,
    actor: enumValue(input.actor, MEMORY_REVISION_ACTORS, 'revision.actor'),
    provider: optionalText(input.provider, 'revision.provider', 200),
    model: optionalText(input.model, 'revision.model', 200),
    promptHash: input.promptHash === null || input.promptHash === undefined ? null : normalizeHash(input.promptHash, 'revision.promptHash'),
    workflowRunId: optionalText(input.workflowRunId, 'revision.workflowRunId', 200),
    restoredFromRevisionId: optionalText(input.restoredFromRevisionId, 'revision.restoredFromRevisionId', 200),
    changeNote: optionalText(input.changeNote, 'revision.changeNote', 500),
    createdAt: timestamp(input.createdAt, 'revision.createdAt'),
  }
  return Object.freeze(revision)
}

function contentValue(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw validation('记忆正文不能为空。')
  if (Buffer.byteLength(value, 'utf8') > MEMORY_BROWSER_MAX_CONTENT_BYTES) {
    throw validation(`单个记忆正文不能超过 ${MEMORY_BROWSER_MAX_CONTENT_BYTES} 字节。`)
  }
  if (hasForbiddenControl(value, true)) throw validation('记忆正文包含不允许的控制字符。')
  return value
}

function structuredJsonValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw validation('structuredJson 必须是 JSON 字符串或 null。')
  if (Buffer.byteLength(value, 'utf8') > MEMORY_BROWSER_MAX_STRUCTURED_JSON_BYTES) {
    throw validation(`structuredJson 不能超过 ${MEMORY_BROWSER_MAX_STRUCTURED_JSON_BYTES} 字节。`)
  }
  try {
    JSON.parse(value)
  } catch {
    throw validation('structuredJson 不是有效 JSON。')
  }
  return value
}

function tokenizeSearchQuery(query: string): string[] {
  const terms: string[] = []
  let buffer = ''
  let quoted = false
  const push = () => {
    const value = buffer.trim().replace(/\s+/g, ' ')
    if (value) terms.push(value)
    buffer = ''
  }
  for (const character of query) {
    if (character === '"') {
      if (quoted) {
        push()
        quoted = false
      } else {
        push()
        quoted = true
      }
    } else if (/\s/u.test(character) && !quoted) {
      push()
    } else {
      buffer += character
    }
  }
  if (quoted) throw validation('搜索词中的双引号没有闭合。')
  push()
  return terms
}

function optionalSearchText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw validation('query.q 必须是字符串。')
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  return requiredSearchText(normalized)
}

function requiredSearchText(value: string): string {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized) throw validation('搜索词不能为空。')
  if (normalized.length > MEMORY_BROWSER_MAX_QUERY_LENGTH) {
    throw validation(`搜索词不能超过 ${MEMORY_BROWSER_MAX_QUERY_LENGTH} 个字符。`)
  }
  if (hasForbiddenControl(normalized, false)) throw validation('搜索词包含不允许的控制字符。')
  return normalized
}

function enumList<const T extends readonly string[]>(raw: unknown, allowed: T, field: string): readonly T[number][] {
  if (raw === undefined || raw === null || raw === '') return []
  const values = typeof raw === 'string' ? raw.split(',') : raw
  if (!Array.isArray(values)) throw validation(`${field} 必须是数组或逗号分隔字符串。`)
  if (values.length > 32) throw validation(`${field} 最多包含 32 项。`)
  return [...new Set(values.map(value => enumValue(typeof value === 'string' ? value.trim() : value, allowed, field)))]
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw validation(`${field} 必须是以下值之一：${allowed.join('、')}。`)
  }
  return value as T[number]
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw validation(`${field} 必须是字符串。`)
  const normalized = value.trim()
  if (!normalized) throw validation(`${field} 不能为空。`)
  if (normalized.length > maxLength) throw validation(`${field} 不能超过 ${maxLength} 个字符。`)
  if (hasForbiddenControl(normalized, false)) throw validation(`${field} 包含不允许的控制字符。`)
  return normalized
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return requiredText(value, field, maxLength)
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw validation(`${field} 必须是 ${minimum} 到 ${maximum} 之间的安全整数。`)
  }
  return value
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw validation(`${field} 必须是布尔值。`)
  return value
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw validation(`${field} 必须是有效时间。`)
  }
  return value
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw validation(`${field} 必须是对象。`)
  return value as Record<string, unknown>
}

function nullableHash(value: unknown, field: string): string | null {
  return value === null ? null : normalizeHash(value, field)
}

function normalizeHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw validation(`${field} 必须是 SHA-256 哈希。`)
  return value.toLowerCase()
}

function safeRelativePath(value: unknown): string {
  const path = requiredText(value, 'source.relativePath', 500).replaceAll('\\', '/')
  if (path.startsWith('/') || /^[a-zA-Z]:\//.test(path) || path.startsWith('//')) {
    throw validation('source.relativePath 不能是绝对路径。')
  }
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw validation('source.relativePath 必须是规范的项目内相对路径。')
  }
  return segments.join('/')
}

function hasForbiddenControl(value: string, allowLineBreaks: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code === 0x7f) return true
    if (code < 0x20 && !(allowLineBreaks && (character === '\n' || character === '\r' || character === '\t'))) return true
  }
  return false
}

function validation(message: string): MemoryBrowserError {
  return new MemoryBrowserError('validation', message)
}
