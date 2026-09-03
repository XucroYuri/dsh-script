import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  MemoryBrowserPage,
  MemoryCategory,
  MemoryConflict,
  MemoryItem,
  MemoryItemState,
  MemoryOrigin,
  MemoryPromptPolicy,
  MemoryRevision,
  MemoryRevisionDiff,
  MemoryRevisionHistoryEntry,
  MemoryStorage,
  MemoryUsagePage,
} from '../domain/model.js'

export type NovelClientRequest = <T>(path: string, init?: RequestInit) => Promise<T>

export interface MemoryBrowserPanelProps {
  projectId: string
  projectRevision: number
  archived?: boolean
  narrow?: boolean
  request: NovelClientRequest
  onProjectChanged?: () => void | Promise<void>
}

type MemoryFilter = {
  q: string
  origin: '' | MemoryOrigin
  scope: '' | MemoryItem['scope']
  category: '' | MemoryCategory
  state: '' | MemoryItemState
  storage: '' | MemoryStorage
  promptPolicy: '' | MemoryPromptPolicy
  used: '' | 'used' | 'unused'
}

type MemoryRevisionsResponse = { items?: MemoryRevisionHistoryEntry[]; revisions?: MemoryRevisionHistoryEntry[]; limited?: boolean }
type MemoryRescanResponse = { changed: number; conflicts: MemoryConflict[] }
type DetailTab = 'content' | 'history' | 'sources' | 'usage'

const emptyFilter: MemoryFilter = { q: '', origin: '', scope: '', category: '', state: '', storage: '', promptPolicy: '', used: '' }

