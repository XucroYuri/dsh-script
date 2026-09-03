import { createHash } from 'node:crypto'
import {
  DomainError,
  type ChapterStatus,
  type KnowledgeSummary,
  type ManuscriptOrigin,
  type ManuscriptStatus,
  type MemoryCategory,
  type MemoryPromptPolicy,
  type ProjectFoundationKind,
  type ProjectTree,
  type RelationshipCategory,
  type RelationshipFactLayer,
  type StoryEntityType,
  type StyleProfileAttributes,
  type WritingStyleProfile,
} from './model.js'

export const MAX_PROJECT_TEXT_BYTES = 32 * 1024 * 1024
export const MAX_PORTABLE_REQUEST_BYTES = 72 * 1024 * 1024
export const PORTABLE_PROJECT_FORMAT = 'novel-studio-project'
export const PORTABLE_PROJECT_SCHEMA_VERSION_V1 = 1
export const PORTABLE_PROJECT_SCHEMA_VERSION = 2

/**
 * These sections are intentionally outside the portable-project contract.
 * A portable snapshot is an allowlisted migration artifact, not a database
 * backup. In particular, no runnable or machine-local state may cross hosts.
 */
export const PORTABLE_PROJECT_V2_EXCLUDED_SECTIONS = Object.freeze([
  'batches',
  'workflows',
  'modelRuns',
  'relationshipCandidates',
  'relationshipExtractionRuns',
  'derivedMemories',
  'memoryUsages',
  'memoryFileBindings',
  'memoryConflicts',
] as const)

const MAX_BOOKS = 100
const MAX_VOLUMES = 1_000
const MAX_CHAPTERS = 20_000
const MAX_MANUSCRIPT_VERSIONS = 100_000
const MAX_FOUNDATION_VERSIONS = 10_000
const MAX_AUTHOR_MEMORIES = 50_000
const MAX_MEMORY_REVISIONS = 250_000
const MAX_MEMORY_SOURCES = 500_000
const MAX_RELATIONSHIP_ENTITIES = 100_000
const MAX_RELATIONSHIPS = 250_000
const MAX_RELATIONSHIP_EVIDENCE = 500_000
const MAX_TITLE_LENGTH = 500
const MAX_SHORT_TEXT_LENGTH = 4_000
const MAX_STORY_ORDER = 1_000_000_000
// These values are persisted in INTEGER columns and some are incremented after
// restore. A valid project cannot approach Number.MAX_SAFE_INTEGER in practice;
// rejecting extreme counters prevents overflow and pathological ordering gaps.
const MAX_REVISION = 10_000_000
const MAX_POSITION = 1_000_000
const MAX_CHAPTER_NUMBER = 10_000_000
const MAX_FOUNDATION_VERSION = 1_000_000

export type ManuscriptImportFormat = 'markdown' | 'txt'

export interface ManuscriptImportInput {
  format: ManuscriptImportFormat
  sourceName: string
  content: string
  title?: string
  language?: string
  genre?: string
  audience?: string
  targetWordCount?: number
  chapterTargetWords?: number
}

export interface ParsedManuscriptChapter {
  title: string
  content: string
}

export interface ParsedManuscriptImport {
  title: string
  normalizedContent: string
  sourceHash: string
  sourceName: string
  chapters: ParsedManuscriptChapter[]
  warnings: string[]
}

export interface ProjectImportResult {
  project: ProjectTree
  chapterIds: string[]
  sourceName: string
  sourceHash: string
  importedAt: string
  warnings: string[]
}

export interface ProjectExportFile {
  fileName: string
  mimeType: 'text/markdown; charset=utf-8' | 'application/json; charset=utf-8'
  content: string
}

export interface PortableManuscriptVersionV1 {
  key: string
  parentVersionKey: string | null
  status: ManuscriptStatus
  content: string
  contentHash: string
  wordCount: number
  origin: ManuscriptOrigin
  createdBy: 'user' | 'model'
  createdAt: string
  approvedAt: string | null
}

export interface PortableChapterV1 {
  key: string
  volumeKey: string | null
  chapterNumber: number
  title: string
  status: ChapterStatus
  currentDraftVersionKey: string | null
  currentApprovedVersionKey: string | null
  revision: number
  createdAt: string
  updatedAt: string
  versions: PortableManuscriptVersionV1[]
}

export interface PortableVolumeV1 {
  key: string
  title: string
  position: number
  createdAt: string
}

export interface PortableBookV1 {
  key: string
  title: string
  position: number
  createdAt: string
  volumes: PortableVolumeV1[]
  chapters: PortableChapterV1[]
}

export interface PortableFoundationVersionV1 {
  key: string
  kind: Extract<ProjectFoundationKind, 'outline' | 'characters' | 'timeline'>
  version: number
  title: string
  content: string
  contentHash: string
  status: 'draft' | 'approved' | 'superseded'
  provider: string
  model: string
  promptVersion: string
  promptHash: string
  dependencyVersionKeys: string[]
  createdAt: string
  approvedAt: string | null
}

export interface PortableWritingStyleProfileV1 {
  presetId: string | null
  source: WritingStyleProfile['source']
  name: string
  summary: string
  attributes: StyleProfileAttributes
  sampleHash: string | null
  revision: number
}

export interface PortableProjectSnapshotV1 {
  format: typeof PORTABLE_PROJECT_FORMAT
  schemaVersion: typeof PORTABLE_PROJECT_SCHEMA_VERSION_V1
  exportedAt: string
  project: {
    title: string
    language: string
    genre: string | null
    audience: string | null
    targetWordCount: number | null
    chapterTargetWords: number | null
    revision: number
    currentBookKey: string
  }
  projectRules: {
    styleRules: string
    chapterGoal: string
    forbiddenContent: string
    revision: number
  }
  styleProfile: PortableWritingStyleProfileV1
  books: PortableBookV1[]
  foundations: PortableFoundationVersionV1[]
}

export interface PortableManuscriptVersionReferenceV2 {
  chapterKey: string
  versionKey: string
}

export interface PortableMemorySourceV2 {
  key: string
  sourceType: string
  /** Portable object key or project-relative reference; never a database ID or absolute path. */
  sourceKey: string
  sourceVersionKey: string | null
  label: string
  createdAt: string
}

export interface PortableAuthorMemoryRevisionV2 {
  key: string
  revision: number
  content: string
  structuredJson: string
  contentHash: string
  actor: 'model' | 'user' | 'filesystem' | 'migration'
  parentRevisionKey: string | null
  provider: string | null
  model: string | null
  promptHash: string | null
  createdAt: string
  sources: PortableMemorySourceV2[]
}

/**
 * Only author-owned memory is portable. Model-derived summaries can be rebuilt
 * from the approved project content and are deliberately omitted from v2.
 * Markdown paths, conflict candidates and ModelRun usage rows are omitted too.
 */
export interface PortableAuthorMemoryV2 {
  key: string
  origin: 'user'
  scope: KnowledgeSummary['scope']
  category: MemoryCategory
  state: 'active' | 'archived'
  promptPolicy: MemoryPromptPolicy
  sourceKey: string
  revision: number
  currentRevisionKey: string
  createdAt: string
  updatedAt: string
  revisions: PortableAuthorMemoryRevisionV2[]
}

