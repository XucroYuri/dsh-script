import { describe, expect, it } from 'vitest'
import {
  advanceMemoryItem,
  appendMemoryRevision,
  assertMemoryRevisionIntegrity,
  buildMemoryFtsQuery,
  compareMemoryPromptCandidates,
  createAuthorMemoryOverride,
  createInitialMemoryRevision,
  decideMarkdownMemorySync,
  defaultMemoryPromptPolicy,
  memoryContentHash,
  memoryPromptCandidate,
  memoryPromptEligible,
  normalizeMemoryBrowserQuery,
  planAuthorMemoryMutation,
  restoreMemoryRevision,
  validateMemoryBrowserItem,
  validateMemoryBrowserSource,
  validateMemoryBrowserUsage,
  type MemoryBrowserItem,
} from '../src/domain/memory-browser.js'

const CREATED_AT = '2026-08-27T08:00:00.000Z'
const UPDATED_AT = '2026-08-27T09:00:00.000Z'

function derivedItem(overrides: Partial<MemoryBrowserItem> = {}): MemoryBrowserItem {
  return {
    id: 'memory-derived-1',
    projectId: 'project-1',
    origin: 'derived',
    storage: 'database',
    stableKey: 'chapter:chapter-1:summary',
    scope: 'chapter',
    targetId: 'chapter-1',
    title: '第一章摘要',
    category: 'summary',
    state: 'active',
    promptPolicy: 'auto',
    currentRevision: 1,
    currentRevisionId: 'revision-derived-1',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

function userItem(overrides: Partial<MemoryBrowserItem> = {}): MemoryBrowserItem {
  return {
    id: 'memory-user-1',
    projectId: 'project-1',
    origin: 'user',
    storage: 'database',
    stableKey: 'user:constraint:moon',
    scope: 'project',
    targetId: null,
    title: '月亮设定',
    category: 'constraint',
    state: 'active',
    promptPolicy: 'auto',
    currentRevision: 1,
    currentRevisionId: 'revision-user-1',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('memory browser query and FTS contract', () => {
  it('normalizes filters, deduplicates values, and supplies bounded pagination defaults', () => {
    const query = normalizeMemoryBrowserQuery({
      q: '  红色   月亮  ',
      origins: 'user,derived,user',
      scopes: ['chapter', 'project'],
      categories: ['constraint'],
      used: 'unused',
      limit: 50,
    })

    expect(query).toMatchObject({
      q: '红色 月亮',
      origins: ['user', 'derived'],
      scopes: ['chapter', 'project'],
      categories: ['constraint'],
      used: 'unused',
      sort: 'relevance',
      limit: 50,
    })
    expect(Object.isFrozen(query.origins)).toBe(true)
    expect(normalizeMemoryBrowserQuery({ sort: 'relevance' }).sort).toBe('updated-desc')
  })

  it('rejects unknown filters, unsafe controls, and excessive page sizes', () => {
    expect(() => normalizeMemoryBrowserQuery({ origins: ['external'] })).toThrow(/query\.origins/)
    expect(() => normalizeMemoryBrowserQuery({ q: 'moon\u0000secret' })).toThrow(/控制字符/)
    expect(() => normalizeMemoryBrowserQuery({ limit: 101 })).toThrow(/query\.limit/)
  })

  it('turns human search into literal FTS phrases and an escaped LIKE fallback', () => {
    const query = buildMemoryFtsQuery('"红色 月亮" OR 100%_')

    expect(query.terms).toEqual(['红色 月亮', 'OR', '100%_'])
    expect(query.matchExpression).toBe('"红色 月亮" AND "OR" AND "100%_"')
    expect(query.fallbackLikePattern).toBe('%红色 月亮 OR 100\\%\\_%')
    expect(query.escapeCharacter).toBe('\\')
    expect(() => buildMemoryFtsQuery('"没有闭合')).toThrow(/没有闭合/)
  })
})

describe('memory browser item, source, and usage invariants', () => {
  it('keeps derived memory database-owned and prevents user notes from impersonating summaries', () => {
    expect(validateMemoryBrowserItem(derivedItem())).toMatchObject({ origin: 'derived', category: 'summary' })
    expect(() => validateMemoryBrowserItem(derivedItem({ storage: 'markdown' }))).toThrow(/权威副本必须保存在数据库/)
    expect(() => validateMemoryBrowserItem(derivedItem({ category: 'constraint' }))).toThrow(/必须使用 summary/)
    expect(() => validateMemoryBrowserItem(userItem({ category: 'summary' }))).toThrow(/不能伪装/)
    expect(defaultMemoryPromptPolicy('user', 'research')).toBe('manual')
    expect(defaultMemoryPromptPolicy('user', 'continuity')).toBe('auto')
  })

  it('allows only project-relative Markdown provenance paths', () => {
    const source = validateMemoryBrowserSource({
      id: 'source-1',
      revisionId: 'revision-1',
      kind: 'markdown-file',
      sourceId: 'memory/moon.md',
      sourceVersionId: null,
      label: '月亮设定',
      contentHash: memoryContentHash('月亮'),
      relativePath: 'memory/project/moon.md',
      position: 0,
    })
    expect(source.relativePath).toBe('memory/project/moon.md')
    expect(() => validateMemoryBrowserSource({ ...source, relativePath: 'C:\\Secrets\\moon.md' })).toThrow(/绝对路径/)
    expect(() => validateMemoryBrowserSource({ ...source, relativePath: '../moon.md' })).toThrow(/项目内相对路径/)
  })

  it('records exact prompt usage without allowing contradictory audit flags', () => {
    const usage = validateMemoryBrowserUsage({
      id: 'usage-1',
      projectId: 'project-1',
      itemId: 'memory-1',
      revisionId: 'revision-1',
      modelRunId: 'run-1',
      sectionKey: 'memory:user-constraint',
      included: true,
      truncated: true,
      reason: 'budget',
      authority: 'user-constraint',
      estimatedTokens: 120,
      createdAt: CREATED_AT,
    })
    expect(usage.truncated).toBe(true)
    expect(() => validateMemoryBrowserUsage({ ...usage, included: false })).toThrow(/truncated/)
    expect(() => validateMemoryBrowserUsage({ ...usage, truncated: false, reason: 'stale' })).toThrow(/只能标记/)
  })
})

describe('immutable memory revision history', () => {
  it('appends with optimistic concurrency, preserves old revisions, and advances the item pointer explicitly', () => {
    const first = createInitialMemoryRevision({
      id: 'revision-1',
      itemId: 'memory-user-1',
      content: '月亮原本是白色。',
      structuredJson: '{"moon":"white"}',
      actor: 'user',
      createdAt: CREATED_AT,
    })
    const second = appendMemoryRevision(first, {
      id: 'revision-2',
      expectedRevision: 1,
      content: '月亮必须是红色。',
      structuredJson: '{"moon":"red"}',
      actor: 'user',
      changeNote: '锁定视觉设定',
      createdAt: UPDATED_AT,
    })

    expect(Object.isFrozen(first)).toBe(true)
    expect(first).toMatchObject({ revision: 1, parentRevisionId: null, content: '月亮原本是白色。' })
    expect(second).toMatchObject({ revision: 2, parentRevisionId: 'revision-1', content: '月亮必须是红色。' })
    expect(second.contentHash).toBe(memoryContentHash(second.content))
    expect(advanceMemoryItem(userItem(), second)).toMatchObject({ currentRevision: 2, currentRevisionId: 'revision-2' })
    expect(() => appendMemoryRevision(first, {
      id: 'revision-conflict',
      expectedRevision: 2,
      content: '冲突更新',
      actor: 'user',
      createdAt: UPDATED_AT,
    })).toThrow(/预期版本 2/)
  })

  it('restores history by creating a new immutable revision instead of moving the pointer backward', () => {
    const first = createInitialMemoryRevision({
      id: 'revision-1', itemId: 'memory-user-1', content: '第一版', actor: 'user', createdAt: CREATED_AT,
    })
    const second = appendMemoryRevision(first, {
      id: 'revision-2', expectedRevision: 1, content: '第二版', actor: 'user', createdAt: UPDATED_AT,
    })
    const restored = restoreMemoryRevision(second, first, {
      id: 'revision-3', expectedRevision: 2, createdAt: '2026-08-27T10:00:00.000Z',
    })

    expect(restored).toMatchObject({
      revision: 3,
      parentRevisionId: 'revision-2',
      restoredFromRevisionId: 'revision-1',
      actor: 'restore',
      content: '第一版',
    })
    expect(second.content).toBe('第二版')
    expect(assertMemoryRevisionIntegrity(restored).contentHash).toBe(memoryContentHash('第一版'))
  })

  it('detects corrupt hashes and refuses to restore a conflict candidate', () => {
    const first = createInitialMemoryRevision({
      id: 'revision-1', itemId: 'memory-user-1', content: '第一版', actor: 'user', createdAt: CREATED_AT,
    })
    const candidate = appendMemoryRevision(first, {
      id: 'revision-candidate',
      expectedRevision: 1,
      content: '文件冲突候选',
      actor: 'filesystem',
      kind: 'conflict-candidate',
      createdAt: UPDATED_AT,
    })
    expect(() => assertMemoryRevisionIntegrity({ ...first, contentHash: memoryContentHash('被篡改') })).toThrow(/不一致/)
    expect(() => advanceMemoryItem(userItem(), candidate)).toThrow(/冲突候选版本不能成为/)
    expect(() => restoreMemoryRevision(first, candidate, {
      id: 'revision-2', expectedRevision: 1, createdAt: UPDATED_AT,
    })).toThrow(/冲突候选版本不能直接恢复/)
  })
})

describe('author override and prompt authority', () => {
  it('creates a separately sourced user item when an author edits derived memory', () => {
    expect(planAuthorMemoryMutation(derivedItem())).toEqual({
      action: 'create-user-override',
      sourceItemId: 'memory-derived-1',
      sourceRevisionId: 'revision-derived-1',
    })
    expect(planAuthorMemoryMutation(userItem())).toEqual({ action: 'append-revision' })
    expect(planAuthorMemoryMutation(userItem({ state: 'archived' })).action).toBe('deny')

    const override = createAuthorMemoryOverride(derivedItem(), {
      itemId: 'memory-override-1',
      revisionId: 'revision-override-1',
      sourceLinkId: 'source-override-1',
      stableKey: 'user:override:chapter-1',
      title: '第一章作者校正',
      category: 'continuity',
      content: '主角左手受伤，不是右手。',
      createdAt: UPDATED_AT,
    })
    expect(override.item).toMatchObject({ origin: 'user', category: 'continuity', promptPolicy: 'auto' })
    expect(override.source).toMatchObject({
      kind: 'memory-revision', sourceId: 'memory-derived-1', sourceVersionId: 'revision-derived-1',
    })
    expect(override.revision.actor).toBe('user')
  })

  it('keeps Canon and approved foundation above memory, then sorts deterministically by recency', () => {
    const candidates = [
      memoryPromptCandidate(derivedItem({ id: 'chapter', scope: 'chapter' })),
      memoryPromptCandidate(derivedItem({ id: 'foundation', scope: 'foundation' })),
      memoryPromptCandidate(userItem({ id: 'constraint' })),
      { id: 'canon', authority: 'current-canon' as const, updatedAt: CREATED_AT },
      { id: 'approved-foundation', authority: 'approved-foundation' as const, updatedAt: CREATED_AT },
    ].sort(compareMemoryPromptCandidates)

    expect(candidates.map(candidate => candidate.id)).toEqual([
      'approved-foundation', 'canon', 'foundation', 'constraint', 'chapter',
    ])
    expect(memoryPromptEligible(userItem({ category: 'research', promptPolicy: 'manual' }))).toBe(false)
    expect(memoryPromptEligible(userItem({ category: 'research', promptPolicy: 'manual' }), true)).toBe(true)
    expect(memoryPromptEligible(derivedItem({ state: 'stale' }))).toBe(false)
    expect(memoryPromptEligible(userItem({ promptPolicy: 'never' }), true)).toBe(false)
  })
})

describe('Markdown three-way hash decisions', () => {
  const base = memoryContentHash('base')
  const database = memoryContentHash('database edit')
  const filesystem = memoryContentHash('filesystem edit')

  it('imports or exports when only one author-owned side changes', () => {
    expect(decideMarkdownMemorySync({ ownership: 'user', baseHash: base, databaseHash: base, filesystemHash: filesystem }).action)
      .toBe('import-file')
    expect(decideMarkdownMemorySync({ ownership: 'user', baseHash: base, databaseHash: database, filesystemHash: base }).action)
      .toBe('export-database')
    expect(decideMarkdownMemorySync({ ownership: 'user', baseHash: base, databaseHash: database, filesystemHash: filesystem }).action)
      .toBe('conflict')
  })

  it('never writes an edited derived mirror back into the derived item', () => {
    expect(decideMarkdownMemorySync({
      ownership: 'derived-mirror', baseHash: base, databaseHash: base, filesystemHash: filesystem,
    }).action).toBe('capture-author-override')
    expect(decideMarkdownMemorySync({
      ownership: 'derived-mirror', baseHash: base, databaseHash: database, filesystemHash: filesystem,
    }).action).toBe('capture-author-override')
  })

  it('handles discovery and deletion conservatively and validates every hash', () => {
    expect(decideMarkdownMemorySync({ ownership: 'user', baseHash: null, databaseHash: null, filesystemHash: filesystem }).action)
      .toBe('register-file')
    expect(decideMarkdownMemorySync({ ownership: 'user', baseHash: null, databaseHash: database, filesystemHash: null }).action)
      .toBe('write-new-file')
    expect(decideMarkdownMemorySync({ ownership: 'user', baseHash: base, databaseHash: database, filesystemHash: null }).action)
      .toBe('preserve-database')
    expect(() => decideMarkdownMemorySync({
      ownership: 'user', baseHash: 'not-a-hash', databaseHash: database, filesystemHash: filesystem,
    })).toThrow(/SHA-256/)
  })
})
