import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationMode, Chapter, ChapterBatchItem, ChapterGenerationBatch, ProjectFoundationWorkspace, RelationshipMode } from '../domain/model.js'
import type { NovelClientRequest } from './client-memory.js'

export interface ChapterBatchesPanelProps {
  projectId: string
  projectRevision: number
  chapters: Chapter[]
  archived?: boolean
  narrow?: boolean
  request: NovelClientRequest
  onProjectChanged?: () => void | Promise<void>
  onOpenChapter?: (chapterId: string) => void | Promise<void>
  onOpenPreparation?: () => void
  onOpenRelationships?: () => void
  onCreateChapter?: () => void | Promise<void>
}

type BatchListResponse = ChapterGenerationBatch[] | { items?: ChapterGenerationBatch[]; batches?: ChapterGenerationBatch[] }
type CreateMode = 'selected' | 'continuous'
type DraftPlanItem = Pick<ChapterBatchItem, 'id' | 'plannedTitle' | 'writingGoal' | 'openingContinuity' | 'endingHook' | 'targetWords'>
type PendingCreation = { mode: CreateMode; automationMode: AutomationMode; chapterIds?: string[]; startChapterId?: string; count: number }

const activeBatchStatuses = new Set<ChapterGenerationBatch['status']>(['planning','queued','running','waiting_approval','pause_requested'])

export function ChapterBatchesPanel({ projectId, projectRevision, chapters, archived = false, narrow = false, request, onProjectChanged, onOpenChapter, onOpenPreparation, onOpenRelationships, onCreateChapter }: ChapterBatchesPanelProps) {
  const orderedChapters = useMemo(() => [...chapters].sort((left, right) => left.chapterNumber - right.chapterNumber), [chapters])
  const [batches, setBatches] = useState<ChapterGenerationBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<ChapterGenerationBatch | null>(null)
  const [creating, setCreating] = useState(false)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [foundation, setFoundation] = useState<ProjectFoundationWorkspace | null>(null)
  const [foundationLoading, setFoundationLoading] = useState(true)
  const [foundationError, setFoundationError] = useState<string | null>(null)
  const [relationshipMode, setRelationshipMode] = useState<RelationshipMode | null>(null)
  const [relationshipModeError, setRelationshipModeError] = useState<string | null>(null)
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const foundationRequestRef = useRef(0)
  const relationshipModeRequestRef = useRef(0)

  const loadFoundation = useCallback(async () => {
    const requestId = ++foundationRequestRef.current
    setFoundationLoading(true)
    try {
      const next = await request<ProjectFoundationWorkspace>(`/projects/${encodeURIComponent(projectId)}/foundation`)
      if (requestId === foundationRequestRef.current) { setFoundation(next); setFoundationError(null) }
    } catch (cause) { if (requestId === foundationRequestRef.current) setFoundationError(errorMessage(cause)) }
    finally { if (requestId === foundationRequestRef.current) setFoundationLoading(false) }
  }, [projectId, request])

  const loadRelationshipMode = useCallback(async () => {
    const requestId = ++relationshipModeRequestRef.current
    try {
      const response = await request<{ mode: RelationshipMode }>(`/projects/${encodeURIComponent(projectId)}/relationships/mode`)
      if (requestId === relationshipModeRequestRef.current) { setRelationshipMode(response.mode); setRelationshipModeError(null) }
    } catch (cause) {
      if (requestId === relationshipModeRequestRef.current) {
        setRelationshipMode(null)
        setRelationshipModeError(errorMessage(cause))
      }
    }
  }, [projectId, request])

  const loadBatches = useCallback(async (quiet = false) => {
    const requestId = ++listRequestRef.current
    if (!quiet) setLoading(true)
    try {
      const response = await request<BatchListResponse>(`/projects/${encodeURIComponent(projectId)}/batches`)
      if (requestId !== listRequestRef.current) return
      const next = Array.isArray(response) ? response : response.items ?? response.batches ?? []
      setBatches(next)
      setSelectedBatchId(current => current && next.some(batch => batch.id === current) ? current : next[0]?.id ?? null)
      setError(null)
    } catch (cause) { if (requestId === listRequestRef.current) setError(errorMessage(cause)) }
    finally { if (!quiet && requestId === listRequestRef.current) setLoading(false) }
  }, [projectId, request])

  const loadBatch = useCallback(async (batchId: string) => {
    const requestId = ++detailRequestRef.current
    try {
      const next = await request<ChapterGenerationBatch>(`/batches/${encodeURIComponent(batchId)}`)
      if (requestId !== detailRequestRef.current) return
      setSelectedBatch(next)
      setError(null)
    } catch (cause) { if (requestId === detailRequestRef.current) setError(errorMessage(cause)) }
  }, [request])

  useEffect(() => { setBatches([]); setSelectedBatch(null); setSelectedBatchId(null); setCreating(false); setMobileDetail(false); setFoundation(null); setFoundationError(null); setRelationshipMode(null); setRelationshipModeError(null); void loadFoundation(); void loadRelationshipMode(); void loadBatches() }, [loadBatches, loadFoundation, loadRelationshipMode, projectId])
  useEffect(() => { if (selectedBatchId) void loadBatch(selectedBatchId); else setSelectedBatch(null) }, [loadBatch, selectedBatchId])
  useEffect(() => {
    const hasActive = batches.some(batch => activeBatchStatuses.has(batch.status)) || (selectedBatch && activeBatchStatuses.has(selectedBatch.status))
    if (!hasActive) return
    const timer = window.setInterval(() => { void loadBatches(true); if (selectedBatchId) void loadBatch(selectedBatchId) }, 900)
    return () => { window.clearInterval(timer) }
  }, [batches, loadBatch, loadBatches, selectedBatch, selectedBatchId])

  const chooseBatch = (id: string) => { setSelectedBatchId(id); setCreating(false); if (narrow) setMobileDetail(true) }
  const created = async (batch: ChapterGenerationBatch) => {
    setCreating(false); setSelectedBatch(batch); setSelectedBatchId(batch.id); setMobileDetail(true)
    await loadBatches(true); await onProjectChanged?.()
  }
  const refreshed = async () => {
    await loadBatches(true)
    if (selectedBatchId) await loadBatch(selectedBatchId)
    await onProjectChanged?.()
  }
  const creationFailed = async () => { await loadBatches(true); await onProjectChanged?.() }

  const foundationApprovedCount = foundation?.stages.filter(stage => stage.status === 'approved').length ?? 0
  if (!archived && orderedChapters.length === 0) return <section className="ns-batches" aria-label="批量章节生成">
    <style>{batchStyles}</style>
    <header className="ns-batches__header"><div><span>作者控制中心</span><h1>批量生成</h1><p>批次需要从已有章节承接，先建立第一章再规划后续内容。</p></div></header>
    <div className="ns-batches__locked"><strong>先创建第一章</strong><span>第一章会成为连续批次的故事锚点，也可以先单章生成并审阅。</span><button type="button" className="ns-batches__primary" onClick={() => { void onCreateChapter?.() }}>创建第一章</button></div>
  </section>

  return <section className="ns-batches" aria-label="批量章节生成">
    <style>{batchStyles}</style>
    <header className="ns-batches__header">
      <div><span>作者控制中心</span><h1>批量生成</h1><p>先审阅整批章节计划，再按故事顺序逐章生成。项目内严格串行，其他项目仍可并行。</p></div>
      {!archived && <button type="button" className="ns-batches__primary" onClick={() => { setCreating(true); if (narrow) setMobileDetail(true) }}>新建批次</button>}
    </header>
    {archived && <div className="ns-batches__archive">此项目已归档。历史批次可查看，但不能继续执行。</div>}
    {!archived && (foundationLoading || foundationError || !foundation?.readyForChapterGeneration) && <div className="ns-batches__preparation-note" role="status"><span><strong>{foundationError ? '暂时无法确认创作准备状态' : foundationLoading ? '正在读取创作准备' : '创作准备尚未完成'}</strong>{foundationError ? '仍可继续建立批次；完成大纲、人物与时间线后，连续生成会更稳。' : foundationLoading ? '可以先继续建立批次；完成准备后，连续生成会更稳。' : `当前已批准 ${foundationApprovedCount}/${foundation?.stages.length ?? 3} 项；可继续生成，完成准备后会更稳。`}</span>{!foundationLoading && onOpenPreparation && <button type="button" onClick={onOpenPreparation}>完善创作准备</button>}</div>}
    {error && <div className="ns-batches__error" role="alert"><span>{error}</span><button type="button" onClick={() => { void loadBatches() }}>重试</button></div>}
    <div className={`ns-batches__workspace${narrow ? ' ns-batches__workspace--narrow' : ''}`}>
      {(!narrow || !mobileDetail) && <BatchIndex batches={batches} selectedId={selectedBatchId} loading={loading} choose={chooseBatch} />}
      {(!narrow || mobileDetail) && <div className="ns-batches__detail">
        {narrow && <button type="button" className="ns-batches__back" onClick={() => { setMobileDetail(false); setCreating(false) }}>← 返回批次列表</button>}
        {creating
          ? <CreateBatch projectId={projectId} projectRevision={projectRevision} chapters={orderedChapters} archived={archived} relationshipMode={relationshipMode} relationshipModeError={relationshipModeError} request={request} close={() => { setCreating(false) }} created={created} failed={creationFailed} openRelationships={onOpenRelationships} />
          : selectedBatch
            ? <BatchDetail batch={selectedBatch} projectRevision={projectRevision} chapters={orderedChapters} archived={archived} relationshipMode={relationshipMode} request={request} refreshed={refreshed} openChapter={onOpenChapter} openRelationships={onOpenRelationships} />
            : <div className="ns-batches__empty"><strong>{loading ? '正在读取批次…' : '还没有批量任务'}</strong><span>使用右上角入口，选择已有章节或让 AI 规划后续章节。</span></div>}
      </div>}
    </div>
  </section>
}