export interface PortableRelationshipEntityV2 {
  key: string
  type: StoryEntityType
  name: string
  aliases: string[]
  description: string
  sourceManuscriptVersion: PortableManuscriptVersionReferenceV2 | null
  createdAt: string
  updatedAt: string
}

export interface PortableRelationshipEvidenceV2 {
  key: string
  sourceType: string
  /** Portable object key or project-relative reference; never a database ID or absolute path. */
  sourceKey: string
  sourceVersionKey: string | null
  label: string
  excerptStart: number | null
  excerptEnd: number | null
  contentHash: string
  createdAt: string
}

/** Formal, confirmed relationship history. Candidate and extraction-run state is never portable. */
export interface PortableEntityRelationshipV2 {
  key: string
  sourceEntityKey: string
  targetEntityKey: string
  predicateKey: string
  label: string
  category: RelationshipCategory
  directionality: 'directed' | 'symmetric'
  factLayer: RelationshipFactLayer
  validFromStoryOrder: number | null
  validToStoryOrder: number | null
  status: 'active' | 'superseded'
  supersedesRelationshipKey: string | null
  createdBy: 'user' | 'ai_confirmed' | 'ai_yolo'
  revision: number
  createdAt: string
  updatedAt: string
  evidence: PortableRelationshipEvidenceV2[]
}

export interface PortableProjectSnapshotV2 extends Omit<PortableProjectSnapshotV1, 'schemaVersion'> {
  schemaVersion: typeof PORTABLE_PROJECT_SCHEMA_VERSION
  authorMemories: PortableAuthorMemoryV2[]
  relationshipEntities: PortableRelationshipEntityV2[]
  relationships: PortableEntityRelationshipV2[]
}

export type PortableProjectSnapshot = PortableProjectSnapshotV1 | PortableProjectSnapshotV2

type UnknownRecord = Record<string, unknown>

interface SourceHeading {
  line: number
  level: number
  title: string
  chapterLike: boolean
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function cleanTitle(value: string): string {
  return value.replace(/\s+#+\s*$/, '').replace(/\s+/g, ' ').trim()
}

function sourceStem(sourceName: string): string {
  const name = sourceName.split(/[\\/]/).at(-1)?.trim() ?? ''
  return cleanTitle(name.replace(/\.(?:md|markdown|txt)$/i, '')) || '导入作品'
}

function isChapterHeading(title: string): boolean {
  const normalized = cleanTitle(title)
  return /^(?:第\s*[零〇一二三四五六七八九十百千万两\d]+\s*[章节回篇幕集部]|序章|楔子|引子|前言|后记|尾声|终章|番外(?:\s*[零〇一二三四五六七八九十百千万两\d]+)?)/u.test(normalized)
    || /^(?:(?:chapter|chap\.?|part)\s+(?:\d+|[ivxlcdm]+)|prologue|epilogue|preface|afterword)(?:\s|[:：._—-]|$)/iu.test(normalized)
}

function isPlainChapterHeading(title: string): boolean {
  const normalized = cleanTitle(title)
  return normalized.length <= 160 && isChapterHeading(normalized) && !/[。！？!?；;]$/.test(normalized)
}

function trimBlock(value: string): string {
  return value.replace(/^\n+|\n+$/g, '')
}

function normalizedSource(input: ManuscriptImportInput): string {
  if (typeof input.content !== 'string') throw new DomainError('validation', '导入内容必须是文本。')
  if (utf8Bytes(input.content) > MAX_PROJECT_TEXT_BYTES) throw new DomainError('validation', '正文总量不能超过 32 MB。')
  const content = input.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (content.includes('\0')) throw new DomainError('validation', '文件包含二进制空字符，不能作为小说正文导入。')
  if (!content.trim()) throw new DomainError('validation', '导入文件没有可用正文。')
  if (utf8Bytes(content) > MAX_PROJECT_TEXT_BYTES) throw new DomainError('validation', '正文总量不能超过 32 MB。')
  return content
}

function markdownHeadings(lines: string[]): SourceHeading[] {
  const headings: SourceHeading[] = []
  for (let line = 0; line < lines.length; line += 1) {
    const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(lines[line]!)
    if (match) {
      const title = cleanTitle(match[2]!)
      if (title) headings.push({ line, level: match[1]!.length, title, chapterLike: isChapterHeading(title) })
      continue
    }
    const plainTitle = cleanTitle(lines[line]!)
    if (isPlainChapterHeading(plainTitle)) headings.push({ line, level: 7, title: plainTitle, chapterLike: true })
  }
  return headings
}

function txtHeadings(lines: string[]): SourceHeading[] {
  const headings: SourceHeading[] = []
  for (let line = 0; line < lines.length; line += 1) {
    const title = cleanTitle(lines[line]!)
    if (title && isPlainChapterHeading(title)) headings.push({ line, level: 1, title, chapterLike: true })
  }
  return headings
}

function splitCandidates(format: ManuscriptImportFormat, headings: SourceHeading[]): SourceHeading[] {
  const explicit = headings.filter(heading => heading.chapterLike)
  if (explicit.length > 0 || format === 'txt') return explicit
  const documentTitle = headings.find(heading => heading.level === 1)
  const remaining = headings.filter(heading => heading !== documentTitle)
  for (let level = 1; level <= 6; level += 1) {
    const sameLevel = remaining.filter(heading => heading.level === level)
    if (sameLevel.length >= 2) return sameLevel
  }
  return []
}

export function parseManuscriptImport(input: ManuscriptImportInput): ParsedManuscriptImport {
  if (input.format !== 'markdown' && input.format !== 'txt') throw new DomainError('validation', '导入格式只支持 Markdown 或 TXT。')
  if (typeof input.sourceName !== 'string' || !input.sourceName.trim()) throw new DomainError('validation', '请提供导入文件名。')
  const content = normalizedSource(input)
  const lines = content.split('\n')
  const headings = input.format === 'markdown' ? markdownHeadings(lines) : txtHeadings(lines)
  const documentTitle = input.format === 'markdown' ? headings.find(heading => heading.level === 1 && !heading.chapterLike) : undefined
  const title = cleanTitle(input.title ?? '') || documentTitle?.title || sourceStem(input.sourceName)
  if (!title || title.length > MAX_TITLE_LENGTH) throw new DomainError('validation', `作品名不能为空且不能超过 ${MAX_TITLE_LENGTH} 个字符。`)
  const candidates = splitCandidates(input.format, headings)
  const warnings: string[] = []
  let chapters: ParsedManuscriptChapter[]

  if (candidates.length === 0) {
    const bodyLines = documentTitle ? lines.filter((_, index) => index !== documentTitle.line) : lines
    const body = trimBlock(bodyLines.join('\n'))
    if (!body.trim()) throw new DomainError('validation', '导入文件只有标题，没有可用正文。')
    chapters = [{ title: '正文', content: body }]
    warnings.push('未识别到章节标题，已作为单章导入。')
  } else {
    const preambleLines = lines.slice(0, candidates[0]!.line)
    if (documentTitle && documentTitle.line < candidates[0]!.line) preambleLines.splice(documentTitle.line, 1)
    const preamble = trimBlock(preambleLines.join('\n'))
    chapters = candidates.map((heading, index) => {
      if (heading.title.length > MAX_TITLE_LENGTH) throw new DomainError('validation', `第 ${index + 1} 个章节标题过长。`)
      const nextLine = candidates[index + 1]?.line ?? lines.length
      let chapterContent = trimBlock(lines.slice(heading.line + 1, nextLine).join('\n'))
      if (index === 0 && preamble) chapterContent = `${preamble}\n\n${chapterContent}`.trimEnd()
      return { title: heading.title, content: chapterContent }
    })
    if (preamble) warnings.push('首章标题前的前言内容已并入第一章。')
  }

  if (chapters.length > MAX_CHAPTERS) throw new DomainError('validation', `一次最多导入 ${MAX_CHAPTERS} 章。`)
  const totalBytes = chapters.reduce((sum, chapter) => sum + utf8Bytes(chapter.content), 0)
  if (totalBytes > MAX_PROJECT_TEXT_BYTES) throw new DomainError('validation', '正文总量不能超过 32 MB。')
  return {
    title,
    normalizedContent: content,
    sourceHash: sha256(content),
    sourceName: input.sourceName.trim(),
    chapters,
    warnings,
  }
}

function printableChapterTitle(chapterNumber: number, title: string): string {
  const clean = cleanTitle(title) || `第${chapterNumber}章`
  return isChapterHeading(clean) ? clean : `第${chapterNumber}章 ${clean}`
}

export function renderProjectMarkdown(projectTitle: string, chapters: Array<{ chapterNumber: number; title: string; content: string }>): string {
  const blocks = [`# ${cleanTitle(projectTitle) || '未命名作品'}`]
  for (const chapter of chapters) {
    blocks.push(`## ${printableChapterTitle(chapter.chapterNumber, chapter.title)}`)
    blocks.push(chapter.content.replace(/\r\n?/g, '\n').replace(/\n+$/g, ''))
  }
  return `${blocks.join('\n\n')}\n`
}

export function safeExportFileStem(title: string): string {
  const stem = cleanTitle(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120)
  return stem || 'novel-studio-project'
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('validation', `${label} 必须是对象。`)
  return value as UnknownRecord
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new DomainError('validation', `${label} 必须是数组。`)
  if (value.length > max) throw new DomainError('validation', `${label} 数量超过上限 ${max}。`)
  return value
}

function text(value: unknown, label: string, max = MAX_SHORT_TEXT_LENGTH, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new DomainError('validation', `${label} 必须是${allowEmpty ? '' : '非空'}文本。`)
  if (value.length > max) throw new DomainError('validation', `${label} 过长。`)
  if (value.includes('\0')) throw new DomainError('validation', `${label} 包含无效空字符。`)
  return value
}

function nullableText(value: unknown, label: string, max = MAX_SHORT_TEXT_LENGTH): string | null {
  if (value === null) return null
  return text(value, label, max, true)
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DomainError('validation', `${label} 必须是 ${minimum} 到 ${maximum} 之间的整数。`)
  }
  return value
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label)
}

