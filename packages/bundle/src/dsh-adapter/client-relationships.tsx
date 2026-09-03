import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import {
  buildRelationshipNeighborhood,
  layoutRelationshipNeighborhood,
  normalizeRelationshipText,
  relationshipCandidateConfirmability,
  type EntityRelationship,
  type EntityRelationshipCategory,
  type EntityRelationshipCandidate,
  type EntityRelationshipEvidence,
  type EntityRelationshipFactLayer,
  type RelationshipCandidateDecision,
  type RelationshipEntityNode,
} from '../domain/entity-relationships.js'

export type EntityRelationshipsViewMode = 'graph' | 'list' | 'candidates'

export interface RelationshipCandidateReviewRequest {
  candidateId: string
  decision: RelationshipCandidateDecision
}

export interface RelationshipQueryState {
  q: string
  rootEntityId: string | null
  depth: 1 | 2
  category: 'all' | EntityRelationshipCategory
  factLayer: 'all' | EntityRelationshipFactLayer
  atStoryOrder: number | null
}

export interface EntityRelationshipsPanelProps {
  nodes: readonly RelationshipEntityNode[]
  entityOptions?: readonly RelationshipEntityNode[]
  relationships: readonly EntityRelationship[]
  listRelationships?: readonly EntityRelationship[]
  listTotal?: number
  listNextCursor?: string | null
  listLoadingMore?: boolean
  candidates?: readonly EntityRelationshipCandidate[]
  evidenceByRelationshipId?: Readonly<Record<string, readonly EntityRelationshipEvidence[]>>
  loading?: boolean
  error?: string | null
  narrow?: boolean
  initialMode?: EntityRelationshipsViewMode
  initialRootEntityId?: string | null
  queryState?: RelationshipQueryState
  onQueryStateChange?: (next: RelationshipQueryState) => void
  onRetry?: () => void | Promise<void>
  onLoadMoreRelationships?: () => void | Promise<void>
  onSelectEntity?: (entityId: string) => void
  onRequestEvidence?: (relationshipId: string) => Promise<readonly EntityRelationshipEvidence[]>
  onDecideCandidate?: (request: RelationshipCandidateReviewRequest) => void | Promise<void>
  onDecideCandidates?: (requests: readonly RelationshipCandidateReviewRequest[]) => void | Promise<void>
}

type EvidenceLoadState = { relationshipId: string | null; status: 'idle' | 'loading' | 'error'; error: string | null }

const factLayerOptions: ReadonlyArray<{ value: 'all' | EntityRelationshipFactLayer; label: string }> = [
  { value: 'all', label: '全部事实层' },
  { value: 'canon', label: 'Canon' },
  { value: 'planned', label: '规划' },
  { value: 'author_asserted', label: '作者声明' },
]

const categoryOptions: ReadonlyArray<{ value: 'all' | EntityRelationshipCategory; label: string }> = [
  { value: 'all', label: '全部类别' },
  { value: 'family', label: '亲属' },
  { value: 'emotion', label: '情感' },
  { value: 'alliance', label: '同盟' },
  { value: 'conflict', label: '冲突' },
  { value: 'membership', label: '隶属' },
  { value: 'possession', label: '持有' },
  { value: 'location', label: '位置' },
  { value: 'knowledge', label: '知情' },
  { value: 'causality', label: '因果' },
  { value: 'other', label: '其他' },
]

function initialRelationshipQuery(rootEntityId: string | null): RelationshipQueryState {
  return { q: '', rootEntityId, depth: 1, category: 'all', factLayer: 'all', atStoryOrder: null }
}