function BatchIndex({ batches, selectedId, loading, choose }: { batches: ChapterGenerationBatch[]; selectedId: string | null; loading: boolean; choose: (id: string) => void }) {
  return <aside className="ns-batches__index" aria-busy={loading}>
    <div className="ns-batches__index-title"><strong>章节批次</strong><span>{batches.length}</span></div>
    <div className="ns-batches__index-scroll">
      {batches.map(batch => {
        const complete = batch.items.filter(item => item.queueState === 'skipped' || item.workflow?.status === 'succeeded').length
        return <button type="button" key={batch.id} className="ns-batches__index-row" aria-current={batch.id === selectedId ? 'true' : undefined} onClick={() => { choose(batch.id) }}>
          <i data-status={batchTone(batch.status)} /><span><strong>{batch.mode === 'continuous' ? `连续 ${batch.requestedCount} 章` : `选定 ${batch.requestedCount} 章`}</strong><small>{batchStatusLabel(batch.status)} · {batch.automationMode.toUpperCase()}</small></span><b>{complete}/{batch.items.length || batch.requestedCount}</b>
        </button>
      })}
      {!loading && batches.length === 0 && <div className="ns-batches__index-empty">暂无历史批次</div>}
    </div>
  </aside>
}

function CreateBatch({ projectId, projectRevision, chapters, archived, relationshipMode, relationshipModeError, request, close, created, failed, openRelationships }: { projectId: string; projectRevision: number; chapters: Chapter[]; archived: boolean; relationshipMode: RelationshipMode | null; relationshipModeError: string | null; request: NovelClientRequest; close: () => void; created: (batch: ChapterGenerationBatch) => Promise<void>; failed: () => Promise<void>; openRelationships?: () => void }) {
  const [mode, setMode] = useState<CreateMode>('continuous')
  const [automationMode, setAutomationMode] = useState<AutomationMode>('auto')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [startChapterId, setStartChapterId] = useState(chapters.at(-1)?.id ?? '')
  const [count, setCount] = useState(5)
  const [pending, setPending] = useState<PendingCreation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleChapter = (chapterId: string, checked: boolean) => setSelectedIds(current => checked ? current.includes(chapterId) ? current : [...current, chapterId] : current.filter(id => id !== chapterId))
  const moveSelected = (chapterId: string, delta: number) => setSelectedIds(current => moveId(current, chapterId, delta))

  const submit = async (confirmed = false) => {
    const creation: PendingCreation = mode === 'selected'
      ? { mode, automationMode, chapterIds: selectedIds, count: selectedIds.length }
      : { mode, automationMode, startChapterId, count }
    if (creation.count < 1 || creation.count > 20) { setError('单批必须为 1—20 章。'); return }
    if (mode === 'selected' && selectedIds.length === 0) { setError('请至少选择一章。'); return }
    if (mode === 'continuous' && !startChapterId) { setError('请选择连续规划的起始章节。'); return }
    if (!confirmed && (automationMode === 'yolo' || creation.count >= 10)) { setPending(creation); return }
    setBusy(true); setError(null)
    try {
      const batch = await request<ChapterGenerationBatch>(`/projects/${encodeURIComponent(projectId)}/batches`, { method: 'POST', body: JSON.stringify({ ...creation, confirmed: confirmed || undefined, projectRevision }) })
      await created(batch)
    } catch (cause) { setError(errorMessage(cause)); setPending(null); await failed() }
    finally { setBusy(false) }
  }

  return <div className="ns-batches__create">
    <header><div><span>创建批次</span><h2>编排下一段故事</h2></div><button type="button" onClick={close}>取消</button></header>
    <div className="ns-batches__mode" role="tablist" aria-label="批次来源"><button type="button" role="tab" aria-selected={mode === 'continuous'} onClick={() => { setMode('continuous'); setPending(null) }}>规划后续 N 章</button><button type="button" role="tab" aria-selected={mode === 'selected'} onClick={() => { setMode('selected'); setPending(null) }}>选择已有章节</button></div>
    <section className="ns-batches__create-body">
      {mode === 'continuous' ? <div className="ns-batches__continuous">
        <label><span>从哪一章承接</span><select value={startChapterId} onChange={event => { setStartChapterId(event.target.value) }}>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>第 {chapter.chapterNumber} 章 · {chapter.title}</option>)}</select></label>
        <label><span>自动规划章节数</span><input type="number" min={1} max={20} value={count} onChange={event => { setCount(clampCount(Number(event.target.value))) }} /></label>
        <p>AI 会先给出每章标题、写作目标、前章承接点、结尾钩子和目标字数。计划确认后才事务性建立章节。</p>
      </div> : <ChapterPicker chapters={chapters} selectedIds={selectedIds} toggle={toggleChapter} move={moveSelected} />}
      <fieldset className="ns-batches__automation"><legend>自动化方式</legend><label data-selected={automationMode === 'auto'}><input type="radio" name="automation-mode" checked={automationMode === 'auto'} onChange={() => { setAutomationMode('auto'); setPending(null) }} /><span><strong>AUTO</strong><small>确认批次计划；每章审阅批准后继续下一章。</small></span></label><label data-selected={automationMode === 'yolo'}><input type="radio" name="automation-mode" checked={automationMode === 'yolo'} onChange={() => { setAutomationMode('yolo'); setPending(null) }} /><span><strong>YOLO</strong><small>跳过人工审批；遇到真正未完成的章节时暂停，已经保存的内容不会丢失。</small></span></label></fieldset>
      {relationshipModeError && <div className="ns-batches__relationship-gate"><span><strong>关系自动提取设置暂时未读取</strong>仍可选择 YOLO；关系设置不会作为批次启动条件。</span>{openRelationships && <button type="button" onClick={openRelationships}>查看实体关系</button>}</div>}
      {relationshipMode === 'off' && <div className="ns-batches__relationship-gate"><span><strong>关系自动提取已关闭</strong>仍可使用 YOLO；本批次不会自动提取关系候选。</span>{openRelationships && <button type="button" onClick={openRelationships}>前往实体关系</button>}</div>}
      <div className="ns-batches__quality-note"><strong>边界说明</strong><span>YOLO 只代表跳过人工审批，不代表真正质量审校。剧情、人物、时间线、文风检查目前都是流程占位，不能证明正文没有矛盾。</span></div>
      {pending && <div className="ns-batches__confirm" role="alertdialog" aria-label="确认高成本批次"><strong>{pending.automationMode === 'yolo' ? '确认启用有界 YOLO' : `确认一次规划 ${pending.count} 章`}</strong><p>{pending.automationMode === 'yolo' ? '该批次会自动批准并连续运行，仍会在章节真正未完成、版本变化或需要作者检查时暂停。' : '10 章以上会产生较高模型调用成本，并让计划审阅范围变大。'}</p><div><button type="button" onClick={() => { setPending(null) }}>返回调整</button><button type="button" className="ns-batches__primary" onClick={() => { void submit(true) }}>我已理解，继续</button></div></div>}
      {error && <div className="ns-batches__inline-error" role="alert">{error}</div>}
    </section>
    <footer><span>默认 5 章 · 单批上限 20 章</span><button type="button" className="ns-batches__primary" disabled={archived || busy || Boolean(pending)} onClick={() => { void submit() }}>{busy ? '正在建立…' : '生成批次计划'}</button></footer>
  </div>
}