function nullableBoundedInteger(value: unknown, label: string, minimum: number, maximum: number): number | null {
  return value === null ? null : integer(value, label, minimum, maximum)
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!Number.isFinite(Date.parse(result))) throw new DomainError('validation', `${label} 不是有效时间。`)
  return result
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new DomainError('validation', `${label} 的值不受支持。`)
  return value as T
}

function hash(value: unknown, content: string, label: string): string {
  const result = text(value, label, 64)
  if (!/^[a-f0-9]{64}$/i.test(result) || result.toLowerCase() !== sha256(content)) throw new DomainError('validation', `${label} 与内容不一致。`)
  return result.toLowerCase()
}

function sha256Hash(value: unknown, label: string, allowEmpty = false): string {
  const result = text(value, label, 64, allowEmpty)
  if (allowEmpty && result === '') return result
  if (!/^[a-f0-9]{64}$/i.test(result)) throw new DomainError('validation', `${label} 必须是 SHA-256 哈希。`)
  return result.toLowerCase()
}

function validJson(value: unknown, label: string, addBytes: (value: string) => void): string {
  const result = text(value, label, MAX_PROJECT_TEXT_BYTES, true)
  try { JSON.parse(result) } catch { throw new DomainError('validation', `${label} 不是有效 JSON。`) }
  addBytes(result)
  return result
}

function key(value: unknown, label: string): string {
  return text(value, label, 160)
}

function stringList(value: unknown, label: string, max: number, itemMax = MAX_SHORT_TEXT_LENGTH): string[] {
  return array(value, label, max).map((item, index) => text(item, `${label}[${index}]`, itemMax, true))
}

function manuscriptVersionReference(value: unknown, label: string): PortableManuscriptVersionReferenceV2 {
  const input = record(value, label)
  return {
    chapterKey: key(input.chapterKey, `${label}.chapterKey`),
    versionKey: key(input.versionKey, `${label}.versionKey`),
  }
}

function manuscriptVersionReferenceKey(reference: PortableManuscriptVersionReferenceV2): string {
  return `${reference.chapterKey.length}:${reference.chapterKey}${reference.versionKey}`
}

function styleAttributes(value: unknown, addBytes: (value: string) => void): StyleProfileAttributes {
  const input = record(value, 'styleProfile.attributes')
  const field = (name: keyof Omit<StyleProfileAttributes, 'expansionRules' | 'avoid'>): string => {
    const result = text(input[name], `styleProfile.attributes.${name}`, MAX_SHORT_TEXT_LENGTH, true)
    addBytes(result)
    return result
  }
  const expansionRules = stringList(input.expansionRules, 'styleProfile.attributes.expansionRules', 100)
  const avoid = stringList(input.avoid, 'styleProfile.attributes.avoid', 100)
  for (const item of [...expansionRules, ...avoid]) addBytes(item)
  return {
    narrativeVoice: field('narrativeVoice'), pointOfView: field('pointOfView'), tense: field('tense'), sentenceRhythm: field('sentenceRhythm'),
    paragraphRhythm: field('paragraphRhythm'), dialogueStyle: field('dialogueStyle'), descriptionStyle: field('descriptionStyle'), emotionalCadence: field('emotionalCadence'),
    pacing: field('pacing'), imagery: field('imagery'), expansionRules, avoid,
  }
}

function assertNoParentCycle(versions: PortableManuscriptVersionV1[], label: string): void {
  assertNoReferenceCycle(versions.map(version => ({ key: version.key, parentKey: version.parentVersionKey })), label, '版本父链')
}

function assertNoReferenceCycle(
  entries: ReadonlyArray<{ key: string; parentKey: string | null }>,
  label: string,
  relationshipLabel: string,
): void {
  const parents = new Map<string, string | null>()
  for (const entry of entries) parents.set(entry.key, entry.parentKey)
  const state = new Map<string, 'visiting' | 'complete'>()
  for (const entry of entries) {
    if (state.get(entry.key) === 'complete') continue
    const path: string[] = []
    let cursor: string | null = entry.key
    while (cursor !== null) {
      const currentState = state.get(cursor)
      if (currentState === 'visiting') throw new DomainError('validation', `${label} 的${relationshipLabel}存在循环。`)
      if (currentState === 'complete') break
      state.set(cursor, 'visiting')
      path.push(cursor)
      cursor = parents.get(cursor) ?? null
    }
    for (const item of path) state.set(item, 'complete')
  }
}