export function MemoryBrowserPanel({ projectId, projectRevision, archived = false, narrow = false, request, onProjectChanged }: MemoryBrowserPanelProps) {
  const [filter, setFilter] = useState<MemoryFilter>(emptyFilter)
  const [page, setPage] = useState<MemoryBrowserPage | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<MemoryItem | null>(null)
  const [revisions, setRevisions] = useState<MemoryRevisionHistoryEntry[]>([])
  const [historyLimited, setHistoryLimited] = useState(false)
  const [conflicts, setConflicts] = useState<MemoryConflict[]>([])
  const [scanBusy, setScanBusy] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTab>('content')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value)
    params.set('limit', '60')
    return params.toString()
  }, [filter])

  const loadList = useCallback(async (quiet = false, cursor?: string) => {
    const requestId = ++listRequestRef.current
    if (cursor) setLoadingMore(true)
    else if (!quiet) setLoading(true)
    try {
      const next = await request<MemoryBrowserPage>(`/projects/${encodeURIComponent(projectId)}/memory?${queryString}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      if (requestId !== listRequestRef.current) return
      setPage(current => cursor && current ? {
        ...next,
        items: [...new Map([...current.items, ...next.items].map(item => [item.id, item])).values()],
      } : next)
      setError(null)
      if (!cursor) setSelectedId(current => {
        if (current && next.items.some(item => item.id === current)) return current
        return next.items[0]?.id ?? null
      })
    } catch (cause) {
      if (requestId === listRequestRef.current) setError(errorMessage(cause))
    } finally {
      if (requestId === listRequestRef.current) {
        if (cursor) setLoadingMore(false)
        else if (!quiet) setLoading(false)
      }
    }
  }, [projectId, queryString, request])

  const loadDetail = useCallback(async (itemId: string) => {
    const requestId = ++detailRequestRef.current
    setDetailLoading(true)
    try {
      const [item, history] = await Promise.all([
        request<MemoryItem>(`/memory/${encodeURIComponent(itemId)}`),
        request<MemoryRevisionsResponse | MemoryRevisionHistoryEntry[]>(`/memory/${encodeURIComponent(itemId)}/revisions`).catch(() => ({ items: [], limited: true })),
      ])
      if (requestId !== detailRequestRef.current) return
      const historyItems = normalizeMemoryHistory(history)
      const unique = new Map<string, MemoryRevisionHistoryEntry>(historyItems.map(revision => [revision.id, revision]))
      unique.set(item.currentRevision.id, { ...item.currentRevision, sources: item.sources })
      setSelected(item)
      setRevisions([...unique.values()].sort((left, right) => right.revision - left.revision))
      setHistoryLimited(!Array.isArray(history) && Boolean(history.limited))
      setDetailError(null)
    } catch (cause) {
      if (requestId === detailRequestRef.current) setDetailError(errorMessage(cause))
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }, [request])

  const loadConflicts = useCallback(async () => {
    try { setConflicts((await request<MemoryConflict[]>(`/projects/${encodeURIComponent(projectId)}/memory/conflicts`)).filter(conflict => conflict.status === 'open')) }
    catch { setConflicts([]) }
  }, [projectId, request])

  useEffect(() => {
    setFilter(emptyFilter); setPage(null); setSelected(null); setSelectedId(null); setMobileDetail(false); setConflicts([]); void loadConflicts()
  }, [loadConflicts, projectId])
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList() }, filter.q ? 240 : 0)
    return () => { window.clearTimeout(timer) }
  }, [loadList, filter.q])
  useEffect(() => {
    if (!selectedId) { setSelected(null); setRevisions([]); return }
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

  const chooseItem = (itemId: string) => {
    setSelectedId(itemId); setDetailTab('content'); setEditorOpen(false)
    if (narrow) setMobileDetail(true)
  }

  const reloadAfterMutation = async (itemId?: string) => {
    await onProjectChanged?.()
    await loadList(true)
    await loadConflicts()
    if (itemId ?? selectedId) await loadDetail((itemId ?? selectedId)!)
  }

  const rescan = async () => {
    if (archived || scanBusy) return
    setScanBusy(true); setError(null)
    try {
      const result = await request<MemoryRescanResponse>(`/projects/${encodeURIComponent(projectId)}/memory/rescan`, { method: 'POST', body: JSON.stringify({ projectRevision }) })
      setConflicts(result.conflicts); await onProjectChanged?.(); await loadList(true)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setScanBusy(false) }
  }

  return <section className="ns-memory" aria-label="记忆浏览器">
    <style>{memoryStyles}</style>
    <header className="ns-memory__header">
      <div>
        <span className="ns-memory__eyebrow">作者控制中心</span>
        <h1>记忆</h1>
        <p>查找模型摘要与作者约束，追溯它们从哪里来、何时进入过生成。</p>
      </div>
      <div className="ns-memory__header-actions">
        <strong>{page?.total ?? 0}</strong><span>条记忆</span>
        {!archived && <div><button type="button" disabled={scanBusy} onClick={() => { void rescan() }}>{scanBusy ? '扫描中…' : '重新扫描'}</button><button type="button" className="ns-memory__primary" onClick={() => { setSelected(null); setEditorOpen(true); if (narrow) setMobileDetail(true) }}>新建作者记忆</button></div>}
      </div>
    </header>

    <div className="ns-memory__notices">
      {archived && <div className="ns-memory__archive" role="status">此项目已归档。记忆可搜索和查看，但不能修改。</div>}
      {error && <Notice message={error} retry={() => { void loadList() }} />}
      {conflicts.length > 0 && <MemoryConflicts conflicts={conflicts} projectRevision={projectRevision} archived={archived} request={request} resolved={reloadAfterMutation} />}
    </div>

    <div className={`ns-memory__workspace${narrow ? ' ns-memory__workspace--narrow' : ''}`}>
      {!narrow && <MemoryFilters filter={filter} facets={page?.facets} setFilter={setFilter} />}
      {narrow && !mobileDetail && <details className="ns-memory__mobile-filters" open={filtersOpen} onToggle={event => { setFiltersOpen(event.currentTarget.open) }}>
        <summary>筛选与搜索{activeFilterCount(filter) ? ` · ${activeFilterCount(filter)} 项` : ''}</summary>
        <MemoryFilters filter={filter} facets={page?.facets} setFilter={setFilter} compact />
      </details>}

      {(!narrow || !mobileDetail) && <MemoryList items={page?.items ?? []} total={page?.total ?? 0} nextCursor={page?.nextCursor ?? null} selectedId={selectedId} loading={loading} loadingMore={loadingMore} filtered={activeFilterCount(filter) > 0} choose={chooseItem} loadMore={cursor => loadList(true, cursor)} />}

      {(!narrow || mobileDetail) && <div className="ns-memory__detail">
        {narrow && <button type="button" className="ns-memory__back" onClick={() => { setMobileDetail(false); setEditorOpen(false) }}>← 返回记忆列表</button>}
        {editorOpen
          ? <MemoryEditor
              source={selected}
              archived={archived}
              request={request}
              projectId={projectId}
              projectRevision={projectRevision}
              close={() => { setEditorOpen(false) }}
              saved={async item => { setEditorOpen(false); setSelectedId(item.id); await reloadAfterMutation(item.id) }}
            />
          : selected
            ? <MemoryDetail
                item={selected}
                revisions={revisions}
                limited={historyLimited}
                tab={detailTab}
                setTab={setDetailTab}
                loading={detailLoading}
                error={detailError}
                archived={archived}
                projectRevision={projectRevision}
                edit={() => { setEditorOpen(true) }}
                request={request}
                changed={() => reloadAfterMutation()}
              />
            : <MemoryEmpty loading={detailLoading || loading} trulyEmpty={Boolean(page && page.total === 0 && activeFilterCount(filter) === 0)} canCreate={!archived} create={() => { setEditorOpen(true) }} />}
      </div>}
    </div>
  </section>
}

function MemoryFilters({ filter, facets, setFilter, compact = false }: { filter: MemoryFilter; facets?: Record<string, Record<string, number>>; setFilter: (next: MemoryFilter) => void; compact?: boolean }) {
  const field = <K extends keyof MemoryFilter>(key: K, value: MemoryFilter[K]) => setFilter({ ...filter, [key]: value })
  return <aside className={`ns-memory__filters${compact ? ' ns-memory__filters--compact' : ''}`} aria-label="记忆筛选">
    <label className="ns-memory__search"><span>全文搜索</span><input type="search" value={filter.q} onChange={event => { field('q', event.target.value) }} placeholder="事实、人物、线索…" /></label>
    <FilterSelect label="来源" value={filter.origin} onChange={value => { field('origin', value as MemoryFilter['origin']) }} options={[['derived','模型派生'],['user','作者记忆']]} facets={facets?.origin} />
    <FilterSelect label="层级" value={filter.scope} onChange={value => { field('scope', value as MemoryFilter['scope']) }} options={[['foundation','创作基建'],['chapter','章节'],['arc','篇章'],['volume','卷'],['book','全书'],['project','项目']]} facets={facets?.scope} />
    <FilterSelect label="类别" value={filter.category} onChange={value => { field('category', value as MemoryFilter['category']) }} options={memoryCategoryOptions} facets={facets?.category} />
    <FilterSelect label="状态" value={filter.state} onChange={value => { field('state', value as MemoryFilter['state']) }} options={[['active','有效'],['conflicted','冲突'],['archived','已归档']]} facets={facets?.state} />
    <FilterSelect label="存储位置" value={filter.storage} onChange={value => { field('storage', value as MemoryFilter['storage']) }} options={[['database','SQLite'],['markdown','Markdown']]} facets={facets?.storage} />
    <FilterSelect label="Prompt" value={filter.promptPolicy} onChange={value => { field('promptPolicy', value as MemoryFilter['promptPolicy']) }} options={[['auto','默认纳入'],['manual','手动启用'],['excluded','不纳入']]} facets={facets?.promptPolicy} />
    <FilterSelect label="最近使用" value={filter.used} onChange={value => { field('used', value as MemoryFilter['used']) }} options={[['used','曾纳入生成'],['unused','尚未纳入']]} facets={facets?.used} />
    {activeFilterCount(filter) > 0 && <button type="button" className="ns-memory__clear" onClick={() => { setFilter(emptyFilter) }}>清除筛选</button>}
  </aside>
}

function FilterSelect({ label, value, options, facets, onChange }: { label: string; value: string; options: ReadonlyArray<readonly [string,string]>; facets?: Record<string,number>; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={event => { onChange(event.target.value) }}><option value="">全部</option>{options.map(([key, text]) => <option key={key} value={key}>{text}{facets?.[key] !== undefined ? ` · ${facets[key]}` : ''}</option>)}</select></label>
}

function MemoryList({ items, total, nextCursor, selectedId, loading, loadingMore, filtered, choose, loadMore }: { items: MemoryItem[]; total: number; nextCursor: string | null; selectedId: string | null; loading: boolean; loadingMore: boolean; filtered: boolean; choose: (id: string) => void; loadMore: (cursor: string) => void | Promise<void> }) {
  return <div className="ns-memory__list" aria-label="记忆列表" aria-busy={loading}>
    <div className="ns-memory__list-title"><strong>搜索结果</strong><span>{items.length} / {total} 条已载入</span></div>
    <div className="ns-memory__list-scroll">
      {loading && items.length === 0 ? <MemorySkeleton /> : items.map(item => <button type="button" key={item.id} className="ns-memory__item" aria-current={item.id === selectedId ? 'true' : undefined} onClick={() => { choose(item.id) }}>
        <span className="ns-memory__item-title">{memoryTitle(item)}</span>
        <span className="ns-memory__item-preview">{item.currentRevision.content}</span>
        <span className="ns-memory__item-meta"><i data-origin={item.origin}>{item.origin === 'user' ? '作者' : '派生'}</i>{memoryCategoryLabel(item.category)} · {memoryScopeLabel(item.scope)} · v{item.revision}</span>
      </button>)}
      {!loading && items.length === 0 && <div className="ns-memory__list-empty"><strong>{filtered ? '没有匹配记忆' : '还没有记忆'}</strong><span>{filtered ? '调整搜索词或清除筛选后再试。' : '批准创作准备或章节后会生成派生记忆，也可以新建作者记忆。'}</span></div>}
      {nextCursor && <button type="button" className="ns-memory__load-more" disabled={loadingMore} onClick={() => { void loadMore(nextCursor) }}>{loadingMore ? '正在加载…' : `加载更多（剩余 ${Math.max(0, total - items.length)} 条）`}</button>}
    </div>
  </div>
}

function MemoryDetail({ item, revisions, limited, tab, setTab, loading, error, archived, projectRevision, edit, request, changed }: { item: MemoryItem; revisions: MemoryRevisionHistoryEntry[]; limited: boolean; tab: DetailTab; setTab: (tab: DetailTab) => void; loading: boolean; error: string | null; archived: boolean; projectRevision: number; edit: () => void; request: NovelClientRequest; changed: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const archive = async () => {
    setBusy(true); setActionError(null)
    try {
      await request<MemoryItem>(`/memory/${encodeURIComponent(item.id)}/archive`, { method: 'POST', body: JSON.stringify({ archived: item.state !== 'archived', baseRevision: item.revision, projectRevision }) })
      await changed()
    } catch (cause) { setActionError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <article className="ns-memory__detail-card">
    <header className="ns-memory__detail-header">
      <div><span>{item.origin === 'derived' ? '模型派生记忆' : '作者记忆'} · {memoryScopeLabel(item.scope)}</span><h2>{memoryTitle(item)}</h2></div>
      {!archived && <div className="ns-memory__detail-actions"><button type="button" disabled={busy} onClick={edit}>{item.origin === 'derived' ? '创建作者覆盖' : '修订'}</button><button type="button" disabled={busy} onClick={() => { void archive() }}>{item.state === 'archived' ? '恢复使用' : '归档'}</button></div>}
    </header>
    <div className="ns-memory__authority"><strong>权威边界</strong><span>{item.origin === 'derived' ? '派生摘要只读。修改会建立作者覆盖，不改写模型原摘要和来源。' : '作者记忆可约束写作，但不能覆盖已批准 Canon。'}</span></div>
    <nav className="ns-memory__tabs" role="tablist" aria-label="记忆详情">
      <TabButton value="content" current={tab} set={setTab}>内容</TabButton><TabButton value="history" current={tab} set={setTab}>历史 <b>{revisions.length}</b></TabButton><TabButton value="sources" current={tab} set={setTab}>来源 <b>{item.sources.length}</b></TabButton><TabButton value="usage" current={tab} set={setTab}>使用记录</TabButton>
    </nav>
    {error && <div className="ns-memory__inline-error" role="alert">{error}</div>}
    {actionError && <div className="ns-memory__inline-error" role="alert">{actionError}</div>}
    <div className="ns-memory__detail-scroll" aria-busy={loading}>
      {tab === 'content' && <MemoryContent item={item} />}
      {tab === 'history' && <MemoryHistory item={item} revisions={revisions} limited={limited} archived={archived} projectRevision={projectRevision} busy={busy} setBusy={setBusy} request={request} changed={changed} setError={setActionError} />}
      {tab === 'sources' && <FactList empty="这条记忆没有可追溯来源。">{item.sources.map(source => <li key={source.id}><strong>{source.label || source.sourceType}</strong><span>{source.sourceType} · {source.sourceVersionId ?? source.sourceId}</span></li>)}</FactList>}
      {tab === 'usage' && <MemoryUsageHistory itemId={item.id} request={request} />}
    </div>
  </article>
}

function MemoryContent({ item }: { item: MemoryItem }) {
  return <div className="ns-memory__content">
    <dl><div><dt>类别</dt><dd>{memoryCategoryLabel(item.category)}</dd></div><div><dt>Prompt 策略</dt><dd>{promptPolicyLabel(item.promptPolicy)}</dd></div><div><dt>存储</dt><dd>{item.storage === 'database' ? 'SQLite' : 'Markdown'}</dd></div><div><dt>当前版本</dt><dd>v{item.currentRevision.revision}</dd></div></dl>
    <pre>{item.currentRevision.content}</pre>
  </div>
}

function MemoryUsageHistory({ itemId, request }: { itemId: string; request: NovelClientRequest }) {
  const [page, setPage] = useState<MemoryUsagePage | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true); else setLoading(true)
    try {
      const next = await request<MemoryUsagePage>(`/memory/${encodeURIComponent(itemId)}/usages?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      setPage(current => cursor && current ? { ...next, items: [...new Map([...current.items, ...next.items].map(usage => [usage.id, usage])).values()] } : next)
      setError(null)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { if (cursor) setLoadingMore(false); else setLoading(false) }
  }, [itemId, request])
  useEffect(() => { setPage(null); void load() }, [load])
  if (loading && !page) return <div className="ns-memory__empty-detail">正在读取 ModelRun 使用审计…</div>
  if (error && !page) return <Notice message={error} retry={() => { void load() }} />
  if (!page || page.total === 0) return <div className="ns-memory__empty-detail">这条记忆还没有进入过模型运行。</div>
  return <div className="ns-memory__usage">
    <div className="ns-memory__usage-summary">已载入 {page.items.length} / {page.total} 条 ModelRun 审计</div>
    <ul className="ns-memory__facts">{page.items.map(usage => <li key={usage.id}>
      <strong>{usage.included ? usage.truncated ? '部分纳入 Prompt' : '完整纳入 Prompt' : '未纳入 Prompt'}</strong>
      <span>modelRunId: {usage.modelRunId}</span>
      <span>sectionKey: {usage.sectionKey || '未匹配区段'}</span>
      <span>included: {usage.included ? '是' : '否'} · truncated: {usage.truncated ? '是' : '否'} · tokens: {usage.estimatedTokens}</span>
      <span>reason: {usage.reason || '无'} · {formatDateTime(usage.createdAt)}</span>
    </li>)}</ul>
    {error && <div className="ns-memory__inline-error" role="alert">{error}</div>}
    {page.nextCursor && <button type="button" className="ns-memory__load-more" disabled={loadingMore} onClick={() => { void load(page.nextCursor!) }}>{loadingMore ? '正在加载…' : `加载更多使用记录（剩余 ${Math.max(0, page.total - page.items.length)} 条）`}</button>}
  </div>
}

function MemoryHistory({ item, revisions, limited, archived, projectRevision, busy, setBusy, request, changed, setError }: { item: MemoryItem; revisions: MemoryRevisionHistoryEntry[]; limited: boolean; archived: boolean; projectRevision: number; busy: boolean; setBusy: (busy: boolean) => void; request: NovelClientRequest; changed: () => Promise<void>; setError: (error: string | null) => void }) {
  const [compareId, setCompareId] = useState<string | null>(null)
  const [diff, setDiff] = useState<MemoryRevisionDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const compared = revisions.find(revision => revision.id === compareId) ?? null
  useEffect(() => {
    if (!compared || compared.id === item.currentRevision.id) { setDiff(null); setDiffLoading(false); return }
    let active = true
    setDiffLoading(true); setDiff(null)
    void request<MemoryRevisionDiff>(`/memory/${encodeURIComponent(item.id)}/diff?from=${encodeURIComponent(compared.id)}&to=${encodeURIComponent(item.currentRevision.id)}`)
      .then(value => { if (active) setDiff(value) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setDiffLoading(false) })
    return () => { active = false }
  }, [compared, item.currentRevision.id, item.id, request, setError])
  const restore = async (revision: MemoryRevision) => {
    setBusy(true); setError(null)
    try {
      await request<MemoryItem>(`/memory/${encodeURIComponent(item.id)}/restore`, { method: 'POST', body: JSON.stringify({ revisionId: revision.id, baseRevision: item.revision, projectRevision }) })
      await changed()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <div className="ns-memory__history">
    {limited && <div className="ns-memory__limited">当前 Host 只返回已加载版本；完整历史接口就绪后会自动显示全部不可变 revision。</div>}
    <div className="ns-memory__timeline">{revisions.map(revision => <button type="button" key={revision.id} aria-current={revision.id === compareId ? 'true' : undefined} onClick={() => { setCompareId(revision.id === compareId ? null : revision.id) }}><i /><span><strong>版本 {revision.revision}{revision.id === item.currentRevision.id ? ' · 当前' : ''}</strong><small>{formatDateTime(revision.createdAt)} · {revision.actor} · {revision.sources.length} 个来源</small></span></button>)}</div>
    {compared && <div className="ns-memory__diff">
      <div className="ns-memory__diff-meta"><strong>来源变化</strong><span>{sourceChangeLabel(compared.sources, item.sources)}</span></div>
      <div className="ns-memory__diff-lines" aria-busy={diffLoading}><strong>版本 {compared.revision} → 当前版本 {item.currentRevision.revision}</strong>{diffLoading ? <span>正在计算逐行差异…</span> : diff ? <pre>{diff.lines.map((line,index) => <span key={`${index}:${line.kind}`} data-kind={line.kind}>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}{line.text}</span>)}</pre> : <span>选择历史版本后查看内容差异。</span>}</div>
      {!archived && item.origin === 'user' && compared.id !== item.currentRevision.id && <button type="button" disabled={busy} onClick={() => { void restore(compared) }}>恢复为新版本</button>}
    </div>}
  </div>
}

function MemoryEditor({ source, archived, request, projectId, projectRevision, close, saved }: { source: MemoryItem | null; archived: boolean; request: NovelClientRequest; projectId: string; projectRevision: number; close: () => void; saved: (item: MemoryItem) => Promise<void> }) {
  const createsOverride = source?.origin === 'derived'
  const editing = source?.origin === 'user'
  const [content, setContent] = useState(source?.currentRevision.content ?? '')
  const [scope, setScope] = useState<MemoryItem['scope']>(source?.scope ?? 'project')
  const [category, setCategory] = useState<MemoryCategory>(source?.category ?? 'continuity')
  const [policy, setPolicy] = useState<MemoryPromptPolicy>(source?.promptPolicy ?? defaultPromptPolicy(source?.category ?? 'continuity'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (archived || !content.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const item = editing
        ? await request<MemoryItem>(`/memory/${encodeURIComponent(source.id)}`, { method: 'POST', body: JSON.stringify({ content: content.trim(), category, promptPolicy: policy, baseRevision: source.revision, projectRevision }) })
        : await request<MemoryItem>(`/projects/${encodeURIComponent(projectId)}/memory`, { method: 'POST', body: JSON.stringify({ content: content.trim(), scope, category, promptPolicy: policy, projectRevision, ...(createsOverride ? { sourceItemId: source.id } : {}) }) })
      await saved(item)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <form className="ns-memory__editor" onSubmit={event => { event.preventDefault(); void submit() }}>
    <header><div><span>{editing ? '修订作者记忆' : createsOverride ? '作者覆盖' : '新建作者记忆'}</span><h2>{source ? memoryTitle(source) : '把明确约束交给后续生成'}</h2></div><button type="button" onClick={close}>取消</button></header>
    {createsOverride && <div className="ns-memory__authority">原派生摘要保持不变；新记忆会保存来源绑定和独立 revision。</div>}
    <label><span>内容</span><textarea autoFocus aria-label="记忆内容" value={content} onChange={event => { setContent(event.target.value) }} rows={12} maxLength={120000} placeholder="例如：沈砚不知道港口失火的真正原因，直到第 18 章前不能提前揭示。" /></label>
    <div className="ns-memory__editor-grid">
      {!editing && <label><span>层级</span><select value={scope} onChange={event => { setScope(event.target.value as MemoryItem['scope']) }}>{scopeOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <label><span>类别</span><select value={category} onChange={event => { const next = event.target.value as MemoryCategory; setCategory(next); setPolicy(defaultPromptPolicy(next)) }}>{memoryCategoryOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Prompt 策略</span><select value={policy} onChange={event => { setPolicy(event.target.value as MemoryPromptPolicy) }}><option value="auto">默认纳入</option><option value="manual">由作者手动启用</option><option value="excluded">不纳入</option></select></label>
    </div>
    <p className="ns-memory__editor-help">连续性和硬约束默认进入 Prompt；灵感、研究默认关闭。正式 Canon 始终拥有更高权威。</p>
    {error && <div className="ns-memory__inline-error" role="alert">{error}</div>}
    <footer><span>{content.trim().length.toLocaleString('zh-CN')} 字符</span><button type="submit" className="ns-memory__primary" disabled={archived || busy || !content.trim()}>{busy ? '正在保存…' : editing ? '保存为新版本' : '创建记忆'}</button></footer>
  </form>
}

function MemoryConflicts({ conflicts, projectRevision, archived, request, resolved }: { conflicts: MemoryConflict[]; projectRevision: number; archived: boolean; request: NovelClientRequest; resolved: (itemId?: string) => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resolve = async (conflict: MemoryConflict, resolution: 'database' | 'file' | 'merged', mergedContent?: string) => {
    setBusyId(conflict.id); setError(null)
    try {
      const item = await request<MemoryItem>(`/memory/${encodeURIComponent(conflict.itemId)}`)
      await request<MemoryItem>(`/memory/${encodeURIComponent(conflict.itemId)}/conflicts/${encodeURIComponent(conflict.id)}/resolve`, { method: 'POST', body: JSON.stringify({ resolution, mergedContent, baseRevision: item.revision, projectRevision }) })
      await resolved(conflict.itemId)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusyId(null) }
  }
  return <details className="ns-memory__conflicts" open>
    <summary><strong>{conflicts.length} 个 Markdown 三方冲突</strong><span>数据库与文件都发生过修改，系统未静默覆盖。</span></summary>
    <div>{conflicts.map(conflict => <MemoryConflictCard key={conflict.id} conflict={conflict} archived={archived} busy={Boolean(busyId)} resolve={resolve} />)}</div>
    {error && <div className="ns-memory__inline-error" role="alert">{error}</div>}
  </details>
}

function MemoryConflictCard({ conflict, archived, busy, resolve }: { conflict: MemoryConflict; archived: boolean; busy: boolean; resolve: (conflict: MemoryConflict, resolution: 'database' | 'file' | 'merged', mergedContent?: string) => Promise<void> }) {
  const [mergedContent, setMergedContent] = useState(conflict.databaseContent)
  useEffect(() => { setMergedContent(conflict.databaseContent) }, [conflict.id, conflict.databaseContent])
  return <article className="ns-memory__conflict-card">
    <header><div><strong>记忆 {conflict.itemId}</strong><span>{formatDateTime(conflict.createdAt)} · 共同基线 {conflict.baseRevisionId ?? '未知'} · SQLite {conflict.databaseRevisionId}</span></div><span>Markdown {conflict.fileHash.slice(0,8)}</span></header>
    <div className="ns-memory__conflict-branches">
      <section><strong>共同基线</strong><small>双方最后一次同步的 revision</small><pre>{conflict.baseContent || '（空内容）'}</pre></section>
      <section><strong>SQLite 当前内容</strong><small>相对共同基线的差异</small><ConflictDiff lines={conflict.baseToDatabaseDiff} /><pre>{conflict.databaseContent}</pre></section>
      <section><strong>Markdown 文件内容</strong><small>相对共同基线的差异</small><ConflictDiff lines={conflict.baseToFileDiff} /><pre>{conflict.fileContent}</pre></section>
    </div>
    {!archived && <div className="ns-memory__merge-editor">
      <div><strong>作者合并正文</strong><span>请在这里明确编辑最终内容；保存后会创建新的不可变 revision。</span></div>
      <div className="ns-memory__merge-start"><button type="button" disabled={busy} onClick={() => { setMergedContent(conflict.databaseContent) }}>以 SQLite 为起点</button><button type="button" disabled={busy} onClick={() => { setMergedContent(conflict.fileContent) }}>以 Markdown 为起点</button></div>
      <textarea aria-label="冲突合并正文" value={mergedContent} onChange={event => { setMergedContent(event.target.value) }} rows={8} maxLength={256000} disabled={busy} />
      <div className="ns-memory__merge-actions"><button type="button" disabled={busy} onClick={() => { void resolve(conflict, 'database') }}>保留 SQLite</button><button type="button" disabled={busy} onClick={() => { void resolve(conflict, 'file') }}>采用 Markdown</button><button type="button" className="ns-memory__primary" disabled={busy || !mergedContent.trim()} onClick={() => { void resolve(conflict, 'merged', mergedContent) }}>{busy ? '正在保存…' : '保存合并正文为新版本'}</button></div>
    </div>}
  </article>
}

function ConflictDiff({ lines }: { lines: MemoryRevisionDiff['lines'] }) {
  const changed = lines.filter(line => line.kind !== 'same')
  return changed.length > 0 ? <details className="ns-memory__conflict-diff"><summary>{changed.length} 行变化</summary><pre>{changed.map((line, index) => <span key={`${index}:${line.kind}`} data-kind={line.kind}>{line.kind === 'added' ? '+ ' : '− '}{line.text}</span>)}</pre></details> : <div className="ns-memory__conflict-same">与共同基线相同</div>
}

function TabButton({ value, current, set, children }: { value: DetailTab; current: DetailTab; set: (value: DetailTab) => void; children: ReactNode }) { return <button type="button" role="tab" aria-selected={value === current} onClick={() => { set(value) }}>{children}</button> }
function FactList({ empty, children }: { empty: string; children: ReactNode }) { const has = Array.isArray(children) ? children.length > 0 : Boolean(children); return has ? <ul className="ns-memory__facts">{children}</ul> : <div className="ns-memory__empty-detail">{empty}</div> }
function MemoryEmpty({ loading, trulyEmpty, canCreate, create }: { loading: boolean; trulyEmpty: boolean; canCreate: boolean; create: () => void }) { return <div className="ns-memory__empty-detail"><strong>{loading ? '正在读取记忆…' : trulyEmpty ? '这里还没有记忆' : '选择一条记忆查看详情'}</strong><span>{trulyEmpty ? '批准创作准备或章节后会生成派生记忆；作者也可以主动记录长期约束。' : '内容、不可变历史、来源和模型使用记录会集中显示在这里。'}</span>{canCreate && <button type="button" onClick={create}>新建作者记忆</button>}</div> }
function MemorySkeleton() { return <div className="ns-memory__skeleton" aria-hidden="true">{[1,2,3,4].map(value => <i key={value} />)}</div> }
function Notice({ message, retry }: { message: string; retry: () => void }) { return <div className="ns-memory__notice" role="alert"><span>{message}</span><button type="button" onClick={retry}>重试</button></div> }

function memoryTitle(item: MemoryItem): string {
  const raw = item.sourceKey.replace(/^user:/, '').replace(/^summary:/, '').replace(/[-_]+/g, ' ').trim()
  return raw && raw.length <= 72 ? raw : `${memoryScopeLabel(item.scope)} · ${memoryCategoryLabel(item.category)}`
}
function memoryScopeLabel(scope: MemoryItem['scope']): string { return ({ foundation: '创作基建', chapter: '章节', arc: '篇章', volume: '卷', book: '全书', project: '项目' } as const)[scope] }
function memoryCategoryLabel(category: MemoryCategory): string { return Object.fromEntries(memoryCategoryOptions)[category] ?? category }
function promptPolicyLabel(policy: MemoryPromptPolicy): string { return policy === 'auto' ? '默认纳入' : policy === 'manual' ? '手动启用' : '不纳入' }
function defaultPromptPolicy(category: MemoryCategory): MemoryPromptPolicy { return category === 'continuity' || category === 'constraint' ? 'auto' : 'manual' }
function activeFilterCount(filter: MemoryFilter): number { return Object.values(filter).filter(Boolean).length }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
function normalizeMemoryHistory(value: MemoryRevisionsResponse | MemoryRevisionHistoryEntry[]): MemoryRevisionHistoryEntry[] {
  if (Array.isArray(value)) return value as MemoryRevisionHistoryEntry[]
  const response = value as MemoryRevisionsResponse
  return response.items ?? response.revisions ?? []
}
function sourceChangeLabel(from: MemoryRevisionHistoryEntry['sources'], to: MemoryItem['sources']): string {
  const before = new Set(from.map(source => `${source.sourceType}:${source.sourceId}:${source.sourceVersionId ?? ''}`))
  const after = new Set(to.map(source => `${source.sourceType}:${source.sourceId}:${source.sourceVersionId ?? ''}`))
  const added = [...after].filter(value => !before.has(value)).length
  const removed = [...before].filter(value => !after.has(value)).length
  if (!added && !removed) return `未变化 · ${after.size} 个来源`
  return `新增 ${added} · 移除 ${removed} · 当前 ${after.size}`
}

const memoryCategoryOptions: ReadonlyArray<readonly [MemoryCategory,string]> = [
  ['continuity','连续性'],['constraint','硬约束'],['character','人物'],['world','世界规则'],['timeline','时间线'],['foreshadowing','伏笔'],['idea','灵感'],['research','研究'],['other','其他'],
]
const scopeOptions: ReadonlyArray<readonly [MemoryItem['scope'],string]> = [['project','项目'],['book','全书'],['volume','卷'],['arc','篇章'],['chapter','章节'],['foundation','创作基建']]

const memoryStyles = `
.ns-memory { --m-bg:var(--dsw-alias-bg-base,#fff);--m-layer:var(--dsw-alias-bg-layer-1,#fff);--m-module:var(--dsw-alias-bg-module-platform,#f5f6f7);--m-hover:var(--dsw-specific-sidebar-nav-item-hover,#f1f3f5);--m-active:var(--dsw-specific-sidebar-nav-item-active,#e9ecf2);--m-text:var(--dsw-alias-label-primary,#202124);--m-muted:var(--dsw-alias-label-secondary,#666b73);--m-faint:var(--dsw-alias-label-tertiary,#8a9099);--m-border:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--m-border-soft:var(--dsw-alias-border-l1,rgba(0,0,0,.05));--m-brand:var(--dsw-alias-state-business-primary,#4176e6);--m-danger:var(--dsw-alias-state-error-primary,#c73737);height:100%;min-width:0;display:grid;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden;color:var(--m-text);background:var(--m-bg);font-family:var(--dsw-font-family,"PingFang SC","Microsoft YaHei",sans-serif)}
.ns-memory *{box-sizing:border-box}.ns-memory button,.ns-memory input,.ns-memory select,.ns-memory textarea{font:inherit}.ns-memory :is(button,input,select,textarea):focus-visible{outline:2px solid var(--m-brand);outline-offset:2px}
.ns-memory__header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:20px 24px 17px;border-bottom:1px solid var(--m-border-soft)}.ns-memory__header h1{margin:3px 0 0;font-size:22px;line-height:1.2;letter-spacing:-.025em}.ns-memory__header p{max-width:620px;margin:6px 0 0;color:var(--m-muted);font-size:12px;line-height:1.55}.ns-memory__eyebrow{color:var(--m-faint);font-size:9px;font-weight:600;letter-spacing:.08em}.ns-memory__header-actions{display:grid;grid-template-columns:auto auto;align-items:baseline;gap:1px 6px;flex:none}.ns-memory__header-actions strong{font-size:18px;font-variant-numeric:tabular-nums}.ns-memory__header-actions span{color:var(--m-faint);font-size:10px}.ns-memory__header-actions>div{grid-column:1/-1;display:flex;gap:6px;margin-top:7px}.ns-memory__header-actions button{min-height:33px;padding:0 9px;border:1px solid var(--m-border);border-radius:7px;color:var(--m-text);background:var(--m-layer);cursor:pointer;font-size:10px;white-space:nowrap}.ns-memory__header-actions .ns-memory__primary{margin:0}
.ns-memory__workspace{min-height:0;display:grid;grid-template-columns:minmax(164px,190px) minmax(235px,300px) minmax(0,1fr);overflow:hidden}.ns-memory__workspace--narrow{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
.ns-memory__filters{min-width:0;overflow:auto;padding:14px 12px;border-right:1px solid var(--m-border-soft);background:var(--m-module)}.ns-memory__filters label{display:grid;gap:4px;margin-bottom:10px;color:var(--m-muted);font-size:9px}.ns-memory__filters :is(input,select){width:100%;min-width:0;height:33px;padding:0 8px;border:1px solid var(--m-border);border-radius:7px;color:var(--m-text);background:var(--m-layer);font-size:11px}.ns-memory__search input{height:36px}.ns-memory__clear{width:100%;min-height:32px;border:0;border-radius:7px;color:var(--m-muted);background:transparent;cursor:pointer;font-size:10px}.ns-memory__clear:hover{background:var(--m-hover)}
.ns-memory__mobile-filters{margin:10px 10px 0;border:1px solid var(--m-border);border-radius:8px;background:var(--m-module);overflow:hidden}.ns-memory__mobile-filters>summary{padding:10px 12px;cursor:pointer;font-size:11px;font-weight:600}.ns-memory__filters--compact{display:grid;grid-template-columns:1fr 1fr;gap:0 9px;max-height:min(58dvh,480px);border:0;border-top:1px solid var(--m-border-soft);background:transparent}.ns-memory__filters--compact .ns-memory__search,.ns-memory__filters--compact .ns-memory__clear{grid-column:1/-1}
.ns-memory__list{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border-right:1px solid var(--m-border-soft);background:var(--m-layer)}.ns-memory__list-title{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:42px;padding:0 13px;border-bottom:1px solid var(--m-border-soft)}.ns-memory__list-title strong{font-size:11px}.ns-memory__list-title span{color:var(--m-faint);font-size:9px}.ns-memory__list-scroll{min-height:0;overflow:auto}.ns-memory__item{width:100%;display:grid;gap:5px;padding:12px 13px;border:0;border-bottom:1px solid var(--m-border-soft);color:var(--m-text);background:transparent;cursor:pointer;text-align:left}.ns-memory__item:hover{background:var(--m-hover)}.ns-memory__item[aria-current=true]{background:var(--m-active);box-shadow:inset 2px 0 var(--m-brand)}.ns-memory__item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}.ns-memory__item-preview{display:-webkit-box;overflow:hidden;color:var(--m-muted);font-size:10px;line-height:1.55;-webkit-line-clamp:2;-webkit-box-orient:vertical}.ns-memory__item-meta{color:var(--m-faint);font-size:9px}.ns-memory__item-meta i{margin-right:5px;padding:1px 4px;border-radius:4px;background:var(--m-module);font-style:normal}.ns-memory__item-meta i[data-origin=user]{color:var(--m-brand)}
.ns-memory__detail{min-width:0;min-height:0;overflow:hidden;background:var(--m-bg)}.ns-memory__back{min-height:38px;margin:8px 10px 0;padding:0 8px;border:0;color:var(--m-muted);background:transparent;cursor:pointer;font-size:11px}.ns-memory__detail-card{height:100%;min-width:0;display:grid;grid-template-rows:auto auto auto minmax(0,1fr);overflow:hidden}.ns-memory__detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:17px 19px 13px}.ns-memory__detail-header span,.ns-memory__editor header span{color:var(--m-faint);font-size:9px}.ns-memory__detail-header h2,.ns-memory__editor h2{margin:4px 0 0;font-size:15px;line-height:1.4}.ns-memory__detail-actions{display:flex;gap:6px}.ns-memory__detail-actions button,.ns-memory__editor header button{min-height:31px;padding:0 9px;border:1px solid var(--m-border);border-radius:7px;color:var(--m-text);background:var(--m-layer);cursor:pointer;font-size:10px;white-space:nowrap}
.ns-memory__authority{display:flex;gap:8px;margin:0 18px 12px;padding:8px 10px;border-left:2px solid var(--m-brand);color:var(--m-muted);background:var(--m-module);font-size:10px;line-height:1.55}.ns-memory__authority strong{flex:none;color:var(--m-text)}.ns-memory__tabs{display:flex;gap:1px;padding:0 14px;border-bottom:1px solid var(--m-border-soft);overflow-x:auto}.ns-memory__tabs button{min-height:37px;padding:0 9px;border:0;border-bottom:2px solid transparent;color:var(--m-muted);background:transparent;cursor:pointer;font-size:10px;white-space:nowrap}.ns-memory__tabs button[aria-selected=true]{border-color:var(--m-brand);color:var(--m-text);font-weight:600}.ns-memory__tabs b{display:inline-grid;place-items:center;min-width:16px;height:16px;margin-left:2px;border-radius:5px;background:var(--m-module);font-size:8px}.ns-memory__detail-scroll{min-height:0;overflow:auto}.ns-memory__content{padding:18px}.ns-memory__content dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 15px}.ns-memory__content dl div{min-width:0;padding:8px;border-radius:7px;background:var(--m-module)}.ns-memory__content dt{color:var(--m-faint);font-size:8px}.ns-memory__content dd{margin:3px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.ns-memory pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.75 var(--dsw-font-family,"PingFang SC",sans-serif)}
 .ns-memory__facts{display:grid;gap:0;margin:0;padding:0;list-style:none}.ns-memory__facts li{display:grid;gap:4px;padding:12px 17px;border-bottom:1px solid var(--m-border-soft)}.ns-memory__facts strong{font-size:11px}.ns-memory__facts span{color:var(--m-muted);font-size:9px;overflow-wrap:anywhere}.ns-memory__history{padding:14px}.ns-memory__limited{margin-bottom:10px;padding:8px;border-radius:7px;color:var(--m-muted);background:var(--m-module);font-size:9px;line-height:1.5}.ns-memory__timeline{display:grid}.ns-memory__timeline button{display:grid;grid-template-columns:12px minmax(0,1fr);gap:7px;padding:8px;border:0;color:var(--m-text);background:transparent;cursor:pointer;text-align:left}.ns-memory__timeline button:hover,.ns-memory__timeline button[aria-current=true]{background:var(--m-hover)}.ns-memory__timeline i{width:7px;height:7px;margin-top:4px;border:2px solid var(--m-brand);border-radius:50%}.ns-memory__timeline span{display:grid}.ns-memory__timeline strong{font-size:10px}.ns-memory__timeline small{margin-top:2px;color:var(--m-faint);font-size:8px}.ns-memory__diff{display:grid;grid-template-columns:1fr;gap:8px;margin-top:12px}.ns-memory__diff>div{min-width:0;padding:10px;border:1px solid var(--m-border);border-radius:8px}.ns-memory__diff>div>strong{display:block;margin-bottom:7px;font-size:10px}.ns-memory__diff-meta{display:flex;align-items:center;justify-content:space-between;gap:10px}.ns-memory__diff-meta>strong{margin:0!important}.ns-memory__diff-meta span,.ns-memory__diff-lines>span{color:var(--m-muted);font-size:9px}.ns-memory__diff-lines pre{display:grid;max-height:300px;margin:0;overflow:auto;font-size:10px}.ns-memory__diff-lines pre span{display:block;min-width:max-content;padding:1px 5px;white-space:pre-wrap}.ns-memory__diff-lines pre span[data-kind=added]{color:#257842;background:rgba(39,152,79,.08)}.ns-memory__diff-lines pre span[data-kind=removed]{color:var(--m-danger);background:color-mix(in srgb,var(--m-danger) 8%,transparent)}.ns-memory__diff>button{justify-self:end;min-height:32px;border:1px solid var(--m-border);border-radius:7px;background:var(--m-layer);cursor:pointer;font-size:10px}
.ns-memory__editor{height:100%;display:grid;grid-template-rows:auto auto auto auto minmax(0,1fr) auto;gap:13px;padding:18px;overflow:auto}.ns-memory__editor header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.ns-memory__editor>label,.ns-memory__editor-grid label{display:grid;gap:5px;color:var(--m-muted);font-size:9px}.ns-memory__editor textarea{width:100%;resize:vertical;min-height:190px;padding:11px;border:1px solid var(--m-border);border-radius:8px;color:var(--m-text);background:var(--m-layer);font-size:12px;line-height:1.65}.ns-memory__editor-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.ns-memory__editor select{width:100%;min-width:0;height:34px;padding:0 8px;border:1px solid var(--m-border);border-radius:7px;color:var(--m-text);background:var(--m-layer);font-size:10px}.ns-memory__editor-help{margin:0;color:var(--m-muted);font-size:9px;line-height:1.55}.ns-memory__editor footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:10px;border-top:1px solid var(--m-border-soft)}.ns-memory__editor footer span{color:var(--m-faint);font-size:9px}.ns-memory__primary{min-height:33px;padding:0 11px;border:1px solid var(--m-brand);border-radius:7px;color:#fff;background:var(--m-brand);cursor:pointer;font-size:10px}.ns-memory__primary:disabled{cursor:not-allowed;opacity:.5}
.ns-memory__notices:empty{display:none}.ns-memory__notice,.ns-memory__archive,.ns-memory__inline-error{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;font-size:10px}.ns-memory__notice,.ns-memory__inline-error{color:var(--m-danger);background:color-mix(in srgb,var(--m-danger) 7%,var(--m-layer))}.ns-memory__notice button{border:0;color:inherit;background:transparent;cursor:pointer}.ns-memory__archive{color:var(--m-muted);background:var(--m-module)}.ns-memory__conflicts{border-bottom:1px solid color-mix(in srgb,var(--m-danger) 35%,var(--m-border));background:color-mix(in srgb,var(--m-danger) 5%,var(--m-layer))}.ns-memory__conflicts>summary{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;color:var(--m-danger);font-size:10px}.ns-memory__conflicts>summary span{color:var(--m-muted);font-size:9px}.ns-memory__conflicts>div{display:grid;gap:6px;max-height:260px;padding:0 12px 10px;overflow:auto}.ns-memory__conflicts article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:9px;border:1px solid var(--m-border);border-radius:7px;background:var(--m-layer)}.ns-memory__conflicts article>div:first-child{min-width:0;display:grid;gap:3px}.ns-memory__conflicts article strong{font-size:10px}.ns-memory__conflicts article span{color:var(--m-faint);font-size:8px}.ns-memory__conflicts article pre{max-height:84px;overflow:auto;font-size:9px}.ns-memory__conflicts article>div:last-child{display:flex;align-items:flex-end;gap:4px}.ns-memory__conflicts button{min-height:29px;padding:0 7px;border:1px solid var(--m-border);border-radius:6px;background:var(--m-layer);cursor:pointer;font-size:8px;white-space:nowrap}.ns-memory__empty-detail,.ns-memory__list-empty{display:grid;place-items:center;align-content:center;min-height:180px;padding:24px;color:var(--m-muted);text-align:center;font-size:10px}.ns-memory__empty-detail strong,.ns-memory__list-empty strong{color:var(--m-text);font-size:12px}.ns-memory__empty-detail span,.ns-memory__list-empty span{max-width:340px;margin-top:5px;line-height:1.6}.ns-memory__empty-detail button{margin-top:12px;min-height:31px;border:1px solid var(--m-border);border-radius:7px;background:var(--m-layer);cursor:pointer;font-size:10px}.ns-memory__skeleton{display:grid;gap:1px}.ns-memory__skeleton i{height:88px;background:linear-gradient(100deg,var(--m-module),var(--m-hover),var(--m-module));background-size:200% 100%;animation:ns-memory-pulse 1.4s infinite}@keyframes ns-memory-pulse{to{background-position:-200% 0}}
.ns-memory__load-more{display:block;min-height:34px;margin:10px auto;padding:0 12px;border:1px solid var(--m-border);border-radius:7px;color:var(--m-muted);background:var(--m-layer);cursor:pointer;font-size:9px}.ns-memory__load-more:disabled{cursor:wait;opacity:.55}.ns-memory__usage{padding-bottom:12px}.ns-memory__usage-summary{padding:9px 17px;color:var(--m-faint);background:var(--m-module);font-size:9px}.ns-memory__usage .ns-memory__facts li{gap:3px}.ns-memory__usage .ns-memory__load-more{margin-bottom:0}
.ns-memory__conflicts>div{max-height:min(72dvh,760px)}.ns-memory__conflicts .ns-memory__conflict-card{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:11px}.ns-memory__conflict-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ns-memory__conflict-card>header>div{display:grid;gap:3px}.ns-memory__conflict-branches{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch!important;gap:7px!important}.ns-memory__conflict-branches section{min-width:0;padding:8px;border:1px solid var(--m-border-soft);border-radius:6px;background:var(--m-module)}.ns-memory__conflict-branches section>strong,.ns-memory__conflict-branches section>small{display:block}.ns-memory__conflict-branches section>small{margin:2px 0 7px;color:var(--m-faint);font-size:8px}.ns-memory__conflict-branches section>pre{max-height:150px!important;padding-top:6px;border-top:1px solid var(--m-border-soft)}.ns-memory__conflict-diff{margin-bottom:7px}.ns-memory__conflict-diff summary{cursor:pointer;color:var(--m-muted);font-size:8px}.ns-memory__conflict-diff pre{display:grid;max-height:100px!important;margin-top:4px!important}.ns-memory__conflict-diff pre span{display:block;padding:1px 3px;white-space:pre-wrap}.ns-memory__conflict-diff pre span[data-kind=added]{color:#257842;background:rgba(39,152,79,.08)}.ns-memory__conflict-diff pre span[data-kind=removed]{color:var(--m-danger);background:color-mix(in srgb,var(--m-danger) 8%,transparent)}.ns-memory__conflict-same{margin-bottom:7px;color:var(--m-faint);font-size:8px}.ns-memory__conflict-card>.ns-memory__merge-editor{display:grid;align-items:stretch;gap:7px}.ns-memory__merge-editor>div:first-child{display:grid;gap:2px}.ns-memory__merge-start,.ns-memory__merge-actions{display:flex;align-items:center;justify-content:flex-start;gap:5px;flex-wrap:wrap}.ns-memory__merge-editor textarea{width:100%;min-height:120px;resize:vertical;padding:9px;border:1px solid var(--m-border);border-radius:7px;color:var(--m-text);background:var(--m-layer);font-size:10px;line-height:1.6}.ns-memory__merge-actions .ns-memory__primary{margin-left:auto;color:#fff;background:var(--m-brand);border-color:var(--m-brand)}
@media(max-width:760px){.ns-memory__header{align-items:flex-start;padding:68px 14px 13px}.ns-memory__header p{font-size:10px}.ns-memory__header-actions{padding-top:2px}.ns-memory__header-actions>div{align-items:stretch;flex-direction:column}.ns-memory__header-actions button{font-size:9px}.ns-memory__conflicts>summary{align-items:flex-start;flex-direction:column}.ns-memory__conflicts article{grid-template-columns:1fr}.ns-memory__conflicts article>div:last-child{align-items:stretch;flex-wrap:wrap}.ns-memory__workspace--narrow .ns-memory__list{border-right:0}.ns-memory__workspace--narrow .ns-memory__detail{min-height:0}.ns-memory__detail-card{height:calc(100% - 46px)}.ns-memory__detail-header{padding:12px 13px 10px}.ns-memory__detail-actions{flex-direction:column}.ns-memory__authority{margin-inline:12px}.ns-memory__content{padding:13px}.ns-memory__content dl{grid-template-columns:1fr 1fr}.ns-memory__diff{grid-template-columns:1fr}.ns-memory__diff>button{grid-column:1}.ns-memory__editor{height:calc(100% - 46px);padding:13px}.ns-memory__editor-grid{grid-template-columns:1fr}.ns-memory__editor footer{position:sticky;bottom:0;padding:10px 0;background:var(--m-bg)}}
@media(max-width:760px){.ns-memory__conflict-card>header{flex-direction:column}.ns-memory__conflict-branches{grid-template-columns:minmax(0,1fr)}.ns-memory__merge-actions .ns-memory__primary{width:100%;margin-left:0}.ns-memory__conflicts>div{max-height:min(76dvh,680px)}}
@media(prefers-reduced-motion:reduce){.ns-memory__skeleton i{animation:none}.ns-memory *{scroll-behavior:auto!important;transition:none!important}}
`