function ChapterPicker({ chapters, selectedIds, toggle, move }: { chapters: Chapter[]; selectedIds: string[]; toggle: (id: string, checked: boolean) => void; move: (id: string, delta: number) => void }) {
  const selected = selectedIds.map(id => chapters.find(chapter => chapter.id === id)).filter((chapter): chapter is Chapter => Boolean(chapter))
  return <div className="ns-batches__picker">
    <div><strong>选择章节</strong><span>{selectedIds.length} / 20</span></div>
    <div className="ns-batches__chapter-grid">{chapters.map(chapter => <label key={chapter.id} data-selected={selectedIds.includes(chapter.id)}><input type="checkbox" checked={selectedIds.includes(chapter.id)} disabled={!selectedIds.includes(chapter.id) && selectedIds.length >= 20} onChange={event => { toggle(chapter.id, event.target.checked) }} /><span>第 {chapter.chapterNumber} 章</span><strong>{chapter.title}</strong></label>)}</div>
    {selected.length > 0 && <div className="ns-batches__selected-order"><span>生成顺序</span>{selected.map((chapter, index) => <div key={chapter.id}><b>{index + 1}</b><span>第 {chapter.chapterNumber} 章 · {chapter.title}</span><button type="button" aria-label={`上移第 ${chapter.chapterNumber} 章`} disabled={index === 0} onClick={() => { move(chapter.id, -1) }}>↑</button><button type="button" aria-label={`下移第 ${chapter.chapterNumber} 章`} disabled={index === selected.length - 1} onClick={() => { move(chapter.id, 1) }}>↓</button></div>)}</div>}
  </div>
}