export function normalizePortableProjectSnapshot(value: unknown): PortableProjectSnapshot {
  let raw: unknown = value
  if (typeof raw === 'string') {
    if (utf8Bytes(raw) > MAX_PORTABLE_REQUEST_BYTES) throw new DomainError('validation', '项目快照文件过大。')
    try { raw = JSON.parse(raw) as unknown } catch { throw new DomainError('validation', '项目快照不是有效 JSON。') }
  }
  const input = record(raw, '项目快照')
  const schemaVersion = input.schemaVersion
  if (input.format !== PORTABLE_PROJECT_FORMAT || (schemaVersion !== PORTABLE_PROJECT_SCHEMA_VERSION_V1 && schemaVersion !== PORTABLE_PROJECT_SCHEMA_VERSION)) {
    throw new DomainError('validation', `仅支持 ${PORTABLE_PROJECT_FORMAT} schema ${PORTABLE_PROJECT_SCHEMA_VERSION_V1} 或 ${PORTABLE_PROJECT_SCHEMA_VERSION}。`)
  }

  let totalTextBytes = 0
  const addBytes = (content: string): void => {
    totalTextBytes += utf8Bytes(content)
    if (totalTextBytes > MAX_PROJECT_TEXT_BYTES) throw new DomainError('validation', '项目快照内的正文与设定总量不能超过 32 MB。')
  }

  const projectInput = record(input.project, 'project')
  const project = {
    title: text(projectInput.title, 'project.title', MAX_TITLE_LENGTH),
    language: text(projectInput.language, 'project.language', 64),
    genre: nullableText(projectInput.genre, 'project.genre', MAX_TITLE_LENGTH),
    audience: nullableText(projectInput.audience, 'project.audience', MAX_TITLE_LENGTH),
    targetWordCount: nullableInteger(projectInput.targetWordCount, 'project.targetWordCount'),
    chapterTargetWords: nullableInteger(projectInput.chapterTargetWords, 'project.chapterTargetWords'),
    revision: integer(projectInput.revision, 'project.revision', 0, MAX_REVISION),
    currentBookKey: key(projectInput.currentBookKey, 'project.currentBookKey'),
  }
  addBytes(project.title)

  const rulesInput = record(input.projectRules, 'projectRules')
  const projectRules = {
    styleRules: text(rulesInput.styleRules, 'projectRules.styleRules', MAX_PROJECT_TEXT_BYTES, true),
    chapterGoal: text(rulesInput.chapterGoal, 'projectRules.chapterGoal', MAX_PROJECT_TEXT_BYTES, true),
    forbiddenContent: text(rulesInput.forbiddenContent, 'projectRules.forbiddenContent', MAX_PROJECT_TEXT_BYTES, true),
    revision: integer(rulesInput.revision, 'projectRules.revision', 0, MAX_REVISION),
  }
  addBytes(projectRules.styleRules); addBytes(projectRules.chapterGoal); addBytes(projectRules.forbiddenContent)

  const styleInput = record(input.styleProfile, 'styleProfile')
  const styleProfile: PortableWritingStyleProfileV1 = {
    presetId: nullableText(styleInput.presetId, 'styleProfile.presetId', 160),
    source: oneOf(styleInput.source, ['builtin', 'extracted', 'user'] as const, 'styleProfile.source'),
    name: text(styleInput.name, 'styleProfile.name', MAX_TITLE_LENGTH),
    summary: text(styleInput.summary, 'styleProfile.summary', MAX_SHORT_TEXT_LENGTH, true),
    attributes: styleAttributes(styleInput.attributes, addBytes),
    sampleHash: nullableText(styleInput.sampleHash, 'styleProfile.sampleHash', 128),
    revision: integer(styleInput.revision, 'styleProfile.revision', 0, MAX_REVISION),
  }
  addBytes(styleProfile.name); addBytes(styleProfile.summary)

  const bookKeys = new Set<string>(), volumeKeys = new Set<string>(), chapterKeys = new Set<string>(), bookPositions = new Set<number>()
  let volumeCount = 0, chapterCount = 0, manuscriptVersionCount = 0
  const books = array(input.books, 'books', MAX_BOOKS).map((bookValue, bookIndex): PortableBookV1 => {
    const bookInput = record(bookValue, `books[${bookIndex}]`)
    const bookKey = key(bookInput.key, `books[${bookIndex}].key`)
    if (bookKeys.has(bookKey)) throw new DomainError('validation', `重复的 book key：${bookKey}`)
    bookKeys.add(bookKey)
    const bookPosition = integer(bookInput.position, 'book.position', 1, MAX_POSITION)
    if (bookPositions.has(bookPosition)) throw new DomainError('validation', `重复的书册顺序：${bookPosition}`)
    bookPositions.add(bookPosition)
    const localVolumeKeys = new Set<string>(), localVolumePositions = new Set<number>(), localChapterNumbers = new Set<number>()
    const volumes = array(bookInput.volumes, `books[${bookIndex}].volumes`, MAX_VOLUMES).map((volumeValue, volumeIndex): PortableVolumeV1 => {
      volumeCount += 1
      if (volumeCount > MAX_VOLUMES) throw new DomainError('validation', `卷数量超过上限 ${MAX_VOLUMES}。`)
      const volumeInput = record(volumeValue, `books[${bookIndex}].volumes[${volumeIndex}]`)
      const volumeKey = key(volumeInput.key, `books[${bookIndex}].volumes[${volumeIndex}].key`)
      if (volumeKeys.has(volumeKey)) throw new DomainError('validation', `重复的 volume key：${volumeKey}`)
      volumeKeys.add(volumeKey); localVolumeKeys.add(volumeKey)
      const position = integer(volumeInput.position, 'volume.position', 1, MAX_POSITION)
      if (localVolumePositions.has(position)) throw new DomainError('validation', `书册 ${bookKey} 存在重复卷顺序：${position}`)
      localVolumePositions.add(position)
      return { key: volumeKey, title: text(volumeInput.title, 'volume.title', MAX_TITLE_LENGTH), position, createdAt: timestamp(volumeInput.createdAt, 'volume.createdAt') }
    })
    if (volumes.length === 0) throw new DomainError('validation', `书册 ${bookKey} 至少需要一卷，才能在工作区显示章节。`)
    const chapters = array(bookInput.chapters, `books[${bookIndex}].chapters`, MAX_CHAPTERS).map((chapterValue, chapterIndex): PortableChapterV1 => {
      chapterCount += 1
      if (chapterCount > MAX_CHAPTERS) throw new DomainError('validation', `章节数量超过上限 ${MAX_CHAPTERS}。`)
      const chapterInput = record(chapterValue, `books[${bookIndex}].chapters[${chapterIndex}]`)
      const chapterKey = key(chapterInput.key, 'chapter.key')
      if (chapterKeys.has(chapterKey)) throw new DomainError('validation', `重复的 chapter key：${chapterKey}`)
      chapterKeys.add(chapterKey)
      const volumeKey = chapterInput.volumeKey === null ? null : key(chapterInput.volumeKey, 'chapter.volumeKey')
      if (volumeKey !== null && !localVolumeKeys.has(volumeKey)) throw new DomainError('validation', `章节 ${chapterKey} 引用了其他书或不存在的卷。`)
      const versionKeys = new Set<string>()
      const versions = array(chapterInput.versions, `chapter ${chapterKey}.versions`, MAX_MANUSCRIPT_VERSIONS).map((versionValue, versionIndex): PortableManuscriptVersionV1 => {
        manuscriptVersionCount += 1
        if (manuscriptVersionCount > MAX_MANUSCRIPT_VERSIONS) throw new DomainError('validation', `手稿版本数量超过上限 ${MAX_MANUSCRIPT_VERSIONS}。`)
        const versionInput = record(versionValue, `chapter ${chapterKey}.versions[${versionIndex}]`)
        const versionKey = key(versionInput.key, 'manuscriptVersion.key')
        if (versionKeys.has(versionKey)) throw new DomainError('validation', `章节 ${chapterKey} 存在重复版本 key。`)
        versionKeys.add(versionKey)
        const content = text(versionInput.content, 'manuscriptVersion.content', MAX_PROJECT_TEXT_BYTES, true)
        addBytes(content)
        return {
          key: versionKey,
          parentVersionKey: versionInput.parentVersionKey === null ? null : key(versionInput.parentVersionKey, 'manuscriptVersion.parentVersionKey'),
          status: oneOf(versionInput.status, ['draft', 'approved', 'superseded'] as const, 'manuscriptVersion.status'),
          content,
          contentHash: hash(versionInput.contentHash, content, 'manuscriptVersion.contentHash'),
          wordCount: integer(versionInput.wordCount, 'manuscriptVersion.wordCount', 0, MAX_PROJECT_TEXT_BYTES),
          origin: oneOf(versionInput.origin, ['user', 'autosave', 'model'] as const, 'manuscriptVersion.origin'),
          createdBy: oneOf(versionInput.createdBy, ['user', 'model'] as const, 'manuscriptVersion.createdBy'),
          createdAt: timestamp(versionInput.createdAt, 'manuscriptVersion.createdAt'),
          approvedAt: versionInput.approvedAt === null ? null : timestamp(versionInput.approvedAt, 'manuscriptVersion.approvedAt'),
        }
      })
      for (const version of versions) if (version.parentVersionKey !== null && !versionKeys.has(version.parentVersionKey)) throw new DomainError('validation', `章节 ${chapterKey} 的父版本不存在。`)
      assertNoParentCycle(versions, `章节 ${chapterKey}`)
      const currentDraftVersionKey = chapterInput.currentDraftVersionKey === null ? null : key(chapterInput.currentDraftVersionKey, 'chapter.currentDraftVersionKey')
      const currentApprovedVersionKey = chapterInput.currentApprovedVersionKey === null ? null : key(chapterInput.currentApprovedVersionKey, 'chapter.currentApprovedVersionKey')
      if (currentDraftVersionKey !== null && !versionKeys.has(currentDraftVersionKey)) throw new DomainError('validation', `章节 ${chapterKey} 的当前草稿指针无效。`)
      if (currentApprovedVersionKey !== null && !versionKeys.has(currentApprovedVersionKey)) throw new DomainError('validation', `章节 ${chapterKey} 的当前批准指针无效。`)
      if (currentApprovedVersionKey !== null && versions.find(version => version.key === currentApprovedVersionKey)?.status !== 'approved') {
        throw new DomainError('validation', `章节 ${chapterKey} 的当前批准指针没有指向 approved 版本。`)
      }
      const chapterNumber = integer(chapterInput.chapterNumber, 'chapter.chapterNumber', 1, MAX_CHAPTER_NUMBER)
      if (localChapterNumbers.has(chapterNumber)) throw new DomainError('validation', `书册 ${bookKey} 存在重复章节序号：${chapterNumber}`)
      localChapterNumbers.add(chapterNumber)
      return {
        key: chapterKey, volumeKey, chapterNumber, title: text(chapterInput.title, 'chapter.title', MAX_TITLE_LENGTH),
        status: oneOf(chapterInput.status, ['draft', 'approved'] as const, 'chapter.status'), currentDraftVersionKey, currentApprovedVersionKey,
        revision: integer(chapterInput.revision, 'chapter.revision', 0, MAX_REVISION), createdAt: timestamp(chapterInput.createdAt, 'chapter.createdAt'), updatedAt: timestamp(chapterInput.updatedAt, 'chapter.updatedAt'), versions,
      }
    })
    return { key: bookKey, title: text(bookInput.title, 'book.title', MAX_TITLE_LENGTH), position: bookPosition, createdAt: timestamp(bookInput.createdAt, 'book.createdAt'), volumes, chapters }
  })
  if (books.length === 0 || !bookKeys.has(project.currentBookKey)) throw new DomainError('validation', '项目当前书册指针无效。')

  const foundationKeys = new Set<string>(), foundationVersionSlots = new Set<string>(), approvedFoundationKinds = new Set<string>()
  const foundations = array(input.foundations, 'foundations', MAX_FOUNDATION_VERSIONS).map((foundationValue, foundationIndex): PortableFoundationVersionV1 => {
    const foundationInput = record(foundationValue, `foundations[${foundationIndex}]`)
    const foundationKey = key(foundationInput.key, 'foundation.key')
    if (foundationKeys.has(foundationKey)) throw new DomainError('validation', `重复的 foundation key：${foundationKey}`)
    foundationKeys.add(foundationKey)
    const content = text(foundationInput.content, 'foundation.content', MAX_PROJECT_TEXT_BYTES, true)
    addBytes(content)
    const kind = oneOf(foundationInput.kind, ['outline', 'characters', 'timeline'] as const, 'foundation.kind')
    const version = integer(foundationInput.version, 'foundation.version', 1, MAX_FOUNDATION_VERSION)
    const status = oneOf(foundationInput.status, ['draft', 'approved', 'superseded'] as const, 'foundation.status')
    const versionSlot = `${kind}:${version}`
    if (foundationVersionSlots.has(versionSlot)) throw new DomainError('validation', `创作基建存在重复版本：${versionSlot}`)
    foundationVersionSlots.add(versionSlot)
    if (status === 'approved') {
      if (approvedFoundationKinds.has(kind)) throw new DomainError('validation', `${kind} 同时存在多个 approved 版本。`)
      approvedFoundationKinds.add(kind)
    }
    return {
      key: foundationKey,
      kind,
      version,
      title: text(foundationInput.title, 'foundation.title', MAX_TITLE_LENGTH), content, contentHash: hash(foundationInput.contentHash, content, 'foundation.contentHash'),
      status,
      provider: text(foundationInput.provider, 'foundation.provider', 200, true), model: text(foundationInput.model, 'foundation.model', 200, true),
      promptVersion: text(foundationInput.promptVersion, 'foundation.promptVersion', 200, true), promptHash: text(foundationInput.promptHash, 'foundation.promptHash', 256, true),
      dependencyVersionKeys: stringList(foundationInput.dependencyVersionKeys, 'foundation.dependencyVersionKeys', MAX_FOUNDATION_VERSIONS, 160),
      createdAt: timestamp(foundationInput.createdAt, 'foundation.createdAt'), approvedAt: foundationInput.approvedAt === null ? null : timestamp(foundationInput.approvedAt, 'foundation.approvedAt'),
    }
  })
  for (const foundation of foundations) for (const dependency of foundation.dependencyVersionKeys) if (!foundationKeys.has(dependency)) throw new DomainError('validation', `创作基建 ${foundation.key} 的依赖版本不存在。`)

  const base: PortableProjectSnapshotV1 = {
    format: PORTABLE_PROJECT_FORMAT,
    schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION_V1,
    exportedAt: timestamp(input.exportedAt, 'exportedAt'),
    project,
    projectRules,
    styleProfile,
    books,
    foundations,
  }
  if (schemaVersion === PORTABLE_PROJECT_SCHEMA_VERSION_V1) return base

  const manuscriptVersionKeys = new Set<string>()
  for (const book of books) for (const chapter of book.chapters) for (const version of chapter.versions) {
    manuscriptVersionKeys.add(manuscriptVersionReferenceKey({ chapterKey: chapter.key, versionKey: version.key }))
  }
  const { authorMemories, relationshipEntities, relationships } = normalizePortableV2Extensions(input, addBytes, manuscriptVersionKeys)
  return {
    ...base,
    schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION,
    authorMemories,
    relationshipEntities,
    relationships,
  }
}