export function EntityRelationshipsPanel({
  nodes,
  entityOptions = nodes,
  relationships,
  listRelationships,
  listTotal,
  listNextCursor,
  listLoadingMore = false,
  candidates = [],
  evidenceByRelationshipId = {},
  loading = false,
  error = null,
  narrow,
  initialMode = 'graph',
  initialRootEntityId = null,
  queryState,
  onQueryStateChange,
  onRetry,
  onLoadMoreRelationships,
  onSelectEntity,
  onRequestEvidence,
  onDecideCandidate,
  onDecideCandidates,
}: EntityRelationshipsPanelProps) {
  const detectedNarrow = useRelationshipNarrowViewport()
  const compact = narrow ?? detectedNarrow
  const [mode, setMode] = useState<EntityRelationshipsViewMode>(initialMode)
  const [localQueryState, setLocalQueryState] = useState<RelationshipQueryState>(() => initialRelationshipQuery(initialRootEntityId))
  const filters = queryState ?? localQueryState
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(initialRootEntityId)
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null)
  const [localEvidence, setLocalEvidence] = useState<Record<string, readonly EntityRelationshipEvidence[]>>({})
  const [evidenceLoad, setEvidenceLoad] = useState<EvidenceLoadState>({ relationshipId: null, status: 'idle', error: null })
  const [candidateBusyId, setCandidateBusyId] = useState<string | null>(null)
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const graphNodeRefs = useRef(new Map<string, HTMLButtonElement>())
  const evidenceDialogRef = useRef<HTMLDivElement>(null)
  const evidenceCloseRef = useRef<HTMLButtonElement>(null)
  const evidenceOpenerRef = useRef<HTMLButtonElement | null>(null)
  const evidenceRequestRef = useRef(0)

  const nodeById = useMemo(() => new Map(entityOptions.map(node => [node.id, node])), [entityOptions])
  const normalizedQuery = normalizeRelationshipText(filters.q).toLowerCase()
  const visibleRelationships = useMemo(() => relationships
    .filter(relationship => relationship.status === 'active')
    .filter(relationship => filters.factLayer === 'all' || relationship.factLayer === filters.factLayer)
    .filter(relationship => filters.category === 'all' || relationship.category === filters.category)
    .filter(relationship => filters.atStoryOrder === null || (relationship.validFromStoryOrder === null || relationship.validFromStoryOrder <= filters.atStoryOrder) && (relationship.validToStoryOrder === null || relationship.validToStoryOrder >= filters.atStoryOrder))
    .filter(relationship => {
      if (!normalizedQuery) return true
      const source = nodeById.get(relationship.sourceEntityId)
      const target = nodeById.get(relationship.targetEntityId)
      return [
        relationship.label,
        relationship.predicateKey,
        source?.name,
        target?.name,
        ...(source?.aliases ?? []),
        ...(target?.aliases ?? []),
      ].some(value => normalizeRelationshipText(value ?? '').toLowerCase().includes(normalizedQuery))
    })
    .sort((left, right) => relationshipSortKey(left, nodeById).localeCompare(relationshipSortKey(right, nodeById), 'zh-CN')),
  [filters.atStoryOrder, filters.category, filters.factLayer, nodeById, normalizedQuery, relationships])

  const visibleListRelationships = useMemo(() => (listRelationships ?? relationships)
    .filter(relationship => relationship.status === 'active')
    .filter(relationship => filters.factLayer === 'all' || relationship.factLayer === filters.factLayer)
    .filter(relationship => filters.category === 'all' || relationship.category === filters.category)
    .filter(relationship => filters.atStoryOrder === null || (relationship.validFromStoryOrder === null || relationship.validFromStoryOrder <= filters.atStoryOrder) && (relationship.validToStoryOrder === null || relationship.validToStoryOrder >= filters.atStoryOrder))
    .filter(relationship => {
      if (!normalizedQuery) return true
      const source = nodeById.get(relationship.sourceEntityId)
      const target = nodeById.get(relationship.targetEntityId)
      return [relationship.label, relationship.predicateKey, source?.name, target?.name].some(value => normalizeRelationshipText(value ?? '').toLowerCase().includes(normalizedQuery))
    }), [filters.atStoryOrder, filters.category, filters.factLayer, listRelationships, nodeById, normalizedQuery, relationships])

  const availableRoot = filters.rootEntityId && nodeById.has(filters.rootEntityId) ? filters.rootEntityId : null
  const neighborhood = useMemo(() => buildRelationshipNeighborhood(nodes, visibleRelationships, {
    rootEntityId: availableRoot,
    maxDepth: filters.depth,
    maxNodes: filters.depth === 2 ? 80 : 60,
    maxRelationships: filters.depth === 2 ? 180 : 120,
  }), [availableRoot, filters.depth, nodes, visibleRelationships])
  const layout = useMemo(() => layoutRelationshipNeighborhood(neighborhood), [neighborhood])
  const positionedById = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout.nodes])
  const reviewCandidates = useMemo(() => candidates.filter(candidate => candidate.status === 'pending' || candidate.status === 'ambiguous'), [candidates])
  const effectiveMode: EntityRelationshipsViewMode = compact && mode === 'graph' ? 'list' : mode
  const relationshipById = useMemo(() => new Map([...(listRelationships ?? []), ...relationships].map(item => [item.id, item])), [listRelationships, relationships])
  const selectedRelationship = selectedRelationshipId ? relationshipById.get(selectedRelationshipId) ?? null : null
  const selectedEvidence = selectedRelationshipId
    ? localEvidence[selectedRelationshipId] ?? evidenceByRelationshipId[selectedRelationshipId]
    : undefined

  function updateFilters(patch: Partial<RelationshipQueryState>): void {
    const next = { ...filters, ...patch }
    if (!queryState) setLocalQueryState(next)
    onQueryStateChange?.(next)
  }

  useEffect(() => {
    const firstId = layout.nodes[0]?.id ?? null
    if (!focusedNodeId || !positionedById.has(focusedNodeId)) setFocusedNodeId(neighborhood.rootEntityId ?? firstId)
  }, [focusedNodeId, layout.nodes, neighborhood.rootEntityId, positionedById])

  useEffect(() => {
    if (!selectedRelationshipId) return
    evidenceCloseRef.current?.focus()
  }, [selectedRelationshipId])

  async function loadEvidence(relationshipId: string): Promise<void> {
    const requestId = ++evidenceRequestRef.current
    if (Object.prototype.hasOwnProperty.call(evidenceByRelationshipId, relationshipId) || Object.prototype.hasOwnProperty.call(localEvidence, relationshipId)) {
      setEvidenceLoad({ relationshipId, status: 'idle', error: null })
      return
    }
    if (!onRequestEvidence) {
      setEvidenceLoad({ relationshipId, status: 'idle', error: null })
      return
    }
    setEvidenceLoad({ relationshipId, status: 'loading', error: null })
    try {
      const evidence = await onRequestEvidence(relationshipId)
      if (requestId !== evidenceRequestRef.current) return
      setLocalEvidence(current => ({ ...current, [relationshipId]: evidence }))
      setEvidenceLoad(current => current.relationshipId === relationshipId ? { relationshipId, status: 'idle', error: null } : current)
    } catch (cause) {
      if (requestId !== evidenceRequestRef.current) return
      setEvidenceLoad(current => current.relationshipId === relationshipId
        ? { relationshipId, status: 'error', error: errorMessage(cause, '证据载入失败。') }
        : current)
    }
  }

  function openEvidence(relationshipId: string, opener: HTMLButtonElement): void {
    evidenceOpenerRef.current = opener
    setSelectedRelationshipId(relationshipId)
    void loadEvidence(relationshipId)
  }

  function closeEvidence(): void {
    evidenceRequestRef.current += 1
    setSelectedRelationshipId(null)
    setEvidenceLoad({ relationshipId: null, status: 'idle', error: null })
    const opener = evidenceOpenerRef.current
    evidenceOpenerRef.current = null
    if (opener) requestAnimationFrame(() => { opener.focus() })
  }

  function handleEvidenceDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeEvidence()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(evidenceDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function focusGraphNode(index: number): void {
    const ordered = layout.nodes
    if (ordered.length === 0) return
    const normalizedIndex = (index + ordered.length) % ordered.length
    const nextId = ordered[normalizedIndex]!.id
    setFocusedNodeId(nextId)
    graphNodeRefs.current.get(nextId)?.focus()
  }

  function handleGraphNodeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusGraphNode(index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusGraphNode(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusGraphNode(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusGraphNode(layout.nodes.length - 1)
    }
  }

  async function decideCandidate(candidate: EntityRelationshipCandidate, decision: RelationshipCandidateDecision): Promise<void> {
    if (!onDecideCandidate) return
    if (decision.action === 'confirm') {
      const reviewedCandidate = {
        ...candidate,
        sourceEntityId: decision.sourceEntityId ?? candidate.sourceEntityId,
        targetEntityId: decision.targetEntityId ?? candidate.targetEntityId,
      }
      if (!relationshipCandidateConfirmability(reviewedCandidate).ok) return
    }
    setCandidateBusyId(candidate.id)
    setCandidateError(null)
    try {
      await onDecideCandidate({ candidateId: candidate.id, decision })
    } catch (cause) {
      setCandidateError(errorMessage(cause, '候选关系处理失败。'))
    } finally {
      setCandidateBusyId(null)
    }
  }

  async function decideCandidateBatch(requests: readonly RelationshipCandidateReviewRequest[]): Promise<void> {
    if (requests.length === 0 || (!onDecideCandidates && !onDecideCandidate)) return
    setCandidateBusyId('__batch__')
    setCandidateError(null)
    try {
      if (onDecideCandidates) await onDecideCandidates(requests)
      else for (const request of requests) await onDecideCandidate!(request)
    } catch (cause) {
      setCandidateError(errorMessage(cause, '批量候选关系处理失败。'))
    } finally {
      setCandidateBusyId(null)
    }
  }

  return <section className="ns-rel" aria-label="实体关系" aria-busy={loading}>
    <style>{relationshipStyles}</style>
    <header className="ns-rel__header">
      <div>
        <h2>实体关系</h2>
        <p>关系事实与来源证据分开保存。AI 提取结果需要确认后才进入关系事实。</p>
      </div>
      <div className="ns-rel__summary" aria-label="关系概况">
        <strong>{relationships.filter(item => item.status === 'active').length}</strong><span>条关系</span>
        <strong>{reviewCandidates.length}</strong><span>条待确认</span>
      </div>
    </header>

    <div className="ns-rel__tabs" role="tablist" aria-label="关系查看方式">
      <ModeButton mode="graph" current={effectiveMode} disabled={compact} setMode={setMode}>关系图</ModeButton>
      <ModeButton mode="list" current={effectiveMode} setMode={setMode}>关系列表</ModeButton>
      <ModeButton mode="candidates" current={effectiveMode} setMode={setMode}>待确认 <span className="ns-rel__count">{reviewCandidates.length}</span></ModeButton>
    </div>

    {error && <div className="ns-rel__notice ns-rel__notice--error" role="alert"><span>{error}</span>{onRetry && <button type="button" onClick={() => { void onRetry() }}>重试</button>}</div>}
    {candidateError && <div className="ns-rel__notice ns-rel__notice--error" role="alert"><span>{candidateError}</span><button type="button" onClick={() => { setCandidateError(null) }}>关闭</button></div>}

    {effectiveMode !== 'candidates' && <div className="ns-rel__filters" aria-label="筛选关系">
      <label><span>搜索</span><input type="search" value={filters.q} onChange={event => { updateFilters({ q: event.target.value }) }} placeholder="实体名或关系" /></label>
      <label><span>关系类别</span><select value={filters.category} onChange={event => { updateFilters({ category: event.target.value as RelationshipQueryState['category'] }) }}>{categoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label><span>事实层</span><select value={filters.factLayer} onChange={event => { updateFilters({ factLayer: event.target.value as RelationshipQueryState['factLayer'] }) }}>{factLayerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label><span>截至故事序</span><input type="number" min={0} value={filters.atStoryOrder ?? ''} onChange={event => { updateFilters({ atStoryOrder: event.target.value ? Math.max(0, Math.trunc(Number(event.target.value))) : null }) }} placeholder="全部" /></label>
      {effectiveMode === 'graph' && <><label><span>跳数</span><select value={filters.depth} onChange={event => { updateFilters({ depth: Number(event.target.value) === 2 ? 2 : 1 }) }}><option value={1}>一跳 · 60/120</option><option value={2}>二跳 · 80/180</option></select></label><label><span>中心实体</span><select value={availableRoot ?? neighborhood.rootEntityId ?? ''} onChange={event => { updateFilters({ rootEntityId: event.target.value || null }) }}><option value="">自动选择</option>{[...entityOptions].sort(compareEntityNode).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label></>}
    </div>}

    {loading
      ? <RelationshipLoading />
      : effectiveMode === 'graph'
        ? <GraphView
            layout={layout}
            neighborhood={neighborhood}
            nodeById={nodeById}
            positionedById={positionedById}
            focusedNodeId={focusedNodeId}
            graphNodeRefs={graphNodeRefs}
            setFocusedNodeId={setFocusedNodeId}
            setRootEntityId={id => { updateFilters({ rootEntityId: id }) }}
            handleGraphNodeKeyDown={handleGraphNodeKeyDown}
            onSelectEntity={onSelectEntity}
            openEvidence={openEvidence}
          />
        : effectiveMode === 'list'
          ? <RelationshipList relationships={visibleListRelationships} total={listTotal ?? visibleListRelationships.length} nextCursor={listNextCursor ?? null} loadingMore={listLoadingMore} onLoadMore={onLoadMoreRelationships} nodeById={nodeById} compact={compact} openEvidence={openEvidence} />
          : <CandidateReview nodes={entityOptions} candidates={reviewCandidates} busyId={candidateBusyId} readOnly={!onDecideCandidate && !onDecideCandidates} decide={decideCandidate} decideBatch={decideCandidateBatch} />}

    {selectedRelationship && <div className="ns-rel__dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeEvidence() }}>
      <div ref={evidenceDialogRef} className="ns-rel__dialog" role="dialog" aria-modal="true" aria-label={`关系证据：${relationshipSentence(selectedRelationship, nodeById)}`} onKeyDown={handleEvidenceDialogKeyDown}>
        <div className="ns-rel__dialog-header"><div><span>关系证据</span><h3>{relationshipSentence(selectedRelationship, nodeById)}</h3></div><button ref={evidenceCloseRef} type="button" onClick={closeEvidence}>关闭</button></div>
        <dl className="ns-rel__facts"><div><dt>事实层</dt><dd>{factLayerLabel(selectedRelationship.factLayer)}</dd></div><div><dt>有效区间</dt><dd>{storyRangeLabel(selectedRelationship)}</dd></div><div><dt>来源方式</dt><dd>{createdByLabel(selectedRelationship.createdBy)}</dd></div></dl>
        {evidenceLoad.relationshipId === selectedRelationship.id && evidenceLoad.status === 'loading'
          ? <div className="ns-rel__empty" role="status">正在载入证据...</div>
          : evidenceLoad.relationshipId === selectedRelationship.id && evidenceLoad.status === 'error'
            ? <div className="ns-rel__notice ns-rel__notice--error" role="alert"><span>{evidenceLoad.error}</span><button type="button" onClick={() => { void loadEvidence(selectedRelationship.id) }}>重试</button></div>
            : <EvidenceItems evidence={selectedEvidence ?? []} />}
      </div>
    </div>}
  </section>
}

function ModeButton({ mode, current, disabled = false, setMode, children }: {
  mode: EntityRelationshipsViewMode
  current: EntityRelationshipsViewMode
  disabled?: boolean
  setMode: (mode: EntityRelationshipsViewMode) => void
  children: ReactNode
}) {
  return <button type="button" role="tab" aria-selected={current === mode} disabled={disabled} title={disabled ? '窄屏使用关系列表' : undefined} onClick={() => { setMode(mode) }}>{children}</button>
}

function RelationshipLoading() {
  return <div className="ns-rel__empty" role="status">正在载入实体关系...</div>
}

function GraphView({
  layout,
  neighborhood,
  nodeById,
  positionedById,
  focusedNodeId,
  graphNodeRefs,
  setFocusedNodeId,
  setRootEntityId,
  handleGraphNodeKeyDown,
  onSelectEntity,
  openEvidence,
}: {
  layout: ReturnType<typeof layoutRelationshipNeighborhood>
  neighborhood: ReturnType<typeof buildRelationshipNeighborhood>
  nodeById: ReadonlyMap<string, RelationshipEntityNode>
  positionedById: ReadonlyMap<string, ReturnType<typeof layoutRelationshipNeighborhood>['nodes'][number]>
  focusedNodeId: string | null
  graphNodeRefs: MutableRefObject<Map<string, HTMLButtonElement>>
  setFocusedNodeId: (id: string) => void
  setRootEntityId: (id: string) => void
  handleGraphNodeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => void
  onSelectEntity?: (entityId: string) => void
  openEvidence: (relationshipId: string, opener: HTMLButtonElement) => void
}) {
  if (neighborhood.nodes.length === 0) return <EmptyRelationships title="还没有可显示的关系" text="确认 AI 候选或由作者新增关系后，这里会出现实体邻域。" />
  return <div role="tabpanel" className="ns-rel__graph-panel">
    <div className="ns-rel__canvas-scroll">
      <div className="ns-rel__canvas" role="group" aria-label="实体关系图，方向键移动焦点" style={{ width: layout.width, height: layout.height }}>
        <svg aria-hidden="true" viewBox={`0 0 ${layout.width} ${layout.height}`}>
          {neighborhood.relationships.map(relationship => {
            const source = positionedById.get(relationship.sourceEntityId)
            const target = positionedById.get(relationship.targetEntityId)
            if (!source || !target) return null
            return <line key={relationship.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`ns-rel__edge ns-rel__edge--${relationship.factLayer}`} />
          })}
        </svg>
        {layout.nodes.map((node, index) => <button
          key={node.id}
          ref={element => { if (element) graphNodeRefs.current.set(node.id, element); else graphNodeRefs.current.delete(node.id) }}
          type="button"
          className={`ns-rel__node${node.id === neighborhood.rootEntityId ? ' ns-rel__node--root' : ''}`}
          style={{ left: node.x, top: node.y } as CSSProperties}
          tabIndex={focusedNodeId === node.id ? 0 : -1}
          aria-label={`${node.name}，${entityTypeLabel(node.type)}，连接 ${node.degree} 条关系`}
          onFocus={() => { setFocusedNodeId(node.id) }}
          onKeyDown={event => { handleGraphNodeKeyDown(event, index) }}
          onClick={() => { setRootEntityId(node.id); onSelectEntity?.(node.id) }}
        ><strong>{node.name}</strong><span>{entityTypeLabel(node.type)}</span></button>)}
      </div>
    </div>
    {(neighborhood.truncated.nodes || neighborhood.truncated.relationships) && <p className="ns-rel__truncated">当前仅显示有界邻域。可切换中心实体或使用关系列表查看其余内容。</p>}
    <CompactRelationshipRows relationships={neighborhood.relationships} nodeById={nodeById} openEvidence={openEvidence} />
  </div>
}

function RelationshipList({ relationships, total, nextCursor, loadingMore, onLoadMore, nodeById, compact, openEvidence }: {
  relationships: readonly EntityRelationship[]
  total: number
  nextCursor: string | null
  loadingMore: boolean
  onLoadMore?: () => void | Promise<void>
  nodeById: ReadonlyMap<string, RelationshipEntityNode>
  compact: boolean
  openEvidence: (relationshipId: string, opener: HTMLButtonElement) => void
}) {
  if (relationships.length === 0) return <EmptyRelationships title="没有符合条件的关系" text="清除筛选，或前往待确认列表处理 AI 候选。" />
  const content = compact
    ? <div className="ns-rel__cards">{relationships.map(relationship => <article key={relationship.id} className="ns-rel__card"><div className="ns-rel__sentence">{relationshipSentence(relationship, nodeById)}</div><div className="ns-rel__meta"><span>{factLayerLabel(relationship.factLayer)}</span><span>{categoryLabel(relationship.category)}</span><span>{storyRangeLabel(relationship)}</span></div><button type="button" onClick={event => { openEvidence(relationship.id, event.currentTarget) }}>查看证据</button></article>)}</div>
    : <div className="ns-rel__table-scroll"><table className="ns-rel__table"><thead><tr><th>源实体</th><th>关系</th><th>目标实体</th><th>事实层</th><th>有效区间</th><th><span className="ns-rel__sr-only">操作</span></th></tr></thead><tbody>{relationships.map(relationship => <tr key={relationship.id}><td>{entityName(relationship.sourceEntityId, nodeById)}</td><td><strong>{directionSymbol(relationship)} {relationship.label}</strong><small>{categoryLabel(relationship.category)}</small></td><td>{entityName(relationship.targetEntityId, nodeById)}</td><td>{factLayerLabel(relationship.factLayer)}</td><td>{storyRangeLabel(relationship)}</td><td><button type="button" onClick={event => { openEvidence(relationship.id, event.currentTarget) }}>查看证据</button></td></tr>)}</tbody></table></div>
  return <div role="tabpanel" className="ns-rel__list-panel">{content}<footer><span>已载入 {relationships.length} / {total} 条正式关系</span>{nextCursor && onLoadMore && <button type="button" disabled={loadingMore} onClick={() => { void onLoadMore() }}>{loadingMore ? '正在载入…' : '载入更多'}</button>}</footer></div>
}

function CompactRelationshipRows({ relationships, nodeById, openEvidence }: {
  relationships: readonly EntityRelationship[]
  nodeById: ReadonlyMap<string, RelationshipEntityNode>
  openEvidence: (relationshipId: string, opener: HTMLButtonElement) => void
}) {
  return <section className="ns-rel__nearby" aria-label="当前邻域关系"><h3>当前邻域关系</h3>{relationships.length === 0 ? <p>中心实体暂时没有关系。</p> : <div>{relationships.map(relationship => <button key={relationship.id} type="button" onClick={event => { openEvidence(relationship.id, event.currentTarget) }}><span>{relationshipSentence(relationship, nodeById)}</span><small>{factLayerLabel(relationship.factLayer)}，查看证据</small></button>)}</div>}</section>
}

type CandidateDraft = {
  sourceEntityId: string | null
  targetEntityId: string | null
  label: string
  predicateKey: string
  category: EntityRelationshipCategory
  directionality: 'directed' | 'symmetric'
  factLayer: EntityRelationshipFactLayer
  validFromStoryOrder: number | null
  validToStoryOrder: number | null
}

function CandidateReview({ nodes, candidates, busyId, readOnly, decide, decideBatch }: {
  nodes: readonly RelationshipEntityNode[]
  candidates: readonly EntityRelationshipCandidate[]
  busyId: string | null
  readOnly: boolean
  decide: (candidate: EntityRelationshipCandidate, decision: RelationshipCandidateDecision) => Promise<void>
  decideBatch: (requests: readonly RelationshipCandidateReviewRequest[]) => Promise<void>
}) {
  const [resolutions, setResolutions] = useState<Record<string, Partial<CandidateDraft>>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const sortedNodes = useMemo(() => [...nodes].sort(compareEntityNode), [nodes])
  useEffect(() => { setSelectedIds(current => current.filter(id => candidates.some(candidate => candidate.id === id))) }, [candidates])
  if (candidates.length === 0) return <div role="tabpanel"><EmptyRelationships title="没有待确认关系" text="AI 提取的新关系会先停在这里，不会直接写入关系事实。" /></div>
  const busy = busyId !== null
  const allSelected = candidates.length > 0 && selectedIds.length === candidates.length
  const draftFor = (candidate: EntityRelationshipCandidate): CandidateDraft => ({
    sourceEntityId: candidate.sourceEntityId, targetEntityId: candidate.targetEntityId, label: candidate.label, predicateKey: candidate.predicateKey,
    category: candidate.category, directionality: candidate.directionality, factLayer: candidate.factLayer,
    validFromStoryOrder: candidate.validFromStoryOrder, validToStoryOrder: candidate.validToStoryOrder, ...resolutions[candidate.id],
  })
  const update = <K extends keyof CandidateDraft>(candidate: EntityRelationshipCandidate, key: K, value: CandidateDraft[K]) => {
    setResolutions(current => ({ ...current, [candidate.id]: { ...current[candidate.id], [key]: value } }))
  }
  const decisionFor = (candidate: EntityRelationshipCandidate): RelationshipCandidateDecision => {
    const draft = draftFor(candidate)
    return {
      action: 'confirm', ...draft,
      sourceEntityId: draft.sourceEntityId ?? undefined, targetEntityId: draft.targetEntityId ?? undefined,
      sourceLabel: draft.sourceEntityId ? nodeById.get(draft.sourceEntityId)?.name : undefined,
      targetLabel: draft.targetEntityId ? nodeById.get(draft.targetEntityId)?.name : undefined,
    }
  }
  const selectedCandidates = candidates.filter(candidate => selectedIds.includes(candidate.id))
  const selectedConfirmable = selectedCandidates.every(candidate => relationshipCandidateConfirmability({ ...candidate, ...draftFor(candidate) }).ok)
  return <div role="tabpanel" className="ns-rel__candidates">
    {readOnly && <div className="ns-rel__notice">当前为归档只读模式。可以查看候选及证据，但不能确认、拒绝或修改。</div>}
    {!readOnly && <div className="ns-rel__candidate-batch"><label><input type="checkbox" checked={allSelected} onChange={event => { setSelectedIds(event.target.checked ? candidates.map(candidate => candidate.id) : []) }} />选择全部 {candidates.length} 条</label><span>已选 {selectedIds.length}</span><button type="button" disabled={busy || selectedIds.length === 0} onClick={() => { void decideBatch(selectedCandidates.map(candidate => ({ candidateId: candidate.id, decision: { action: 'reject' } }))) }}>批量拒绝</button><button type="button" className="ns-rel__primary" disabled={busy || selectedIds.length === 0 || !selectedConfirmable} onClick={() => { void decideBatch(selectedCandidates.map(candidate => ({ candidateId: candidate.id, decision: decisionFor(candidate) }))) }}>批量确认</button></div>}
    {candidates.map(candidate => {
    const resolution = draftFor(candidate)
    const reviewedCandidate = { ...candidate, ...resolution }
    const confirmability = relationshipCandidateConfirmability(reviewedCandidate)
    const itemBusy = busyId === candidate.id || busyId === '__batch__'
    const selected = selectedIds.includes(candidate.id)
    return <article key={candidate.id} className="ns-rel__candidate">
      <label className="ns-rel__candidate-select"><input type="checkbox" checked={selected} disabled={readOnly || busy} onChange={event => { setSelectedIds(current => event.target.checked ? [...new Set([...current, candidate.id])] : current.filter(id => id !== candidate.id)) }} /><span className="ns-rel__sr-only">选择候选关系</span></label>
      <div className="ns-rel__candidate-main"><div className="ns-rel__candidate-title"><strong>{candidate.sourceLabel || '未解析实体'} {resolution.directionality === 'symmetric' ? '↔' : '→'} {candidate.targetLabel || '未解析实体'}</strong><span>{Math.round(Math.max(0, Math.min(1, candidate.confidence)) * 100)}% 置信度</span></div><p>{resolution.label}<small>{categoryLabel(resolution.category)}，{factLayerLabel(resolution.factLayer)}</small></p><details className="ns-rel__candidate-editor" open={candidate.status === 'ambiguous' ? true : undefined}><summary>检查并修改关系字段</summary><div className="ns-rel__resolution"><label><span>源实体</span><select aria-label={`${candidate.sourceLabel} 对应的源实体`} value={resolution.sourceEntityId ?? ''} disabled={readOnly || busy} onChange={event => { update(candidate, 'sourceEntityId', event.target.value || null) }}><option value="">选择实体</option>{sortedNodes.map(node => <option key={node.id} value={node.id}>{node.name}，{entityTypeLabel(node.type)}</option>)}</select></label><label><span>目标实体</span><select aria-label={`${candidate.targetLabel} 对应的目标实体`} value={resolution.targetEntityId ?? ''} disabled={readOnly || busy} onChange={event => { update(candidate, 'targetEntityId', event.target.value || null) }}><option value="">选择实体</option>{sortedNodes.map(node => <option key={node.id} value={node.id}>{node.name}，{entityTypeLabel(node.type)}</option>)}</select></label><label><span>显示关系</span><input value={resolution.label} disabled={readOnly || busy} onChange={event => { update(candidate, 'label', event.target.value) }} /></label><label><span>谓词键</span><input value={resolution.predicateKey} disabled={readOnly || busy} onChange={event => { update(candidate, 'predicateKey', event.target.value) }} /></label><label><span>类别</span><select value={resolution.category} disabled={readOnly || busy} onChange={event => { update(candidate, 'category', event.target.value as EntityRelationshipCategory) }}>{categoryOptions.filter(option => option.value !== 'all').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>方向</span><select value={resolution.directionality} disabled={readOnly || busy} onChange={event => { update(candidate, 'directionality', event.target.value as CandidateDraft['directionality']) }}><option value="directed">单向</option><option value="symmetric">双向</option></select></label><label><span>事实层</span><select value={resolution.factLayer} disabled={readOnly || busy} onChange={event => { update(candidate, 'factLayer', event.target.value as EntityRelationshipFactLayer) }}>{factLayerOptions.filter(option => option.value !== 'all').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>有效故事序（起）</span><input type="number" min={0} value={resolution.validFromStoryOrder ?? ''} disabled={readOnly || busy} onChange={event => { update(candidate, 'validFromStoryOrder', event.target.value ? Math.max(0, Math.trunc(Number(event.target.value))) : null) }} /></label><label><span>有效故事序（止）</span><input type="number" min={0} value={resolution.validToStoryOrder ?? ''} disabled={readOnly || busy} onChange={event => { update(candidate, 'validToStoryOrder', event.target.value ? Math.max(0, Math.trunc(Number(event.target.value))) : null) }} /></label></div></details>{!confirmability.ok && <div className="ns-rel__candidate-warning">{confirmabilityLabel(confirmability.issues)}</div>}<EvidenceItems evidence={candidate.evidence} compact /></div>
      <div className="ns-rel__candidate-actions"><button type="button" disabled={readOnly || busy} onClick={() => { void decide(candidate, { action: 'reject' }) }}>{itemBusy ? '处理中...' : '拒绝'}</button><button type="button" className="ns-rel__primary" disabled={readOnly || busy || !confirmability.ok} onClick={() => { void decide(candidate, decisionFor(candidate)) }}>{itemBusy ? '处理中...' : '确认关系'}</button></div>
    </article>
  })}</div>
}

function EvidenceItems({ evidence, compact = false }: { evidence: readonly EntityRelationshipEvidence[]; compact?: boolean }) {
  if (compact) return <details className="ns-rel__candidate-evidence"><summary>证据 {evidence.length} 条</summary>{evidence.length === 0 ? <p>候选未附带可定位证据。</p> : <EvidenceList evidence={evidence} />}</details>
  if (evidence.length === 0) return <div className="ns-rel__empty">这条关系还没有可展示的来源证据。</div>
  return <EvidenceList evidence={evidence} />
}

function EvidenceList({ evidence }: { evidence: readonly EntityRelationshipEvidence[] }) {
  return <ol className="ns-rel__evidence-list">{evidence.map(item => <li key={item.id}><div><strong>{item.label}</strong><span>{item.sourceType}，{item.sourceVersionId ? `版本 ${item.sourceVersionId}` : `来源 ${item.sourceId}`}</span></div>{item.excerpt && <blockquote>{item.excerpt}</blockquote>}{!item.excerpt && item.excerptStart !== null && <p>原文位置 {item.excerptStart} 至 {item.excerptEnd ?? item.excerptStart}</p>}</li>)}</ol>
}

function EmptyRelationships({ title, text }: { title: string; text: string }) {
  return <div className="ns-rel__empty"><strong>{title}</strong><p>{text}</p></div>
}

function useRelationshipNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 760px)')
    const update = () => { setNarrow(media.matches) }
    media.addEventListener('change', update)
    update()
    return () => { media.removeEventListener('change', update) }
  }, [])
  return narrow
}

function relationshipSentence(relationship: EntityRelationship, nodeById: ReadonlyMap<string, RelationshipEntityNode>): string {
  return `${entityName(relationship.sourceEntityId, nodeById)} ${directionSymbol(relationship)} ${relationship.label} ${entityName(relationship.targetEntityId, nodeById)}`
}

function entityName(id: string, nodeById: ReadonlyMap<string, RelationshipEntityNode>): string {
  return nodeById.get(id)?.name ?? id
}

function directionSymbol(relationship: EntityRelationship): string {
  return relationship.directionality === 'symmetric' ? '↔' : '→'
}

function relationshipSortKey(relationship: EntityRelationship, nodeById: ReadonlyMap<string, RelationshipEntityNode>): string {
  return `${entityName(relationship.sourceEntityId, nodeById)}\u0000${relationship.label}\u0000${entityName(relationship.targetEntityId, nodeById)}\u0000${relationship.id}`
}

function compareEntityNode(left: RelationshipEntityNode, right: RelationshipEntityNode): number {
  return left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
}

function factLayerLabel(layer: EntityRelationshipFactLayer): string {
  return layer === 'canon' ? 'Canon' : layer === 'planned' ? '规划' : '作者声明'
}

function categoryLabel(category: EntityRelationship['category']): string {
  return ({ family: '亲属', emotion: '情感', alliance: '同盟', conflict: '冲突', membership: '隶属', possession: '持有', location: '位置', knowledge: '知情', causality: '因果', other: '其他' } as const)[category]
}

function createdByLabel(createdBy: EntityRelationship['createdBy']): string {
  return createdBy === 'user' ? '作者录入' : createdBy === 'ai_confirmed' ? 'AI 提取后确认' : 'AI 自动模式'
}

function entityTypeLabel(type: string): string {
  return ({ character: '人物', location: '地点', faction: '阵营', item: '物品', ability: '能力', species: '种族', organization: '组织', concept: '概念', rule: '规则' } as Record<string, string>)[type] ?? type
}

function storyRangeLabel(range: { validFromStoryOrder: number | null; validToStoryOrder: number | null }): string {
  if (range.validFromStoryOrder === null && range.validToStoryOrder === null) return '未限定'
  if (range.validFromStoryOrder === null) return `截至故事序 ${range.validToStoryOrder}`
  if (range.validToStoryOrder === null) return `自故事序 ${range.validFromStoryOrder}`
  return `故事序 ${range.validFromStoryOrder} 至 ${range.validToStoryOrder}`
}

function confirmabilityLabel(issues: readonly string[]): string {
  if (issues.includes('missing_source_entity') || issues.includes('missing_target_entity')) return '需要先把两端提及解析到实体。'
  if (issues.includes('same_entity')) return '关系两端不能是同一个实体。'
  if (issues.includes('invalid_time_range')) return '有效时间区间不合法。'
  if (issues.includes('invalid_confidence')) return '候选置信度不合法。'
  if (issues.includes('missing_predicate') || issues.includes('missing_label')) return '关系类型或显示名称缺失。'
  return '这条候选当前不能确认。'
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

const relationshipStyles = `
.ns-rel { --ns-rel-bg: var(--dsw-alias-bg-base, #fff); --ns-rel-layer: var(--dsw-alias-bg-layer-1, #fff); --ns-rel-module: var(--dsw-alias-bg-module-platform, #f5f6f7); --ns-rel-hover: var(--dsw-specific-sidebar-nav-item-hover, #f1f3f5); --ns-rel-active: var(--dsw-specific-sidebar-nav-item-active, #e9ecf2); --ns-rel-text: var(--dsw-alias-label-primary, #202124); --ns-rel-muted: var(--dsw-alias-label-secondary, #666b73); --ns-rel-faint: var(--dsw-alias-label-tertiary, #8a9099); --ns-rel-border: var(--dsw-alias-border-l2, rgba(0,0,0,.12)); --ns-rel-border-soft: var(--dsw-alias-border-l1, rgba(0,0,0,.06)); --ns-rel-accent: var(--dsw-alias-state-business-primary, #4176e6); --ns-rel-danger: var(--dsw-alias-state-error-primary, #c73737); min-width: 0; color: var(--ns-rel-text); background: var(--ns-rel-bg); font-family: var(--dsw-font-family, "PingFang SC", "Microsoft YaHei", sans-serif); }
.ns-rel *, .ns-rel *::before, .ns-rel *::after { box-sizing: border-box; }
.ns-rel button, .ns-rel input, .ns-rel select { font: inherit; }
.ns-rel button:focus-visible, .ns-rel input:focus-visible, .ns-rel select:focus-visible, .ns-rel summary:focus-visible { outline: 2px solid var(--ns-rel-accent); outline-offset: 2px; }
.ns-rel__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 18px 20px 15px; border-bottom: 1px solid var(--ns-rel-border-soft); }
.ns-rel__header h2 { margin: 0; font-size: 17px; line-height: 1.35; }
.ns-rel__header p { max-width: 680px; margin: 5px 0 0; color: var(--ns-rel-muted); font-size: 12px; line-height: 1.6; }
.ns-rel__summary { display: grid; grid-template-columns: auto auto; align-items: baseline; gap: 1px 7px; flex: 0 0 auto; padding-top: 1px; }
.ns-rel__summary strong { text-align: right; font-size: 16px; font-variant-numeric: tabular-nums; }
.ns-rel__summary span { color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__tabs { display: flex; gap: 2px; min-height: 42px; padding: 5px 16px; border-bottom: 1px solid var(--ns-rel-border-soft); background: var(--ns-rel-module); }
.ns-rel__tabs button { min-height: 32px; padding: 0 11px; border: 0; border-radius: 7px; color: var(--ns-rel-muted); background: transparent; cursor: pointer; font-size: 12px; }
.ns-rel__tabs button[aria-selected="true"] { color: var(--ns-rel-text); background: var(--ns-rel-layer); font-weight: 600; }
.ns-rel__tabs button:disabled { cursor: not-allowed; opacity: .48; }
.ns-rel__count { display: inline-grid; place-items: center; min-width: 19px; height: 19px; margin-left: 4px; padding: 0 5px; border-radius: 6px; background: var(--ns-rel-active); font-size: 10px; font-variant-numeric: tabular-nums; }
.ns-rel__filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--ns-rel-border-soft); }
.ns-rel__filters label { display: grid; gap: 4px; color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__filters input, .ns-rel__filters select { width: 190px; height: 34px; padding: 0 9px; border: 1px solid var(--ns-rel-border); border-radius: 7px; color: var(--ns-rel-text); background: var(--ns-rel-layer); font-size: 12px; }
.ns-rel__notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 10px 16px 0; padding: 9px 11px; border: 1px solid var(--ns-rel-border); border-radius: 8px; color: var(--ns-rel-muted); background: var(--ns-rel-layer); font-size: 11px; }
.ns-rel__notice--error { border-color: color-mix(in srgb, var(--ns-rel-danger) 55%, var(--ns-rel-border)); color: var(--ns-rel-danger); }
.ns-rel__notice button, .ns-rel__card button, .ns-rel__table button, .ns-rel__candidate button, .ns-rel__dialog button { min-height: 32px; padding: 0 10px; border: 1px solid var(--ns-rel-border); border-radius: 7px; color: var(--ns-rel-text); background: var(--ns-rel-layer); cursor: pointer; white-space: nowrap; font-size: 11px; }
.ns-rel__notice button:disabled, .ns-rel__candidate button:disabled { cursor: not-allowed; opacity: .5; }
.ns-rel__empty { display: grid; place-items: center; align-content: center; min-height: 180px; padding: 28px; color: var(--ns-rel-muted); text-align: center; font-size: 12px; }
.ns-rel__empty strong { color: var(--ns-rel-text); font-size: 13px; }
.ns-rel__empty p { max-width: 420px; margin: 6px 0 0; line-height: 1.65; }
.ns-rel__graph-panel { min-width: 0; }
.ns-rel__canvas-scroll { overflow: auto; border-bottom: 1px solid var(--ns-rel-border-soft); background: var(--ns-rel-module); }
.ns-rel__canvas { position: relative; margin: 0 auto; }
.ns-rel__canvas svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ns-rel__edge { stroke: var(--ns-rel-faint); stroke-width: 1.1; opacity: .55; }
.ns-rel__edge--planned { stroke-dasharray: 5 5; opacity: .45; }
.ns-rel__edge--author_asserted { stroke: var(--ns-rel-accent); opacity: .42; }
.ns-rel__node { position: absolute; width: 110px; min-height: 44px; padding: 6px 8px; transform: translate(-50%, -50%); border: 1px solid var(--ns-rel-border); border-radius: 9px; color: var(--ns-rel-text); background: var(--ns-rel-layer); cursor: pointer; box-shadow: 0 2px 8px rgba(20, 24, 32, .06); }
.ns-rel__node:hover { background: var(--ns-rel-hover); }
.ns-rel__node--root { border-color: var(--ns-rel-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ns-rel-accent) 13%, transparent); }
.ns-rel__node strong, .ns-rel__node span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ns-rel__node strong { font-size: 11px; }
.ns-rel__node span { margin-top: 2px; color: var(--ns-rel-muted); font-size: 9px; }
.ns-rel__truncated { margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--ns-rel-border-soft); color: var(--ns-rel-muted); background: var(--ns-rel-module); font-size: 10px; }
.ns-rel__nearby { padding: 14px 16px 18px; }
.ns-rel__nearby h3 { margin: 0 0 8px; font-size: 12px; }
.ns-rel__nearby p { margin: 0; color: var(--ns-rel-muted); font-size: 11px; }
.ns-rel__nearby > div { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 7px; }
.ns-rel__nearby button { display: grid; gap: 3px; padding: 8px 10px; border: 1px solid var(--ns-rel-border-soft); border-radius: 8px; color: var(--ns-rel-text); background: var(--ns-rel-layer); cursor: pointer; text-align: left; }
.ns-rel__nearby button:hover { border-color: var(--ns-rel-border); background: var(--ns-rel-hover); }
.ns-rel__nearby button span { font-size: 11px; }
.ns-rel__nearby button small { color: var(--ns-rel-muted); font-size: 9px; }
.ns-rel__table-scroll { overflow: auto; }
.ns-rel__table { width: 100%; border-collapse: collapse; font-size: 11px; }
.ns-rel__table th { padding: 9px 12px; border-bottom: 1px solid var(--ns-rel-border); color: var(--ns-rel-muted); background: var(--ns-rel-module); text-align: left; font-size: 10px; font-weight: 500; white-space: nowrap; }
.ns-rel__table td { padding: 10px 12px; border-bottom: 1px solid var(--ns-rel-border-soft); vertical-align: middle; }
.ns-rel__table td:nth-child(2) strong, .ns-rel__table td:nth-child(2) small { display: block; }
.ns-rel__table td:nth-child(2) small { margin-top: 2px; color: var(--ns-rel-muted); }
.ns-rel__list-panel > footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--ns-rel-border-soft); color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__list-panel > footer button { min-height: 31px; padding: 0 10px; border: 1px solid var(--ns-rel-border); border-radius: 7px; color: var(--ns-rel-text); background: var(--ns-rel-layer); cursor: pointer; font-size: 10px; }
.ns-rel__cards { display: grid; gap: 8px; padding: 12px; }
.ns-rel__card { padding: 11px; border: 1px solid var(--ns-rel-border); border-radius: 9px; background: var(--ns-rel-layer); }
.ns-rel__sentence { font-size: 12px; font-weight: 600; line-height: 1.55; }
.ns-rel__meta { display: flex; flex-wrap: wrap; gap: 5px 12px; margin: 6px 0 9px; color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__candidates { display: grid; gap: 9px; padding: 14px 16px 20px; }
.ns-rel__candidate-batch { position: sticky; z-index: 2; top: 0; display: flex; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid var(--ns-rel-border); border-radius: 9px; background: var(--ns-rel-module); }
.ns-rel__candidate-batch label { display: flex; align-items: center; gap: 6px; font-size: 10px; }
.ns-rel__candidate-batch span { margin-right: auto; color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__candidate-batch button { min-height: 30px; padding: 0 9px; border: 1px solid var(--ns-rel-border); border-radius: 7px; color: var(--ns-rel-text); background: var(--ns-rel-layer); cursor: pointer; font-size: 10px; }
.ns-rel__candidate-batch .ns-rel__primary { border-color: var(--ns-rel-accent); color: #fff; background: var(--ns-rel-accent); }
.ns-rel__candidate { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; padding: 13px; border: 1px solid var(--ns-rel-border); border-radius: 9px; background: var(--ns-rel-layer); }
.ns-rel__candidate-select { align-self: start; padding-top: 2px; }
.ns-rel__candidate-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ns-rel__candidate-title strong { font-size: 13px; }
.ns-rel__candidate-title span { color: var(--ns-rel-muted); font-size: 10px; white-space: nowrap; }
.ns-rel__candidate-main > p { margin: 6px 0 0; font-size: 12px; }
.ns-rel__candidate-main > p small { display: block; margin-top: 3px; color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__candidate-warning { margin-top: 8px; color: var(--ns-rel-danger); font-size: 10px; }
.ns-rel__resolution { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; padding: 9px; border-radius: 8px; background: var(--ns-rel-module); }
.ns-rel__resolution label { display: grid; gap: 4px; color: var(--ns-rel-muted); font-size: 9px; }
.ns-rel__candidate-editor { margin-top: 9px; color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__candidate-editor summary { width: max-content; cursor: pointer; }
.ns-rel__resolution :is(input, select) { width: 100%; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--ns-rel-border); border-radius: 7px; color: var(--ns-rel-text); background: var(--ns-rel-layer); font-size: 11px; }
.ns-rel__candidate-actions { display: flex; align-items: flex-end; gap: 7px; }
.ns-rel__candidate .ns-rel__primary { border-color: var(--ns-rel-accent); color: #fff; background: var(--ns-rel-accent); }
.ns-rel__candidate-evidence { margin-top: 9px; color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__candidate-evidence summary { width: max-content; cursor: pointer; }
.ns-rel__candidate-evidence p { margin: 7px 0 0; }
.ns-rel__dialog-backdrop { position: fixed; z-index: 1200; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(22, 25, 31, .42); }
.ns-rel__dialog { width: min(620px, 100%); max-height: min(720px, calc(100dvh - 36px)); overflow: auto; border: 1px solid var(--ns-rel-border); border-radius: 10px; color: var(--ns-rel-text); background: var(--ns-rel-bg); box-shadow: 0 18px 54px rgba(15, 18, 24, .22); }
.ns-rel__dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 15px 16px; border-bottom: 1px solid var(--ns-rel-border-soft); }
.ns-rel__dialog-header span { color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__dialog-header h3 { margin: 4px 0 0; font-size: 14px; line-height: 1.45; }
.ns-rel__facts { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--ns-rel-border-soft); background: var(--ns-rel-module); }
.ns-rel__facts div { min-width: 0; padding-right: 12px; }
.ns-rel__facts dt { color: var(--ns-rel-muted); font-size: 9px; }
.ns-rel__facts dd { margin: 4px 0 0; font-size: 11px; }
.ns-rel__evidence-list { display: grid; gap: 9px; margin: 0; padding: 14px 16px 18px 34px; }
.ns-rel__evidence-list li { padding-left: 3px; color: var(--ns-rel-text); font-size: 11px; }
.ns-rel__evidence-list li > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ns-rel__evidence-list li span { color: var(--ns-rel-muted); font-size: 9px; }
.ns-rel__evidence-list blockquote { margin: 7px 0 0; padding: 8px 10px; border-left: 2px solid var(--ns-rel-accent); color: var(--ns-rel-muted); background: var(--ns-rel-module); line-height: 1.65; }
.ns-rel__evidence-list p { margin: 6px 0 0; color: var(--ns-rel-muted); font-size: 10px; }
.ns-rel__sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media (max-width: 760px) {
  .ns-rel__header { display: grid; padding: 15px 14px 13px; }
  .ns-rel__summary { width: max-content; }
  .ns-rel__tabs { padding-inline: 10px; overflow-x: auto; }
  .ns-rel__filters { display: grid; grid-template-columns: 1fr 1fr; padding: 10px 12px; }
  .ns-rel__filters label:first-child { grid-column: 1 / -1; }
  .ns-rel__filters input, .ns-rel__filters select { width: 100%; }
  .ns-rel__candidate { grid-template-columns: 1fr; }
  .ns-rel__candidate-select { grid-row: 1; }
  .ns-rel__candidate-batch { align-items: stretch; flex-wrap: wrap; }
  .ns-rel__candidate-batch span { width: 100%; margin: 0; }
  .ns-rel__candidate-title { align-items: flex-start; flex-direction: column; gap: 4px; }
  .ns-rel__resolution { grid-template-columns: 1fr; }
  .ns-rel__candidate-actions { justify-content: flex-end; }
  .ns-rel__facts { grid-template-columns: 1fr; gap: 9px; }
  .ns-rel__evidence-list li > div { align-items: flex-start; flex-direction: column; gap: 3px; }
}
@media (prefers-reduced-motion: reduce) {
  .ns-rel *, .ns-rel *::before, .ns-rel *::after { scroll-behavior: auto !important; transition: none !important; }
}
`