function BatchDetail({ batch, projectRevision, chapters, archived, relationshipMode, request, refreshed, openChapter, openRelationships }: { batch: ChapterGenerationBatch; projectRevision: number; chapters: Chapter[]; archived: boolean; relationshipMode: RelationshipMode | null; request: NovelClientRequest; refreshed: () => Promise<void>; openChapter?: (chapterId: string) => void | Promise<void>; openRelationships?: () => void }) {
  const [planItems, setPlanItems] = useState<DraftPlanItem[]>(() => batch.items.map(toDraftItem))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'skip'; itemId?: string } | null>(null)
  useEffect(() => { setPlanItems(batch.items.map(toDraftItem)); setError(null); setConfirmAction(null) }, [batch.id, batch.revision])

  const command = async (action: 'start' | 'pause' | 'resume' | 'retry' | 'cancel') => {
    setBusy(action); setError(null)
    try { await request(`/batches/${encodeURIComponent(batch.id)}/${action}`, { method: 'POST', body: JSON.stringify({ projectRevision }) }); await refreshed() }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null); setConfirmAction(null) }
  }
  const approvePlan = async () => {
    setBusy('approve-plan'); setError(null)
    try { await request(`/batches/${encodeURIComponent(batch.id)}/approve-plan`, { method: 'POST', body: JSON.stringify({ baseRevision: batch.revision, projectRevision, items: planItems }) }); await refreshed() }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }
  const reorder = async (itemId: string, delta: number) => {
    const ordered = moveId(batch.items.map(item => item.id), itemId, delta)
    setBusy(`reorder:${itemId}`); setError(null)
    try { await request(`/batches/${encodeURIComponent(batch.id)}/reorder`, { method: 'POST', body: JSON.stringify({ itemIds: ordered, baseRevision: batch.revision, projectRevision }) }); await refreshed() }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }
  const skip = async (itemId: string) => {
    setBusy(`skip:${itemId}`); setError(null)
    try { await request(`/batches/${encodeURIComponent(batch.id)}/items/${encodeURIComponent(itemId)}/skip`, { method: 'POST', body: JSON.stringify({ projectRevision }) }); await refreshed() }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null); setConfirmAction(null) }
  }

  const completed = batch.items.filter(item => item.queueState === 'skipped' || item.workflow?.status === 'succeeded').length
  const progress = batch.items.length ? Math.round(completed / batch.items.length * 100) : 0
  const notice = batchNotice(batch)
  return <article className="ns-batches__batch">
    <header className="ns-batches__batch-header"><div><span>{batch.mode === 'continuous' ? '连续章节' : '选定章节'} · {batch.automationMode.toUpperCase()}</span><h2>{batch.mode === 'continuous' ? `规划并生成后续 ${batch.requestedCount} 章` : `按顺序生成 ${batch.requestedCount} 章`}</h2></div><BatchStatus status={batch.status} /></header>
    <div className="ns-batches__progress"><i style={{ width: `${progress}%` }} /><span>{completed} / {batch.items.length || batch.requestedCount} 已处理</span></div>
    {batch.automationMode === 'yolo' && relationshipMode === 'off' && <div className="ns-batches__relationship-gate"><span><strong>关系自动提取已关闭</strong>批次仍可运行，但不会自动提取关系候选。</span>{openRelationships && <button type="button" onClick={openRelationships}>前往实体关系</button>}</div>}
    {batch.status === 'awaiting_plan_approval' ? <PlanApproval items={planItems} setItems={setPlanItems} busy={Boolean(busy)} approve={() => { void approvePlan() }} /> : <BatchQueue batch={batch} chapters={chapters} archived={archived} busy={busy} reorder={reorder} askSkip={itemId => { setConfirmAction({ type: 'skip', itemId }) }} openChapter={openChapter} />}
    {notice && <div className="ns-batches__blocked" data-tone={notice.tone}><strong>{notice.title}</strong><span>{notice.message}</span></div>}
    {error && <div className="ns-batches__inline-error" role="alert">{error}</div>}
    {confirmAction && <div className="ns-batches__confirm ns-batches__confirm--inline" role="alertdialog"><strong>{confirmAction.type === 'cancel' ? '取消整个批次？' : '跳过这一章？'}</strong><p>{confirmAction.type === 'cancel' ? '已生成和已批准内容会保留；未启动项将取消。' : '后续章节仍可继续，但批次会永久标记“存在连续性缺口”。'}</p><div><button type="button" onClick={() => { setConfirmAction(null) }}>返回</button><button type="button" onClick={() => { confirmAction.type === 'cancel' ? void command('cancel') : void skip(confirmAction.itemId!) }}>确认</button></div></div>}
    {!archived && <footer className="ns-batches__controls">
      {batch.status === 'queued' && <button type="button" className="ns-batches__primary" disabled={Boolean(busy)} onClick={() => { void command('start') }}>开始生成</button>}
      {['running','waiting_approval'].includes(batch.status) && <button type="button" disabled={Boolean(busy)} onClick={() => { void command('pause') }}>完成当前步骤后暂停</button>}
      {batch.status === 'paused' && <button type="button" className="ns-batches__primary" disabled={Boolean(busy)} onClick={() => { void command('resume') }}>继续批次</button>}
      {batch.status === 'blocked' && <button type="button" className="ns-batches__primary" disabled={Boolean(busy)} onClick={() => { void command('retry') }}>重试本章</button>}
      {!['succeeded','completed_with_skips','cancelled'].includes(batch.status) && <button type="button" disabled={Boolean(busy)} onClick={() => { setConfirmAction({ type: 'cancel' }) }}>取消批次</button>}
      {busy && <span>正在提交操作…</span>}
    </footer>}
  </article>
}