function normalizePortableV2Extensions(
  input: UnknownRecord,
  addBytes: (value: string) => void,
  manuscriptVersionKeys: ReadonlySet<string>,
): Pick<PortableProjectSnapshotV2, 'authorMemories' | 'relationshipEntities' | 'relationships'> {
  const memoryKeys = new Set<string>()
  const memoryRevisionKeys = new Set<string>()
  const memorySourceKeys = new Set<string>()
  let memoryRevisionCount = 0
  let memorySourceCount = 0
  const authorMemories = array(input.authorMemories, 'authorMemories', MAX_AUTHOR_MEMORIES).map((memoryValue, memoryIndex): PortableAuthorMemoryV2 => {
    const memoryInput = record(memoryValue, `authorMemories[${memoryIndex}]`)
    const memoryKey = key(memoryInput.key, `authorMemories[${memoryIndex}].key`)
    if (memoryKeys.has(memoryKey)) throw new DomainError('validation', `重复的作者记忆 key：${memoryKey}`)
    memoryKeys.add(memoryKey)
    const revisionNumbers = new Set<number>()
    const localRevisionKeys = new Set<string>()
    const revisions = array(memoryInput.revisions, `authorMemories[${memoryIndex}].revisions`, MAX_MEMORY_REVISIONS).map((revisionValue, revisionIndex): PortableAuthorMemoryRevisionV2 => {
      memoryRevisionCount += 1
      if (memoryRevisionCount > MAX_MEMORY_REVISIONS) throw new DomainError('validation', `作者记忆版本数量超过上限 ${MAX_MEMORY_REVISIONS}。`)
      const label = `authorMemories[${memoryIndex}].revisions[${revisionIndex}]`
      const revisionInput = record(revisionValue, label)
      const revisionKey = key(revisionInput.key, `${label}.key`)
      if (memoryRevisionKeys.has(revisionKey)) throw new DomainError('validation', `重复的作者记忆版本 key：${revisionKey}`)
      memoryRevisionKeys.add(revisionKey); localRevisionKeys.add(revisionKey)
      const revision = integer(revisionInput.revision, `${label}.revision`, 1, MAX_REVISION)
      if (revisionNumbers.has(revision)) throw new DomainError('validation', `作者记忆 ${memoryKey} 存在重复版本号 ${revision}。`)
      revisionNumbers.add(revision)
      const content = text(revisionInput.content, `${label}.content`, MAX_PROJECT_TEXT_BYTES)
      addBytes(content)
      const structuredJson = validJson(revisionInput.structuredJson, `${label}.structuredJson`, addBytes)
      const sources = array(revisionInput.sources, `${label}.sources`, MAX_MEMORY_SOURCES).map((sourceValue, sourceIndex): PortableMemorySourceV2 => {
        memorySourceCount += 1
        if (memorySourceCount > MAX_MEMORY_SOURCES) throw new DomainError('validation', `作者记忆来源数量超过上限 ${MAX_MEMORY_SOURCES}。`)
        const sourceLabel = `${label}.sources[${sourceIndex}]`
        const sourceInput = record(sourceValue, sourceLabel)
        const sourceKey = key(sourceInput.key, `${sourceLabel}.key`)
        if (memorySourceKeys.has(sourceKey)) throw new DomainError('validation', `重复的作者记忆来源 key：${sourceKey}`)
        memorySourceKeys.add(sourceKey)
        const result = {
          key: sourceKey,
          sourceType: text(sourceInput.sourceType, `${sourceLabel}.sourceType`, 160),
          sourceKey: portableSourceKey(sourceInput.sourceKey, `${sourceLabel}.sourceKey`),
          sourceVersionKey: sourceInput.sourceVersionKey === null ? null : portableSourceKey(sourceInput.sourceVersionKey, `${sourceLabel}.sourceVersionKey`),
          label: text(sourceInput.label, `${sourceLabel}.label`, MAX_TITLE_LENGTH, true),
          createdAt: timestamp(sourceInput.createdAt, `${sourceLabel}.createdAt`),
        }
        addBytes(result.label)
        return result
      })
      return {
        key: revisionKey,
        revision,
        content,
        structuredJson,
        contentHash: hash(revisionInput.contentHash, content, `${label}.contentHash`),
        actor: oneOf(revisionInput.actor, ['model', 'user', 'filesystem', 'migration'] as const, `${label}.actor`),
        parentRevisionKey: revisionInput.parentRevisionKey === null ? null : key(revisionInput.parentRevisionKey, `${label}.parentRevisionKey`),
        provider: nullableText(revisionInput.provider, `${label}.provider`, 200),
        model: nullableText(revisionInput.model, `${label}.model`, 200),
        promptHash: nullableText(revisionInput.promptHash, `${label}.promptHash`, 256),
        createdAt: timestamp(revisionInput.createdAt, `${label}.createdAt`),
        sources,
      }
    })
    if (revisions.length === 0) throw new DomainError('validation', `作者记忆 ${memoryKey} 至少需要一个不可变版本。`)
    const revisionsByNumber = new Map(revisions.map(revision => [revision.revision, revision]))
    for (let revisionNumber = 1; revisionNumber <= revisions.length; revisionNumber += 1) {
      const revision = revisionsByNumber.get(revisionNumber)
      if (!revision) throw new DomainError('validation', `作者记忆 ${memoryKey} 的版本号必须从 1 连续递增。`)
      if (revisionNumber === 1 && revision.parentRevisionKey !== null) throw new DomainError('validation', `作者记忆 ${memoryKey} 的首个版本不能有父版本。`)
      if (revisionNumber > 1) {
        const previous = revisionsByNumber.get(revisionNumber - 1)!
        if (revision.parentRevisionKey !== previous.key) throw new DomainError('validation', `作者记忆 ${memoryKey} 的版本 ${revisionNumber} 必须指向紧邻前一版本。`)
        if (Date.parse(revision.createdAt) < Date.parse(previous.createdAt)) throw new DomainError('validation', `作者记忆 ${memoryKey} 的版本时间必须按 revision 递增。`)
      }
      for (const source of revision.sources) if (Date.parse(source.createdAt) < Date.parse(revision.createdAt)) {
        throw new DomainError('validation', `作者记忆 ${memoryKey} 的来源时间不能早于所属版本。`)
      }
    }
    for (const revision of revisions) if (revision.parentRevisionKey !== null && !localRevisionKeys.has(revision.parentRevisionKey)) {
      throw new DomainError('validation', `作者记忆 ${memoryKey} 的父版本不存在。`)
    }
    assertNoReferenceCycle(revisions.map(revision => ({ key: revision.key, parentKey: revision.parentRevisionKey })), `作者记忆 ${memoryKey}`, '版本父链')
    const currentRevisionKey = key(memoryInput.currentRevisionKey, `authorMemories[${memoryIndex}].currentRevisionKey`)
    const currentRevision = revisions.find(revision => revision.key === currentRevisionKey)
    if (!currentRevision || currentRevision.revision !== revisions.length) throw new DomainError('validation', `作者记忆 ${memoryKey} 的当前版本指针无效。`)
    const createdAt = timestamp(memoryInput.createdAt, `authorMemories[${memoryIndex}].createdAt`)
    const updatedAt = timestamp(memoryInput.updatedAt, `authorMemories[${memoryIndex}].updatedAt`)
    if (Date.parse(createdAt) > Date.parse(updatedAt)) throw new DomainError('validation', `作者记忆 ${memoryKey} 的创建时间不能晚于更新时间。`)
    if (Date.parse(currentRevision.createdAt) > Date.parse(updatedAt)) throw new DomainError('validation', `作者记忆 ${memoryKey} 的更新时间不能早于当前版本。`)
    const revision = integer(memoryInput.revision, `authorMemories[${memoryIndex}].revision`, 1, MAX_REVISION)
    if (revision < currentRevision.revision) throw new DomainError('validation', `作者记忆 ${memoryKey} 的条目 revision 不能落后于当前内容版本。`)
    return {
      key: memoryKey,
      origin: oneOf(memoryInput.origin, ['user'] as const, `authorMemories[${memoryIndex}].origin`),
      scope: oneOf(memoryInput.scope, ['foundation', 'chapter', 'arc', 'volume', 'book', 'project'] as const, `authorMemories[${memoryIndex}].scope`),
      category: oneOf(memoryInput.category, ['continuity', 'constraint', 'character', 'world', 'timeline', 'foreshadowing', 'idea', 'research', 'other'] as const, `authorMemories[${memoryIndex}].category`),
      state: oneOf(memoryInput.state, ['active', 'archived'] as const, `authorMemories[${memoryIndex}].state`),
      promptPolicy: oneOf(memoryInput.promptPolicy, ['auto', 'manual', 'excluded'] as const, `authorMemories[${memoryIndex}].promptPolicy`),
      sourceKey: portableSourceKey(memoryInput.sourceKey, `authorMemories[${memoryIndex}].sourceKey`),
      revision,
      currentRevisionKey,
      createdAt,
      updatedAt,
      revisions,
    }
  })

  const entityKeys = new Set<string>()
  const relationshipEntities = array(input.relationshipEntities, 'relationshipEntities', MAX_RELATIONSHIP_ENTITIES).map((entityValue, entityIndex): PortableRelationshipEntityV2 => {
    const label = `relationshipEntities[${entityIndex}]`
    const entityInput = record(entityValue, label)
    const entityKey = key(entityInput.key, `${label}.key`)
    if (entityKeys.has(entityKey)) throw new DomainError('validation', `重复的关系实体 key：${entityKey}`)
    entityKeys.add(entityKey)
    const aliases = array(entityInput.aliases, `${label}.aliases`, 100).map((alias, aliasIndex) => text(alias, `${label}.aliases[${aliasIndex}]`, MAX_TITLE_LENGTH))
    const aliasIndex = new Set<string>()
    for (const alias of aliases) {
      const normalized = alias.normalize('NFKC').trim().toLocaleLowerCase()
      if (aliasIndex.has(normalized)) throw new DomainError('validation', `关系实体 ${entityKey} 存在重复别名。`)
      aliasIndex.add(normalized); addBytes(alias)
    }
    const description = text(entityInput.description, `${label}.description`, MAX_PROJECT_TEXT_BYTES, true)
    addBytes(description)
    const sourceManuscriptVersion = entityInput.sourceManuscriptVersion === null ? null : manuscriptVersionReference(entityInput.sourceManuscriptVersion, `${label}.sourceManuscriptVersion`)
    if (sourceManuscriptVersion && !manuscriptVersionKeys.has(manuscriptVersionReferenceKey(sourceManuscriptVersion))) {
      throw new DomainError('validation', `关系实体 ${entityKey} 引用的手稿版本不存在。`)
    }
    const createdAt = timestamp(entityInput.createdAt, `${label}.createdAt`)
    const updatedAt = timestamp(entityInput.updatedAt, `${label}.updatedAt`)
    if (Date.parse(createdAt) > Date.parse(updatedAt)) throw new DomainError('validation', `关系实体 ${entityKey} 的创建时间不能晚于更新时间。`)
    const name = text(entityInput.name, `${label}.name`, MAX_TITLE_LENGTH)
    addBytes(name)
    return {
      key: entityKey,
      type: oneOf(entityInput.type, ['character', 'location', 'faction', 'item', 'ability', 'species', 'organization', 'concept', 'rule'] as const, `${label}.type`),
      name,
      aliases,
      description,
      sourceManuscriptVersion,
      createdAt,
      updatedAt,
    }
  })

  const relationshipKeys = new Set<string>()
  const evidenceKeys = new Set<string>()
  let evidenceCount = 0
  const relationships = array(input.relationships, 'relationships', MAX_RELATIONSHIPS).map((relationshipValue, relationshipIndex): PortableEntityRelationshipV2 => {
    const label = `relationships[${relationshipIndex}]`
    const relationshipInput = record(relationshipValue, label)
    const relationshipKey = key(relationshipInput.key, `${label}.key`)
    if (relationshipKeys.has(relationshipKey)) throw new DomainError('validation', `重复的正式关系 key：${relationshipKey}`)
    relationshipKeys.add(relationshipKey)
    const sourceEntityKey = key(relationshipInput.sourceEntityKey, `${label}.sourceEntityKey`)
    const targetEntityKey = key(relationshipInput.targetEntityKey, `${label}.targetEntityKey`)
    if (sourceEntityKey === targetEntityKey) throw new DomainError('validation', `正式关系 ${relationshipKey} 不能连接同一实体。`)
    const validFromStoryOrder = nullableBoundedInteger(relationshipInput.validFromStoryOrder, `${label}.validFromStoryOrder`, 0, MAX_STORY_ORDER)
    const validToStoryOrder = nullableBoundedInteger(relationshipInput.validToStoryOrder, `${label}.validToStoryOrder`, 0, MAX_STORY_ORDER)
    if (validFromStoryOrder !== null && validToStoryOrder !== null && validFromStoryOrder > validToStoryOrder) {
      throw new DomainError('validation', `正式关系 ${relationshipKey} 的有效章节区间无效。`)
    }
    const evidence = array(relationshipInput.evidence, `${label}.evidence`, MAX_RELATIONSHIP_EVIDENCE).map((evidenceValue, evidenceIndex): PortableRelationshipEvidenceV2 => {
      evidenceCount += 1
      if (evidenceCount > MAX_RELATIONSHIP_EVIDENCE) throw new DomainError('validation', `关系证据数量超过上限 ${MAX_RELATIONSHIP_EVIDENCE}。`)
      const evidenceLabel = `${label}.evidence[${evidenceIndex}]`
      const evidenceInput = record(evidenceValue, evidenceLabel)
      const evidenceKey = key(evidenceInput.key, `${evidenceLabel}.key`)
      if (evidenceKeys.has(evidenceKey)) throw new DomainError('validation', `重复的关系证据 key：${evidenceKey}`)
      evidenceKeys.add(evidenceKey)
      const excerptStart = nullableBoundedInteger(evidenceInput.excerptStart, `${evidenceLabel}.excerptStart`, 0, MAX_PROJECT_TEXT_BYTES)
      const excerptEnd = nullableBoundedInteger(evidenceInput.excerptEnd, `${evidenceLabel}.excerptEnd`, 0, MAX_PROJECT_TEXT_BYTES)
      if ((excerptStart === null) !== (excerptEnd === null) || (excerptStart !== null && excerptEnd !== null && excerptStart > excerptEnd)) {
        throw new DomainError('validation', `关系证据 ${evidenceKey} 的摘录区间无效。`)
      }
      const evidenceName = text(evidenceInput.label, `${evidenceLabel}.label`, MAX_TITLE_LENGTH, true)
      addBytes(evidenceName)
      return {
        key: evidenceKey,
        sourceType: text(evidenceInput.sourceType, `${evidenceLabel}.sourceType`, 160),
        sourceKey: portableSourceKey(evidenceInput.sourceKey, `${evidenceLabel}.sourceKey`),
        sourceVersionKey: evidenceInput.sourceVersionKey === null ? null : portableSourceKey(evidenceInput.sourceVersionKey, `${evidenceLabel}.sourceVersionKey`),
        label: evidenceName,
        excerptStart,
        excerptEnd,
        contentHash: sha256Hash(evidenceInput.contentHash, `${evidenceLabel}.contentHash`),
        createdAt: timestamp(evidenceInput.createdAt, `${evidenceLabel}.createdAt`),
      }
    })
    const createdAt = timestamp(relationshipInput.createdAt, `${label}.createdAt`)
    const updatedAt = timestamp(relationshipInput.updatedAt, `${label}.updatedAt`)
    if (Date.parse(createdAt) > Date.parse(updatedAt)) throw new DomainError('validation', `正式关系 ${relationshipKey} 的创建时间不能晚于更新时间。`)
    return {
      key: relationshipKey,
      sourceEntityKey,
      targetEntityKey,
      predicateKey: text(relationshipInput.predicateKey, `${label}.predicateKey`, 200),
      label: text(relationshipInput.label, `${label}.label`, MAX_TITLE_LENGTH),
      category: oneOf(relationshipInput.category, ['family', 'emotion', 'alliance', 'conflict', 'membership', 'possession', 'location', 'knowledge', 'causality', 'other'] as const, `${label}.category`),
      directionality: oneOf(relationshipInput.directionality, ['directed', 'symmetric'] as const, `${label}.directionality`),
      factLayer: oneOf(relationshipInput.factLayer, ['planned', 'canon', 'author_asserted'] as const, `${label}.factLayer`),
      validFromStoryOrder,
      validToStoryOrder,
      status: oneOf(relationshipInput.status, ['active', 'superseded'] as const, `${label}.status`),
      supersedesRelationshipKey: relationshipInput.supersedesRelationshipKey === null ? null : key(relationshipInput.supersedesRelationshipKey, `${label}.supersedesRelationshipKey`),
      createdBy: oneOf(relationshipInput.createdBy, ['user', 'ai_confirmed', 'ai_yolo'] as const, `${label}.createdBy`),
      revision: integer(relationshipInput.revision, `${label}.revision`, 1, MAX_REVISION),
      createdAt,
      updatedAt,
      evidence,
    }
  })

  const usedEntityKeys = new Set<string>()
  const supersededBy = new Map<string, string>()
  const relationshipByKey = new Map(relationships.map(relationship => [relationship.key, relationship]))
  const activeFingerprints = new Set<string>()
  for (const relationship of relationships) {
    if (!entityKeys.has(relationship.sourceEntityKey) || !entityKeys.has(relationship.targetEntityKey)) {
      throw new DomainError('validation', `正式关系 ${relationship.key} 引用了不存在的实体。`)
    }
    usedEntityKeys.add(relationship.sourceEntityKey); usedEntityKeys.add(relationship.targetEntityKey)
    if (relationship.supersedesRelationshipKey !== null) {
      const parent = relationshipByKey.get(relationship.supersedesRelationshipKey)
      if (!parent) throw new DomainError('validation', `正式关系 ${relationship.key} 引用的被修订关系不存在。`)
      if (supersededBy.has(parent.key)) throw new DomainError('validation', `正式关系 ${parent.key} 同时被多个关系修订。`)
      if (parent.status !== 'superseded') throw new DomainError('validation', `被修订关系 ${parent.key} 必须标记为 superseded。`)
      if (relationship.revision !== parent.revision + 1) throw new DomainError('validation', `正式关系 ${relationship.key} 的 revision 必须紧接被修订关系。`)
      if (Date.parse(relationship.createdAt) < Date.parse(parent.createdAt)) throw new DomainError('validation', `正式关系 ${relationship.key} 的创建时间不能早于被修订关系。`)
      supersededBy.set(parent.key, relationship.key)
    } else if (relationship.revision !== 1) {
      throw new DomainError('validation', `正式关系 ${relationship.key} 没有前序关系时 revision 必须为 1。`)
    }
    if (relationship.status === 'active') {
      const fingerprint = portableRelationshipFingerprint(relationship)
      if (activeFingerprints.has(fingerprint)) throw new DomainError('validation', `存在重复的 active 正式关系：${relationship.key}`)
      activeFingerprints.add(fingerprint)
    }
    for (const evidence of relationship.evidence) if (Date.parse(evidence.createdAt) < Date.parse(relationship.createdAt)) {
      throw new DomainError('validation', `正式关系 ${relationship.key} 的证据时间不能早于关系创建时间。`)
    }
  }
  for (const relationship of relationships) {
    if (relationship.status === 'active' && supersededBy.has(relationship.key)) throw new DomainError('validation', `active 正式关系 ${relationship.key} 不能已经被修订。`)
    if (relationship.status === 'superseded' && !supersededBy.has(relationship.key)) throw new DomainError('validation', `superseded 正式关系 ${relationship.key} 缺少后续修订版本。`)
  }
  assertNoReferenceCycle(relationships.map(relationship => ({ key: relationship.key, parentKey: relationship.supersedesRelationshipKey })), '正式关系', '修订链')
  for (const entity of relationshipEntities) if (!usedEntityKeys.has(entity.key)) {
    throw new DomainError('validation', `关系实体 ${entity.key} 未被任何正式关系引用，不能进入可携带快照。`)
  }

  return { authorMemories, relationshipEntities, relationships }
}

function portableSourceKey(value: unknown, label: string): string {
  const result = text(value, label, 500)
  if (/^(?:[a-z]:[\\/]|[\\/]{1,2}|file:\/\/)/iu.test(result) || /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(result)) {
    throw new DomainError('validation', `${label} 不能包含机器绝对路径或路径跳转。`)
  }
  return result
}

function portableRelationshipFingerprint(relationship: PortableEntityRelationshipV2): string {
  let source = relationship.sourceEntityKey
  let target = relationship.targetEntityKey
  if (relationship.directionality === 'symmetric' && source > target) [source, target] = [target, source]
  return JSON.stringify([
    relationship.directionality,
    source,
    target,
    relationship.predicateKey.normalize('NFKC').trim().toLocaleLowerCase(),
    relationship.factLayer,
    relationship.validFromStoryOrder,
    relationship.validToStoryOrder,
  ])
}