function PlanApproval({ items, setItems, busy, approve }: { items: DraftPlanItem[]; setItems: (items: DraftPlanItem[]) => void; busy: boolean; approve: () => void }) {
  const update = (id: string, key: keyof DraftPlanItem, value: string | number) => setItems(items.map(item => item.id === id ? { ...item, [key]: value } : item))
  return <section className="ns-batches__plan"><header><div><strong>批次计划待确认</strong><span>可修改标题、目标、承接点、结尾钩子与字数。</span></div><button type="button" className="ns-batches__primary" disabled={busy || items.length === 0} onClick={approve}>确认计划并创建队列</button></header><div>{items.map((item, index) => <article key={item.id}><b>{String(index + 1).padStart(2,'0')}</b><div className="ns-batches__plan-fields"><label><span>章节标题</span><input value={item.plannedTitle} onChange={event => { update(item.id,'plannedTitle',event.target.value) }} /></label><label><span>写作目标</span><textarea rows={2} value={item.writingGoal} onChange={event => { update(item.id,'writingGoal',event.target.value) }} /></label><label><span>前章承接点</span><textarea rows={2} value={item.openingContinuity} onChange={event => { update(item.id,'openingContinuity',event.target.value) }} /></label><label><span>结尾钩子</span><textarea rows={2} value={item.endingHook} onChange={event => { update(item.id,'endingHook',event.target.value) }} /></label><label><span>目标字数</span><input type="number" min={1} value={item.targetWords} onChange={event => { update(item.id,'targetWords',Number(event.target.value)) }} /></label></div></article>)}</div></section>
}

function BatchQueue({ batch, chapters, archived, busy, reorder, askSkip, openChapter }: { batch: ChapterGenerationBatch; chapters: Chapter[]; archived: boolean; busy: string | null; reorder: (id: string, delta: number) => Promise<void>; askSkip: (id: string) => void; openChapter?: (chapterId: string) => void | Promise<void> }) {
  if (batch.items.length === 0) return <div className="ns-batches__empty"><strong>{batch.status === 'planning' ? 'AI 正在生成批次计划' : '队列尚未建立'}</strong><span>计划会持久化，关闭页面或重启 Harness 后仍可恢复。</span></div>
  return <ol className="ns-batches__queue">{batch.items.map((item, index) => {
    const chapter = item.chapterId ? chapters.find(value => value.id === item.chapterId) : null
    const canReorder = !archived && batch.mode === 'selected' && !item.workflowRunId && ['planned','queued'].includes(item.queueState)
    const canSkip = !archived && ['queued','blocked'].includes(item.queueState)
    const previousMovable = index > 0 && ['planned','queued'].includes(batch.items[index - 1]!.queueState)
    const nextMovable = index < batch.items.length - 1 && ['planned','queued'].includes(batch.items[index + 1]!.queueState)
    return <li key={item.id} data-state={queueTone(item)}><span className="ns-batches__queue-number">{String(index + 1).padStart(2,'0')}</span><div className="ns-batches__queue-main"><strong>{chapter ? `第 ${chapter.chapterNumber} 章 · ${chapter.title}` : item.plannedTitle}</strong><span>{queueLabel(item)}{item.workflow?.currentNodeKey ? ` · ${workflowNodeLabel(item.workflow.currentNodeKey)}` : ''}</span><p>{item.writingGoal}</p></div><div className="ns-batches__queue-actions">{item.chapterId && openChapter && <button type="button" onClick={() => { void openChapter(item.chapterId!) }}>打开章节</button>}{canReorder && <><button type="button" aria-label={`上移 ${item.plannedTitle}`} disabled={!previousMovable || Boolean(busy)} onClick={() => { void reorder(item.id,-1) }}>↑</button><button type="button" aria-label={`下移 ${item.plannedTitle}`} disabled={!nextMovable || Boolean(busy)} onClick={() => { void reorder(item.id,1) }}>↓</button></>}{canSkip && <button type="button" disabled={Boolean(busy)} onClick={() => { askSkip(item.id) }}>跳过</button>}</div></li>
  })}</ol>
}

function BatchStatus({ status }: { status: ChapterGenerationBatch['status'] }) { return <span className="ns-batches__status" data-tone={batchTone(status)}><i />{batchStatusLabel(status)}</span> }
function toDraftItem(item: ChapterBatchItem): DraftPlanItem { return { id:item.id, plannedTitle:item.plannedTitle, writingGoal:item.writingGoal, openingContinuity:item.openingContinuity, endingHook:item.endingHook, targetWords:item.targetWords } }
function moveId(values: string[], id: string, delta: number): string[] { const index = values.indexOf(id); const next = index + delta; if (index < 0 || next < 0 || next >= values.length) return values; const copy = [...values]; [copy[index],copy[next]] = [copy[next]!,copy[index]!]; return copy }
function clampCount(value: number): number { return Number.isFinite(value) ? Math.min(20,Math.max(1,Math.round(value))) : 1 }
function batchTone(status: ChapterGenerationBatch['status']): 'idle'|'active'|'warning'|'done'|'error' { if (status === 'succeeded' || status === 'completed_with_skips') return 'done'; if (status === 'blocked' || status === 'awaiting_plan_approval' || status === 'waiting_approval' || status === 'paused' || status === 'pause_requested') return 'warning'; if (status === 'planning' || status === 'queued' || status === 'running') return 'active'; return 'idle' }
function batchStatusLabel(status: ChapterGenerationBatch['status']): string { return ({ planning:'正在规划',awaiting_plan_approval:'计划待确认',queued:'等待开始',running:'正在生成',waiting_approval:'章节待审批',pause_requested:'正在软暂停',paused:'已暂停',blocked:'需要处理',succeeded:'已完成',completed_with_skips:'完成 · 有连续性缺口',cancelled:'已取消' } as const)[status] }
function queueTone(item: ChapterBatchItem): string { if (item.queueState === 'skipped' || item.queueState === 'cancelled') return 'muted'; if (item.queueState === 'blocked') return 'warning'; if (item.workflow?.status === 'failed') return 'error'; if (item.workflow?.status === 'succeeded') return 'done'; if (item.workflowRunId) return 'active'; return 'idle' }
function queueLabel(item: ChapterBatchItem): string { if (item.queueState === 'skipped') return '已跳过 · 连续性缺口'; if (item.queueState === 'cancelled') return '已取消'; if (item.queueState === 'blocked') return item.workflow?.status === 'failed' ? '本章生成暂未完成' : '需要处理'; if (!item.workflow) return item.queueState === 'planned' ? '计划项' : '等待生成'; return ({ running:'正在生成',paused:'已暂停',waiting_approval:'等待章节审批',succeeded:'已完成',failed:'本章生成暂未完成',cancel_requested:'正在取消',cancelled:'已取消' } as Record<string,string>)[item.workflow.status] ?? item.workflow.status }
function workflowNodeLabel(key: string): string { return ({ freeze_input_snapshot:'冻结输入',retrieve_context:'准备上下文',plan_scenes:'整理章节结构',validate_scene_plan:'检查结构',generate_draft:'撰写正文',plot_review:'剧情检查（流程占位）',character_review:'人物检查（流程占位）',timeline_review:'时间线检查（流程占位）',style_review:'文风检查（流程占位）',aggregate_review:'汇总检查（流程占位）',conditional_revision_loop:'判断是否建立返修版本',wait_chapter_approval:'等待审批',commit_approved_version:'批准正文',extract_canon_candidates:'提取事实',validate_canon_candidates:'验证事实',commit_canon:'提交 Canon',refresh_summaries_and_indexes:'更新记忆' } as Record<string,string>)[key] ?? key }
function batchError(value: string): string { try { const parsed = JSON.parse(value) as { message?:unknown;warning?:unknown }; return typeof parsed.message === 'string' ? parsed.message : typeof parsed.warning === 'string' ? parsed.warning : value } catch { return value } }
function batchNotice(batch: ChapterGenerationBatch): { tone: 'warning' | 'error'; title: string; message: string } | null {
  if (!batch.errorJson || !['blocked','paused','pause_requested'].includes(batch.status)) return null
  return {
    tone: batch.status === 'blocked' || batch.status === 'paused' || batch.status === 'pause_requested' ? 'warning' : 'error',
    title: batch.status === 'blocked' ? '批次需要处理' : '批次已暂停',
    message: batchError(batch.errorJson),
  }
}
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }

const batchStyles = `
.ns-batches{--b-bg:var(--dsw-alias-bg-base,#fff);--b-layer:var(--dsw-alias-bg-layer-1,#fff);--b-module:var(--dsw-alias-bg-module-platform,#f5f6f7);--b-hover:var(--dsw-specific-sidebar-nav-item-hover,#f1f3f5);--b-active:var(--dsw-specific-sidebar-nav-item-active,#e9ecf2);--b-text:var(--dsw-alias-label-primary,#202124);--b-muted:var(--dsw-alias-label-secondary,#666b73);--b-faint:var(--dsw-alias-label-tertiary,#8a9099);--b-border:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--b-border-soft:var(--dsw-alias-border-l1,rgba(0,0,0,.05));--b-brand:var(--dsw-alias-state-business-primary,#4176e6);--b-success:var(--dsw-alias-state-success-primary,#22a45d);--b-warning:var(--dsw-alias-state-warn-primary,#d99019);--b-danger:var(--dsw-alias-state-error-primary,#c73737);height:100%;min-width:0;display:grid;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden;color:var(--b-text);background:var(--b-bg);font-family:var(--dsw-font-family,"PingFang SC","Microsoft YaHei",sans-serif)}.ns-batches *{box-sizing:border-box}.ns-batches :is(button,input,select,textarea){font:inherit}.ns-batches :is(button,input,select,textarea):focus-visible{outline:2px solid var(--b-brand);outline-offset:2px}
.ns-batches__header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:20px 24px 17px;border-bottom:1px solid var(--b-border-soft)}.ns-batches__header span,.ns-batches__create header span,.ns-batches__batch-header>div>span{color:var(--b-faint);font-size:9px;font-weight:600;letter-spacing:.07em}.ns-batches__header h1{margin:4px 0 0;font-size:22px;line-height:1.2;letter-spacing:-.025em}.ns-batches__header p{max-width:620px;margin:6px 0 0;color:var(--b-muted);font-size:12px;line-height:1.55}.ns-batches__primary{min-height:33px;padding:0 11px;border:1px solid var(--b-brand)!important;border-radius:7px;color:#fff!important;background:var(--b-brand)!important;cursor:pointer;font-size:10px;white-space:nowrap}.ns-batches button:disabled{cursor:not-allowed;opacity:.48}
.ns-batches__locked{grid-row:2/4;display:grid;place-items:center;align-content:center;gap:7px;padding:34px;color:var(--b-muted);text-align:center}.ns-batches__locked strong{color:var(--b-text);font-size:15px}.ns-batches__locked span{max-width:480px;font-size:11px;line-height:1.65}.ns-batches__locked button{margin-top:8px}
.ns-batches__workspace{min-height:0;display:grid;grid-template-columns:minmax(225px,290px) minmax(0,1fr);overflow:hidden}.ns-batches__workspace--narrow{grid-template-columns:1fr}.ns-batches__index{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;border-right:1px solid var(--b-border-soft);background:var(--b-module)}.ns-batches__index-title{display:flex;align-items:center;justify-content:space-between;min-height:43px;padding:0 13px;border-bottom:1px solid var(--b-border-soft)}.ns-batches__index-title strong{font-size:11px}.ns-batches__index-title span{display:grid;place-items:center;min-width:18px;height:18px;border-radius:5px;background:var(--b-active);font-size:9px}.ns-batches__index-scroll{min-height:0;overflow:auto}.ns-batches__index-row{width:100%;display:grid;grid-template-columns:9px minmax(0,1fr) auto;align-items:center;gap:9px;padding:11px 12px;border:0;border-bottom:1px solid var(--b-border-soft);color:var(--b-text);background:transparent;cursor:pointer;text-align:left}.ns-batches__index-row:hover{background:var(--b-hover)}.ns-batches__index-row[aria-current=true]{background:var(--b-active);box-shadow:inset 2px 0 var(--b-brand)}.ns-batches__index-row>i,.ns-batches__status i{width:7px;height:7px;border-radius:50%;background:var(--b-faint)}[data-status=active],.ns-batches__status[data-tone=active] i{background:var(--b-brand)}[data-status=warning],.ns-batches__status[data-tone=warning] i{background:var(--b-warning)}[data-status=done],.ns-batches__status[data-tone=done] i{background:var(--b-success)}[data-status=error],.ns-batches__status[data-tone=error] i{background:var(--b-danger)}.ns-batches__index-row span{min-width:0;display:grid;gap:3px}.ns-batches__index-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.ns-batches__index-row small{color:var(--b-muted);font-size:9px}.ns-batches__index-row b{font:9px var(--ds-font-family-code,monospace);color:var(--b-faint)}.ns-batches__new{min-height:39px;margin:8px;border:1px dashed var(--b-border);border-radius:7px;color:var(--b-muted);background:transparent;cursor:pointer;font-size:10px}.ns-batches__new:hover{background:var(--b-hover)}
.ns-batches__detail{min-width:0;min-height:0;overflow:auto;background:var(--b-bg)}.ns-batches__back{min-height:38px;margin:7px 9px 0;padding:0 8px;border:0;color:var(--b-muted);background:transparent;cursor:pointer;font-size:10px}.ns-batches__create,.ns-batches__batch{width:min(900px,100%);min-height:100%;margin:0 auto;padding:22px 24px 36px}.ns-batches__create>header,.ns-batches__batch-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.ns-batches__create h2,.ns-batches__batch h2{margin:4px 0 0;font-size:17px;line-height:1.35}.ns-batches__create>header>button{min-height:31px;border:1px solid var(--b-border);border-radius:7px;color:var(--b-text);background:var(--b-layer);cursor:pointer;font-size:10px}.ns-batches__mode{display:flex;gap:2px;margin-top:18px;padding:3px;border-radius:8px;background:var(--b-module)}.ns-batches__mode button{flex:1;min-height:34px;border:0;border-radius:6px;color:var(--b-muted);background:transparent;cursor:pointer;font-size:11px}.ns-batches__mode button[aria-selected=true]{color:var(--b-text);background:var(--b-layer);box-shadow:0 1px 3px rgba(0,0,0,.06);font-weight:600}.ns-batches__create-body{display:grid;gap:14px;margin-top:14px}.ns-batches__continuous{display:grid;grid-template-columns:2fr 1fr;gap:10px;padding:14px;border:1px solid var(--b-border);border-radius:9px}.ns-batches__continuous label,.ns-batches__plan label,.ns-batches__plan-fields label{display:grid;gap:5px;color:var(--b-muted);font-size:9px}.ns-batches :is(input,select,textarea){min-width:0;border:1px solid var(--b-border);border-radius:7px;color:var(--b-text);background:var(--b-layer)}.ns-batches :is(input,select){height:34px;padding:0 8px}.ns-batches textarea{padding:8px;resize:vertical;line-height:1.5}.ns-batches__continuous p{grid-column:1/-1;margin:0;color:var(--b-muted);font-size:10px;line-height:1.55}.ns-batches__automation{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0;padding:11px;border:1px solid var(--b-border);border-radius:9px}.ns-batches__automation legend{padding:0 4px;color:var(--b-muted);font-size:9px}.ns-batches__automation label{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:10px;border:1px solid var(--b-border-soft);border-radius:8px;cursor:pointer}.ns-batches__automation label[data-selected=true]{border-color:var(--b-brand);background:color-mix(in srgb,var(--b-brand) 6%,var(--b-layer))}.ns-batches__automation span{display:grid;gap:3px}.ns-batches__automation strong{font-size:11px}.ns-batches__automation small{color:var(--b-muted);font-size:9px;line-height:1.5}.ns-batches__quality-note{display:flex;gap:8px;padding:9px 10px;border-left:2px solid var(--b-warning);color:var(--b-muted);background:var(--b-module);font-size:9px;line-height:1.55}.ns-batches__quality-note strong{flex:none;color:var(--b-text)}.ns-batches__create>footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;padding-top:13px;border-top:1px solid var(--b-border-soft)}.ns-batches__create>footer>span{color:var(--b-faint);font-size:9px}
.ns-batches__picker{display:grid;gap:10px}.ns-batches__picker>div:first-child{display:flex;justify-content:space-between;font-size:10px}.ns-batches__picker>div:first-child span{color:var(--b-faint)}.ns-batches__chapter-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px;max-height:235px;overflow:auto}.ns-batches__chapter-grid label{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;gap:6px;padding:8px;border:1px solid var(--b-border-soft);border-radius:7px;cursor:pointer;font-size:9px}.ns-batches__chapter-grid label[data-selected=true]{border-color:var(--b-brand);background:color-mix(in srgb,var(--b-brand) 6%,var(--b-layer))}.ns-batches__chapter-grid label>span{color:var(--b-faint)}.ns-batches__chapter-grid label>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.ns-batches__selected-order{display:grid;gap:4px;padding:10px;border-radius:8px;background:var(--b-module)}.ns-batches__selected-order>span{margin-bottom:3px;color:var(--b-muted);font-size:9px}.ns-batches__selected-order>div{display:grid;grid-template-columns:20px minmax(0,1fr) 27px 27px;align-items:center;gap:5px}.ns-batches__selected-order b{font:9px var(--ds-font-family-code,monospace);color:var(--b-faint)}.ns-batches__selected-order div span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.ns-batches__selected-order button{height:26px;border:1px solid var(--b-border);border-radius:6px;background:var(--b-layer);cursor:pointer;font-size:10px}
.ns-batches__confirm{padding:13px;border:1px solid var(--b-warning);border-radius:9px;background:color-mix(in srgb,var(--b-warning) 7%,var(--b-layer))}.ns-batches__confirm strong{font-size:11px}.ns-batches__confirm p{margin:5px 0 10px;color:var(--b-muted);font-size:9px;line-height:1.55}.ns-batches__confirm>div{display:flex;justify-content:flex-end;gap:6px}.ns-batches__confirm button{min-height:31px;padding:0 9px;border:1px solid var(--b-border);border-radius:7px;color:var(--b-text);background:var(--b-layer);cursor:pointer;font-size:9px}.ns-batches__confirm--inline{margin-top:12px}
.ns-batches__status{display:inline-flex;align-items:center;gap:6px;min-height:27px;padding:0 8px;border-radius:7px;color:var(--b-muted);background:var(--b-module);font-size:9px;white-space:nowrap}.ns-batches__progress{position:relative;height:29px;margin-top:15px;overflow:hidden;border-radius:7px;background:var(--b-module)}.ns-batches__progress>i{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--b-brand) 12%,transparent)}.ns-batches__progress>span{position:relative;display:flex;align-items:center;height:100%;padding:0 9px;color:var(--b-muted);font-size:9px}.ns-batches__queue{display:grid;gap:7px;margin:14px 0 0;padding:0;list-style:none}.ns-batches__queue li{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px;border:1px solid var(--b-border);border-radius:9px;background:var(--b-layer)}.ns-batches__queue li[data-state=active]{border-color:color-mix(in srgb,var(--b-brand) 45%,var(--b-border))}.ns-batches__queue li[data-state=warning]{border-color:color-mix(in srgb,var(--b-warning) 55%,var(--b-border))}.ns-batches__queue li[data-state=error]{border-color:color-mix(in srgb,var(--b-danger) 55%,var(--b-border))}.ns-batches__queue li[data-state=muted]{opacity:.62}.ns-batches__queue-number{font:11px var(--ds-font-family-code,monospace);color:var(--b-faint)}.ns-batches__queue-main{min-width:0;display:grid;gap:3px}.ns-batches__queue-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.ns-batches__queue-main>span{color:var(--b-muted);font-size:9px}.ns-batches__queue-main p{margin:3px 0 0;color:var(--b-muted);font-size:9px;line-height:1.45}.ns-batches__queue-actions{display:flex;gap:4px}.ns-batches__queue-actions button,.ns-batches__controls button{min-height:29px;padding:0 8px;border:1px solid var(--b-border);border-radius:6px;color:var(--b-text);background:var(--b-layer);cursor:pointer;font-size:9px;white-space:nowrap}.ns-batches__controls{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:14px;padding-top:12px;border-top:1px solid var(--b-border-soft)}.ns-batches__controls span{margin-right:auto;color:var(--b-faint);font-size:9px}.ns-batches__blocked{display:flex;gap:8px;margin-top:12px;padding:9px 10px;border-left:2px solid var(--b-danger);color:var(--b-muted);background:color-mix(in srgb,var(--b-danger) 6%,var(--b-layer));font-size:9px;line-height:1.5}.ns-batches__blocked strong{flex:none;color:var(--b-danger)}.ns-batches__blocked[data-tone=warning]{border-left-color:var(--b-warning);background:color-mix(in srgb,var(--b-warning) 7%,var(--b-layer))}.ns-batches__blocked[data-tone=warning] strong{color:var(--b-warning)}
.ns-batches__plan{margin-top:14px;border:1px solid var(--b-border);border-radius:9px;overflow:hidden}.ns-batches__plan>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px;background:var(--b-module)}.ns-batches__plan>header>div{display:grid;gap:3px}.ns-batches__plan>header strong{font-size:11px}.ns-batches__plan>header span{color:var(--b-muted);font-size:9px}.ns-batches__plan>div{display:grid}.ns-batches__plan article{display:grid;grid-template-columns:27px minmax(0,1fr);gap:9px;padding:12px;border-top:1px solid var(--b-border-soft)}.ns-batches__plan article>b{font:10px var(--ds-font-family-code,monospace);color:var(--b-faint)}.ns-batches__plan-fields{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px}.ns-batches__plan-fields label:nth-child(2),.ns-batches__plan-fields label:nth-child(3),.ns-batches__plan-fields label:nth-child(4){grid-row:2}.ns-batches__plan-fields label:nth-child(2){grid-column:1}.ns-batches__plan-fields label:nth-child(3){grid-column:2}.ns-batches__plan-fields label:nth-child(4){grid-column:3}.ns-batches__plan-fields label:nth-child(5){grid-column:2/4;grid-row:1}.ns-batches__plan-fields :is(input,textarea){width:100%;font-size:10px}
.ns-batches__error,.ns-batches__archive,.ns-batches__inline-error{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;font-size:10px}.ns-batches__error,.ns-batches__inline-error{color:var(--b-danger);background:color-mix(in srgb,var(--b-danger) 7%,var(--b-layer))}.ns-batches__error button{border:0;color:inherit;background:transparent;cursor:pointer}.ns-batches__archive{color:var(--b-muted);background:var(--b-module)}.ns-batches__empty,.ns-batches__index-empty{display:grid;place-items:center;align-content:center;min-height:180px;padding:26px;color:var(--b-muted);text-align:center;font-size:10px}.ns-batches__empty strong{color:var(--b-text);font-size:12px}.ns-batches__empty span{max-width:360px;margin-top:5px;line-height:1.6}.ns-batches__empty button{margin-top:11px;min-height:31px;border:1px solid var(--b-border);border-radius:7px;background:var(--b-layer);cursor:pointer;font-size:10px}
.ns-batches__preparation-note,.ns-batches__relationship-gate{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;border-left:2px solid var(--b-warning);color:var(--b-muted);background:color-mix(in srgb,var(--b-warning) 7%,var(--b-layer));font-size:9px;line-height:1.55}.ns-batches__preparation-note{margin:0}.ns-batches__relationship-gate{margin-top:12px}.ns-batches__preparation-note span,.ns-batches__relationship-gate span{display:block}.ns-batches__preparation-note strong,.ns-batches__relationship-gate strong{display:block;margin-bottom:2px;color:var(--b-text)}.ns-batches__preparation-note button,.ns-batches__relationship-gate button{flex:none;min-height:29px;padding:0 8px;border:1px solid var(--b-border);border-radius:6px;color:var(--b-text);background:var(--b-layer);cursor:pointer;font-size:9px;white-space:nowrap}
@media(max-width:760px){.ns-batches__header{align-items:flex-start;padding:68px 14px 13px}.ns-batches__header p{font-size:10px}.ns-batches__workspace--narrow .ns-batches__index{border:0}.ns-batches__create,.ns-batches__batch{min-height:calc(100% - 45px);padding:12px 13px 70px}.ns-batches__continuous,.ns-batches__automation{grid-template-columns:1fr}.ns-batches__plan>header{align-items:flex-start;flex-direction:column}.ns-batches__plan-fields{grid-template-columns:1fr}.ns-batches__plan-fields label:nth-child(n){grid-column:auto;grid-row:auto}.ns-batches__queue li{grid-template-columns:25px minmax(0,1fr)}.ns-batches__queue-actions{grid-column:2;flex-wrap:wrap}.ns-batches__controls{position:sticky;bottom:0;flex-wrap:wrap;padding:10px;background:var(--b-bg);box-shadow:0 -7px 14px color-mix(in srgb,var(--b-bg) 92%,transparent)}.ns-batches__controls span{width:100%;margin:0}.ns-batches__chapter-grid{grid-template-columns:1fr}.ns-batches__create>footer{position:sticky;bottom:0;padding:10px 0;background:var(--b-bg)}.ns-batches__preparation-note,.ns-batches__relationship-gate{align-items:flex-start;flex-direction:column}.ns-batches__preparation-note button,.ns-batches__relationship-gate button{width:100%}}
@media(prefers-reduced-motion:reduce){.ns-batches *{scroll-behavior:auto!important;transition:none!important}}
`
