import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react'
import type { ClientContext, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  Button, StateDot, Tooltip, IconArchiveOutline20, IconBranchOutline16, IconCheckOutline16,
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16, IconDataOutline16, IconEditOutline16, IconFolderClose16, IconFolderOpen16, IconFolderOpenOutline16,
  IconCopyOutline16, IconListPenOutline16, IconPauseOutline16, IconPlayOutline16, IconPlusOutline16, IconRefreshOutline16,
  IconSendOutline14, IconSettingsOutline16, IconStopFill16, IconThinkOutline16, IconUserOutline16, IconWarningOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChapterDetail, EntityRelationship, EntityRelationshipEvidence, FoundationGenerationRun, FoundationPlannerAnswer, FoundationPlannerQuestion, GenerationSources, GenerationTelemetry, HistoricalKnowledgeScope, KnowledgeWorkspace, LibraryOverview, ManuscriptVersion, ModelRun, Project, ProjectFoundationKind, ProjectFoundationWorkspace, ProjectTree, RelationshipCandidate, RelationshipCandidateBatchResult, RelationshipCategory, RelationshipExtractionRun, RelationshipFactLayer, RelationshipGraph, RelationshipListPage, RelationshipMode, StoryEntity, StudioOverview, StudioProjectSummary, WorkflowRun, WorkspaceSnapshot, WritingStylePreset, WritingStyleProfile } from '../domain/model.js'
import { manuscriptWordCount } from '../domain/manuscript.js'
import { diffManuscriptParagraphs, type ManuscriptParagraphDiff } from '../domain/manuscript-diff.js'
import type { ProjectExportFile, ProjectImportResult } from '../domain/project-portability.js'
import { applyManuscriptSelectionRewrite, createManuscriptSelectionSnapshot, MAX_SELECTION_CONTEXT_CHARACTERS, MAX_SELECTION_REWRITE_INSTRUCTION_CHARACTERS, type ManuscriptSelectionSnapshot, type SelectionRewriteResult } from '../domain/selection-rewrite.js'
import { extractStoryTimelineAnchors } from '../domain/story-timeline.js'
import { NOVEL_API_ROUTE } from './contract.js'
import { BUILTIN_STYLE_PRESETS } from '../style/presets.js'
import { ChapterBatchesPanel } from './client-batches.js'
import { MemoryBrowserPanel } from './client-memory.js'
import { EntityRelationshipsPanel, type RelationshipCandidateReviewRequest, type RelationshipQueryState } from './client-relationships.js'
import { ProjectStatisticsPanel } from './client-statistics.js'
import type { EntityRelationship as RelationshipPanelEdge, EntityRelationshipCandidate as RelationshipPanelCandidate, RelationshipEntityNode } from '../domain/entity-relationships.js'

type FooterProps = PropsRuntime<'sidebar.footer.action'>
type OverlayProps = PropsRuntime<'shell.overlay'>
type ProjectSection = 'overview' | 'chapter' | 'batches' | 'statistics' | 'entities' | 'relationships' | 'canon' | 'timeline' | 'foreshadowing' | 'memory' | 'sources'
type AuthorInspectorTab = 'versions' | 'sources' | 'memory'
type SelectionRewritePopover = {
  snapshot: ManuscriptSelectionSnapshot
  left: number
  top: number
  mode: 'trigger' | 'composer'
  instruction: string
  status: 'idle' | 'loading' | 'error'
  error: string | null
}

const SELECTION_REWRITE_QUICK_ACTIONS = [
  { label: '重写', instruction: '' },
  { label: '扩写', instruction: '扩写这一段，增加具体动作、感官和必要的因果衔接，但只返回选区替换片段。' },
  { label: '精简', instruction: '精简这一段，保留关键事实、动作和情绪，删除重复与空泛表达，让长度明显缩短。' },
  { label: '增加对白', instruction: '在不改变事实和事件顺序的前提下，增加自然、符合人物关系的对白；只修改选区。' },
  { label: '加强情绪', instruction: '加强这一段的情绪张力，通过人物反应、动作和细节呈现，不直接解释情绪。' },
  { label: '增加环境细节', instruction: '增加与当前场景相关的环境、感官和空间调度细节，不喧宾夺主。' },
] as const

type StyleCatalog = { profile: WritingStyleProfile; presets: WritingStylePreset[]; rulesRevision: number }
type StudioSurface = 'workspace' | 'library'
type LibrarySegment = 'active' | 'archived'
type BeforeLeaveFlush = () => Promise<void>
type RegisterBeforeLeaveFlush = (flush: BeforeLeaveFlush | null) => void
type ChapterRecoveryDraft = {
  schemaVersion: 1
  chapterId: string
  baseVersionId: string | null
  baseRevision: number
  content: string
  savedAt: string
}
type ImportCandidate = {
  format: 'markdown' | 'txt' | 'snapshot'
  sourceName: string
  content: string
  snapshot: Record<string, unknown> | null
  size: number
}

const MAX_CLIENT_MANUSCRIPT_IMPORT_BYTES = 32 * 1024 * 1024
const MAX_CLIENT_SNAPSHOT_IMPORT_BYTES = 70 * 1024 * 1024
const MAX_LOCAL_RECOVERY_DRAFT_CHARACTERS = 256_000
const CHAPTER_RECOVERY_STORAGE_PREFIX = 'novel-studio:chapter-recovery:v1:'

function chapterRecoveryStorageKey(chapterId: string): string { return `${CHAPTER_RECOVERY_STORAGE_PREFIX}${chapterId}` }
function readChapterRecoveryDraft(chapterId: string): ChapterRecoveryDraft | null {
  try {
    const raw = window.localStorage.getItem(chapterRecoveryStorageKey(chapterId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ChapterRecoveryDraft>
    if (value.schemaVersion !== 1 || value.chapterId !== chapterId || typeof value.content !== 'string' || typeof value.savedAt !== 'string' || value.content.length > MAX_LOCAL_RECOVERY_DRAFT_CHARACTERS) return null
    return { schemaVersion: 1, chapterId, baseVersionId: typeof value.baseVersionId === 'string' ? value.baseVersionId : null, baseRevision: typeof value.baseRevision === 'number' ? value.baseRevision : 0, content: value.content, savedAt: value.savedAt }
  } catch { return null }
}
function writeChapterRecoveryDraft(chapterId: string, baseVersionId: string | null, baseRevision: number, content: string): void {
  if (content.length > MAX_LOCAL_RECOVERY_DRAFT_CHARACTERS) return
  try { window.localStorage.setItem(chapterRecoveryStorageKey(chapterId), JSON.stringify({ schemaVersion: 1, chapterId, baseVersionId, baseRevision, content, savedAt: new Date().toISOString() } satisfies ChapterRecoveryDraft)) }
  catch { /* SQLite autosave remains authoritative when browser storage is unavailable. */ }
}
function clearChapterRecoveryDraft(chapterId: string, expectedContent?: string): void {
  try {
    if (expectedContent !== undefined && readChapterRecoveryDraft(chapterId)?.content !== expectedContent) return
    window.localStorage.removeItem(chapterRecoveryStorageKey(chapterId))
  } catch { /* Browser recovery is best effort. */ }
}

const color = {
  bg: 'var(--dsw-alias-bg-base, #fff)', layer: 'var(--dsw-alias-bg-layer-1, #fff)', module: 'var(--dsw-alias-bg-module-platform, #f5f6f7)',
  hover: 'var(--dsw-specific-sidebar-nav-item-hover, #f1f3f5)', active: 'var(--dsw-specific-sidebar-nav-item-active, #e9ecf2)',
  text: 'var(--dsw-alias-label-primary, #202124)', secondary: 'var(--dsw-alias-label-secondary, #666b73)', tertiary: 'var(--dsw-alias-label-tertiary, #8a9099)',
  border: 'var(--dsw-alias-border-l2, rgba(0,0,0,.1))', borderSoft: 'var(--dsw-alias-border-l1, rgba(0,0,0,.05))',
  brand: 'var(--dsw-alias-state-business-primary, #4176e6)', success: 'var(--dsw-alias-state-success-primary, #22c55e)',
  warning: 'var(--dsw-alias-state-warn-primary, #f59e0b)', danger: 'var(--dsw-alias-state-error-primary, #ef4444)',
}

class NovelApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) { super(message); this.name = 'NovelApiError' }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${NOVEL_API_ROUTE}${path}`, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } })
  const body = await response.json() as T & { error?: { code?: string; message?: string } }
  if (!response.ok) throw new NovelApiError(body.error?.message ?? `HTTP ${response.status}`, response.status, body.error?.code ?? null)
  return body
}

function useNarrowViewport(maxWidth = 900): boolean {
  const query = `(max-width: ${maxWidth}px)`
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => { const media = window.matchMedia(query); const update = () => { setMatches(media.matches) }; media.addEventListener('change', update); update(); return () => { media.removeEventListener('change', update) } }, [query])
  return matches
}

function HomeOutline16({ size = 16 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M2.25 7.15 8 2.5l5.75 4.65v5.35a1 1 0 0 1-1 1H9.9V9.65H6.1v3.85H3.25a1 1 0 0 1-1-1V7.15Z" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function generationPulse(telemetry: GenerationTelemetry, active: boolean): string {
  if (telemetry.finalTokensPerSecond !== null) return `${telemetry.finalTokensPerSecond.toFixed(1)} tok/s · ${formatNumber(telemetry.finalOutputTokens ?? 0)} tokens`
  if (telemetry.estimatedTokensPerSecond !== null && telemetry.estimatedOutputTokens > 0) return `${active ? '正在生成 · ' : ''}≈ ${telemetry.estimatedTokensPerSecond.toFixed(1)} tok/s`
  return active ? '模型正在思考' : '未获得输出速率'
}

function SidebarEntry({ wide, openStudio, useSessions }: FooterProps & { openStudio: (sessionId?: string) => void }) {
  const sessionId = useSessions(state => state.current)
  const content = <button type="button" aria-label="打开小说工作室" style={{ ...plainNavButton, width: '100%', justifyContent: wide ? 'flex-start' : 'center', padding: wide ? '8px 10px' : 8 }} onClick={() => { openStudio(sessionId) }}><IconListPenOutline16 size={wide ? 16 : 18} />{wide && <span>小说工作室</span>}</button>
  return wide ? content : <Tooltip label="小说工作室" delayMs={400}>{content}</Tooltip>
}

function StudioOverlay({ closeStudio, sessionId, workspaces }: OverlayProps & { closeStudio: () => void; sessionId?: string; workspaces: IWorkspaces }) {
  const narrow = useNarrowViewport()
  const mobile = useNarrowViewport(620)
  const [overview, setOverview] = useState<StudioOverview | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [surface, setSurface] = useState<StudioSurface>('workspace')
  const [library, setLibrary] = useState<LibraryOverview | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [projectGenre, setProjectGenre] = useState('')
  const [projectStylePreset, setProjectStylePreset] = useState('web-fast')
  const [projectFolder, setProjectFolder] = useState<string | null>(null)
  const [markdownSync, setMarkdownSync] = useState(true)
  const [folderBusy, setFolderBusy] = useState(false)
  const beforeLeaveFlushRef = useRef<BeforeLeaveFlush | null>(null)
  const workspaceRequestRef = useRef(0)
  const refreshRequestRef = useRef(0)
  const workspaceSelectionPendingRef = useRef(false)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  const registerBeforeLeaveFlush = useCallback<RegisterBeforeLeaveFlush>((flush) => {
    beforeLeaveFlushRef.current = flush
  }, [])

  const flushEditorBeforeLeave = useCallback(async (): Promise<boolean> => {
    if (leaveBusy) return false
    const flush = beforeLeaveFlushRef.current
    if (!flush) { setLeaveError(null); return true }
    setLeaveBusy(true); setLeaveError(null)
    try { await flush(); return true }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setLeaveError(`正文保存失败，已留在当前页面：${message}`)
      return false
    } finally { setLeaveBusy(false) }
  }, [leaveBusy])

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    try {
      setLibrary(await api<LibraryOverview>('/library'))
      setLibraryError(null)
    } catch (cause) { setLibraryError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLibraryLoading(false) }
  }, [])

  const refresh = useCallback(async (quiet = false) => {
    const requestId = ++refreshRequestRef.current
    const selectionVersion = workspaceRequestRef.current
    if (!quiet) setLoading(true)
    try {
      const [nextOverview, loadedWorkspace] = await Promise.all([api<StudioOverview>('/studio'), api<WorkspaceSnapshot>('/workspace')])
      if (requestId !== refreshRequestRef.current || selectionVersion !== workspaceRequestRef.current || workspaceSelectionPendingRef.current) return
      const selectedProjectIsAvailable = Boolean(loadedWorkspace.selectedProjectId && loadedWorkspace.selectedProject)
      const preferredProjectId = selectedProjectIsAvailable ? loadedWorkspace.selectedProjectId : nextOverview.projects[0]?.project.id ?? null
      const nextWorkspace = loadedWorkspace.selectedProjectId !== preferredProjectId
        ? await api<WorkspaceSnapshot>('/workspace', { method: 'POST', body: JSON.stringify({ projectId: preferredProjectId, chapterId: null, sessionId }) })
        : loadedWorkspace
      if (requestId !== refreshRequestRef.current || selectionVersion !== workspaceRequestRef.current || workspaceSelectionPendingRef.current) return
      setOverview(nextOverview); setWorkspace(nextWorkspace); setError(null)
      setActiveProjectId(preferredProjectId)
    } catch (cause) { if (requestId === refreshRequestRef.current && selectionVersion === workspaceRequestRef.current && !workspaceSelectionPendingRef.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (!quiet && requestId === refreshRequestRef.current) setLoading(false) }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!creatingProject) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCreatingProject(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [creatingProject])
  useEffect(() => {
    const hasLiveRuns = overview && [...overview.activeRuns, ...overview.waitingApprovalRuns].length > 0
    if (!hasLiveRuns) return
    const timer = window.setInterval(() => { void refresh(true) }, 900)
    return () => { window.clearInterval(timer) }
  }, [overview?.activeRuns.length, overview?.waitingApprovalRuns.length, refresh])

  const openProject = useCallback(async (projectId: string, chapterId: string | null = null) => {
    if (!await flushEditorBeforeLeave()) return false
    const requestId = ++workspaceRequestRef.current
    workspaceSelectionPendingRef.current = true
    try {
      const nextWorkspace = await api<WorkspaceSnapshot>('/workspace', { method: 'POST', body: JSON.stringify({ projectId, chapterId, sessionId }) })
      if (requestId !== workspaceRequestRef.current) return false
      setWorkspace(nextWorkspace)
      setActiveProjectId(projectId); setSurface('workspace'); setError(null); setLoading(false)
      return true
    } catch (cause) { if (requestId === workspaceRequestRef.current) setError(cause instanceof Error ? cause.message : String(cause)); return false }
    finally { if (requestId === workspaceRequestRef.current) workspaceSelectionPendingRef.current = false }
  }, [flushEditorBeforeLeave, sessionId])

  const openLibrary = useCallback(async () => {
    if (!await flushEditorBeforeLeave()) return
    setSurface('library')
    setCreatingProject(false)
    void loadLibrary()
  }, [flushEditorBeforeLeave, loadLibrary])

  const leaveStudio = useCallback(async () => {
    if (await flushEditorBeforeLeave()) closeStudio()
  }, [closeStudio, flushEditorBeforeLeave])

  const archiveProject = useCallback(async (project: Project) => {
    if (activeProjectId === project.id && !await flushEditorBeforeLeave()) throw new Error('请先解决正文保存错误，再归档当前项目。')
    await api<Project>(`/projects/${encodeURIComponent(project.id)}/archive`, { method: 'POST', body: JSON.stringify({ baseRevision: project.revision }) })
    if (activeProjectId === project.id) {
      setWorkspace(await api<WorkspaceSnapshot>('/workspace', { method: 'POST', body: JSON.stringify({ projectId: null, chapterId: null, sessionId }) }))
      setActiveProjectId(null); setSurface('library')
    }
    await Promise.all([loadLibrary(), refresh(true)])
  }, [activeProjectId, flushEditorBeforeLeave, loadLibrary, refresh, sessionId])

  const restoreProject = useCallback(async (project: Project) => {
    await api<Project>(`/projects/${encodeURIComponent(project.id)}/restore`, { method: 'POST', body: JSON.stringify({ baseRevision: project.revision }) })
    await Promise.all([loadLibrary(), refresh(true)])
  }, [loadLibrary, refresh])

  const finishImport = useCallback(async (projectId: string) => {
    setImportOpen(false)
    await Promise.all([loadLibrary(), refresh(true)])
    await openProject(projectId)
  }, [loadLibrary, openProject, refresh])

  const registerProjectFolder = async (path: string): Promise<void> => {
    await workspaces.create({ path })
    setProjectFolder(path)
  }

  const chooseProjectFolder = async (): Promise<void> => {
    if (folderBusy) return
    setFolderBusy(true)
    try {
      const path = await workspaces.pickDirectory()
      if (path) await registerProjectFolder(path)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setFolderBusy(false) }
  }

  const createProjectFolder = async (): Promise<void> => {
    if (folderBusy) return
    setFolderBusy(true)
    try {
      const parent = await workspaces.pickDirectory()
      if (!parent) return
      const name = projectTitle.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '').trim() || 'novel-project'
      const path = await workspaces.createDirectory(parent, name.slice(0, 120))
      await registerProjectFolder(path)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setFolderBusy(false) }
  }

  const createProject = async () => {
    if (!projectTitle.trim()) return
    if (!await flushEditorBeforeLeave()) return
    try {
      const tree = await api<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify({ title: projectTitle.trim(), genre: projectGenre.trim() || undefined, stylePresetId: projectStylePreset, workspacePath: projectFolder ?? undefined, markdownSyncEnabled: Boolean(projectFolder && markdownSync) }) })
      setProjectTitle(''); setProjectGenre(''); setProjectStylePreset('web-fast'); setProjectFolder(null); setMarkdownSync(true); setCreatingProject(false); await refresh(true); await openProject(tree.project.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return <section data-novel-studio role="dialog" aria-modal="true" aria-label="小说工作室" style={{ position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'auto', display: 'grid', gridTemplateRows: '52px minmax(0,1fr)', background: color.bg, color: color.text, fontFamily: 'var(--dsw-font-family, Inter, "PingFang SC", sans-serif)' }}>
    <style>{STUDIO_SCOPED_CSS}</style>
    <header style={topBar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <Tooltip label="返回 DeepSeek Harness" delayMs={350}><Button size="sm" variant="toolbar" aria-label="返回 DeepSeek Harness" disabled={leaveBusy} icon={<HomeOutline16 size={16} />} onClick={() => { void leaveStudio() }} /></Tooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <IconListPenOutline16 size={18} /><strong style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>小说工作室</strong>
          <Button size="sm" variant={surface === 'library' ? 'outline' : 'toolbar'} aria-label="打开作品库" aria-pressed={surface === 'library'} disabled={leaveBusy} icon={<IconArchiveOutline20 size={15} />} onClick={() => { void openLibrary() }}>{mobile ? undefined : leaveBusy ? '正在保存…' : '作品库'}</Button>
          {surface === 'workspace' && activeProjectId && overview && <select aria-label="切换小说项目" value={activeProjectId} onChange={event => { void openProject(event.target.value) }} style={{ ...inputStyle, width: mobile ? 116 : 190, height: 30, padding: '0 8px', background: color.layer }}>
            {workspace?.selectedProject?.project.status === 'archived' && !overview.projects.some(item => item.project.id === activeProjectId) && <option value={activeProjectId}>{workspace.selectedProject.project.title}（只读）</option>}
            {overview.projects.map(item => <option key={item.project.id} value={item.project.id}>{item.project.title}</option>)}
          </select>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {mobile ? <Tooltip label="新建项目" delayMs={350}><Button size="sm" variant="toolbar" aria-label="新建项目" icon={<IconPlusOutline16 size={16} />} onClick={() => { setImportOpen(false); setCreatingProject(value => !value) }} /></Tooltip> : <Button size="sm" variant="outline" icon={<IconPlusOutline16 size={14} />} onClick={() => { setImportOpen(false); setCreatingProject(value => !value) }}>新建项目</Button>}
      </div>
    </header>
    {leaveError && <div role="alert" style={{ position: 'absolute', zIndex: 1005, top: 58, right: 12, maxWidth: 'min(520px, calc(100% - 24px))', padding: '9px 12px', border: `1px solid ${color.danger}`, borderRadius: 7, background: color.layer, color: color.danger, fontSize: 11, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}><IconWarningOutline16 size={14} /> {leaveError}</div>}
    {creatingProject && <section role="dialog" aria-modal="true" aria-label="新建项目" style={{ position: 'absolute', zIndex: 1002, top: 58, left: mobile ? 10 : '50%', right: mobile ? 10 : 'auto', transform: mobile ? undefined : 'translateX(-50%)', width: mobile ? undefined : 560, ...panel, padding: 14, boxShadow: '0 12px 34px rgba(0,0,0,.16)' }}>
      <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>新建小说项目</strong>
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0,2fr) minmax(0,1fr)', gap: 9 }}><Field label="项目名称"><input autoFocus aria-label="快速项目名称" value={projectTitle} onChange={event => { setProjectTitle(event.target.value) }} style={inputStyle} placeholder="例如：潮汐尽头" /></Field><Field label="题材"><input aria-label="快速项目题材" value={projectGenre} onChange={event => { setProjectGenre(event.target.value) }} style={inputStyle} placeholder="科幻、悬疑…" /></Field></div>
      <Field label="初始文风"><select aria-label="初始文风" value={projectStylePreset} onChange={event => { setProjectStylePreset(event.target.value) }} style={{ ...inputStyle, height: 36, marginTop: 9 }}>{BUILTIN_STYLE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name} · {preset.summary}</option>)}</select></Field>
      <div style={{ marginTop: 10, padding: 10, border: `1px solid ${color.borderSoft}`, borderRadius: 7, background: color.module }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span style={{ color: color.secondary, fontSize: 11 }}>小说文件夹（可选）</span><div style={{ display: 'flex', gap: 6 }}><Button size="sm" variant="ghost" disabled={folderBusy} onClick={() => { void chooseProjectFolder() }}>选择文件夹</Button><Button size="sm" variant="ghost" disabled={folderBusy} onClick={() => { void createProjectFolder() }}>新建文件夹</Button></div></div>{projectFolder && <div style={{ marginTop: 7, color: color.text, fontSize: 11, wordBreak: 'break-all' }}>{projectFolder}</div>}{projectFolder && <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, color: color.secondary, fontSize: 11 }}><input type="checkbox" checked={markdownSync} onChange={event => { setMarkdownSync(event.target.checked) }} />生成后同步章节 Markdown 与 memory 文件</label>}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}><Button size="sm" variant="ghost" onClick={() => { setCreatingProject(false) }}>取消</Button><Button size="sm" variant="primary" disabled={!projectTitle.trim()} onClick={() => { void createProject() }}>创建并进入</Button></div>
    </section>}
    {importOpen && <ImportProjectDialog mobile={mobile} close={() => { setImportOpen(false) }} imported={finishImport} />}
    {surface === 'library' ? <ProjectLibraryView library={library} overview={overview} loading={libraryLoading} error={libraryError} mobile={mobile} createProject={() => { setImportOpen(false); setCreatingProject(true) }} openImport={() => { setCreatingProject(false); setImportOpen(true) }} openProject={openProject} archiveProject={archiveProject} restoreProject={restoreProject} retry={loadLibrary} /> : loading && !overview ? <div style={centered}>正在载入小说项目…</div> : overview?.projects.length === 0 && !workspace?.selectedProject ?
      <EmptyProjectWorkspace error={error} mobile={mobile} createProject={() => { setImportOpen(false); setCreatingProject(true) }} openImport={() => { setCreatingProject(false); setImportOpen(true) }} /> :
      activeProjectId && overview && workspace ? <ProjectWorkspace projectId={activeProjectId} overview={overview} workspace={workspace} narrow={narrow} mobile={mobile} error={error} openProject={openProject} refresh={refresh} registerBeforeLeaveFlush={registerBeforeLeaveFlush} /> :
      <div style={centered}>{error ?? '正在进入项目工作台…'}</div>}
  </section>
}

function EmptyProjectWorkspace({ error, mobile, createProject, openImport }: { error: string | null; mobile: boolean; createProject: () => void; openImport: () => void }) {
  return <main style={{ minHeight: 0, display: 'grid', gridTemplateColumns: mobile ? '1fr' : '250px minmax(0,1fr)', background: color.bg }}>
    {!mobile && <aside style={sidePanel} aria-label="空项目结构"><div style={sideHeader}><strong>项目结构</strong></div><div style={{ padding: 8 }}><TreeNav icon={<IconDataOutline16 size={16} />} label="创作准备" active /><TreeNav icon={<IconDataOutline16 size={16} />} label="创作统计" disabled /><TreeNav icon={<IconUserOutline16 size={16} />} label="人物事实" disabled /><TreeNav icon={<IconThinkOutline16 size={16} />} label="Canon 事实" disabled /></div></aside>}
    <section style={{ minWidth: 0, display: 'grid', placeItems: 'center', background: color.module }}><div style={{ ...panel, width: 'min(520px, calc(100% - 32px))', background: color.layer }}><EmptyState icon={<IconFolderOpenOutline16 size={24} />} title="从第一个小说项目开始" text="新建空白项目，或导入 Markdown、TXT、可携带项目快照（非完整备份）。" action={<div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}><Button variant="primary" icon={<IconPlusOutline16 size={15} />} onClick={createProject}>新建项目</Button><Button variant="outline" icon={<IconFolderOpenOutline16 size={15} />} onClick={openImport}>导入已有作品</Button></div>} />{error && <ErrorNotice message={error} />}</div></section>
  </main>
}

const OFFLINE_COVER_PALETTES = [
  { paper: '#ede8df', ink: '#3e352d', accent: '#b86442' },
  { paper: '#dfe8e4', ink: '#263b36', accent: '#4d7e70' },
  { paper: '#e5e4ed', ink: '#313349', accent: '#686aa0' },
  { paper: '#eee6d8', ink: '#423627', accent: '#ad7b35' },
  { paper: '#e7e1e4', ink: '#44323b', accent: '#946177' },
] as const

function deterministicCoverPalette(seed: string): (typeof OFFLINE_COVER_PALETTES)[number] {
  let hash = 2166136261
  for (const character of seed) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return OFFLINE_COVER_PALETTES[(hash >>> 0) % OFFLINE_COVER_PALETTES.length]!
}

function ProjectLibraryView({ library, overview, loading, error, mobile, createProject, openImport, openProject, archiveProject, restoreProject, retry }: { library: LibraryOverview | null; overview: StudioOverview | null; loading: boolean; error: string | null; mobile: boolean; createProject: () => void; openImport: () => void; openProject: (projectId: string, chapterId?: string | null) => Promise<boolean>; archiveProject: (project: Project) => Promise<void>; restoreProject: (project: Project) => Promise<void>; retry: () => Promise<void> }) {
  const [segment, setSegment] = useState<LibrarySegment>('active')
  const [query, setQuery] = useState('')
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const projects = library?.[segment] ?? []
  const filteredProjects = useMemo(() => projects.filter(project => !normalizedQuery || `${project.title}\n${project.genre ?? ''}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery)), [normalizedQuery, projects])
  const summaries = useMemo(() => new Map(overview?.projects.map(item => [item.project.id, item]) ?? []), [overview])

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busyAction) return
    setBusyAction(key); setActionError(null)
    try { await action() }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusyAction(null) }
  }

  if (loading && !library) return <main aria-label="作品库" style={{ ...centered, background: color.module }}>正在载入作品库…</main>
  if (!library) return <main aria-label="作品库" style={{ ...centered, padding: 24, background: color.module }}><div style={{ ...panel, width: 'min(520px, 100%)' }}><EmptyState icon={<IconWarningOutline16 size={24} />} title="作品库暂时无法打开" text={error ?? '未能读取本地项目。'} action={<Button variant="outline" icon={<IconRefreshOutline16 size={15} />} onClick={() => { void retry() }}>重新载入</Button>} /></div></main>

  const noProjects = library.active.length === 0 && library.archived.length === 0
  return <main aria-label="作品库" aria-busy={loading || Boolean(busyAction)} style={{ minHeight: 0, overflow: 'auto', background: color.module }}>
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: mobile ? '26px 16px 64px' : '42px 30px 72px' }}>
      <header style={{ display: 'flex', alignItems: mobile ? 'stretch' : 'flex-end', flexDirection: mobile ? 'column' : 'row', gap: 16 }}>
        <div><span style={sectionLabel}>NOVEL STUDIO</span><h1 style={{ ...pageTitle, marginTop: 5 }}>作品库</h1><p style={{ ...pageSubtitle, maxWidth: 520 }}>浏览本机保存的小说项目。启动时仍会直接进入上次写作位置。</p></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: mobile ? 0 : 'auto' }}><Button variant="outline" icon={<IconFolderOpenOutline16 size={15} />} onClick={openImport}>导入已有作品</Button><Button variant="primary" icon={<IconPlusOutline16 size={15} />} onClick={createProject}>新建项目</Button></div>
      </header>
      {noProjects ? <section style={{ ...panel, marginTop: 24, background: color.layer }}><EmptyState icon={<IconFolderOpenOutline16 size={26} />} title="作品库还是空的" text="新建空白作品，或导入 Markdown、TXT、可携带项目快照（非完整备份）。" action={<div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}><Button variant="primary" onClick={createProject}>新建项目</Button><Button variant="outline" onClick={openImport}>导入为新项目</Button></div>} /></section> : <>
        <section aria-label="筛选作品" style={{ display: 'flex', alignItems: mobile ? 'stretch' : 'center', flexDirection: mobile ? 'column' : 'row', gap: 12, marginTop: 26 }}>
          <div role="tablist" aria-label="作品库分段" style={{ display: 'inline-flex', alignSelf: mobile ? 'stretch' : 'auto', padding: 3, border: `1px solid ${color.borderSoft}`, borderRadius: 8, background: color.layer }}>
            <button type="button" role="tab" aria-selected={segment === 'active'} onClick={() => { setSegment('active'); setConfirmArchiveId(null) }} style={{ ...librarySegmentButton, flex: mobile ? 1 : undefined, background: segment === 'active' ? color.active : 'transparent', color: segment === 'active' ? color.text : color.secondary }}>活跃作品 <span style={libraryCountBadge}>{library.active.length}</span></button>
            <button type="button" role="tab" aria-selected={segment === 'archived'} onClick={() => { setSegment('archived'); setConfirmArchiveId(null) }} style={{ ...librarySegmentButton, flex: mobile ? 1 : undefined, background: segment === 'archived' ? color.active : 'transparent', color: segment === 'archived' ? color.text : color.secondary }}>已归档 <span style={libraryCountBadge}>{library.archived.length}</span></button>
          </div>
          <input type="search" aria-label="搜索作品标题或题材" value={query} onChange={event => { setQuery(event.target.value) }} placeholder="搜索标题或题材" style={{ ...inputStyle, width: mobile ? '100%' : 260, marginLeft: mobile ? 0 : 'auto', background: color.layer }} />
        </section>
        {(error || actionError) && <ErrorNotice message={actionError ?? error ?? ''} />}
        {filteredProjects.length === 0 ? <section style={{ ...panel, marginTop: 18, background: color.layer }}><EmptyState icon={<IconArchiveOutline20 size={24} />} title={normalizedQuery ? '没有匹配的作品' : segment === 'active' ? '没有活跃作品' : '归档中没有作品'} text={normalizedQuery ? '试试作品标题中的其他字，或按题材搜索。' : segment === 'active' ? '可以恢复归档作品，或创建一个新项目。' : '归档后的作品会安全地保留在这里。'} /></section> : <section aria-label={segment === 'active' ? '活跃作品列表' : '归档作品列表'} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 248px), 1fr))', gap: 16, marginTop: 18 }}>
          {filteredProjects.map(project => <LibraryProjectCard key={project.id} project={project} summary={summaries.get(project.id)} archived={segment === 'archived'} busyAction={busyAction} confirmArchive={confirmArchiveId === project.id} requestArchive={() => { setConfirmArchiveId(project.id); setActionError(null) }} cancelArchive={() => { setConfirmArchiveId(null) }} open={() => { void openProject(project.id) }} archive={() => { void runAction(`archive:${project.id}`, async () => { await archiveProject(project); setConfirmArchiveId(null) }) }} restore={() => { void runAction(`restore:${project.id}`, () => restoreProject(project)) }} exportProject={format => { void runAction(`export:${project.id}:${format}`, () => downloadProjectExport(project.id, format)) }} />)}
        </section>}
      </>}
    </div>
  </main>
}

function LibraryProjectCard({ project, summary, archived, busyAction, confirmArchive, requestArchive, cancelArchive, open, archive, restore, exportProject }: { project: Project; summary?: StudioProjectSummary; archived: boolean; busyAction: string | null; confirmArchive: boolean; requestArchive: () => void; cancelArchive: () => void; open: () => void; archive: () => void; restore: () => void; exportProject: (format: 'markdown' | 'snapshot') => void }) {
  const palette = deterministicCoverPalette(project.id)
  const projectBusy = busyAction?.includes(`:${project.id}`) ?? false
  const statusText = summary ? `${summary.chapterCount} 章 · ${summary.approvedChapterCount} 章已批准` : archived ? '项目已归档' : '等待载入章节统计'
  return <article style={{ ...panel, display: 'grid', gridTemplateRows: '148px auto', minWidth: 0, background: color.layer }}>
    <div data-novel-offline-cover={project.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '17px 18px', borderBottom: `1px solid ${color.borderSoft}`, background: palette.paper, color: palette.ink, overflow: 'hidden' }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 5, background: palette.accent }} />
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.16em', opacity: .68 }}>NOVEL STUDIO · LOCAL</span>
      <strong style={{ maxWidth: '88%', fontFamily: 'Iowan Old Style, Songti SC, STSong, serif', fontSize: 21, lineHeight: 1.3, letterSpacing: '.01em' }}>{project.title}</strong>
      <span style={{ fontSize: 10, opacity: .74 }}>{project.genre?.trim() || '未设置题材'}</span>
    </div>
    <div style={{ display: 'grid', gap: 12, padding: 14 }}>
      <div style={{ minWidth: 0 }}><h2 style={{ margin: 0, overflow: 'hidden', color: color.text, fontSize: 14, fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</h2><div style={{ marginTop: 5, color: color.secondary, fontSize: 11 }}>{statusText}</div>{summary && summary.waitingApprovalCount > 0 && <div style={{ marginTop: 4, color: color.warning, fontSize: 10 }}>{summary.waitingApprovalCount} 个章节等待审批</div>}<div style={{ marginTop: 6, color: color.tertiary, fontSize: 10 }}>更新于 {formatProjectDate(project.updatedAt)}</div></div>
      {confirmArchive ? <div role="group" aria-label={`确认归档${project.title}`} style={{ padding: 10, border: `1px solid ${color.warning}`, borderRadius: 7, background: color.module }}><strong style={{ display: 'block', fontSize: 11 }}>确认归档《{project.title}》？</strong><p style={{ margin: '4px 0 9px', color: color.secondary, fontSize: 10, lineHeight: 1.5 }}>不会删除内容，可随时从“已归档”恢复。</p><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><Button size="sm" variant="ghost" disabled={projectBusy} onClick={cancelArchive}>取消</Button><Button size="sm" variant="outline" disabled={projectBusy} onClick={archive}>{projectBusy ? '正在归档…' : '确认归档'}</Button></div></div> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{archived ? <><Button size="sm" variant="outline" disabled={projectBusy} onClick={open}>只读查看</Button><Button size="sm" variant="primary" disabled={projectBusy} onClick={restore}>{projectBusy ? '正在恢复…' : '恢复到活跃作品'}</Button></> : <><Button size="sm" variant="primary" disabled={projectBusy} onClick={open}>继续写作</Button><Button size="sm" variant="ghost" disabled={projectBusy} onClick={requestArchive}>归档</Button></>}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 10, borderTop: `1px solid ${color.borderSoft}` }}><Button size="sm" variant="ghost" disabled={projectBusy} onClick={() => { exportProject('markdown') }}>下载 Markdown</Button><Button size="sm" variant="ghost" disabled={projectBusy} onClick={() => { exportProject('snapshot') }}>下载可携带项目快照</Button></div>
    </div>
  </article>
}

async function downloadProjectExport(projectId: string, format: 'markdown' | 'snapshot'): Promise<void> {
  const file = await api<ProjectExportFile>(`/projects/${encodeURIComponent(projectId)}/exports/${format}`)
  const objectUrl = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl; anchor.download = file.fileName; anchor.click()
  window.setTimeout(() => { URL.revokeObjectURL(objectUrl) }, 0)
}

function ImportProjectDialog({ mobile, close, imported }: { mobile: boolean; close: () => void; imported: (projectId: string) => Promise<void> }) {
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) close() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [busy, close])

  const chooseFile = async (file: File | undefined) => {
    setCandidate(null); setError(null)
    if (!file) return
    const lowerName = file.name.toLocaleLowerCase('en-US')
    const format: ImportCandidate['format'] | null = lowerName.endsWith('.json') ? 'snapshot' : lowerName.endsWith('.md') || lowerName.endsWith('.markdown') ? 'markdown' : lowerName.endsWith('.txt') ? 'txt' : null
    if (!format) { setError('仅支持 .md、.markdown、.txt 和 JSON 可携带项目快照。'); return }
    const sizeLimit = format === 'snapshot' ? MAX_CLIENT_SNAPSHOT_IMPORT_BYTES : MAX_CLIENT_MANUSCRIPT_IMPORT_BYTES
    if (file.size > sizeLimit) { setError(format === 'snapshot' ? '可携带项目快照超过 70 MB，无法在 72 MB Host 请求上限内安全导入。' : 'Markdown/TXT 正文超过 32 MB，请拆分后再导入。'); return }
    try {
      const content = await file.text()
      let snapshot: Record<string, unknown> | null = null
      if (format === 'snapshot') {
        const parsed = JSON.parse(content) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('可携带项目快照必须是 JSON 对象。')
        snapshot = parsed as Record<string, unknown>
      }
      setCandidate({ format, sourceName: file.name, content, snapshot, size: file.size })
    } catch (cause) { setError(cause instanceof Error ? `无法读取文件：${cause.message}` : '无法读取所选文件。') }
  }

  const submit = async () => {
    if (!candidate || busy) return
    setBusy(true); setError(null)
    try {
      const overrideTitle = title.trim()
      const body = candidate.format === 'snapshot'
        ? { content: candidate.snapshot, ...(overrideTitle ? { title: overrideTitle } : {}) }
        : { format: candidate.format, sourceName: candidate.sourceName, content: candidate.content, ...(overrideTitle ? { title: overrideTitle } : {}) }
      const result = await api<ProjectImportResult | ProjectTree>('/imports', { method: 'POST', body: JSON.stringify(body) })
      const projectId = 'chapterIds' in result ? result.project.project.id : result.project.id
      await imported(projectId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <div style={{ position: 'fixed', zIndex: 1003, inset: 0, display: 'grid', placeItems: 'center', padding: mobile ? 12 : 24, background: 'rgba(10, 13, 18, .28)' }}>
    <section role="dialog" aria-modal="true" aria-labelledby="novel-import-title" aria-describedby="novel-import-description" style={{ ...panel, boxSizing: 'border-box', width: 'min(560px, 100%)', maxHeight: 'min(680px, calc(100vh - 24px))', overflow: 'auto', padding: mobile ? 16 : 20, background: color.layer, boxShadow: '0 18px 48px rgba(0,0,0,.2)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}><div style={{ minWidth: 0, flex: 1 }}><h2 id="novel-import-title" style={{ margin: 0, fontSize: 16 }}>导入为新项目</h2><p id="novel-import-description" style={{ margin: '6px 0 0', color: color.secondary, fontSize: 11, lineHeight: 1.6 }}>导入会创建独立的新项目，不会覆盖现有内容。可携带项目快照并非完整备份。</p></div><Button size="sm" variant="toolbar" aria-label="关闭导入对话框" disabled={busy} icon={<IconCloseOutline16 size={16} />} onClick={close} /></div>
      <label style={{ display: 'grid', placeItems: 'center', minHeight: 116, marginTop: 18, padding: 18, border: `1px dashed ${candidate ? color.brand : color.border}`, borderRadius: 8, background: color.module, color: color.secondary, textAlign: 'center' }}><IconFolderOpenOutline16 size={23} /><strong style={{ marginTop: 8, color: color.text, fontSize: 12 }}>{candidate ? candidate.sourceName : '选择 Markdown、TXT 或可携带项目快照'}</strong><span style={{ marginTop: 4, fontSize: 10 }}>{candidate ? `${formatImportKind(candidate.format)} · ${formatFileSize(candidate.size)}` : '正文最大 32 MB · JSON 可携带项目快照最大 70 MB'}</span><input type="file" aria-label="选择要导入的作品文件" accept=".md,.markdown,.txt,.novel-studio.json,.json,text/markdown,text/plain,application/json" disabled={busy} onChange={event => { void chooseFile(event.currentTarget.files?.[0]) }} style={{ boxSizing: 'border-box', maxWidth: '100%', marginTop: 12, color: color.secondary, font: 'inherit', fontSize: 10 }} /></label>
      <Field label="项目标题（可选覆盖）"><input aria-label="导入项目标题" value={title} maxLength={500} disabled={busy} onChange={event => { setTitle(event.target.value) }} placeholder="留空则使用文件标题或文件名" style={{ ...inputStyle, marginTop: 7 }} /></Field>
      {error && <div role="alert" style={{ marginTop: 12, padding: '9px 10px', border: `1px solid ${color.danger}`, borderRadius: 7, color: color.danger, fontSize: 11, lineHeight: 1.5 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={!candidate || busy} onClick={() => { void submit() }}>{busy ? '正在导入…' : '导入并打开新项目'}</Button></div>
    </section>
  </div>
}

function formatImportKind(format: ImportCandidate['format']): string { return format === 'snapshot' ? '可携带项目快照（非完整备份）' : format === 'markdown' ? 'Markdown 正文' : '纯文本正文' }
function formatFileSize(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
function formatProjectDate(value: string): string { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) }

function ProjectWorkspace({ projectId, overview, workspace, narrow, mobile, error, openProject, refresh, registerBeforeLeaveFlush }: { projectId: string; overview: StudioOverview; workspace: WorkspaceSnapshot; narrow: boolean; mobile: boolean; error: string | null; openProject: (projectId: string, chapterId?: string | null) => Promise<boolean>; refresh: (quiet?: boolean) => Promise<void>; registerBeforeLeaveFlush: RegisterBeforeLeaveFlush }) {
  const tree = workspace.selectedProjectId === projectId ? workspace.selectedProject : null
  const summary = overview.projects.find(item => item.project.id === projectId) ?? (tree ? readOnlyProjectSummary(tree) : null)
  const readOnly = summary?.project.status === 'archived'
  const [showTree, setShowTree] = useState(!mobile)
  const [section, setSection] = useState<ProjectSection>(workspace.selectedChapter ? 'chapter' : readOnly ? 'memory' : 'overview')
  const creatingChapterRef = useRef(false)
  useEffect(() => {
    if (mobile) setShowTree(false)
    else setShowTree(true)
  }, [mobile])
  const selectedChapter = workspace.selectedProjectId === projectId ? workspace.selectedChapter : null
  const projectChapters = workspace.selectedProjectId === projectId && workspace.selectedProject
    ? workspace.selectedProject.books.flatMap(book => book.volumes.flatMap(volume => volume.chapters))
    : []
  useEffect(() => { setSection(selectedChapter ? 'chapter' : readOnly ? 'memory' : 'overview') }, [projectId, readOnly])
  useEffect(() => { if (selectedChapter) setSection('chapter') }, [selectedChapter?.id])
  if (!summary) return <div style={centered}>项目不存在或暂时无法打开。</div>
  const projectRuns = [...overview.waitingApprovalRuns, ...overview.activeRuns, ...overview.failedRuns, ...overview.recentRuns].filter(run => run.projectId === projectId)
  const createChapter = async () => {
    if (readOnly || creatingChapterRef.current || !await openProject(projectId, workspace.selectedChapterId)) return
    creatingChapterRef.current = true
    try {
      const chapter = await api<ChapterDetail>(`/projects/${encodeURIComponent(projectId)}/chapters`, { method: 'POST', body: '{}' })
      await refresh(true); await openProject(projectId, chapter.id)
    } finally { creatingChapterRef.current = false }
  }
  return <main style={{ minHeight: 0, position: 'relative', display: 'grid', gridTemplateColumns: mobile ? '1fr' : narrow ? '232px minmax(0,1fr)' : '250px minmax(0,1fr)', background: color.bg }}>
    {mobile && <div style={{ position: 'absolute', zIndex: 5, top: 0, left: 0, right: 0, height: 52, boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '8px', borderBottom: `1px solid ${color.borderSoft}`, background: color.module, pointerEvents: 'none' }}><Button size="sm" variant="outline" aria-expanded={showTree} aria-label={showTree ? '关闭项目结构' : '打开项目结构'} style={{ pointerEvents: 'auto' }} icon={<IconFolderClose16 size={16} />} onClick={() => { setShowTree(value => !value) }}>结构</Button></div>}
    {showTree && <ProjectTree summary={summary} workspace={workspace} section={section} mobile={mobile} readOnly={readOnly} selectSection={next => { if (next === 'chapter') { setSection(next); if (mobile) setShowTree(false); return }; void (async () => { if (!await openProject(projectId, null)) return; setSection(next); if (mobile) setShowTree(false) })() }} selectChapter={chapterId => openProject(projectId, chapterId)} createChapter={createChapter} close={() => { if (mobile) setShowTree(false) }} />}
    <section style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', gridColumn: mobile ? '1' : undefined }}>{section === 'chapter' ? selectedChapter ? <ChapterEditor chapter={selectedChapter} projectRuns={projectRuns} readOnly={readOnly} refresh={refresh} registerBeforeLeaveFlush={registerBeforeLeaveFlush} /> : <ProjectOverview summary={summary} runs={projectRuns} openChapter={chapterId => openProject(projectId, chapterId)} createChapter={createChapter} mobile={mobile} /> : section === 'overview' ? <ProjectOverview summary={summary} runs={projectRuns} openChapter={chapterId => openProject(projectId, chapterId)} createChapter={createChapter} mobile={mobile} /> : section === 'batches' ? <ChapterBatchesPanel projectId={projectId} projectRevision={summary.project.revision} chapters={projectChapters} archived={summary.project.status === 'archived'} narrow={narrow} request={api} onProjectChanged={() => refresh(true)} onOpenPreparation={() => { setSection('overview') }} onOpenRelationships={() => { setSection('relationships') }} onCreateChapter={createChapter} onOpenChapter={async chapterId => { await openProject(projectId, chapterId) }} /> : section === 'memory' ? <MemoryBrowserPanel projectId={projectId} projectRevision={summary.project.revision} archived={summary.project.status === 'archived'} narrow={narrow} request={api} onProjectChanged={() => refresh(true)} /> : section === 'relationships' ? <EntityRelationshipsWorkspace project={summary.project} narrow={narrow} refreshProject={() => refresh(true)} /> : section === 'statistics' ? <ProjectStatisticsPanel projectId={projectId} projectTitle={summary.project.title} narrow={narrow} request={api} onOpenChapter={async chapterId => { await openProject(projectId, chapterId) }} /> : <KnowledgeView projectId={projectId} section={section} mobile={mobile} readOnly={readOnly} />}{error && <ErrorNotice message={error} />}</section>
  </main>
}

function readOnlyProjectSummary(tree: ProjectTree): StudioProjectSummary {
  const volumes = tree.books.flatMap(book => book.volumes)
  const chapters = volumes.flatMap(volume => volume.chapters)
  return { project: tree.project, bookCount: tree.books.length, volumeCount: volumes.length, chapterCount: chapters.length, approvedChapterCount: chapters.filter(chapter => chapter.status === 'approved').length, latestWorkflow: null, activeWorkflowCount: 0, waitingApprovalCount: 0 }
}

function ProjectTree({ summary, workspace, section, mobile, readOnly, selectSection, selectChapter, createChapter, close }: { summary: StudioProjectSummary; workspace: WorkspaceSnapshot; section: ProjectSection; mobile: boolean; readOnly: boolean; selectSection: (section: ProjectSection) => void; selectChapter: (id: string | null) => Promise<boolean>; createChapter: () => Promise<void>; close: () => void }) {
  const tree = workspace.selectedProjectId === summary.project.id ? workspace.selectedProject : null
  return <aside role={mobile ? 'dialog' : undefined} aria-modal={mobile ? true : undefined} tabIndex={mobile ? -1 : undefined} onKeyDown={event => { if (mobile && event.key === 'Escape') close() }} style={{ ...sidePanel, ...(mobile ? mobileDrawerLeft : {}) }} aria-label="项目结构">
    <div style={sideHeader}><strong>项目结构</strong>{mobile && <Button size="sm" variant="toolbar" aria-label="关闭项目结构" icon={<IconCloseOutline16 size={16} />} onClick={close} />}</div>
    <nav style={{ padding: '8px 8px 2px' }}><TreeNav icon={<IconDataOutline16 size={16} />} label="创作准备" active={section === 'overview'} disabled={readOnly} onClick={() => { selectSection('overview') }} /><TreeNav icon={<IconPlayOutline16 size={16} />} label="批量生成" active={section === 'batches'} onClick={() => { selectSection('batches') }} /><TreeNav icon={<IconDataOutline16 size={16} />} label="创作统计" active={section === 'statistics'} onClick={() => { selectSection('statistics') }} /><TreeNav icon={<IconUserOutline16 size={16} />} label="人物事实" active={section === 'entities'} onClick={() => { selectSection('entities') }} /><TreeNav icon={<IconBranchOutline16 size={16} />} label="实体关系" active={section === 'relationships'} onClick={() => { selectSection('relationships') }} /><TreeNav icon={<IconThinkOutline16 size={16} />} label="Canon 事实" active={section === 'canon'} onClick={() => { selectSection('canon') }} /><TreeNav icon={<IconListPenOutline16 size={16} />} label="时间线看板" active={section === 'timeline'} onClick={() => { selectSection('timeline') }} /><TreeNav icon={<IconWarningOutline16 size={16} />} label="伏笔事实" active={section === 'foreshadowing'} onClick={() => { selectSection('foreshadowing') }} /><TreeNav icon={<IconDataOutline16 size={16} />} label="记忆" active={section === 'memory'} onClick={() => { selectSection('memory') }} /></nav>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 12px 7px' }}><span style={sectionLabel}>{readOnly ? '正文结构 · 只读' : '正文结构'}</span><Button size="sm" variant="ghost" aria-label="新建章节" disabled={readOnly} icon={<IconPlusOutline16 size={14} />} onClick={() => { void createChapter() }}>新章</Button></div>
    <div style={{ padding: '0 8px 16px', overflow: 'auto' }}>{tree?.books.map(book => <div key={book.id}><div style={treeGroup}><IconFolderOpenOutline16 size={15} />{book.title}</div>{book.volumes.map(volume => <div key={volume.id}><div style={{ ...treeGroup, paddingLeft: 22 }}><IconFolderOpenOutline16 size={14} />{volume.title}</div>{volume.chapters.map(chapter => <button type="button" key={chapter.id} onClick={() => { void selectChapter(chapter.id).then(opened => { if (opened) close() }) }} style={{ ...treeRow, background: chapter.id === workspace.selectedChapterId ? color.active : 'transparent' }}><span style={{ width: 22, color: color.tertiary, fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 10 }}>{String(chapter.chapterNumber).padStart(2, '0')}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chapter.title}</span>{chapter.status === 'approved' && <StateDot state="done" size={8} />}</button>)}</div>)}</div>)}</div>
    <div style={{ marginTop: 'auto', padding: 8, borderTop: `1px solid ${color.borderSoft}` }}><TreeNav icon={<IconArchiveOutline20 size={16} />} label="故事资料" active={section === 'sources'} onClick={() => { selectSection('sources') }} /><TreeNav icon={<IconSettingsOutline16 size={16} />} label="项目设置" disabled /></div>
  </aside>
}

function ProjectOverview({ summary, runs, openChapter, createChapter, mobile }: { summary: StudioProjectSummary; runs: WorkflowRun[]; openChapter: (id: string) => Promise<boolean>; createChapter: () => Promise<void>; mobile: boolean }) {
  return <div style={{ height: '100%', overflow: 'auto', background: color.module }}><div style={{ maxWidth: 820, margin: '0 auto', padding: mobile ? '70px 16px 70px' : '42px 30px 70px' }}>
    <h1 style={pageTitle}>{summary.project.title}</h1>
    <StyleProfilePanel projectId={summary.project.id} />
    <FoundationSequence projectId={summary.project.id} chapterCount={summary.chapterCount} createChapter={createChapter} />
    <section style={{ marginTop: 30 }}><SectionHeading title="最近运行" /><div style={{ ...panel, marginTop: 10 }}>{runs.slice(0, 5).map(run => <RunRow key={run.id} run={run} project={summary.project} onOpen={() => { void openChapter(run.chapterId) }} />)}{runs.length === 0 && <div style={{ padding: 22, color: color.secondary, fontSize: 13 }}>完成创作准备并选择章节后，这里会显示生成、流程检查和审批进度。</div>}</div></section>
  </div></div>
}

function StyleProfilePanel({ projectId }: { projectId: string }) {
  const [catalog, setCatalog] = useState<StyleCatalog | null>(null)
  const [sampleName, setSampleName] = useState('我的自定义文风')
  const [sampleText, setSampleText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setCatalog(await api<StyleCatalog>(`/projects/${encodeURIComponent(projectId)}/styles`)); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [projectId])
  useEffect(() => { setCatalog(null); setSampleText(''); void load() }, [load])
  const selectPreset = async (presetId: string) => {
    if (!catalog || busy) return
    setBusy(true); setError(null)
    try { await api<WritingStyleProfile>(`/projects/${encodeURIComponent(projectId)}/styles/preset`, { method: 'POST', body: JSON.stringify({ presetId, baseRevision: catalog.profile.revision }) }); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const extract = async () => {
    if (!catalog || busy || sampleText.trim().length < 300) return
    setBusy(true); setError(null)
    try { await api<WritingStyleProfile>(`/projects/${encodeURIComponent(projectId)}/styles/extract`, { method: 'POST', body: JSON.stringify({ name: sampleName, sampleText, baseRevision: catalog.profile.revision }) }); setSampleText(''); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  if (!catalog) return <section aria-label="项目文风" style={{ ...panel, marginTop: 22, padding: 14, color: color.secondary, fontSize: 12 }}>正在载入项目文风…</section>
  return <section aria-label="项目文风" style={{ ...panel, marginTop: 22, padding: 15 }}>
    <SectionHeading title="项目文风" />
    <select aria-label="项目文风选择" value={catalog.profile.presetId ?? ''} onChange={event => { void selectPreset(event.target.value) }} disabled={busy} style={{ ...inputStyle, height: 34, marginTop: 10 }}>{catalog.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}{catalog.profile.source === 'extracted' && <option value="">当前为自定义提炼文风</option>}</select>
    <details style={{ marginTop: 12 }}><summary style={{ cursor: 'pointer', color: color.secondary, fontSize: 11 }}>从样文提炼自定义文风</summary><div style={{ display: 'grid', gap: 8, marginTop: 10 }}><input aria-label="自定义文风名称" value={sampleName} onChange={event => { setSampleName(event.target.value) }} style={inputStyle} placeholder="例如：我的克制悬疑文风" /><textarea aria-label="文风样文" value={sampleText} onChange={event => { setSampleText(event.target.value) }} style={{ ...textareaStyle, minHeight: 140 }} placeholder="粘贴至少 300 个字符的样文。系统只保存提炼出的风格特征，不保存这段原文。" /><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span style={{ color: color.tertiary, fontSize: 10 }}>{sampleText.trim().length} / 300 最少字符</span><Button size="sm" variant="outline" disabled={busy || sampleText.trim().length < 300} onClick={() => { void extract() }}>{busy ? '正在提炼…' : '提炼并应用'}</Button></div></div></details>
    {error && <div role="alert" style={{ marginTop: 9, color: color.danger, fontSize: 11 }}>{error}</div>}
  </section>
}

function FoundationSequence({ projectId, chapterCount, createChapter }: { projectId: string; chapterCount: number; createChapter: () => Promise<void> }) {
  const [workspace, setWorkspace] = useState<ProjectFoundationWorkspace | null>(null)
  const [briefs, setBriefs] = useState<Partial<Record<ProjectFoundationKind, string>>>({})
  const [runs, setRuns] = useState<Partial<Record<ProjectFoundationKind, FoundationGenerationRun>>>({})
  const [busy, setBusy] = useState<ProjectFoundationKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRequestRef = useRef(0)
  const projectIdRef = useRef(projectId); projectIdRef.current = projectId
  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    try {
      const next = await api<ProjectFoundationWorkspace>(`/projects/${encodeURIComponent(projectId)}/foundation`)
      if (requestId !== loadRequestRef.current) return
      const visibleRuns: Partial<Record<ProjectFoundationKind, FoundationGenerationRun>> = {}
      for (const stage of next.stages) {
        const latest = stage.latestGenerationRun
        const visible = stage.activeGenerationRun ?? (latest && ['failed','cancelled'].includes(latest.status) && latest.streamedText ? latest : null)
        if (visible) visibleRuns[stage.kind] = visible
      }
      setBriefs(current => {
        const restored = { ...current }
        for (const stage of next.stages) {
          const latest = stage.activeGenerationRun ?? stage.latestGenerationRun
          if (restored[stage.kind] === undefined && latest?.brief) restored[stage.kind] = latest.brief
        }
        return restored
      })
      setWorkspace(next); setRuns(visibleRuns); setError(null)
    }
    catch (cause) { if (requestId === loadRequestRef.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [projectId])
  useEffect(() => { setWorkspace(null); setBriefs({}); setRuns({}); void load() }, [load])
  useEffect(() => {
    const active = Object.values(runs).filter((run): run is FoundationGenerationRun => Boolean(run && ['planning','waiting_input','generating'].includes(run.status)))
    if (active.length === 0) return
    const poll = async () => {
      const updates = await Promise.all(active.map(run => api<FoundationGenerationRun>(`/foundation-runs/${encodeURIComponent(run.id)}`).catch(() => null)))
      if (projectIdRef.current !== projectId) return
      const refreshWorkspace = updates.some(update => update?.status === 'succeeded')
      setRuns(current => {
        const next = { ...current }
        for (const update of updates) {
          if (!update) continue
          next[update.kind] = update
        }
        return next
      })
      if (refreshWorkspace) await load()
    }
    const timer = window.setInterval(() => { void poll() }, 650)
    return () => { window.clearInterval(timer) }
  }, [runs, load])
  const startRun = async (kind: ProjectFoundationKind, guided: boolean) => {
    setBusy(kind); setError(null)
    try {
      const run = await api<FoundationGenerationRun>(`/projects/${encodeURIComponent(projectId)}/foundation/${kind}/runs`, { method: 'POST', body: JSON.stringify({ brief: briefs[kind] ?? '', guided }) })
      setRuns(current => ({ ...current, [kind]: run }))
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  const answerRun = async (run: FoundationGenerationRun, answers: FoundationPlannerAnswer[]) => {
    setBusy(run.kind); setError(null)
    try {
      if (run.interactionSessionId) await api<FoundationGenerationRun>(`/foundation-runs/${encodeURIComponent(run.id)}/inline`, { method: 'POST', body: '{}' })
      const updated = await api<FoundationGenerationRun>(`/foundation-runs/${encodeURIComponent(run.id)}/answers`, { method: 'POST', body: JSON.stringify({ answers }) })
      setRuns(current => ({ ...current, [run.kind]: updated }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  const cancelRun = async (run: FoundationGenerationRun) => {
    setBusy(run.kind); setError(null)
    try {
      const cancelled = await api<FoundationGenerationRun>(`/foundation-runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST', body: '{}' })
      setRuns(current => ({ ...current, [run.kind]: cancelled.streamedText ? cancelled : undefined }))
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  const retryRun = async (run: FoundationGenerationRun) => {
    setBusy(run.kind); setError(null)
    try {
      const updated = await api<FoundationGenerationRun>(`/foundation-runs/${encodeURIComponent(run.id)}/retry`, { method: 'POST', body: '{}' })
      setRuns(current => ({ ...current, [run.kind]: updated }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  const finishPlanning = async (run: FoundationGenerationRun) => {
    setBusy(run.kind); setError(null)
    try {
      const updated = await api<FoundationGenerationRun>(`/foundation-runs/${encodeURIComponent(run.id)}/finish-planning`, { method: 'POST', body: '{}' })
      setRuns(current => ({ ...current, [run.kind]: updated }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  const approve = async (kind: ProjectFoundationKind, versionId: string) => {
    setBusy(kind); setError(null)
    try { setWorkspace(await api<ProjectFoundationWorkspace>(`/projects/${encodeURIComponent(projectId)}/foundation/${kind}/approve`, { method: 'POST', body: JSON.stringify({ versionId }) })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  if (!workspace) return <section style={{ marginTop: 30 }}><SectionHeading title="创作基建" /><div style={{ ...panel, marginTop: 10, padding: 20, color: color.secondary }}>{error ?? '正在读取项目生成顺序…'}</div></section>
  const approvedCount = workspace.stages.filter(stage => stage.status === 'approved').length
  const approvedStages = workspace.stages.filter(stage => stage.approvedVersion)
  return <section style={{ marginTop: 30 }} aria-label="项目创作基建流程">
    <SectionHeading title="创作基建" meta={workspace.readyForChapterGeneration ? '完整批准链 · 连续性增强已启用' : `${approvedCount}/${workspace.stages.length} 已批准 · 不阻塞开写`} />
    <div style={{ ...panel, marginTop: 10, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${workspace.stages.length},minmax(140px,1fr))`, borderBottom: `1px solid ${color.borderSoft}`, overflowX: 'auto' }}>
        {workspace.stages.map((stage, index) => {
          const run = runs[stage.kind]
          const live = run && ['planning','waiting_input','generating'].includes(run.status) ? run : null
          return <div key={stage.kind} style={{ position: 'relative', minWidth: 140, padding: '13px 12px 12px', background: stage.status === 'draft' || live ? color.active : 'transparent', borderRight: index < workspace.stages.length - 1 ? `1px solid ${color.borderSoft}` : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ color: stage.status === 'approved' && !live ? color.success : stage.status === 'locked' ? color.tertiary : color.brand, fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 10 }}>{String(stage.position).padStart(2, '0')}</span>{stage.status === 'approved' && !live ? <StateDot state="done" size={7} /> : stage.status === 'draft' || live?.status === 'waiting_input' ? <StateDot state="warning" size={7} /> : live ? <StateDot state="ongoing" size={7} /> : <span aria-label={stage.status === 'locked' ? '尚未解锁' : '可以开始'} style={{ width: 7, height: 7, borderRadius: '50%', background: stage.status === 'locked' ? color.tertiary : color.brand }} />}</div>
            <strong style={{ display: 'block', marginTop: 8, fontSize: 12 }}>{stage.title}</strong><span style={{ display: 'block', marginTop: 4, color: color.tertiary, fontSize: 10 }}>{live ? foundationRunShortLabel(live) : stage.status === 'approved' ? `已批准 v${stage.approvedVersion?.version}` : stage.status === 'draft' ? '草稿待批准' : stage.status === 'locked' ? '等待前置步骤' : '可开始生成'}</span>
          </div>
        })}
      </div>
      <div style={{ display: 'grid', gap: 0 }}>
        {workspace.stages.map(stage => {
          const actionable = stage.status === 'ready' || stage.status === 'draft'
          if (!actionable) return null
          const draft = stage.latestVersion?.status === 'draft' ? stage.latestVersion : null
          const run = runs[stage.kind] ?? null
          const liveRun = run && ['planning','waiting_input','generating'].includes(run.status) ? run : null
          const downstreamApprovedCount = workspace.stages.slice(stage.position).filter(item => item.approvedVersion).length
          return <div key={stage.kind} style={{ minWidth: 0, boxSizing: 'border-box', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}><span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 7, background: color.active, color: color.brand, fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 11 }}>{String(stage.position).padStart(2, '0')}</span><div style={{ minWidth: 0, flex: 1 }}><strong style={{ fontSize: 13 }}>{draft ? `审阅${stage.title}草稿` : `生成${stage.title}`}</strong><p style={{ margin: '4px 0 0', color: color.secondary, fontSize: 11, lineHeight: 1.55 }}>{stage.description}</p></div></div>
            {run && <FoundationRunPanel run={run} busy={busy === stage.kind} submit={answers => { void answerRun(run, answers) }} finish={() => { void finishPlanning(run) }} cancel={() => { void cancelRun(run) }} retry={() => { void retryRun(run) }} />}
            {draft ? <><div style={{ marginTop: 12, border: `1px solid ${color.border}`, borderRadius: 7, background: color.bg, padding: 13 }}><strong style={{ display: 'block', fontSize: 12 }}>{draft.title}</strong><div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', color: color.secondary, fontSize: 12, lineHeight: 1.7 }}>{draft.content}</div>{downstreamApprovedCount > 0 && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: color.module, color: color.warning, fontSize: 11 }}>批准这个新版本后，后续 {downstreamApprovedCount} 项已批准基建会转为历史版本，并按新内容重新生成。</div>}<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}><span style={{ color: color.tertiary, fontSize: 10 }}>{draft.provider}/{draft.model} · v{draft.version} · 前置版本 {draft.dependencyVersionIds.length} 个</span><Button size="sm" variant="primary" disabled={busy === stage.kind || Boolean(liveRun)} icon={<IconCheckOutline16 size={14} />} onClick={() => { void approve(stage.kind, draft.id) }}>{downstreamApprovedCount > 0 ? '批准并重锁后续' : '批准并进入下一步'}</Button></div></div>{!liveRun && <FoundationGenerationControls title={stage.title} kind={stage.kind} brief={briefs[stage.kind] ?? ''} setBrief={brief => { setBriefs(value => ({ ...value, [stage.kind]: brief })) }} busy={busy === stage.kind} regenerate start={guided => { void startRun(stage.kind, guided) }} />}</> : !liveRun && <FoundationGenerationControls title={stage.title} kind={stage.kind} brief={briefs[stage.kind] ?? ''} setBrief={brief => { setBriefs(value => ({ ...value, [stage.kind]: brief })) }} busy={busy === stage.kind} start={guided => { void startRun(stage.kind, guided) }} />}
          </div>
        })}
        {workspace.readyForChapterGeneration && <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, background: color.layer }}><StateDot state="done" size={9} /><div style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', fontSize: 12 }}>创作准备已完成</strong><span style={{ color: color.secondary, fontSize: 11 }}>{chapterCount === 0 ? '现在建立第一章，进入正文写作。' : '新章节会使用已批准的大纲、人物与时间线。'}</span></div>{chapterCount === 0 && <Button size="sm" variant="primary" icon={<IconPlusOutline16 size={14} />} onClick={() => { void createChapter() }}>创建第一章</Button>}</div>}
      </div>
      {approvedStages.length > 0 && <div style={{ padding: '13px 16px 16px', borderTop: `1px solid ${color.borderSoft}`, background: color.module }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><strong style={{ fontSize: 12 }}>已批准内容</strong><span style={{ color: color.tertiary, fontSize: 10 }}>可展开查看；重批上游会重新锁定下游</span></div>
        <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>{approvedStages.map(stage => {
          const approved = stage.approvedVersion!
          const run = runs[stage.kind] ?? null
          const liveRun = run && ['planning','waiting_input','generating'].includes(run.status) ? run : null
          const downstreamApprovedCount = workspace.stages.slice(stage.position).filter(item => item.approvedVersion).length
          return <details key={stage.kind} open={Boolean(liveRun)} style={{ border: `1px solid ${color.border}`, borderRadius: 7, background: color.layer }}><summary style={{ padding: '10px 12px', cursor: 'pointer', color: color.text, fontSize: 12 }}><span style={{ marginRight: 8, color: color.success, fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 10 }}>{String(stage.position).padStart(2, '0')}</span>{stage.title} · 已批准 v{approved.version}{liveRun ? ` · ${foundationRunShortLabel(liveRun)}` : ''}</summary><div style={{ padding: '0 12px 12px', borderTop: `1px solid ${color.borderSoft}` }}><strong style={{ display: 'block', marginTop: 11, fontSize: 12 }}>{approved.title}</strong><div style={{ marginTop: 7, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', color: color.secondary, fontSize: 12, lineHeight: 1.7 }}>{approved.content}</div>{run && <FoundationRunPanel run={run} busy={busy === stage.kind} submit={answers => { void answerRun(run, answers) }} finish={() => { void finishPlanning(run) }} cancel={() => { void cancelRun(run) }} retry={() => { void retryRun(run) }} />}{downstreamApprovedCount > 0 && <div style={{ marginTop: 8, color: color.warning, fontSize: 10 }}>生成新草稿不会影响当前批准链；只有批准新版本后，后续 {downstreamApprovedCount} 项才会转为历史版本并重新锁定。</div>}{!liveRun && <FoundationGenerationControls title={stage.title} kind={stage.kind} brief={briefs[stage.kind] ?? ''} setBrief={brief => { setBriefs(value => ({ ...value, [stage.kind]: brief })) }} busy={busy === stage.kind} regenerate start={guided => { void startRun(stage.kind, guided) }} />}</div></details>
        })}</div>
      </div>}
    </div>
    {error && <ErrorNotice message={error} />}
  </section>
}

function FoundationGenerationControls({ title, kind, brief, setBrief, busy, regenerate = false, start }: { title: string; kind: ProjectFoundationKind; brief: string; setBrief: (value: string) => void; busy: boolean; regenerate?: boolean; start: (guided: boolean) => void }) {
  const optionalPlaceholder = regenerate
    ? `可选：补充你对这一版${title}最想保留或改变的地方。`
    : kind === 'outline' ? '输入大纲基础（可选）；留空也可以直接生成。' : `输入${title}基础（可选）；留空也可以直接生成。`
  return <div style={{ marginTop: 12, paddingTop: 11, borderTop: `1px solid ${color.borderSoft}` }}>
    {regenerate ? <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ maxWidth: 490, color: color.secondary, fontSize: 10, lineHeight: 1.55 }}>如果这一版{title}不满意，让 AI 先围绕当前内容确认真正需要修改的方向。</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button size="sm" variant="outline" disabled={busy} onClick={() => { start(false) }}>{busy ? '正在启动' : `直接重写${title}`}</Button><Button size="sm" variant="primary" disabled={busy} icon={<IconThinkOutline16 size={15} />} onClick={() => { start(true) }}>{busy ? '正在分析当前版本' : '需要调整，先问我'}</Button></div>
      </div>
      <details style={{ marginTop: 9 }}><summary style={{ width: 'fit-content', cursor: 'pointer', color: color.tertiary, fontSize: 10 }}>补充要求（可选）{brief.trim() ? ' · 已填写' : ''}</summary><textarea aria-label={`${title}重新生成补充`} value={brief} onChange={event => { setBrief(event.target.value) }} placeholder={optionalPlaceholder} style={{ ...textareaStyle, minHeight: 66, marginTop: 8 }} /></details>
    </> : kind === 'outline' ? <div style={{ display: 'grid', gap: 8 }}>
      <textarea aria-label={`${title}基础`} value={brief} onChange={event => { setBrief(event.target.value) }} placeholder={optionalPlaceholder} style={{ ...textareaStyle, minHeight: 84 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" variant="primary" disabled={busy} icon={<IconPlayOutline16 size={15} />} onClick={() => { start(false) }}>{busy ? '正在启动生成' : `生成${title}初稿`}</Button></div>
    </div> : <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <details style={{ flex: '1 1 260px' }}><summary style={{ width: 'fit-content', cursor: 'pointer', color: color.tertiary, fontSize: 10 }}>补充要求（可选）{brief.trim() ? ' · 已填写' : ''}</summary><textarea aria-label={`${title}生成补充`} value={brief} onChange={event => { setBrief(event.target.value) }} placeholder={optionalPlaceholder} style={{ ...textareaStyle, minHeight: 66, marginTop: 8 }} /></details>
      <Button size="sm" variant="primary" disabled={busy} icon={<IconPlayOutline16 size={15} />} onClick={() => { start(false) }}>{busy ? '正在启动生成' : `生成${title}初稿`}</Button>
    </div>}
  </div>
}

function LiveManuscriptPreview({ text, active, telemetry, interrupted, fullHeight = false, onDismiss }: { text: string; active: boolean; telemetry: GenerationTelemetry; interrupted?: boolean; fullHeight?: boolean; onDismiss?: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport && following) viewport.scrollTop = viewport.scrollHeight
  }, [text, following])
  const returnToLatest = () => {
    setFollowing(true)
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }
  return <section aria-label="AI 实时手稿" style={{ minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', borderTop: `1px solid ${color.borderSoft}`, borderBottom: fullHeight ? undefined : `1px solid ${color.borderSoft}`, background: color.layer }}>
    <style>{`@keyframes novel-live-caret{0%,44%{opacity:.78}45%,100%{opacity:.16}}.novel-live-caret{animation:novel-live-caret 1.15s steps(1,end) infinite}@media(prefers-reduced-motion:reduce){.novel-live-caret{animation:none}}`}</style>
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 43, padding: '0 13px', borderBottom: `1px solid ${color.borderSoft}`, background: color.module, overflowX: 'auto' }}><StateDot state={active ? 'ongoing' : 'warning'} size={8} /><strong style={{ flexShrink: 0, fontSize: 11 }}>{active ? 'AI 正在写作' : interrupted ? '生成中断，已保留现场' : '未完成的实时手稿'}</strong><span style={{ flexShrink: 0, color: color.tertiary, fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 10 }}>{generationPulse(telemetry, active)} · 尚未成为正式稿</span><span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><CopyTextButton text={text} />{!following && <button type="button" onClick={returnToLatest} style={{ padding: '3px 7px', border: `1px solid ${color.border}`, borderRadius: 6, background: color.layer, color: color.secondary, cursor: 'pointer', fontSize: 10 }}>回到最新</button>}{onDismiss && !active && <button type="button" onClick={onDismiss} style={{ padding: '3px 7px', border: 0, borderRadius: 6, background: 'transparent', color: color.secondary, cursor: 'pointer', fontSize: 10 }}>返回当前正文</button>}</span></header>
    <div ref={viewportRef} onScroll={event => { const element = event.currentTarget; setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 36) }} aria-live="off" style={{ minHeight: fullHeight ? 0 : 150, maxHeight: fullHeight ? undefined : 390, overflow: 'auto', padding: fullHeight ? 'clamp(34px,7vh,74px) clamp(24px,9vw,110px)' : '22px clamp(18px,4vw,42px) 28px', color: color.text, fontFamily: 'Iowan Old Style, Songti SC, STSong, serif', fontSize: fullHeight ? 17 : 14, lineHeight: fullHeight ? 1.9 : 1.85, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text || <span style={{ color: color.tertiary, fontFamily: 'var(--dsw-font-family, Inter, "PingFang SC", sans-serif)', fontSize: 11 }}>正在等待模型返回第一个文字片段…</span>}{active && <span className="novel-live-caret" aria-hidden="true" style={{ display: 'inline-block', width: 2, height: '1em', marginLeft: 3, verticalAlign: '-.1em', background: color.brand }} />}</div>
  </section>
}

function FoundationRunPanel({ run, busy, submit, finish, cancel, retry }: { run: FoundationGenerationRun; busy: boolean; submit: (answers: FoundationPlannerAnswer[]) => void; finish: () => void; cancel: () => void; retry: () => void }) {
  const steps = run.guided ? ['分析当前版本','确认修改方向','判断信息充分性','生成修订版','校验并保存'] : ['组装项目上下文','生成可审阅初稿','校验并保存']
  const currentStep = foundationRunStep(run)
  const confirmedQuestions = run.questions.filter(question => run.answers.some(answer => answer.questionId === question.id))
  const pendingQuestions = run.questions.filter(question => !run.answers.some(answer => answer.questionId === question.id))
  return <section aria-live="polite" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', marginTop: 12, border: `1px solid ${run.status === 'failed' ? color.danger : color.border}`, borderRadius: 8, background: color.layer, overflow: 'hidden' }}>
    <div style={{ padding: '12px 13px 11px', borderBottom: `1px solid ${color.borderSoft}` }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><StateDot state={run.status === 'failed' ? 'error' : run.status === 'waiting_input' ? 'warning' : 'ongoing'} size={8} /><strong style={{ fontSize: 12 }}>{foundationRunTitle(run)}</strong><span style={{ marginLeft: 'auto', color: color.tertiary, fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 10 }}>{run.progress}%</span></div><div style={{ height: 4, marginTop: 9, borderRadius: 4, overflow: 'hidden', background: color.module }}><div style={{ width: `${run.progress}%`, height: '100%', borderRadius: 4, background: run.status === 'failed' ? color.danger : run.status === 'waiting_input' ? color.warning : color.brand, transition: 'width 180ms ease-out' }} /></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 7, color: color.tertiary, fontSize: 10 }}><span>{foundationPhaseLabel(run.phase)}</span><span style={{ fontFamily: 'var(--ds-font-family-code, monospace)' }}>{generationPulse(run.generationTelemetry, run.status === 'planning' || run.status === 'generating')}</span></div></div>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length},minmax(92px,1fr))`, overflowX: 'auto', borderBottom: `1px solid ${color.borderSoft}` }}>{steps.map((step, index) => <div key={step} style={{ minWidth: 92, padding: '8px 9px', borderRight: index < steps.length - 1 ? `1px solid ${color.borderSoft}` : undefined, color: index < currentStep ? color.success : index === currentStep ? color.text : color.tertiary, fontSize: 9, whiteSpace: 'nowrap' }}><span style={{ marginRight: 5, fontFamily: 'var(--ds-font-family-code, monospace)' }}>{String(index + 1).padStart(2, '0')}</span>{step}</div>)}</div>
    {(run.phase === 'generating_content' || run.streamedText.length > 0) && <LiveManuscriptPreview text={run.streamedText} active={run.status === 'generating'} telemetry={run.generationTelemetry} interrupted={run.status === 'failed' || run.status === 'cancelled'} />}
    {run.guided && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'start', padding: '11px 13px', borderBottom: run.status === 'waiting_input' || confirmedQuestions.length > 0 ? `1px solid ${color.borderSoft}` : undefined, background: color.module }}><div><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><StateDot state={run.informationReady ? 'done' : 'warning'} size={7} /><strong style={{ fontSize: 11 }}>{run.informationReady ? '信息已充分' : '信息尚未充分'}</strong></div><span style={{ display: 'block', marginTop: 4, color: color.secondary, fontSize: 10, lineHeight: 1.5 }}>{run.readinessSummary || 'AI 正在检查生成所需的关键方向。'}</span></div><span style={{ color: color.tertiary, fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 9, whiteSpace: 'nowrap' }}>ROUND {String(Math.max(run.planningRound, 1)).padStart(2, '0')} · 已确认 {run.answers.length}</span></div>}
    {confirmedQuestions.length > 0 && <details style={{ borderBottom: run.status === 'waiting_input' ? `1px solid ${color.borderSoft}` : undefined }}><summary style={{ padding: '9px 13px', cursor: 'pointer', color: color.secondary, fontSize: 10 }}>已确认信息 · {confirmedQuestions.length} 项</summary><div style={{ display: 'grid', gap: 0, padding: '0 13px 10px' }}>{confirmedQuestions.map(question => {
      const answer = run.answers.find(item => item.questionId === question.id)!
      const option = question.options.find(item => item.id === answer.optionId)
      return <div key={question.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px,.8fr) minmax(0,1.2fr)', gap: 10, padding: '7px 0', borderTop: `1px solid ${color.borderSoft}`, fontSize: 10, lineHeight: 1.45 }}><span style={{ color: color.tertiary }}>{question.question}</span><span style={{ color: color.text }}>{answer.skipped ? '已跳过，未设置约束' : option?.label ?? '自定义方向'}{answer.customText ? ` · ${answer.customText}` : ''}</span></div>
    })}</div></details>}
    {run.status === 'waiting_input' && pendingQuestions.length > 0 && <><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 13px', borderBottom: `1px solid ${color.borderSoft}` }}><span style={{ color: color.secondary, fontSize: 10, lineHeight: 1.5 }}>这些问题只用于明确当前初稿要怎么改；不会让你重新口述整份内容。</span><Button size="sm" variant="outline" disabled={busy || run.answers.length === 0} onClick={finish}>按已确认方向修订</Button></div><InlineFoundationQuestionComposer key={`${run.id}:${run.planningRound}`} run={run} questions={pendingQuestions} busy={busy} submit={submit} cancel={cancel} /></>}
    {(run.status === 'planning' || run.status === 'generating') && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 13px' }}><span style={{ color: color.secondary, fontSize: 10 }}>{run.status === 'planning' ? run.answers.length > 0 ? 'AI 正在根据已确认方向检查是否还有会明显影响修订结果的缺口。' : 'AI 正在对照当前初稿分析修改方向，随后只会询问必要问题。' : run.guided ? '修订方向已确认；AI 正在生成新版本，可以离开或刷新页面。' : 'AI 正在生成可审阅初稿，可以离开或刷新页面。'}</span><Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>取消</Button></div>}
    {run.status === 'failed' && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 13px' }}><span style={{ color: color.danger, fontSize: 11, lineHeight: 1.5 }}>生成失败：{run.error ?? '模型调用没有完成。'}</span><Button size="sm" variant="outline" disabled={busy} icon={<IconRefreshOutline16 size={14} />} onClick={retry}>{run.answers.length ? '保留本次选择并重试' : '重试本次生成'}</Button></div>}
  </section>
}

type InlineQuestionDraft = { optionId: string | null; customText: string; skipped: boolean }

function InlineFoundationQuestionComposer({ run, questions, busy, submit, cancel }: { run: FoundationGenerationRun; questions: FoundationPlannerQuestion[]; busy: boolean; submit: (answers: FoundationPlannerAnswer[]) => void; cancel: () => void }) {
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, InlineQuestionDraft>>(() => Object.fromEntries(questions.map(question => [question.id, { optionId: null, customText: '', skipped: false }])))
  const [feedback, setFeedback] = useState<string | null>(null)
  const question = questions[Math.min(index, questions.length - 1)]!
  const draft = drafts[question.id] ?? { optionId: null, customText: '', skipped: false }
  const complete = (value: InlineQuestionDraft): boolean => Boolean(value.optionId || value.customText.trim() || value.skipped)
  const allComplete = questions.every(item => complete(drafts[item.id] ?? { optionId: null, customText: '', skipped: false }))
  const updateDraft = (value: InlineQuestionDraft) => { setDrafts(current => ({ ...current, [question.id]: value })); setFeedback(null) }
  const next = () => {
    if (!complete(draft)) { setFeedback('请选择一个方向、填写自己的答案，或者跳过本题。'); return }
    if (index < questions.length - 1) { setIndex(value => value + 1); setFeedback(null); return }
    if (!allComplete) { const unanswered = questions.findIndex(item => !complete(drafts[item.id] ?? { optionId: null, customText: '', skipped: false })); setIndex(Math.max(unanswered, 0)); setFeedback('还有问题尚未确认。'); return }
    submit(questions.map(item => { const value = drafts[item.id]!; return { questionId: item.id, optionId: value.optionId, customText: value.customText.trim(), ...(value.skipped ? { skipped: true } : {}) } }))
  }
  const choose = (optionId: string) => {
    updateDraft({ optionId, customText: '', skipped: false })
    if (index < questions.length - 1) window.setTimeout(() => { setIndex(value => Math.min(value + 1, questions.length - 1)) }, 120)
  }
  const skip = () => {
    updateDraft({ optionId: null, customText: '', skipped: true })
    if (index < questions.length - 1) window.setTimeout(() => { setIndex(value => Math.min(value + 1, questions.length - 1)) }, 80)
  }
  const label = ({ outline: '全书大纲', characters: '人物体系', worldbuilding: '世界观与规则', timeline: '故事时间线', foreshadowing: '伏笔与回收' } as Record<ProjectFoundationKind,string>)[run.kind]
  return <div style={{ padding: '14px 13px 16px', background: color.module }}>
    <section aria-label={`第 ${run.planningRound} 轮${label}信息确认`} style={{ width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${color.border}`, borderRadius: 18, background: 'var(--dsw-specific-input-major, #fff)', boxShadow: 'var(--dsw-shadow-lv2, 0 8px 24px rgba(0,0,0,.08))' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, padding: '18px 18px 0 20px' }}><div style={{ minWidth: 0 }}><div style={{ marginBottom: 5, color: color.tertiary, fontSize: 10, lineHeight: '15px' }}>第 {run.planningRound} 轮 · {label}</div><h3 style={{ margin: 0, color: color.text, fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>{question.question}</h3></div><Tooltip label="取消本次梳理" delayMs={350}><button type="button" aria-label="取消本次梳理" disabled={busy} onClick={cancel} style={questionIconButton}><IconCloseOutline16 size={14} /></button></Tooltip></header>
      <div style={{ minHeight: 0, maxHeight: 360, overflowY: 'auto', padding: '5px 10px 0' }}><p style={{ margin: '0 10px 7px', color: color.tertiary, fontSize: 11, lineHeight: 1.55 }}>{question.why}</p><div role="radiogroup" aria-label={question.question} style={{ display: 'grid', gap: 2, padding: '3px 0' }}>{question.options.map((option, optionIndex) => {
        const selected = draft.optionId === option.id
        return <button key={option.id} type="button" role="radio" aria-checked={selected} disabled={busy} onClick={() => { choose(option.id) }} style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px 9px 8px', border: `1px solid ${selected ? color.border : 'transparent'}`, borderRadius: 12, background: selected ? color.hover : 'transparent', color: color.text, cursor: busy ? 'default' : 'pointer', textAlign: 'left' }}><span style={{ width: 21, height: 21, flex: '0 0 21px', display: 'grid', placeItems: 'center', marginTop: 1, borderRadius: 6, background: selected ? color.active : color.module, color: selected ? color.brand : color.secondary, fontSize: 11, fontWeight: 600 }}>{optionIndex + 1}</span><span style={{ minWidth: 0, flex: 1 }}><span style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 6px' }}><strong style={{ fontSize: 12, lineHeight: '22px' }}>{option.label}</strong>{option.recommended && <span style={{ padding: '0 5px', borderRadius: 6, background: 'var(--dsw-specific-sidebar-nav-item-active-accent, #e7edff)', color: color.brand, fontSize: 9, fontWeight: 600, lineHeight: '17px' }}>推荐</span>}<span style={{ color: color.tertiary, fontSize: 11, lineHeight: '20px' }}>{option.description}</span></span></span></button>
      })}<label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, minHeight: 44, padding: '9px 10px 9px 8px', border: `1px solid ${draft.customText ? color.border : 'transparent'}`, borderRadius: 12, background: draft.customText ? color.hover : 'transparent' }}><span style={{ width: 21, height: 21, flex: '0 0 21px', display: 'grid', placeItems: 'center', marginTop: 1, borderRadius: 6, background: color.module, color: color.secondary }}><IconEditOutline16 size={12} /></span><input aria-label="输入自己的答案" value={draft.customText} disabled={busy} onChange={event => { updateDraft({ optionId: null, customText: event.target.value, skipped: false }) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); next() } }} placeholder="输入你的答案" style={{ minWidth: 0, flex: 1, padding: 0, border: 'none', outline: 'none', background: 'transparent', color: color.text, caretColor: color.brand, font: 'inherit', fontSize: 12, lineHeight: '22px' }} /></label></div></div>
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px 12px 16px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><button type="button" aria-label="上一题" disabled={busy || index === 0} onClick={() => { setIndex(value => Math.max(0, value - 1)); setFeedback(null) }} style={questionIconButton}><IconChevronLeftOutline14 size={14} /></button><span style={{ minWidth: 34, color: color.secondary, textAlign: 'center', fontSize: 11, fontWeight: 600 }}>{index + 1} / {questions.length}</span><button type="button" aria-label="下一题" disabled={busy || index === questions.length - 1} onClick={() => { setIndex(value => Math.min(questions.length - 1, value + 1)); setFeedback(null) }} style={questionIconButton}><IconChevronRightOutline14 size={14} /></button></div><span role="status" style={{ minHeight: 16, flex: 1, color: color.danger, textAlign: 'right', fontSize: 10 }}>{feedback}</span><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Button size="sm" variant="outline" disabled={busy} onClick={skip}>跳过本题</Button><Button size="sm" variant="primary" disabled={busy || !complete(draft)} icon={index === questions.length - 1 ? <IconSendOutline14 size={13} /> : undefined} onClick={next}>{busy ? '正在提交' : index === questions.length - 1 ? '提交本轮' : '下一题'}</Button></div></footer>
    </section>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 9, padding: '0 3px', color: color.tertiary, fontSize: 10, lineHeight: 1.5 }}><span>你的选择会写入当前项目，并参与下一次信息充分性判断。</span><span style={{ whiteSpace: 'nowrap' }}>{run.interactionSessionId ? '提交后将在此页面接管旧对话任务' : '回答后自动继续'}</span></div>
  </div>
}

const questionIconButton: CSSProperties = { width: 25, height: 25, display: 'grid', placeItems: 'center', flex: '0 0 25px', padding: 0, border: 'none', borderRadius: 999, background: 'transparent', color: color.tertiary, cursor: 'pointer' }

function foundationRunShortLabel(run: FoundationGenerationRun): string { return run.status === 'waiting_input' ? `等待第 ${run.planningRound} 轮修改确认` : run.status === 'planning' ? run.answers.length ? '正在检查修订方向' : '正在准备修改问题' : run.status === 'generating' ? run.guided ? '正在生成修订版' : '正在生成初稿' : run.status === 'failed' ? '上次生成失败' : run.status === 'cancelled' ? '已取消' : '已完成' }
function foundationRunTitle(run: FoundationGenerationRun): string { return run.status === 'waiting_input' ? '等待你确认修改方向' : run.status === 'planning' ? run.answers.length ? '正在判断修订信息是否充分' : '正在分析当前初稿' : run.status === 'generating' ? run.guided ? '正在生成修订版' : '正在生成可审阅初稿' : run.status === 'failed' ? '本次生成没有完成' : run.status === 'cancelled' ? '本次生成已取消' : '生成完成' }
function foundationPhaseLabel(phase: string): string { return ({ analyzing_project: '正在分析项目与前置内容', generating_questions: '正在生成首轮关键问题', awaiting_answers: '等待你补全关键信息', evaluating_information: '正在判断信息是否充分', information_ready: '信息已充分，准备正式生成', assembling_context: '正在组装已批准上下文', generating_content: '正在接收正式内容', validating_output: '正在校验模型输出', saving_draft: '正在保存不可变草稿', complete: '已保存草稿', failed: '运行失败', cancelled: '已取消' } as Record<string,string>)[phase] ?? phase }
function foundationRunStep(run: FoundationGenerationRun): number {
  if (!run.guided) return ['assembling_context'].includes(run.phase) ? 0 : run.phase === 'generating_content' ? 1 : 2
  if (run.phase === 'analyzing_project') return 0
  if (run.phase === 'generating_questions' || run.phase === 'awaiting_answers') return 1
  if (run.phase === 'evaluating_information' || run.phase === 'information_ready') return 2
  if (run.phase === 'assembling_context' || run.phase === 'generating_content') return 3
  return 4
}

const historicalScopeLabels: Record<HistoricalKnowledgeScope, string> = {
  structure_summary: '结构摘要', pacing_statistics: '节奏统计', style_features: '风格特征', writing_experience: '创作经验',
  worldbuilding_method: '世界观方法', original_excerpt: '原文片段', names_and_entities: '人物与专名', specific_plot: '具体剧情',
}
const historicalScopeOrder = Object.keys(historicalScopeLabels) as HistoricalKnowledgeScope[]


function formatNumber(value: number): string { return new Intl.NumberFormat('zh-CN').format(value) }

function EntityRelationshipsWorkspace({ project, narrow, refreshProject }: { project: Project; narrow: boolean; refreshProject: () => Promise<void> }) {
  const [graph, setGraph] = useState<RelationshipGraph | null>(null)
  const [relationshipPage, setRelationshipPage] = useState<RelationshipListPage | null>(null)
  const [extractionRuns, setExtractionRuns] = useState<RelationshipExtractionRun[]>([])
  const [entityOptions, setEntityOptions] = useState<StoryEntity[]>([])
  const [candidates, setCandidates] = useState<RelationshipCandidate[]>([])
  const [mode, setMode] = useState<RelationshipMode>('off')
  const [queryState, setQueryState] = useState<RelationshipQueryState>({ q: '', rootEntityId: null, depth: 1, category: 'all', factLayer: 'all', atStoryOrder: null })
  const [loading, setLoading] = useState(true)
  const [listLoadingMore, setListLoadingMore] = useState(false)
  const [modeBusy, setModeBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const loadRequestRef = useRef(0)

  const relationshipUrls = useCallback((cursor?: string) => {
    const graphParams = new URLSearchParams({ depth: String(queryState.depth), limitNodes: String(queryState.depth === 2 ? 80 : 60), limitEdges: String(queryState.depth === 2 ? 180 : 120) })
    const listParams = new URLSearchParams({ limit: '40' })
    if (queryState.rootEntityId) graphParams.set('rootEntityId', queryState.rootEntityId)
    if (queryState.category !== 'all') { graphParams.set('categories', queryState.category); listParams.set('categories', queryState.category) }
    if (queryState.factLayer !== 'all') { graphParams.set('factLayers', queryState.factLayer); listParams.set('factLayers', queryState.factLayer) }
    if (queryState.atStoryOrder !== null) { graphParams.set('atStoryOrder', String(queryState.atStoryOrder)); listParams.set('atStoryOrder', String(queryState.atStoryOrder)) }
    if (queryState.q.trim()) listParams.set('q', queryState.q.trim())
    if (cursor) listParams.set('cursor', cursor)
    const base = `/projects/${encodeURIComponent(project.id)}/relationships`
    return { graph: `${base}/graph?${graphParams}`, list: `${base}?${listParams}` }
  }, [project.id, queryState])

  const load = useCallback(async (quiet = false) => {
    const requestId = ++loadRequestRef.current
    if (!quiet) setLoading(true)
    try {
      const urls = relationshipUrls()
      const [nextGraph, nextPage, nextCandidates, nextRuns, modeResult, knowledge] = await Promise.all([
        api<RelationshipGraph>(urls.graph),
        api<RelationshipListPage>(urls.list),
        api<RelationshipCandidate[]>(`/projects/${encodeURIComponent(project.id)}/relationships/candidates`),
        api<RelationshipExtractionRun[]>(`/projects/${encodeURIComponent(project.id)}/relationships/runs?limit=20`),
        api<RelationshipMode | { mode: RelationshipMode }>(`/projects/${encodeURIComponent(project.id)}/relationships/mode`),
        api<KnowledgeWorkspace>(`/projects/${encodeURIComponent(project.id)}/knowledge`),
      ])
      if (requestId !== loadRequestRef.current) return
      setGraph(nextGraph); setRelationshipPage(nextPage); setCandidates(nextCandidates); setExtractionRuns(nextRuns); setEntityOptions(knowledge.entities); setMode(typeof modeResult === 'string' ? modeResult : modeResult.mode); setError(null)
    } catch (cause) { if (requestId === loadRequestRef.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (!quiet && requestId === loadRequestRef.current) setLoading(false) }
  }, [project.id, relationshipUrls])
  useEffect(() => { setGraph(null); setRelationshipPage(null); setCandidates([]); setExtractionRuns([]); setEntityOptions([]); setEditorOpen(false); setQueryState({ q: '', rootEntityId: null, depth: 1, category: 'all', factLayer: 'all', atStoryOrder: null }) }, [project.id])
  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, queryState.q ? 240 : 0)
    return () => { window.clearTimeout(timer) }
  }, [load, queryState.q])

  const loadMoreRelationships = async () => {
    const cursor = relationshipPage?.nextCursor
    if (!cursor || listLoadingMore) return
    setListLoadingMore(true); setError(null)
    try {
      const next = await api<RelationshipListPage>(relationshipUrls(cursor).list)
      setRelationshipPage(current => current ? { ...next, items: [...current.items, ...next.items] } : next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setListLoadingMore(false) }
  }

  const changeMode = async (nextMode: RelationshipMode) => {
    if (modeBusy || nextMode === mode || project.status === 'archived') return
    setModeBusy(true); setError(null)
    try {
      const result = await api<RelationshipMode | { mode: RelationshipMode }>(`/projects/${encodeURIComponent(project.id)}/relationships/mode`, { method: 'POST', body: JSON.stringify({ mode: nextMode, baseRevision: project.revision }) })
      setMode(typeof result === 'string' ? result : result.mode)
      await refreshProject(); await load(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setModeBusy(false) }
  }
  const decide = async ({ candidateId, decision }: RelationshipCandidateReviewRequest) => {
    const action = decision.action === 'confirm' ? 'confirm' : 'reject'
    let input: Record<string, unknown> = {}
    if (decision.action === 'confirm') {
      const { action: _action, sourceLabel: _sourceLabel, targetLabel: _targetLabel, decidedAt: _decidedAt, ...confirmed } = decision
      input = confirmed
    }
    await api(`/projects/${encodeURIComponent(project.id)}/relationships/candidates/${encodeURIComponent(candidateId)}/${action}`, { method: 'POST', body: JSON.stringify({ ...input, projectRevision: project.revision }) })
    await refreshProject(); await load(true)
  }
  const decideBatch = async (requests: readonly RelationshipCandidateReviewRequest[]) => {
    const decisions = requests.map(({ candidateId, decision }) => {
      if (decision.action === 'reject') return { candidateId, decision: 'reject' as const }
      const { action: _action, sourceLabel: _sourceLabel, targetLabel: _targetLabel, decidedAt: _decidedAt, ...input } = decision
      return { candidateId, decision: 'confirm' as const, ...input }
    })
    await api<RelationshipCandidateBatchResult[]>(`/projects/${encodeURIComponent(project.id)}/relationships/candidates/batch`, { method: 'POST', body: JSON.stringify({ decisions, projectRevision: project.revision }) })
    await refreshProject(); await load(true)
  }
  const evidence = async (relationshipId: string) => {
    const values = await api<EntityRelationshipEvidence[]>(`/projects/${encodeURIComponent(project.id)}/relationships/${encodeURIComponent(relationshipId)}/evidence`)
    return values.map(({ excerpt, ...value }) => excerpt === null ? value : { ...value, excerpt })
  }

  const nodes: RelationshipEntityNode[] = (graph?.nodes ?? []).map(toRelationshipPanelNode)
  const allNodes: RelationshipEntityNode[] = (entityOptions.length ? entityOptions : graph?.nodes ?? []).map(toRelationshipPanelNode)
  const edges: RelationshipPanelEdge[] = (graph?.edges ?? []).map(toRelationshipPanelEdge)
  const listEdges: RelationshipPanelEdge[] = (relationshipPage?.items ?? []).map(toRelationshipPanelEdge)
  const panelCandidates: RelationshipPanelCandidate[] = candidates.map(candidate => ({ id: candidate.id, runId: candidate.runId, sourceEntityId: candidate.sourceEntityId, targetEntityId: candidate.targetEntityId, sourceLabel: candidate.sourceLabel, targetLabel: candidate.targetLabel, predicateKey: candidate.predicateKey, label: candidate.label, category: candidate.category, directionality: candidate.directionality, factLayer: candidate.factLayer, validFromStoryOrder: candidate.validFromStoryOrder, validToStoryOrder: candidate.validToStoryOrder, confidence: candidate.confidence, status: candidate.status, evidence: parseRelationshipCandidateEvidence(candidate), fingerprint: candidate.fingerprint, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt }))

  return <div className="ns-relationship-workspace">
    <style>{relationshipWorkspaceStyles}</style>
    <section className="ns-relationship-policy" aria-label="关系自动化权限">
      <div><strong>关系提取权限</strong><span>与章节 AUTO / YOLO 独立保存；新项目默认关闭。</span></div>
      <div role="radiogroup" aria-label="关系提取权限">{(['off','auto','yolo'] as RelationshipMode[]).map(value => <button type="button" role="radio" aria-checked={mode === value} disabled={modeBusy || project.status === 'archived'} key={value} onClick={() => { void changeMode(value) }}><b>{value.toUpperCase()}</b><small>{value === 'off' ? '不自动提取' : value === 'auto' ? '生成候选，等待确认' : '仅无歧义关系自动提交'}</small></button>)}</div>
      <button type="button" className="ns-relationship-manual" title={entityOptions.length < 2 ? '至少需要两个人物或实体' : undefined} disabled={project.status === 'archived' || entityOptions.length < 2} onClick={() => { setEditorOpen(value => !value) }}>{editorOpen ? '收起手工编辑' : '手工创建 / 修订'}</button>
    </section>
    {project.status === 'archived' && <div className="ns-relationship-archive">此项目已归档。关系事实和证据可查看，但不能修改。</div>}
    {project.status !== 'archived' && !loading && entityOptions.length < 2 && <div className="ns-relationship-archive">手工建立关系至少需要两个故事实体。先批准人物体系或章节，让人物、地点等事实进入项目。</div>}
    {extractionRuns.length > 0 && <details className="ns-relationship-runs"><summary>最近关系提取运行 · {extractionRuns.length}</summary><div>{extractionRuns.map(run => <span key={run.id}><b>{run.automationMode.toUpperCase()}</b> · {relationshipRunStatusLabel(run.status)} · {run.candidateCount} 条候选{run.pendingCount ? `，${run.pendingCount} 条待处理` : ''} · {formatTime(run.createdAt)}</span>)}</div></details>}
    {editorOpen && graph && <RelationshipEditor project={project} nodes={entityOptions.length ? entityOptions : graph.nodes} relationships={relationshipPage?.items ?? graph.edges} close={() => { setEditorOpen(false) }} changed={async () => { setEditorOpen(false); await refreshProject(); await load(true) }} />}
    <EntityRelationshipsPanel nodes={nodes} entityOptions={allNodes} relationships={edges} listRelationships={listEdges} listTotal={relationshipPage?.total ?? listEdges.length} listNextCursor={relationshipPage?.nextCursor ?? null} listLoadingMore={listLoadingMore} candidates={panelCandidates} loading={loading} error={error} narrow={narrow} initialMode={narrow ? 'list' : 'graph'} queryState={queryState} onQueryStateChange={setQueryState} onLoadMoreRelationships={loadMoreRelationships} onRetry={() => load()} onRequestEvidence={evidence} onDecideCandidate={project.status === 'archived' ? undefined : decide} onDecideCandidates={project.status === 'archived' ? undefined : decideBatch} />
    {graph?.truncated && <div className="ns-relationship-truncated">当前视图已按 {queryState.depth === 2 ? '80 个实体 / 180 条关系' : '60 个实体 / 120 条关系'} 限幅。切换中心实体或使用分页列表继续查看。</div>}
  </div>
}

function RelationshipEditor({ project, nodes, relationships, close, changed }: { project: Project; nodes: StoryEntity[]; relationships: EntityRelationship[]; close: () => void; changed: () => Promise<void> }) {
  const [relationshipId, setRelationshipId] = useState('')
  const [sourceEntityId, setSourceEntityId] = useState(nodes[0]?.id ?? '')
  const [targetEntityId, setTargetEntityId] = useState(nodes[1]?.id ?? nodes[0]?.id ?? '')
  const [label, setLabel] = useState('认识')
  const [predicateKey, setPredicateKey] = useState('knows')
  const [category, setCategory] = useState<RelationshipCategory>('other')
  const [directionality, setDirectionality] = useState<'directed' | 'symmetric'>('directed')
  const [factLayer, setFactLayer] = useState<RelationshipFactLayer>('author_asserted')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = relationships.find(item => item.id === relationshipId) ?? null
  const selectExisting = (id: string) => {
    setRelationshipId(id)
    const item = relationships.find(value => value.id === id)
    if (!item) return
    setSourceEntityId(item.sourceEntityId); setTargetEntityId(item.targetEntityId); setLabel(item.label); setPredicateKey(item.predicateKey); setCategory(item.category); setDirectionality(item.directionality); setFactLayer(item.factLayer); setFrom(item.validFromStoryOrder?.toString() ?? ''); setTo(item.validToStoryOrder?.toString() ?? '')
  }
  const submit = async () => {
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId || !label.trim() || !predicateKey.trim()) { setError('请选择两个不同实体，并填写关系名称和谓词。'); return }
    setBusy(true); setError(null)
    try {
      const payload = { sourceEntityId, targetEntityId, label: label.trim(), predicateKey: predicateKey.trim(), category, directionality, factLayer, validFromStoryOrder: from ? Number(from) : null, validToStoryOrder: to ? Number(to) : null, baseRevision: project.revision }
      const path = editing ? `/projects/${encodeURIComponent(project.id)}/relationships/${encodeURIComponent(editing.id)}/revise` : `/projects/${encodeURIComponent(project.id)}/relationships`
      await api(path, { method: 'POST', body: JSON.stringify(payload) }); await changed()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <section className="ns-relationship-editor" aria-label="手工关系编辑器">
    <header><div><strong>{editing ? '修订正式关系' : '手工创建关系'}</strong><span>修订会 supersede 旧边，历史和证据仍保留。</span></div><button type="button" onClick={close}>关闭</button></header>
    <label className="ns-relationship-editor__existing"><span>操作</span><select value={relationshipId} onChange={event => { selectExisting(event.target.value) }}><option value="">新建关系</option>{relationships.map(item => <option key={item.id} value={item.id}>{entityLabel(item.sourceEntityId,nodes)} → {item.label} → {entityLabel(item.targetEntityId,nodes)}</option>)}</select></label>
    <div className="ns-relationship-editor__grid"><label><span>源实体</span><select disabled={Boolean(editing)} value={sourceEntityId} onChange={event => { setSourceEntityId(event.target.value) }}>{nodes.map(node => <option key={node.id} value={node.id}>{node.name} · {node.type}</option>)}</select></label><label><span>目标实体</span><select disabled={Boolean(editing)} value={targetEntityId} onChange={event => { setTargetEntityId(event.target.value) }}>{nodes.map(node => <option key={node.id} value={node.id}>{node.name} · {node.type}</option>)}</select></label><label><span>显示关系</span><input value={label} onChange={event => { setLabel(event.target.value) }} /></label><label><span>谓词键</span><input value={predicateKey} onChange={event => { setPredicateKey(event.target.value) }} /></label><label><span>类别</span><select value={category} onChange={event => { setCategory(event.target.value as RelationshipCategory) }}>{relationshipCategoryOptions.map(([value,text]) => <option key={value} value={value}>{text}</option>)}</select></label><label><span>方向</span><select value={directionality} onChange={event => { setDirectionality(event.target.value as 'directed'|'symmetric') }}><option value="directed">单向</option><option value="symmetric">双向</option></select></label><label><span>事实层</span><select value={factLayer} onChange={event => { setFactLayer(event.target.value as RelationshipFactLayer) }}><option value="author_asserted">作者事实</option><option value="canon">Canon</option><option value="planned">规划</option></select></label><label><span>有效故事序（起）</span><input type="number" value={from} onChange={event => { setFrom(event.target.value) }} /></label><label><span>有效故事序（止）</span><input type="number" value={to} onChange={event => { setTo(event.target.value) }} /></label></div>
    {error && <div role="alert" className="ns-relationship-editor__error">{error}</div>}
    <footer><span>正式关系会按来源权威进入后续 Prompt；候选关系不会。</span><button type="button" disabled={busy || nodes.length < 2} onClick={() => { void submit() }}>{busy ? '正在保存…' : editing ? '保存为新修订' : '创建正式关系'}</button></footer>
  </section>
}

function parseRelationshipCandidateEvidence(candidate: RelationshipCandidate): RelationshipPanelCandidate['evidence'] {
  let values: unknown
  try { values = JSON.parse(candidate.evidenceJson) } catch { return [] }
  const evidenceValues: unknown[] = Array.isArray(values) ? values : values && typeof values === 'object' ? [values] : []
  return evidenceValues.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const value = raw as Record<string,unknown>
    return [{ id: String(value.id ?? `${candidate.id}-evidence-${index + 1}`), relationshipId: candidate.id, sourceType: String(value.sourceType ?? 'candidate'), sourceId: String(value.sourceId ?? candidate.runId), sourceVersionId: typeof value.sourceVersionId === 'string' ? value.sourceVersionId : null, label: String(value.label ?? '候选关系证据'), excerptStart: Number.isInteger(value.excerptStart) ? Number(value.excerptStart) : null, excerptEnd: Number.isInteger(value.excerptEnd) ? Number(value.excerptEnd) : null, contentHash: String(value.contentHash ?? candidate.fingerprint), createdAt: candidate.createdAt, ...(typeof value.excerpt === 'string' ? { excerpt: value.excerpt } : typeof value.content === 'string' ? { excerpt: value.content } : {}) }]
  })
}

function toRelationshipPanelNode(node: StoryEntity): RelationshipEntityNode {
  return { id: node.id, projectId: node.projectId, type: node.type, name: node.name, aliases: node.aliases, description: node.description }
}

function toRelationshipPanelEdge(edge: EntityRelationship): RelationshipPanelEdge {
  return { id: edge.id, projectId: edge.projectId, sourceEntityId: edge.sourceEntityId, targetEntityId: edge.targetEntityId, predicateKey: edge.predicateKey, label: edge.label, category: edge.category, directionality: edge.directionality, factLayer: edge.factLayer, validFromStoryOrder: edge.validFromStoryOrder, validToStoryOrder: edge.validToStoryOrder, status: edge.status, supersedesRelationshipId: edge.supersedesRelationshipId, createdBy: edge.createdBy, fingerprint: edge.fingerprint, revision: edge.revision, createdAt: edge.createdAt, updatedAt: edge.updatedAt }
}

function relationshipRunStatusLabel(status: RelationshipExtractionRun['status']): string {
  return ({ queued: '排队中', running: '提取中', waiting_review: '等待确认', succeeded: '已完成', blocked: '有歧义', failed: '失败', cancelled: '已取消' } as const)[status]
}

function entityLabel(id: string, nodes: StoryEntity[]): string { return nodes.find(node => node.id === id)?.name ?? id }
const relationshipCategoryOptions: ReadonlyArray<readonly [RelationshipCategory,string]> = [['family','亲属'],['emotion','情感'],['alliance','同盟'],['conflict','冲突'],['membership','隶属'],['possession','持有'],['location','位置'],['knowledge','知情'],['causality','因果'],['other','其他']]
const relationshipWorkspaceStyles = `
.ns-relationship-workspace{height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base,#fff)}.ns-relationship-policy{display:grid;grid-template-columns:minmax(145px,1fr) minmax(360px,2fr) auto;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));background:var(--dsw-alias-bg-module-platform,#f5f6f7)}.ns-relationship-policy>div:first-child{display:grid;gap:3px}.ns-relationship-policy>div:first-child strong{font-size:11px}.ns-relationship-policy>div:first-child span{color:var(--dsw-alias-label-secondary,#666b73);font-size:9px}.ns-relationship-policy>div[role=radiogroup]{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:3px;border-radius:8px;background:var(--dsw-alias-bg-base,#fff)}.ns-relationship-policy>div[role=radiogroup] button{display:grid;gap:2px;min-height:38px;padding:4px 7px;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary,#666b73);background:transparent;cursor:pointer;text-align:left}.ns-relationship-policy>div[role=radiogroup] button[aria-checked=true]{color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-specific-sidebar-nav-item-active,#e9ecf2)}.ns-relationship-policy b{font-size:10px}.ns-relationship-policy small{font-size:8px}.ns-relationship-manual{min-height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;font-size:9px;white-space:nowrap}.ns-relationship-archive,.ns-relationship-truncated{padding:8px 14px;color:var(--dsw-alias-label-secondary,#666b73);background:var(--dsw-alias-bg-module-platform,#f5f6f7);font-size:9px}.ns-relationship-truncated{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}.ns-relationship-editor{margin:12px 16px;padding:13px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff)}.ns-relationship-editor header,.ns-relationship-editor footer{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ns-relationship-editor header>div{display:grid;gap:3px}.ns-relationship-editor header strong{font-size:11px}.ns-relationship-editor header span,.ns-relationship-editor footer span{color:var(--dsw-alias-label-secondary,#666b73);font-size:9px}.ns-relationship-editor button{min-height:31px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:7px;background:var(--dsw-alias-bg-base,#fff);cursor:pointer;font-size:9px}.ns-relationship-editor label{display:grid;gap:4px;color:var(--dsw-alias-label-secondary,#666b73);font-size:8px}.ns-relationship-editor :is(input,select){width:100%;min-width:0;height:32px;padding:0 7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:6px;color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-bg-base,#fff);font:inherit;font-size:9px}.ns-relationship-editor__existing{margin-top:11px}.ns-relationship-editor__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:8px}.ns-relationship-editor footer{align-items:center;margin-top:11px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}.ns-relationship-editor footer button{color:#fff;border-color:var(--dsw-alias-state-business-primary,#4176e6);background:var(--dsw-alias-state-business-primary,#4176e6)}.ns-relationship-editor__error{margin-top:8px;color:var(--dsw-alias-state-error-primary,#c73737);font-size:9px}
.ns-relationship-runs{margin:8px 16px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));border-radius:8px;color:var(--dsw-alias-label-secondary,#666b73);background:var(--dsw-alias-bg-module-platform,#f5f6f7);font-size:9px}.ns-relationship-runs summary{cursor:pointer;font-weight:600}.ns-relationship-runs>div{display:grid;gap:5px;margin-top:8px}.ns-relationship-runs span{padding-top:5px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}
@media(max-width:760px){.ns-relationship-workspace{padding-top:52px}.ns-relationship-policy{grid-template-columns:1fr;padding:11px 12px}.ns-relationship-manual{width:100%}.ns-relationship-editor{margin:9px 10px}.ns-relationship-editor__grid{grid-template-columns:1fr 1fr}.ns-relationship-editor footer{align-items:flex-start;flex-direction:column}.ns-relationship-editor footer button{width:100%}}
`

function KnowledgeView({ projectId, section, mobile, readOnly }: { projectId: string; section: Exclude<ProjectSection, 'overview' | 'chapter' | 'batches' | 'memory' | 'relationships' | 'statistics'>; mobile: boolean; readOnly: boolean }) {
  const [knowledge, setKnowledge] = useState<KnowledgeWorkspace | null>(null)
  const [foundation, setFoundation] = useState<ProjectFoundationWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRequestRef = useRef(0)
  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    try {
      const [nextKnowledge, nextFoundation] = await Promise.all([
        api<KnowledgeWorkspace>(`/projects/${encodeURIComponent(projectId)}/knowledge`),
        section === 'timeline' ? api<ProjectFoundationWorkspace>(`/projects/${encodeURIComponent(projectId)}/foundation`) : Promise.resolve(null),
      ])
      if (requestId !== loadRequestRef.current) return
      setKnowledge(nextKnowledge); setFoundation(nextFoundation); setError(null)
    } catch (cause) { if (requestId === loadRequestRef.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [projectId, section])
  useEffect(() => { void load() }, [load])
  if (!knowledge) return <div style={centered}>{error ?? '正在读取故事知识…'}</div>
  const title = ({ entities: '人物事实', canon: 'Canon 事实', timeline: '时间线看板', foreshadowing: '伏笔事实', sources: '故事资料' } as const)[section]
  const characters = visibleCharacters(knowledge.entities)
  return <div style={{ height: '100%', overflow: 'auto', background: color.module }}><div style={{ maxWidth: 960, margin: '0 auto', padding: mobile ? '70px 16px 60px' : '34px 30px 70px' }}>
    <span style={sectionLabel}>{knowledge.project.title}</span><h1 style={{ ...pageTitle, marginTop: 8 }}>{title}</h1>
    {section === 'entities' && <CharacterList characters={characters} mobile={mobile} />}
    {section === 'canon' && <><KnowledgeMetricStrip values={[[knowledge.canonFacts.length,'Canon 事实'],[knowledge.summaries.length,'分层摘要'],[knowledge.entities.length,'故事实体']]} /><KnowledgeList empty="章节获批后才会提交 Canon；草稿不会出现在这里。">{knowledge.canonFacts.map(fact => <KnowledgeRow key={fact.id} title={`${fact.subject} · ${fact.predicate}`} meta="当前项目 Canon" text={friendlyFactValue(fact.valueJson)} />)}{knowledge.summaries.map(summary => <KnowledgeRow key={summary.id} title={`${summaryScopeLabel(summary.scope)}摘要`} meta={summary.status === 'current' ? '最新' : '需刷新'} text={summary.content} />)}</KnowledgeList></>}
    {section === 'timeline' && <StoryTimelineView knowledge={knowledge} foundation={foundation} />}
    {section === 'foreshadowing' && <KnowledgeList empty="目前没有已登记伏笔。工作流提取出的伏笔必须随批准版本提交。">{knowledge.foreshadowing.map(item => <KnowledgeRow key={item.id} title={item.title} meta={foreshadowLabel(item.status)} text={item.description} />)}</KnowledgeList>}
    {section === 'sources' && <HistoricalSources knowledge={knowledge} setKnowledge={setKnowledge} readOnly={readOnly} />}
    {error && <ErrorNotice message={error} />}
  </div></div>
}

function HistoricalSources({ knowledge, setKnowledge, readOnly }: { knowledge: KnowledgeWorkspace; setKnowledge: (value: KnowledgeWorkspace) => void; readOnly: boolean }) {
  const update = async (sourceProjectId: string, enabled: boolean, scopes: HistoricalKnowledgeScope[]) => { if (!readOnly) setKnowledge(await api<KnowledgeWorkspace>(`/projects/${knowledge.project.id}/knowledge-sources/${sourceProjectId}`, { method: 'POST', body: JSON.stringify({ enabled, scopes }) })) }
  return <div style={{ marginTop: 22, display: 'grid', gap: 10 }}>
    {readOnly && <div role="status" style={{ ...panel, padding: 11, color: color.secondary, fontSize: 11 }}>此项目已归档。可以查看故事资料与历史引用，但不能修改来源范围。</div>}
    <div style={{ ...panel, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}><MiniStat value={knowledge.historicalSources.filter(item => item.enabled).length} label="已启用历史项目" /><MiniStat value={knowledge.latestRetrievals.length} label="最近检索记录" /><MiniStat value={knowledge.latestRetrievals.reduce((sum, item) => sum + item.items.length, 0)} label="已记录引用" /></div>
    {knowledge.historicalSources.map(source => <section key={source.sourceProject.id} style={{ ...panel, padding: 15 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={folderTile}><IconFolderOpen16 size={18} /></span><div style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 13 }}>{source.sourceProject.title}</strong><span style={{ color: color.secondary, fontSize: 11 }}>{source.sourceProject.genre || '未设置题材'}</span></div><label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, color: color.secondary, fontSize: 12 }}><input type="checkbox" disabled={readOnly} checked={source.enabled} onChange={event => { void update(source.sourceProject.id, event.target.checked, event.target.checked && source.scopes.length === 0 ? ['structure_summary'] : source.scopes) }} />用于当前项目</label></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '8px 14px', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${color.borderSoft}` }}>{historicalScopeOrder.map(scope => <label key={scope} style={{ display: 'flex', alignItems: 'center', gap: 7, color: source.enabled ? color.text : color.tertiary, fontSize: 12 }}><input type="checkbox" disabled={readOnly || !source.enabled} checked={source.scopes.includes(scope)} onChange={event => { const scopes = event.target.checked ? [...source.scopes, scope] : source.scopes.filter(item => item !== scope); void update(source.sourceProject.id, source.enabled, scopes) }} />{historicalScopeLabels[scope]}{['original_excerpt','names_and_entities','specific_plot'].includes(scope) && <span style={{ color: color.warning, fontSize: 10 }}>高风险</span>}</label>)}</div>
    </section>)}
    {knowledge.historicalSources.length === 0 && <EmptyState icon={<IconArchiveOutline20 size={22} />} title="没有其他小说项目" text="建立第二个项目后，可以在这里选择允许复用的知识范围。" />}
    {knowledge.latestRetrievals.length > 0 && <section style={{ marginTop: 18 }}><SectionHeading title="最近检索" meta={`${knowledge.latestRetrievals.length} 次`} /><div style={{ ...panel, marginTop: 10 }}>{knowledge.latestRetrievals.map(bundle => <div key={bundle.id} style={{ padding: '12px 14px', borderBottom: `1px solid ${color.borderSoft}` }}><strong style={{ fontSize: 12 }}>{bundle.purpose}</strong><span style={{ marginLeft: 8, color: color.secondary, fontSize: 11 }}>{bundle.items.length} 条引用 · {formatTime(bundle.createdAt)}</span><div style={{ marginTop: 7, color: color.tertiary, fontSize: 11 }}>{[...new Set(bundle.items.map(item => item.citationLabel))].slice(0, 5).join(' · ') || '无来源'}</div></div>)}</div></section>}
  </div>
}

function CharacterList({ characters, mobile }: { characters: StoryEntity[]; mobile: boolean }) {
  if (characters.length === 0) return <div style={{ ...panel, marginTop: 22, padding: mobile ? 22 : 28, color: color.secondary, fontSize: 12 }}>批准人物体系或章节后，人物事实会在这里形成稳定记录。</div>
  return <div aria-label="人物卡片列表" style={{ display: 'grid', gap: 10, marginTop: 22 }}>{characters.map(character => <article key={character.id} style={{ ...panel, display: 'grid', gridTemplateColumns: `minmax(0,1fr) ${mobile ? 64 : 82}px`, alignItems: 'center', gap: mobile ? 12 : 18, padding: mobile ? 13 : 16 }}>
    <div style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 14, lineHeight: 1.35 }}>{character.name}</strong><p style={{ margin: '7px 0 0', color: color.secondary, fontSize: 12, lineHeight: 1.7 }}>{character.description || '尚未补充人物描述。'}</p></div>
    <CharacterPortrait size={mobile ? 64 : 82} />
  </article>)}</div>
}
function CharacterPortrait({ size }: { size: number }) {
  return <div aria-hidden="true" style={{ width: size, height: size, display: 'grid', placeItems: 'center', border: `1px solid ${color.border}`, borderRadius: size * .24, background: `linear-gradient(145deg, ${color.active}, ${color.module})`, color: color.secondary, overflow: 'hidden' }}>
    <svg width={size * .72} height={size * .72} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="24" r="11" fill="currentColor" opacity=".78" />
      <path d="M14 55c1.8-11.7 8.3-18 18-18s16.2 6.3 18 18" fill="currentColor" opacity=".78" />
      <path d="M21 23c1.8-7 6.3-11 11-11s9.2 4 11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".38" />
      <circle cx="48" cy="13" r="3" fill={color.brand} opacity=".9" />
    </svg>
  </div>
}
function compactKnowledgeChildren(children: ReactNode): ReactNode[] { return Array.isArray(children) ? children.flatMap(compactKnowledgeChildren) : children === null || children === undefined || typeof children === 'boolean' ? [] : [children] }
function KnowledgeList({ children, empty }: { children: ReactNode; empty: string }) { const list = compactKnowledgeChildren(children); return <div style={{ ...panel, marginTop: 22 }}>{list.length ? list : <div style={{ padding: 28, color: color.secondary, fontSize: 12 }}>{empty}</div>}</div> }
function KnowledgeRow({ title, meta, text }: { title: string; meta?: string; text: string }) { return <article style={{ padding: '13px 15px', borderBottom: `1px solid ${color.borderSoft}` }}><div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}><strong style={{ fontSize: 13 }}>{title}</strong>{meta && <span style={{ color: color.tertiary, fontSize: 10 }}>{meta}</span>}</div><p style={{ margin: '6px 0 0', color: color.secondary, fontSize: 12, lineHeight: 1.65 }}>{text}</p></article> }
function KnowledgeMetricStrip({ values }: { values: Array<[number,string]> }) { return <div style={{ ...panel, display: 'grid', gridTemplateColumns: `repeat(${values.length},minmax(0,1fr))`, marginTop: 22 }}>{values.map(([value,label]) => <div key={label} style={{ padding: 14, borderRight: `1px solid ${color.borderSoft}` }}><strong style={{ display: 'block', fontSize: 18 }}>{value}</strong><span style={{ color: color.secondary, fontSize: 11 }}>{label}</span></div>)}</div> }
function visibleCharacters(entities: StoryEntity[]): StoryEntity[] {
  const characters = entities.filter(entity => entity.type === 'character')
  return characters.filter(candidate => characters.filter(other => other.id !== candidate.id && candidate.name.includes(other.name)).length < 2)
}
function StoryTimelineView({ knowledge, foundation }: { knowledge: KnowledgeWorkspace; foundation: ProjectFoundationWorkspace | null }) {
  const timelineVersion = foundation?.stages.find(stage => stage.kind === 'timeline')?.approvedVersion ?? null
  const anchors = extractStoryTimelineAnchors(timelineVersion?.content ?? '')
  const progress = knowledge.summaries.filter(summary => summary.scope === 'chapter' && summary.status === 'current')
    .sort((left, right) => (left.sourceStartChapter ?? Number.MAX_SAFE_INTEGER) - (right.sourceStartChapter ?? Number.MAX_SAFE_INTEGER))
  return <div style={{ display: 'grid', gap: 22, marginTop: 22 }}>
    <section><SectionHeading title="当前故事进展" meta={progress.length ? `已推进 ${progress.length} 章` : undefined} /><div style={{ ...panel, marginTop: 10 }}>{progress.length ? progress.map((summary, index) => <KnowledgeRow key={summary.id} title={summary.sourceStartChapter ? `第 ${summary.sourceStartChapter} 章` : '已发生事件'} meta={index === progress.length - 1 ? '当前' : '已发生'} text={summary.compactNarrative || summary.content} />) : <div style={{ padding: 28, color: color.secondary, fontSize: 12 }}>批准章节后，已经写入正文的故事进展会出现在这里。</div>}</div></section>
    <section><SectionHeading title="全局时间锚点" meta="过去、现在与后续既定节点" /><div style={{ ...panel, marginTop: 10 }}>{anchors.length ? anchors.map((anchor, index) => <article key={`${index}:${anchor}`} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 10, padding: '12px 15px', borderBottom: `1px solid ${color.borderSoft}` }}><span aria-hidden="true" style={{ width: 8, height: 8, marginTop: 5, borderRadius: '50%', background: color.brand, boxShadow: `0 0 0 4px ${color.active}` }} /><span style={{ color: color.text, fontSize: 12, lineHeight: 1.65 }}>{anchor}</span></article>) : <div style={{ padding: 28, color: color.secondary, fontSize: 12 }}>{timelineVersion ? '已批准的故事时间线还没有可识别的关键时间锚点。' : '请先在创作准备生成并批准故事时间线。'}</div>}</div></section>
  </div>
}
function summaryScopeLabel(scope: string) { return ({ chapter: '章节', volume: '分卷', book: 'Book', project: '项目' } as Record<string,string>)[scope] ?? scope }
function foreshadowLabel(status: string) { return ({ planned: '已规划', planted: '已埋设', reinforced: '已强化', resolved: '已回收', abandoned: '已放弃' } as Record<string,string>)[status] ?? status }
function friendlyFactValue(value: string) { try { const parsed = JSON.parse(value) as Record<string,unknown>; return Object.entries(parsed).map(([key,item]) => `${key}: ${String(item)}`).join(' · ') } catch { return value } }

function ChapterEditor({ chapter, projectRuns, readOnly, refresh, registerBeforeLeaveFlush }: { chapter: ChapterDetail; projectRuns: WorkflowRun[]; readOnly: boolean; refresh: (quiet?: boolean) => Promise<void>; registerBeforeLeaveFlush: RegisterBeforeLeaveFlush }) {
  const inspectorDrawer = useNarrowViewport(1279)
  const activeRun = projectRuns.find(run => run.chapterId === chapter.id && ['running','paused','waiting_approval','failed','cancel_requested'].includes(run.status)) ?? null
  const completedNoticeRun = activeRun ? null : projectRuns.find(run => run.chapterId === chapter.id && run.status === 'succeeded' && workflowHasPersistentNotice(run)) ?? null
  const workflowBarRun = activeRun ?? completedNoticeRun
  const current = chapter.versions.find(version => version.id === chapter.currentDraftVersionId) ?? chapter.versions.find(version => version.id === chapter.currentApprovedVersionId)
  const waitingApprovalTargetId = activeRun?.status === 'waiting_approval' ? activeRun.approval?.manuscriptVersionId ?? null : null
  const waitingApprovalTargetVersion = waitingApprovalTargetId ? chapter.versions.find(version => version.id === waitingApprovalTargetId) ?? null : null
  const waitingApprovalTargetError = activeRun?.status !== 'waiting_approval' ? null : !waitingApprovalTargetId ? '审批记录缺少目标正文版本，当前不能批准；请刷新或重试该工作流。' : !waitingApprovalTargetVersion ? `待审批版本 ${waitingApprovalTargetId} 未出现在本章版本列表中，当前不能批准。` : null
  const initialComparison = defaultVersionComparison(chapter.versions, current?.id ?? null)
  const [content, setContent] = useState(current?.content ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [recoveryDraft, setRecoveryDraft] = useState<ChapterRecoveryDraft | null>(null)
  const [foundation, setFoundation] = useState<ProjectFoundationWorkspace | null>(null)
  const [foundationError, setFoundationError] = useState<string | null>(null)
  const [modelRuns, setModelRuns] = useState<ModelRun[]>([])
  const [generationSources, setGenerationSources] = useState<GenerationSources | null>(null)
  const [generationSourcesLoading, setGenerationSourcesLoading] = useState(false)
  const [generationSourcesError, setGenerationSourcesError] = useState<string | null>(null)
  const [dismissedPreviewId, setDismissedPreviewId] = useState<string | null>(null)
  const [startingWorkflow, setStartingWorkflow] = useState(false)
  const [generationActionError, setGenerationActionError] = useState<string | null>(null)
  const [workflowCommandBusy, setWorkflowCommandBusy] = useState(false)
  const [workflowCommandError, setWorkflowCommandError] = useState<string | null>(null)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [selectionRewrite, setSelectionRewrite] = useState<SelectionRewritePopover | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<AuthorInspectorTab>('versions')
  const [editorMode, setEditorMode] = useState<'write' | 'review'>('write')
  const [reviewLeftVersionId, setReviewLeftVersionId] = useState<string | null>(initialComparison.left)
  const [reviewRightVersionId, setReviewRightVersionId] = useState<string | null>(initialComparison.right)
  const [knowledge, setKnowledge] = useState<KnowledgeWorkspace | null>(null)
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null)
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const rewritePopoverRef = useRef<HTMLDivElement | null>(null)
  const rewriteControllerRef = useRef<AbortController | null>(null)
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const contentRef = useRef(content); contentRef.current = content
  const revisionRef = useRef(chapter.revision)
  const savedContentRef = useRef(current?.content ?? '')
  const loadedChapterIdRef = useRef(chapter.id)
  const savingPromiseRef = useRef<Promise<void> | null>(null)
  const rewriteBusy = selectionRewrite?.status === 'loading'
  const rewriteComposerOpen = selectionRewrite?.mode === 'composer'
  const rewriteComposerOpenRef = useRef(rewriteComposerOpen); rewriteComposerOpenRef.current = rewriteComposerOpen
  const rememberLocalEdit = useCallback((value: string) => {
    if (readOnly) return
    contentRef.current = value
    setContent(value)
    const changed = value !== savedContentRef.current
    dirtyRef.current = changed; setDirty(changed); setSaveError(null); setRecoveryDraft(null)
    if (changed) writeChapterRecoveryDraft(chapter.id, current?.id ?? null, revisionRef.current, value)
    else clearChapterRecoveryDraft(chapter.id)
  }, [chapter.id, current?.id, readOnly])
  const restoreRecoveryDraft = () => { if (recoveryDraft && !readOnly) rememberLocalEdit(recoveryDraft.content) }
  const discardRecoveryDraft = () => { clearChapterRecoveryDraft(chapter.id); setRecoveryDraft(null) }
  useEffect(() => { revisionRef.current = chapter.revision }, [chapter.id, chapter.revision])
  useEffect(() => {
    if (!selectionRewrite) return
    const shell = editorShellRef.current
    if (!shell) return
    const reposition = () => {
      const bounds = shell.getBoundingClientRect()
      const popover = rewritePopoverRef.current
      const fallbackWidth = selectionRewrite.mode === 'composer'
        ? Math.min(360, Math.max(0, bounds.width - 24))
        : Math.min(620, Math.max(0, bounds.width - 16))
      const width = popover?.offsetWidth || fallbackWidth
      const height = popover?.offsetHeight || (selectionRewrite.mode === 'composer' ? 174 : 56)
      const minLeft = 8 + width / 2
      const maxLeft = bounds.width - 8 - width / 2
      const left = maxLeft >= minLeft ? Math.min(Math.max(selectionRewrite.left, minLeft), maxLeft) : bounds.width / 2
      const top = Math.min(Math.max(selectionRewrite.top, 8), Math.max(8, bounds.height - height - 8))
      setSelectionRewrite(action => {
        if (!action) return action
        return left === action.left && top === action.top ? action : { ...action, left, top }
      })
    }
    const frame = window.requestAnimationFrame(reposition)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition)
    resizeObserver?.observe(shell)
    if (rewritePopoverRef.current) resizeObserver?.observe(rewritePopoverRef.current)
    window.addEventListener('resize', reposition)
    return () => { window.cancelAnimationFrame(frame); resizeObserver?.disconnect(); window.removeEventListener('resize', reposition) }
  }, [selectionRewrite?.mode, selectionRewrite?.snapshot.start, selectionRewrite?.snapshot.end])
  useEffect(() => {
    const comparison = defaultVersionComparison(chapter.versions, current?.id ?? null)
    const savedContent = current?.content ?? ''
    const switchedChapter = loadedChapterIdRef.current !== chapter.id
    loadedChapterIdRef.current = chapter.id
    savedContentRef.current = savedContent
    const localDraft = readOnly ? null : readChapterRecoveryDraft(chapter.id)
    if (!switchedChapter && dirtyRef.current && contentRef.current !== savedContent) {
      setRecoveryDraft(null)
      return
    }
    rewriteControllerRef.current?.abort(); rewriteControllerRef.current = null; setSelectionRewrite(null); contentRef.current = savedContent; setContent(savedContent); dirtyRef.current = false; setDirty(false); setSaveError(null)
    if (localDraft?.content === savedContent) { clearChapterRecoveryDraft(chapter.id, savedContent); setRecoveryDraft(null) }
    else setRecoveryDraft(localDraft)
    setReviewLeftVersionId(comparison.left); setReviewRightVersionId(comparison.right); setEditorMode('write')
  }, [chapter.id, current?.id, readOnly])
  useEffect(() => () => { rewriteControllerRef.current?.abort() }, [])
  useEffect(() => { setKnowledge(null); setKnowledgeError(null); setInspectorOpen(false); setEditorMode('write') }, [chapter.projectId, chapter.id])
  useEffect(() => {
    if (!inspectorOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !rewriteBusy) setInspectorOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [inspectorOpen, rewriteBusy])
  useEffect(() => {
    if (activeRun?.status !== 'waiting_approval' || !waitingApprovalTargetId || !waitingApprovalTargetVersion) return
    const comparison = defaultVersionComparison(chapter.versions, waitingApprovalTargetId)
    setReviewLeftVersionId(comparison.left); setReviewRightVersionId(waitingApprovalTargetId)
  }, [activeRun?.id, activeRun?.status, chapter.revision, waitingApprovalTargetId, waitingApprovalTargetVersion?.contentHash])
  useEffect(() => {
    if (!inspectorOpen || inspectorTab !== 'memory' || knowledge) return
    let active = true
    setKnowledgeError(null)
    void api<KnowledgeWorkspace>(`/projects/${encodeURIComponent(chapter.projectId)}/knowledge`)
      .then(result => { if (active) setKnowledge(result) })
      .catch(cause => { if (active) setKnowledgeError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [chapter.projectId, inspectorOpen, inspectorTab, knowledge])
  useEffect(() => {
    setFoundation(null); setFoundationError(null)
    void api<ProjectFoundationWorkspace>(`/projects/${encodeURIComponent(chapter.projectId)}/foundation`).then(setFoundation).catch(cause => { setFoundationError(cause instanceof Error ? cause.message : String(cause)) })
  }, [chapter.projectId])
  const loadModelRuns = useCallback(async () => {
    try { setModelRuns(await api<ModelRun[]>(`/chapters/${encodeURIComponent(chapter.id)}/model-runs`)) }
    catch { /* Live preview polling may retry without replacing the editor. */ }
  }, [chapter.id])
  const loadGenerationSources = useCallback(async () => {
    setGenerationSourcesLoading(true)
    try { setGenerationSources(await api<GenerationSources>(`/chapters/${encodeURIComponent(chapter.id)}/generation-sources`)); setGenerationSourcesError(null) }
    catch (cause) { setGenerationSourcesError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setGenerationSourcesLoading(false) }
  }, [chapter.id])
  useEffect(() => {
    setModelRuns([]); setGenerationSources(null); setGenerationSourcesError(null); setGenerationSourcesLoading(true); setDismissedPreviewId(null); void loadModelRuns(); void loadGenerationSources()
    if (!activeRun || !['running','cancel_requested','failed'].includes(activeRun.status)) return
    const timer = window.setInterval(() => { void loadModelRuns(); void loadGenerationSources() }, 650)
    return () => { window.clearInterval(timer) }
  }, [chapter.id, activeRun?.id, activeRun?.currentNodeKey, activeRun?.status, loadGenerationSources, loadModelRuns])
  const save = useCallback((origin: 'user' | 'autosave'): Promise<void> => {
    if (readOnly) return Promise.reject(new Error('归档项目为只读状态。'))
    if (savingPromiseRef.current) return savingPromiseRef.current
    if (!dirtyRef.current) return Promise.resolve()
    if (rewriteControllerRef.current || rewriteComposerOpenRef.current) return Promise.reject(new Error('请先完成或取消选区重写，再离开当前章节。'))
    const value = contentRef.current
    setSaving(true); setSaveError(null)
    const request = api<ChapterDetail>(`/chapters/${encodeURIComponent(chapter.id)}/drafts`, { method: 'POST', body: JSON.stringify({ content: value, baseRevision: revisionRef.current, origin }) })
      .then(async savedChapter => {
        revisionRef.current = savedChapter.revision
        savedContentRef.current = value
        clearChapterRecoveryDraft(chapter.id, value)
        if (contentRef.current === value) { dirtyRef.current = false; setDirty(false); setRecoveryDraft(null) }
        await refresh(true)
      })
    const tracked = request.catch(async cause => {
      if (cause instanceof NovelApiError && cause.code === 'revision-conflict') {
        try {
          const latest = await api<ChapterDetail>(`/chapters/${encodeURIComponent(chapter.id)}`)
          const latestVersion = latest.versions.find(version => version.id === latest.currentDraftVersionId) ?? latest.versions.find(version => version.id === latest.currentApprovedVersionId)
          revisionRef.current = latest.revision
          savedContentRef.current = latestVersion?.content ?? ''
          if (latestVersion?.content === value) {
            clearChapterRecoveryDraft(chapter.id, value)
            if (contentRef.current === value) { dirtyRef.current = false; setDirty(false); setRecoveryDraft(null) }
            setSaveError(null)
            await refresh(true)
            return
          }
          await refresh(true)
          const conflict = new Error('服务器正文已在另一个窗口更新；本地恢复草稿仍保留，请核对后再次保存。')
          setSaveError(conflict.message)
          throw conflict
        } catch (refreshCause) {
          if (!(refreshCause instanceof Error) || !refreshCause.message.includes('本地恢复草稿仍保留')) setSaveError(cause.message)
          throw refreshCause
        }
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      setSaveError(message)
      throw cause
    }).finally(() => {
      if (savingPromiseRef.current === tracked) savingPromiseRef.current = null
      setSaving(false)
    })
    savingPromiseRef.current = tracked
    return tracked
  }, [chapter.id, readOnly, refresh])
  const flushBeforeLeave = useCallback(async (): Promise<void> => {
    if (readOnly) return
    if (rewriteControllerRef.current || rewriteComposerOpenRef.current) throw new Error('请先完成或取消选区重写，再离开当前章节。')
    if (savingPromiseRef.current) await savingPromiseRef.current
    if (dirtyRef.current) await save('user')
    if (dirtyRef.current) throw new Error('正文仍有未保存修改。')
  }, [readOnly, save])
  const flushBeforeLeaveRef = useRef(flushBeforeLeave); flushBeforeLeaveRef.current = flushBeforeLeave
  useEffect(() => {
    if (readOnly) { registerBeforeLeaveFlush(null); return }
    registerBeforeLeaveFlush(() => flushBeforeLeaveRef.current())
    return () => { registerBeforeLeaveFlush(null) }
  }, [readOnly, registerBeforeLeaveFlush])
  useEffect(() => {
    if (!dirty || readOnly) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => { window.removeEventListener('beforeunload', warnBeforeUnload) }
  }, [dirty, readOnly])
  useEffect(() => { if (!dirty || readOnly || saving || rewriteComposerOpen) return; const timer = window.setTimeout(() => { void save('autosave').catch(() => {}) }, 1200); return () => { window.clearTimeout(timer) } }, [content, dirty, readOnly, rewriteComposerOpen, save, saving])
  const orderedVersions = useMemo(() => [...chapter.versions].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [chapter.versions])
  const reviewLeftVersion = orderedVersions.find(version => version.id === reviewLeftVersionId) ?? null
  const reviewRightVersion = orderedVersions.find(version => version.id === reviewRightVersionId) ?? current ?? orderedVersions[0] ?? null
  const versionDiff = useMemo(() => reviewLeftVersion && reviewRightVersion ? diffManuscriptParagraphs(reviewLeftVersion.content, reviewRightVersion.content) : null, [reviewLeftVersion?.contentHash, reviewRightVersion?.contentHash])
  const approveVersion = async (versionId: string): Promise<boolean> => {
    if (readOnly || !chapter.versions.some(version => version.id === versionId) || rewriteComposerOpen || approvalBusy) return false
    setApprovalBusy(true); setGenerationActionError(null)
    try {
      await api(`/chapters/${chapter.id}/approve`, { method: 'POST', body: JSON.stringify({ versionId, baseRevision: chapter.revision }) })
      await refresh(true); return true
    } catch (cause) { setGenerationActionError(cause instanceof Error ? cause.message : String(cause)); return false }
    finally { setApprovalBusy(false) }
  }
  const createWorkflow = async () => { if (readOnly || startingWorkflow || activeRun || rewriteComposerOpen) return; setGenerationActionError(null); setStartingWorkflow(true); try { await startWorkflow(chapter.id, refresh) } catch (cause) { setGenerationActionError(cause instanceof Error ? cause.message : String(cause)) } finally { setStartingWorkflow(false) } }
  const workflowCommand = async (action: string, body: unknown = {}): Promise<boolean> => { if (readOnly || !activeRun || workflowCommandBusy) return false; setWorkflowCommandBusy(true); setWorkflowCommandError(null); try { await api(`/workflows/${activeRun.id}/${action}`, { method: 'POST', body: JSON.stringify(body) }); await refresh(true); return true } catch (cause) { setWorkflowCommandError(cause instanceof Error ? cause.message : String(cause)); return false } finally { setWorkflowCommandBusy(false) } }
  const openInspector = (tab: AuthorInspectorTab) => { setInspectorTab(tab); setInspectorOpen(true) }
  const selectVersion = (versionId: string) => {
    const comparison = defaultVersionComparison(orderedVersions, versionId)
    setReviewLeftVersionId(comparison.left); setReviewRightVersionId(comparison.right)
  }
  const compareVersion = (versionId: string) => {
    const comparison = defaultVersionComparison(orderedVersions, versionId)
    if (!comparison.left || !comparison.right) return
    setSelectionRewrite(null); setReviewLeftVersionId(comparison.left); setReviewRightVersionId(comparison.right); setEditorMode('review'); openInspector('versions')
  }
  const approveCurrentDraft = async () => {
    if (dirty || saving || approvalBusy || rewriteComposerOpen || activeRun) return
    const targetVersionId = chapter.currentDraftVersionId
    if (!targetVersionId || !chapter.versions.some(version => version.id === targetVersionId)) {
      setGenerationActionError('当前草稿版本不可用，无法批准。')
      return
    }
    await approveVersion(targetVersionId)
  }
  const approveWaitingDraft = async () => {
    if (dirty || saving || rewriteBusy || workflowCommandBusy || activeRun?.status !== 'waiting_approval') return
    if (waitingApprovalTargetError || !waitingApprovalTargetId) {
      setWorkflowCommandError(waitingApprovalTargetError ?? '待批准版本不可用，请刷新后重试。')
      return
    }
    if (chapter.currentDraftVersionId !== waitingApprovalTargetId) {
      setWorkflowCommandError('当前正文和待批准版本尚未同步；请先保存正文，再批准本章。')
      return
    }
    await workflowCommand('approval', { decision: 'approved', note: '' })
  }
  const continueEditingVersion = (version: ManuscriptVersion) => {
    if (readOnly || dirty || saving || activeRun || rewriteBusy) return
    rewriteControllerRef.current?.abort(); rewriteControllerRef.current = null; setSelectionRewrite(null)
    rememberLocalEdit(version.content); setEditorMode('write')
  }
  const foundationReady = foundation?.readyForChapterGeneration === true
  const approvedFoundationCount = foundation?.stages.filter(stage => stage.status === 'approved').length ?? 0
  const foundationAdvisory = foundationReady ? null : foundationError
    ? '创作准备状态暂时未读取；仍可继续生成，完成准备后会更稳'
    : `创作准备 ${approvedFoundationCount}/${foundation?.stages.length ?? 3}；可继续生成，完成大纲、人物与时间线后会更稳`
  const latestDraftRun = modelRuns.find(run => run.purpose === 'chapter-draft') ?? null
  const draftMatchesWorkflow = latestDraftRun && (!activeRun || Date.parse(latestDraftRun.createdAt) >= Date.parse(activeRun.createdAt))
  const visibleDraftRun = latestDraftRun && draftMatchesWorkflow && latestDraftRun.id !== dismissedPreviewId && (latestDraftRun.status === 'running' || latestDraftRun.status === 'failed' && latestDraftRun.streamedText) ? latestDraftRun : null
  const preparingFirstDraft = Boolean(activeRun && activeRun.status === 'running' && !visibleDraftRun && !content && workflowAtOrBeforeDraft(activeRun))
  const visibleContent = visibleDraftRun?.streamedText ?? content
  const visibleWordCount = manuscriptWordCount(visibleContent)
  const captureSelection = useCallback((textarea: HTMLTextAreaElement, point?: { clientX: number; clientY: number }) => {
    if (readOnly || rewriteControllerRef.current || saving || activeRun && activeRun.status !== 'waiting_approval') return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    if (end <= start || !contentRef.current.slice(start, end).trim()) { setSelectionRewrite(null); return }
    try {
      const shell = editorShellRef.current
      if (!shell) return
      const bounds = shell.getBoundingClientRect()
      const rawLeft = (point?.clientX ?? bounds.left + bounds.width / 2) - bounds.left
      const rawTop = (point?.clientY ?? bounds.top + 54) - bounds.top - 42
      const horizontalInset = Math.min(72, Math.max(42, bounds.width / 3))
      setSelectionRewrite({
        snapshot: createManuscriptSelectionSnapshot(contentRef.current, start, end),
        left: Math.min(Math.max(rawLeft, horizontalInset), Math.max(horizontalInset, bounds.width - horizontalInset)),
        top: Math.min(Math.max(rawTop, 8), Math.max(8, bounds.height - 38)),
        mode: 'trigger', instruction: '', status: 'idle', error: null,
      })
    } catch { setSelectionRewrite(null) }
  }, [activeRun, readOnly, saving])
  const openSelectionRewriteComposer = () => {
    const action = selectionRewrite
    const shell = editorShellRef.current
    if (!action || action.status === 'loading' || !shell) return
    const bounds = shell.getBoundingClientRect()
    const cardWidth = Math.min(360, Math.max(0, bounds.width - 24))
    const minLeft = 12 + cardWidth / 2
    const maxLeft = bounds.width - 12 - cardWidth / 2
    setSelectionRewrite({
      ...action,
      mode: 'composer',
      left: maxLeft >= minLeft ? Math.min(Math.max(action.left, minLeft), maxLeft) : bounds.width / 2,
      top: Math.min(action.top, Math.max(8, bounds.height - 174)),
      error: null,
    })
  }
  const setSelectionRewriteInstruction = (instruction: string) => {
    setSelectionRewrite(action => action && action.mode === 'composer' && action.status !== 'loading'
      ? { ...action, instruction, status: 'idle', error: null }
      : action)
  }
  const cancelSelectionRewrite = () => {
    if (rewriteControllerRef.current) return
    setSelectionRewrite(null)
  }
  const rewriteSelectedText = async (instructionOverride?: string) => {
    const action = selectionRewrite
    if (readOnly || !action || action.status === 'loading' || saving || activeRun && activeRun.status !== 'waiting_approval') return
    const instruction = instructionOverride ?? action.instruction
    const controller = new AbortController()
    rewriteControllerRef.current = controller
    setSelectionRewrite({ ...action, mode: 'composer', instruction, status: 'loading', error: null })
    try {
      const result = await api<SelectionRewriteResult>(`/chapters/${encodeURIComponent(chapter.id)}/rewrite-selection`, {
        method: 'POST', signal: controller.signal, body: JSON.stringify({
          selectedText: action.snapshot.selectedText,
          contextBefore: action.snapshot.content.slice(Math.max(0, action.snapshot.start - MAX_SELECTION_CONTEXT_CHARACTERS), action.snapshot.start),
          contextAfter: action.snapshot.content.slice(action.snapshot.end, action.snapshot.end + MAX_SELECTION_CONTEXT_CHARACTERS),
          instruction: instruction.trim(),
          baseRevision: chapter.revision,
        }),
      })
      if (controller.signal.aborted) return
      const next = applyManuscriptSelectionRewrite(contentRef.current, action.snapshot, result.replacementText)
      rememberLocalEdit(next.content); setSelectionRewrite(null); setGenerationActionError(null)
      window.requestAnimationFrame(() => { const textarea = editorRef.current; if (!textarea) return; textarea.focus(); textarea.setSelectionRange(next.selectionEnd, next.selectionEnd) })
    } catch (cause) {
      if (controller.signal.aborted) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setSelectionRewrite(currentAction => currentAction ? { ...currentAction, status: 'error', error: message } : null)
    } finally {
      if (rewriteControllerRef.current === controller) rewriteControllerRef.current = null
    }
  }
  const runQuickSelectionRewrite = (instruction: string) => { void rewriteSelectedText(instruction) }
  const selectionRewriteAvailable = editorMode === 'write' && !readOnly && !visibleDraftRun && (!activeRun || activeRun.status === 'waiting_approval')
  const waitingApprovalReady = activeRun?.status === 'waiting_approval' && !waitingApprovalTargetError && !dirty && !saving && !rewriteBusy && chapter.currentDraftVersionId === waitingApprovalTargetId
  return <div style={{ position: 'relative', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: color.layer }}>
    <div style={{ minHeight: 48, flex: '0 0 48px', display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', borderBottom: `1px solid ${color.borderSoft}`, overflowX: 'auto' }}>
      <span style={{ flexShrink: 0, color: color.secondary, fontSize: 12 }}>第 {chapter.chapterNumber} 章</span><strong style={{ flexShrink: 0, fontSize: 14 }}>{chapter.title}</strong>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>{readOnly ? <span style={{ color: color.secondary, fontSize: 12 }}>归档只读</span> : activeRun ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: color.secondary, fontSize: 12 }}><StatusDot status={activeRun.status} warning={workflowUsesWarningTone(activeRun)} />{nodeLabel(activeRun.currentNodeKey)}</span> : <span style={{ color: color.tertiary, fontSize: 12 }}>正文工作区</span>}<Button size="sm" variant="toolbar" aria-label="打开版本审阅" aria-pressed={inspectorOpen && inspectorTab === 'versions'} icon={<IconBranchOutline16 size={15} />} onClick={() => { openInspector('versions') }}>版本</Button><Button size="sm" variant="toolbar" aria-label="打开本章资料" aria-pressed={inspectorOpen && inspectorTab === 'sources'} icon={<IconDataOutline16 size={15} />} onClick={() => { openInspector('sources') }}>资料</Button></span>
    </div>
    <div style={{ minHeight: 56, flex: '0 0 56px', display: 'flex', alignItems: 'center', gap: 7, padding: '0 18px', borderBottom: `1px solid ${color.borderSoft}`, background: color.module, overflowX: 'auto' }}>
      {!readOnly && <><Button size="sm" variant="primary" style={{ flexShrink: 0, whiteSpace: 'nowrap' }} disabled={dirty || saving || Boolean(activeRun) || startingWorkflow || rewriteComposerOpen} icon={<IconPlayOutline16 size={15} />} onClick={() => { void createWorkflow() }}>{startingWorkflow ? '正在启动…' : '生成本章'}</Button>{foundationAdvisory && <span role="status" style={{ flexShrink: 0, color: color.warning, fontSize: 11 }}>{foundationAdvisory}</span>}</>}
      {selectionRewriteAvailable && <Tooltip label={selectionRewrite ? `已选中 ${formatNumber(selectionRewrite.snapshot.selectedText.length)} 个字符，点击填写改写要求` : '先在正文中选择一段文字'} delayMs={250}><Button size="sm" variant="outline" aria-label="选段改写" disabled={!selectionRewrite || rewriteBusy} icon={<IconEditOutline16 size={14} />} onMouseDown={event => { event.preventDefault() }} onClick={openSelectionRewriteComposer}>{selectionRewrite ? `已选 ${formatNumber(selectionRewrite.snapshot.selectedText.length)} 字` : '选段改写'}</Button></Tooltip>}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 7, flexShrink: 0 }}>{!visibleDraftRun && <CopyTextButton text={visibleContent} />}{!readOnly && <><Button size="sm" variant="outline" disabled={!dirty || saving || Boolean(visibleDraftRun) || rewriteComposerOpen} onClick={() => { void save('user').catch(() => {}) }}>{saving ? '保存中' : dirty ? '保存' : '已保存'}</Button>{!activeRun && <Button size="sm" variant="outline" disabled={!chapter.currentDraftVersionId || dirty || approvalBusy || chapter.currentApprovedVersionId === chapter.currentDraftVersionId || rewriteComposerOpen} onClick={() => { void approveCurrentDraft() }}>{approvalBusy ? '批准中…' : '批准本章'}</Button>}</>}</span>
    </div>
    {readOnly && <div role="status" style={{ flex: '0 0 auto', padding: '8px 18px', borderBottom: `1px solid ${color.borderSoft}`, color: color.secondary, background: color.module, fontSize: 11 }}>此项目已归档。正文、版本和本章资料可查看；恢复项目后才能编辑或生成。</div>}
    {recoveryDraft && !readOnly && <div role="status" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '9px 18px', borderBottom: `1px solid ${color.warning}`, background: color.module, fontSize: 11 }}><div style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block' }}>发现浏览器恢复草稿</strong><span style={{ color: color.secondary }}>保存于 {formatTime(recoveryDraft.savedAt)}{recoveryDraft.baseVersionId !== (current?.id ?? null) ? '；服务器版本此后可能已更新，请恢复后核对' : ''}</span></div><Button size="sm" variant="ghost" onClick={discardRecoveryDraft}>丢弃</Button><Button size="sm" variant="primary" onClick={restoreRecoveryDraft}>恢复本地草稿</Button></div>}
    {workflowBarRun && <ChapterWorkflowBar run={workflowBarRun} readOnly={readOnly} busy={workflowCommandBusy} error={activeRun ? waitingApprovalTargetError ?? workflowCommandError : null} approvalBlocked={activeRun?.status === 'waiting_approval' && !waitingApprovalReady} approvalEditing={dirty || rewriteBusy} command={workflowCommand} approveWaiting={() => { void approveWaitingDraft() }} />}
    <div style={{ position: 'relative', minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: inspectorOpen && !inspectorDrawer ? 'minmax(0,1fr) 350px' : 'minmax(0,1fr)', overflow: 'hidden' }}>
      <section aria-label={editorMode === 'review' ? '版本审阅区' : '章节编辑区'} style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {editorMode === 'review' && reviewLeftVersion && reviewRightVersion && versionDiff ? <VersionReviewSurface left={reviewLeftVersion} right={reviewRightVersion} diff={versionDiff} onReturn={() => { setEditorMode('write') }} /> : <div ref={editorShellRef} style={{ position: 'relative', minHeight: 0, flex: 1, overflow: 'hidden' }}>{visibleDraftRun ? <LiveManuscriptPreview text={visibleDraftRun.streamedText} active={visibleDraftRun.status === 'running'} telemetry={visibleDraftRun.generationTelemetry} interrupted={visibleDraftRun.status === 'failed'} fullHeight onDismiss={() => { setDismissedPreviewId(visibleDraftRun.id) }} /> : preparingFirstDraft && activeRun ? <WorkflowPreparingSurface run={activeRun} /> : <textarea ref={editorRef} aria-label="章节正文" value={content} readOnly={readOnly || saving || rewriteBusy} onChange={event => { setSelectionRewrite(null); rememberLocalEdit(event.target.value) }} onPointerUp={event => { const textarea = event.currentTarget; const point = { clientX: event.clientX, clientY: event.clientY }; window.requestAnimationFrame(() => { captureSelection(textarea, point) }) }} onKeyUp={event => { captureSelection(event.currentTarget) }} onKeyDown={event => { if (event.key === 'Escape' && !rewriteBusy) setSelectionRewrite(null) }} onScroll={() => { if (!rewriteBusy) setSelectionRewrite(null) }} onBlur={() => { window.requestAnimationFrame(() => { if (!rewriteBusy && !rewritePopoverRef.current?.contains(document.activeElement)) setSelectionRewrite(null) }) }} placeholder="开始写作…" style={{ ...editorStyle, cursor: readOnly ? 'default' : saving || rewriteBusy ? 'wait' : 'text' }} />}{selectionRewrite && selectionRewriteAvailable && <SelectionRewriteAction action={selectionRewrite} popoverRef={rewritePopoverRef} openComposer={openSelectionRewriteComposer} runQuick={runQuickSelectionRewrite} setInstruction={setSelectionRewriteInstruction} cancel={cancelSelectionRewrite} run={() => { void rewriteSelectedText() }} />}</div>}
        <div style={{ minHeight: 34, flex: '0 0 34px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '0 18px', borderTop: `1px solid ${color.borderSoft}`, color: saveError || generationActionError || selectionRewrite?.error ? color.danger : color.tertiary, fontSize: 11 }}><span role={saveError ? 'alert' : undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{readOnly ? '归档只读；不会产生新的正文版本' : editorMode === 'review' ? '这里只比较两个版本的修改；返回正文后可继续编辑' : saveError ? `保存失败：${saveError}` : selectionRewrite?.error ? `重写失败：${selectionRewrite.error}` : generationActionError ? `生成失败：${generationActionError}` : rewriteBusy ? '只重写选中的文字；正文其他内容保持不变' : visibleDraftRun ? visibleDraftRun.status === 'running' ? '正文正在实时写入；完成后会保存为草稿' : '生成中断；以上文字未进入正式正文' : dirty ? '未保存；已同步写入浏览器恢复草稿，停笔后自动保存' : chapter.currentApprovedVersionId === chapter.currentDraftVersionId && chapter.currentDraftVersionId ? '当前版本已批准' : '选中一段文字，可重写、扩写或精简'}</span><span data-novel-word-count={visibleWordCount} style={{ flexShrink: 0, color: color.tertiary, fontVariantNumeric: 'tabular-nums' }}>本章字数 {formatNumber(visibleWordCount)} · REV {chapter.revision}</span></div>
      </section>
      {inspectorOpen && <AuthorContextInspector drawer={inspectorDrawer} tab={inspectorTab} setTab={setInspectorTab} close={() => { setInspectorOpen(false) }} versions={orderedVersions} failedDraftRuns={modelRuns.filter(run => run.purpose === 'chapter-draft' && run.status === 'failed' && Boolean(run.streamedText))} currentDraftVersionId={chapter.currentDraftVersionId} currentApprovedVersionId={chapter.currentApprovedVersionId} reviewLeftVersionId={reviewLeftVersionId} reviewRightVersionId={reviewRightVersion?.id ?? null} setReviewLeftVersionId={setReviewLeftVersionId} selectVersion={selectVersion} compareVersion={compareVersion} continueEditingVersion={continueEditingVersion} canContinue={!readOnly && !dirty && !saving && !approvalBusy && !activeRun && !rewriteBusy} readOnly={readOnly} sources={generationSources} sourcesLoading={generationSourcesLoading} sourcesError={generationSourcesError} retrySources={loadGenerationSources} knowledge={knowledge} knowledgeError={knowledgeError} />}
    </div>
  </div>
}

function defaultVersionComparison(versions: ManuscriptVersion[], requestedRightId: string | null): { left: string | null; right: string | null } {
  const ordered = [...versions].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  const right = ordered.find(version => version.id === requestedRightId) ?? ordered[0] ?? null
  if (!right) return { left: null, right: null }
  const parent = ordered.find(version => version.id === right.parentVersionId)
  if (parent) return { left: parent.id, right: right.id }
  const index = ordered.findIndex(version => version.id === right.id)
  const neighbor = ordered[index + 1] ?? ordered[index - 1] ?? null
  return { left: neighbor?.id ?? null, right: right.id }
}

function AuthorContextInspector({ drawer, tab, setTab, close, versions, failedDraftRuns, currentDraftVersionId, currentApprovedVersionId, reviewLeftVersionId, reviewRightVersionId, setReviewLeftVersionId, selectVersion, compareVersion, continueEditingVersion, canContinue, readOnly, sources, sourcesLoading, sourcesError, retrySources, knowledge, knowledgeError }: { drawer: boolean; tab: AuthorInspectorTab; setTab: (tab: AuthorInspectorTab) => void; close: () => void; versions: ManuscriptVersion[]; failedDraftRuns: ModelRun[]; currentDraftVersionId: string | null; currentApprovedVersionId: string | null; reviewLeftVersionId: string | null; reviewRightVersionId: string | null; setReviewLeftVersionId: (id: string | null) => void; selectVersion: (id: string) => void; compareVersion: (id: string) => void; continueEditingVersion: (version: ManuscriptVersion) => void; canContinue: boolean; readOnly: boolean; sources: GenerationSources | null; sourcesLoading: boolean; sourcesError: string | null; retrySources: () => Promise<void>; knowledge: KnowledgeWorkspace | null; knowledgeError: string | null }) {
  const tabs: Array<{ id: AuthorInspectorTab; label: string }> = [{ id: 'versions', label: '版本' }, { id: 'sources', label: '本章资料' }, { id: 'memory', label: '记忆摘要' }]
  return <>
    {drawer && <button type="button" aria-label="关闭作者上下文检查器" onClick={close} style={{ position: 'absolute', zIndex: 7, inset: 0, border: 0, background: 'rgba(20,24,30,.28)', cursor: 'default' }} />}
    <aside role={drawer ? 'dialog' : 'complementary'} aria-modal={drawer ? true : undefined} aria-labelledby="novel-author-inspector-title" style={{ position: drawer ? 'absolute' : 'relative', zIndex: drawer ? 8 : 1, top: drawer ? 0 : undefined, right: drawer ? 0 : undefined, bottom: drawer ? 0 : undefined, width: drawer ? 'min(390px, calc(100% - 24px))' : 'auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${color.border}`, boxShadow: drawer ? '-14px 0 34px rgba(0,0,0,.14)' : undefined, background: color.layer }}>
      <header style={{ minHeight: 48, flex: '0 0 48px', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 14px', borderBottom: `1px solid ${color.borderSoft}` }}><strong id="novel-author-inspector-title" style={{ fontSize: 12 }}>作者上下文</strong><span style={{ marginLeft: 'auto' }}><Tooltip label="关闭检查器" delayMs={300}><Button size="sm" variant="toolbar" aria-label="关闭作者上下文检查器" icon={<IconCloseOutline16 size={15} />} onClick={close} /></Tooltip></span></header>
      <div role="tablist" aria-label="作者上下文类型" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, padding: 7, borderBottom: `1px solid ${color.borderSoft}`, background: color.module }}>
        {tabs.map(item => <button className="novel-inspector-tab" type="button" role="tab" id={`novel-inspector-tab-${item.id}`} aria-controls={`novel-inspector-panel-${item.id}`} aria-selected={tab === item.id} key={item.id} onClick={() => { setTab(item.id) }} style={{ minHeight: 31, border: 0, borderRadius: 6, background: tab === item.id ? color.layer : 'transparent', color: tab === item.id ? color.text : color.secondary, cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: tab === item.id ? 600 : 400 }}>{item.label}</button>)}
      </div>
      <div role="tabpanel" id={`novel-inspector-panel-${tab}`} aria-labelledby={`novel-inspector-tab-${tab}`} tabIndex={0} style={{ minHeight: 0, flex: 1, overflow: 'auto', padding: 12 }}>
        {tab === 'versions' ? <VersionInspectorPanel versions={versions} failedDraftRuns={failedDraftRuns} currentDraftVersionId={currentDraftVersionId} currentApprovedVersionId={currentApprovedVersionId} reviewLeftVersionId={reviewLeftVersionId} reviewRightVersionId={reviewRightVersionId} setReviewLeftVersionId={setReviewLeftVersionId} selectVersion={selectVersion} compareVersion={compareVersion} continueEditingVersion={continueEditingVersion} canContinue={canContinue} readOnly={readOnly} /> : tab === 'sources' ? <GenerationSourcesInspector sources={sources} loading={sourcesLoading} error={sourcesError} retry={retrySources} /> : <MemorySummaryPanel knowledge={knowledge} error={knowledgeError} />}
      </div>
    </aside>
  </>
}

function VersionInspectorPanel({ versions, failedDraftRuns, currentDraftVersionId, currentApprovedVersionId, reviewLeftVersionId, reviewRightVersionId, setReviewLeftVersionId, selectVersion, compareVersion, continueEditingVersion, canContinue, readOnly }: { versions: ManuscriptVersion[]; failedDraftRuns: ModelRun[]; currentDraftVersionId: string | null; currentApprovedVersionId: string | null; reviewLeftVersionId: string | null; reviewRightVersionId: string | null; setReviewLeftVersionId: (id: string | null) => void; selectVersion: (id: string) => void; compareVersion: (id: string) => void; continueEditingVersion: (version: ManuscriptVersion) => void; canContinue: boolean; readOnly: boolean }) {
  const selected = versions.find(version => version.id === reviewRightVersionId) ?? versions[0] ?? null
  if (!selected) return <div style={{ display: 'grid', gap: 12 }}><EmptyState icon={<IconBranchOutline16 size={21} />} title="还没有正式版本" text="保存或生成正文后，不可变版本会出现在这里。中断稿不会冒充正式版本。" /><FailedDraftAttempts runs={failedDraftRuns} /></div>
  return <div style={{ display: 'grid', gap: 12 }}>
    {versions.length > 1 && <section style={{ ...panel, padding: 12 }}><SectionHeading title="版本差异" /><div style={{ display: 'grid', gap: 9, marginTop: 11 }}><Field label="原版本"><select aria-label="差异原版本" value={reviewLeftVersionId ?? ''} onChange={event => { setReviewLeftVersionId(event.target.value || null) }} style={{ ...inputStyle, height: 34 }}>{versions.filter(version => version.id !== selected.id).map(version => <option key={version.id} value={version.id}>{versionOptionLabel(version)}</option>)}</select></Field><Field label="新版本"><select aria-label="差异新版本" value={selected.id} onChange={event => { selectVersion(event.target.value) }} style={{ ...inputStyle, height: 34 }}>{versions.map(version => <option key={version.id} value={version.id}>{versionOptionLabel(version)}</option>)}</select></Field></div><Button size="sm" variant="outline" style={{ width: '100%', marginTop: 10 }} disabled={!reviewLeftVersionId || reviewLeftVersionId === selected.id} onClick={() => { compareVersion(selected.id) }}>比较修改</Button></section>}
    <section aria-label="版本历史"><SectionHeading title="版本历史" /><div style={{ ...panel, marginTop: 8 }}>{versions.map(version => {
      const active = version.id === selected.id
      return <button className="novel-version-row" type="button" aria-pressed={active} key={version.id} onClick={() => { selectVersion(version.id) }} style={{ width: '100%', display: 'grid', gap: 5, padding: '10px 11px', border: 0, borderBottom: `1px solid ${color.borderSoft}`, background: active ? color.active : 'transparent', color: color.text, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><strong style={{ fontSize: 11 }}>{versionOptionLabel(version)}</strong>{version.id === currentDraftVersionId && <span style={versionBadgeStyle}>当前</span>}{version.id === currentApprovedVersionId && <span style={{ ...versionBadgeStyle, color: color.success }}>已批准</span>}</span><span style={{ color: color.tertiary, fontSize: 10 }}>{formatNumber(version.wordCount)} 字 · {versionOriginLabel(version.origin)} · {formatTime(version.createdAt)}</span></button>
    })}</div></section>
    <FailedDraftAttempts runs={failedDraftRuns} />
    {!readOnly && <section style={{ ...panel, padding: 12 }}><Button size="sm" variant="primary" style={{ width: '100%' }} disabled={!canContinue} onClick={() => { continueEditingVersion(selected) }}>载入此版本编辑</Button>{!canContinue && <div style={{ marginTop: 7, color: color.warning, fontSize: 10 }}>请先保存当前修改，并等待本章运行结束。</div>}</section>}
  </div>
}

function FailedDraftAttempts({ runs }: { runs: ModelRun[] }) {
  if (runs.length === 0) return null
  return <section aria-label="中断生成历史"><SectionHeading title="中断生成历史" meta={`${runs.length} 次`} /><p style={{ margin: '6px 2px 8px', color: color.secondary, fontSize: 10, lineHeight: 1.55 }}>这些内容只用于找回和复制，不是正式草稿；重新生成不会自动接在其后。</p><div style={{ ...panel }}>{runs.map((run, index) => <details key={run.id} style={{ borderBottom: `1px solid ${color.borderSoft}` }}><summary style={{ padding: '10px 11px', cursor: 'pointer', color: color.text, fontSize: 10.5 }}>第 {runs.length - index} 次中断 · {formatNumber(manuscriptWordCount(run.streamedText))} 字 · {formatTime(run.createdAt)}</summary><div style={{ padding: '0 11px 11px' }}><div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 7 }}><CopyTextButton text={run.streamedText} /></div><div style={{ maxHeight: 260, overflow: 'auto', padding: 10, border: `1px solid ${color.borderSoft}`, borderRadius: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: color.secondary, background: color.module, fontSize: 10.5, lineHeight: 1.65 }}>{run.streamedText}</div></div></details>)}</div></section>
}

function VersionReviewSurface({ left, right, diff, onReturn }: { left: ManuscriptVersion; right: ManuscriptVersion; diff: ManuscriptParagraphDiff; onReturn: () => void }) {
  return <section aria-label="版本差异审阅" style={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', background: color.module }}>
    <header style={{ minHeight: 48, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderBottom: `1px solid ${color.borderSoft}`, background: color.layer }}>
      <div style={{ minWidth: 140, flex: 1 }}><strong style={{ display: 'block', fontSize: 12 }}>版本差异</strong><span style={{ color: color.tertiary, fontSize: 10 }}>{versionOptionLabel(left)} → {versionOptionLabel(right)} · +{diff.added} / −{diff.removed}</span></div>
      <Button size="sm" variant="outline" onClick={onReturn}>返回正文</Button>
    </header>
    {diff.coarse && <div role="status" style={{ padding: '8px 16px', borderBottom: `1px solid ${color.borderSoft}`, color: color.warning, fontSize: 10 }}>改动段落较多，中间差异按完整增删块展示；正文没有被截断。</div>}
    <div style={{ minHeight: 0, flex: 1, overflow: 'auto', padding: '14px 16px 32px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', border: `1px solid ${color.border}`, borderRadius: 9, overflow: 'hidden', background: color.layer }}>
        {diff.rows.length ? diff.rows.map((row, index) => <div key={`${row.kind}:${row.leftNumber}:${row.rightNumber}:${index}`} style={{ display: 'grid', gridTemplateColumns: '36px 36px 24px minmax(0,1fr)', borderBottom: `1px solid ${color.borderSoft}`, background: row.kind === 'added' ? 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #22c55e) 9%, transparent)' : row.kind === 'removed' ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 7%, transparent)' : color.layer }}><span style={diffNumberStyle}>{row.leftNumber ?? ''}</span><span style={diffNumberStyle}>{row.rightNumber ?? ''}</span><span aria-label={row.kind === 'added' ? '新增段落' : row.kind === 'removed' ? '删除段落' : '未改段落'} style={{ paddingTop: 9, color: row.kind === 'added' ? color.success : row.kind === 'removed' ? color.danger : color.tertiary, textAlign: 'center', fontSize: 12 }}>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : '·'}</span><p style={{ margin: 0, padding: '8px 12px 9px 4px', color: row.kind === 'removed' ? color.secondary : color.text, fontFamily: 'Iowan Old Style, Songti SC, STSong, serif', fontSize: 15, lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.text}</p></div>) : <EmptyState icon={<IconCheckOutline16 size={21} />} title="两个版本没有段落差异" text="返回正文后可继续编辑。" />}
      </div>
    </div>
  </section>
}

function GenerationSourcesInspector({ sources, loading, error, retry }: { sources: GenerationSources | null; loading: boolean; error: string | null; retry: () => Promise<void> }) {
  return <div style={{ display: 'grid', gap: 12 }}>
    {error && <section role="alert" style={{ ...panel, padding: 12, borderColor: color.danger }}><strong style={{ display: 'block', color: color.danger, fontSize: 11 }}>本章资料读取失败</strong><p style={{ margin: '5px 0 9px', color: color.secondary, fontSize: 10, lineHeight: 1.55 }}>{error}</p><Button size="sm" variant="outline" disabled={loading} icon={<IconRefreshOutline16 size={13} />} onClick={() => { void retry() }}>{loading ? '正在重试…' : '重试读取资料'}</Button></section>}
    {sources && sources.status !== 'unavailable' ? <GenerationSourcesPanel sources={sources} /> : !error && loading ? <div aria-live="polite" style={{ ...panel, padding: 18, color: color.secondary, fontSize: 11 }}>正在读取本章资料记录…</div> : !error ? <EmptyState icon={<IconDataOutline16 size={21} />} title="还没有本章资料记录" text="正式启动章节生成后，这里只显示实际进入提示词或因预算未纳入的资料。" /> : null}
  </div>
}

function GenerationSourcesPanel({ sources }: { sources: GenerationSources }) {
  const usedItems = sources.items.filter(item => item.used)
  const unusedItems = sources.items.filter(item => !item.used)
  const statusText = sources.status === 'running' ? '正在读取并生成' : sources.status === 'failed' ? '生成失败，保留本次记录' : '已完成'
  return <section aria-label="本次生成使用的资料" style={{ display: 'grid', gap: 14 }}>
    <div style={{ ...panel, padding: 12 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconDataOutline16 size={15} /><span><strong style={{ display: 'block', fontSize: 11 }}>本次生成使用的资料</strong><span style={{ display: 'block', marginTop: 2, color: color.tertiary, fontSize: 10 }}>{usedItems.length} 项已使用 · {unusedItems.length} 项未纳入 · {statusText}</span></span></div>{sources.truncated && <div style={{ marginTop: 8, color: color.warning, fontSize: 10 }}>部分资料因上下文预算未纳入本次生成；下方区分实际进入提示词与未纳入的条目。</div>}</div>
    {usedItems.length ? <SourceItemList title="实际使用" items={usedItems} used /> : <div style={{ ...panel, padding: 14, color: color.tertiary, fontSize: 10 }}>正在记录本次生成实际读取的资料…</div>}
    {unusedItems.length > 0 && <SourceItemList title="未纳入" items={unusedItems} used={false} />}
  </section>
}

function SourceItemList({ title, items, used }: { title: string; items: GenerationSources['items']; used: boolean }) {
  return <section><SectionHeading title={title} meta={`${items.length} 项`} /><div style={{ ...panel, marginTop: 8 }}>{items.map(item => <div key={item.id} style={{ minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 7, padding: '9px 10px', borderBottom: `1px solid ${color.borderSoft}`, background: used ? color.layer : color.module }}><span aria-hidden="true" style={{ flex: '0 0 auto', color: used ? color.success : color.warning, fontSize: 12, lineHeight: 1.3 }}>{used ? '✓' : '—'}</span><span style={{ minWidth: 0, color: used ? color.text : color.secondary, fontSize: 10.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}><span>{item.label}</span>{item.detail && <span style={{ display: 'block', marginTop: 2, color: color.tertiary, fontSize: 9.5 }}>{item.detail}</span>}</span></div>)}</div></section>
}

function MemorySummaryPanel({ knowledge, error }: { knowledge: KnowledgeWorkspace | null; error: string | null }) {
  if (error) return <ErrorNotice message={error} />
  if (!knowledge) return <div style={{ ...panel, padding: 18, color: color.secondary, fontSize: 11 }}>正在读取已批准的长期记忆…</div>
  const summaries = knowledge.summaries.filter(summary => summary.status === 'current').sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 20)
  return <section aria-label="项目记忆摘要" style={{ display: 'grid', gap: 12 }}><div style={{ ...panel, padding: 12 }}><strong style={{ display: 'block', fontSize: 11 }}>已批准记忆</strong><p style={{ margin: '5px 0 0', color: color.secondary, fontSize: 10, lineHeight: 1.55 }}>这里显示项目当前的分层摘要，不展示完整 Prompt，也不会把草稿误当成正式事实。</p></div>{summaries.length ? summaries.map(summary => <article key={summary.id} style={{ ...panel, padding: 11 }}><div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}><strong style={{ fontSize: 11 }}>{summaryScopeLabel(summary.scope)}摘要</strong><span style={{ marginLeft: 'auto', color: color.tertiary, fontSize: 9.5 }}>{summaryRangeLabel(summary)}</span></div><p style={{ margin: '7px 0 0', color: color.secondary, fontSize: 10.5, lineHeight: 1.6 }}>{summary.compactNarrative || summary.content}</p></article>) : <EmptyState icon={<IconArchiveOutline20 size={21} />} title="还没有长期记忆" text="章节获批并完成知识刷新后，分层摘要会出现在这里。" />}</section>
}

function summaryRangeLabel(summary: KnowledgeWorkspace['summaries'][number]): string {
  if (summary.sourceStartChapter && summary.sourceEndChapter) return summary.sourceStartChapter === summary.sourceEndChapter ? `第 ${summary.sourceStartChapter} 章` : `${summary.sourceStartChapter}–${summary.sourceEndChapter} 章`
  return summary.updatedAt ? formatTime(summary.updatedAt) : '当前'
}

function versionOptionLabel(version: ManuscriptVersion): string { return `${version.status === 'approved' ? '批准' : version.status === 'superseded' ? '历史' : '草稿'} · ${formatNumber(version.wordCount)} 字` }
function versionOriginLabel(origin: ManuscriptVersion['origin']): string { return ({ user: '手动保存', autosave: '自动保存', model: 'AI 生成' } as const)[origin] }

function SelectionRewriteAction({ action, popoverRef, openComposer, runQuick, setInstruction, cancel, run }: { action: SelectionRewritePopover; popoverRef: MutableRefObject<HTMLDivElement | null>; openComposer: () => void; runQuick: (instruction: string) => void; setInstruction: (value: string) => void; cancel: () => void; run: () => void }) {
  const loading = action.status === 'loading'
  const failed = action.status === 'error'
  if (action.mode === 'trigger') {
    return <div ref={popoverRef} role="toolbar" aria-label="选区创作工具" aria-live="polite" style={{ boxSizing: 'border-box', position: 'absolute', zIndex: 6, left: action.left, top: action.top, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, width: 'min(620px, calc(100% - 16px))', padding: 7, border: `1px solid ${color.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.18)', background: color.layer, color: color.text, pointerEvents: 'auto' }}>
      {SELECTION_REWRITE_QUICK_ACTIONS.map(item => <button type="button" key={item.label} data-novel-selection-rewrite={action.status} aria-label={item.label} title={`${item.label}选中内容`} onMouseDown={event => { event.preventDefault() }} onClick={() => { runQuick(item.instruction) }} style={{ minHeight: 28, padding: '0 8px', border: `1px solid ${color.borderSoft}`, borderRadius: 7, background: color.module, color: color.text, cursor: 'pointer', font: 'inherit', fontSize: 11, whiteSpace: 'nowrap' }}>{item.label}</button>)}
      <button type="button" data-novel-selection-rewrite={action.status} aria-label="自定义要求" title="自定义要求" onMouseDown={event => { event.preventDefault() }} onClick={openComposer} style={{ minHeight: 28, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 8px', border: `1px solid ${color.brand}`, borderRadius: 7, background: color.active, color: color.text, cursor: 'pointer', font: 'inherit', fontSize: 11, whiteSpace: 'nowrap' }}><IconEditOutline16 size={12} /><span>自定义要求</span></button>
    </div>
  }
  const submitLabel = loading ? '正在重写' : failed ? '重试' : '按要求重写'
  return <div ref={popoverRef} role="dialog" aria-label="重写选中内容" aria-live="polite" data-novel-selection-rewrite={action.status} onBlur={event => { if (!loading && !event.currentTarget.contains(event.relatedTarget as Node | null)) cancel() }} style={{ boxSizing: 'border-box', position: 'absolute', zIndex: 6, left: action.left, top: action.top, transform: 'translateX(-50%)', width: 'min(360px, calc(100% - 24px))', padding: 12, border: `1px solid ${failed ? color.danger : color.border}`, borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.16)', background: color.layer, color: color.text, pointerEvents: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><strong style={{ fontSize: 12 }}>自定义编辑选区</strong><span style={{ marginLeft: 'auto', color: color.tertiary, fontSize: 10 }}>{formatNumber(action.snapshot.selectedText.length)} 字符</span></div>
    <textarea autoFocus aria-label="重写要求" placeholder="例如：写少一点，保留事实，只加强动作和紧张感" value={action.instruction} maxLength={MAX_SELECTION_REWRITE_INSTRUCTION_CHARACTERS} disabled={loading} onChange={event => { setInstruction(event.target.value) }} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); run() } else if (event.key === 'Escape' && !loading) { event.preventDefault(); cancel() } }} style={{ ...textareaStyle, minHeight: 72, marginTop: 9, resize: 'vertical' }} />
    <div style={{ minHeight: 18, marginTop: 6, color: failed ? color.danger : color.tertiary, fontSize: 10, lineHeight: 1.5 }}>{failed ? `重写失败：${action.error ?? '可以重试。'}` : '只替换蓝色选区 · ⌘/Ctrl + Enter 提交'}</div>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 8 }}><Button size="sm" variant="ghost" disabled={loading} onClick={cancel}>取消</Button><Button size="sm" variant="primary" aria-label={submitLabel} disabled={loading} icon={loading ? <StateDot state="ongoing" size={8} /> : failed ? <IconWarningOutline16 size={13} /> : <IconEditOutline16 size={13} />} onClick={run}>{submitLabel}</Button></div>
  </div>
}

function CopyTextButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<number | null>(null)
  useEffect(() => () => { if (resetTimer.current !== null) window.clearTimeout(resetTimer.current) }, [])
  const copy = async () => {
    if (!text || state === 'copied') return
    const copied = await writeClipboard(text)
    setState(copied ? 'copied' : 'failed')
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => { setState('idle') }, 1400)
  }
  const label = state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : '复制正文'
  return <Tooltip label={label} delayMs={350}><Button size="sm" variant="outline" aria-label={label} disabled={!text} icon={state === 'copied' ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />} onClick={() => { void copy() }} /></Tooltip>
}

function ChapterWorkflowBar({ run, readOnly, busy, error, approvalBlocked, approvalEditing, command, approveWaiting }: { run: WorkflowRun; readOnly: boolean; busy: boolean; error: string | null; approvalBlocked: boolean; approvalEditing: boolean; command: (action: string, body?: unknown) => Promise<boolean>; approveWaiting: () => void }) {
  const rejectedCanonCandidateCount = run.canonCandidates.filter(candidate => candidate.status === 'rejected').length
  const showCanonSkipNotice = rejectedCanonCandidateCount > 0 && !['failed', 'cancel_requested', 'cancelled'].includes(run.status)
  const lengthAdvisory = workflowLengthAdvisory(run)
  const completionAdvisory = workflowCompletionAdvisory(run)
  const postProcessingWarnings = workflowPostProcessingWarnings(run)
  const failure = workflowFailure(run)
  const revisionConflict = run.status === 'failed' && failure?.code === 'revision-conflict'
  const warningTone = revisionConflict || Boolean(completionAdvisory)
  const hardFailure = run.status === 'failed' && !warningTone
  const statusText = completionAdvisory ? '已保留可审阅正文' : revisionConflict ? '内容已更新，等待重试' : statusLabel(run.status)
  const waitingApproval = run.status === 'waiting_approval'
  const statusHeading = waitingApproval ? '等待批准' : `${statusText} · ${nodeLabel(run.currentNodeKey)}`
  return <section aria-live="polite" style={{ flex: '0 0 auto', padding: waitingApproval ? '6px 18px' : '9px 18px', borderBottom: `1px solid ${hardFailure ? color.danger : warningTone ? color.warning : color.borderSoft}`, background: hardFailure ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ef4444) 6%, transparent)' : warningTone ? 'color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 6%, transparent)' : color.layer }}>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 9, minWidth: 0 }}><StatusDot status={run.status} warning={warningTone} /><div style={{ minWidth: 120, flex: 1 }}><strong style={{ display: 'block', fontSize: 11 }}>{statusHeading}</strong>{waitingApproval && <span style={{ display: 'block', marginTop: 2, color: color.secondary, fontSize: 10 }}>{approvalEditing ? '正文有修改，保存后即可批准' : '可直接批准；也可在正文中选中片段改写'}</span>}</div>{!readOnly && <div style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0, gap: 7 }}>{run.status === 'running' && <><Button size="sm" variant="outline" disabled={busy} icon={<IconPauseOutline16 size={14} />} onClick={() => { void command('pause') }}>暂停</Button><Button size="sm" variant="ghost" disabled={busy} icon={<IconStopFill16 size={14} />} onClick={() => { void command('cancel') }}>取消</Button></>}{run.status === 'paused' && <><Button size="sm" variant="primary" disabled={busy} icon={<IconPlayOutline16 size={14} />} onClick={() => { void command('resume') }}>继续</Button><Button size="sm" variant="ghost" disabled={busy} icon={<IconStopFill16 size={14} />} onClick={() => { void command('cancel') }}>取消</Button></>}{run.status === 'failed' && <Button size="sm" variant="primary" disabled={busy} icon={<IconRefreshOutline16 size={14} />} onClick={() => { void command('retry') }}>{busy ? '正在重试…' : '重试本章'}</Button>}{waitingApproval && <Button size="sm" variant="primary" disabled={busy || approvalBlocked} icon={<IconCheckOutline16 size={14} />} onClick={approveWaiting}>{busy ? '批准中…' : approvalEditing ? '保存后批准' : '批准本章'}</Button>}</div>}</div>
    {hardFailure && <div role="alert" style={{ marginTop: 7, color: color.danger, fontSize: 10, lineHeight: 1.55 }}>本章生成暂未完成：{failure?.message ?? '模型调用没有完成。'}<span style={{ marginLeft: 6, color: color.secondary }}>原正文和已完成的前置步骤不会丢失；重试本章会从安全节点重新执行。</span></div>}
    {revisionConflict && <div role="status" style={{ marginTop: 7, color: color.warning, fontSize: 10, lineHeight: 1.55 }}>生成期间项目或章节内容已更新，旧结果没有覆盖最新内容；请基于当前内容重试本章。</div>}
    {completionAdvisory && <div role="status" style={{ marginTop: 7, color: color.warning, fontSize: 10, lineHeight: 1.55 }}>{completionAdvisory}</div>}
    {lengthAdvisory && run.status !== 'failed' && !waitingApproval && <div role="status" style={{ marginTop: 7, color: color.secondary, fontSize: 10, lineHeight: 1.55 }}>实际 {formatNumber(lengthAdvisory.actualWords)} 字 · 建议 {formatNumber(lengthAdvisory.targetWords)} 字</div>}
    {showCanonSkipNotice && <div role="status" style={{ marginTop: 7, color: color.warning, fontSize: 10, lineHeight: 1.55 }}>有 {rejectedCanonCandidateCount} 条候选故事事实因缺少可核验的正文证据已安全跳过，未写入 Canon；不会因此中断章节批准、记忆更新或后续写作。</div>}
    {postProcessingWarnings.length > 0 && run.status === 'succeeded' && <div role="status" style={{ marginTop: 7, color: color.warning, fontSize: 10, lineHeight: 1.55 }}>本章正文、Canon 与基础知识索引均已保存；{postProcessingWarnings.map(warning => `${warning.label}：${warning.message}`).join('；')}。这些属于可再生后处理，暂未完成不会把本章标为失败，也不影响后续写作。</div>}
    {error && <div role="alert" style={{ marginTop: 7, color: color.danger, fontSize: 10 }}>{error}</div>}
    {isPlaceholderReviewNode(run.currentNodeKey) && <div style={{ marginTop: 7, color: color.warning, fontSize: 10 }}>该节点只记录流程占位，不等于 AI 已完成质量审校或证明正文无矛盾。</div>}
  </section>
}

function WorkflowPreparingSurface({ run }: { run: WorkflowRun }) {
  return <div aria-live="polite" style={{ height: '100%', boxSizing: 'border-box', display: 'grid', placeItems: 'center', padding: 24, background: color.layer }}><div style={{ textAlign: 'center' }}><StateDot state="ongoing" size={9} /><strong style={{ display: 'block', marginTop: 12, fontSize: 13 }}>{nodeLabel(run.currentNodeKey)}</strong></div></div>
}

function RunRow({ run, project, onOpen }: { run: WorkflowRun; project?: Project; onOpen: () => void }) { return <button type="button" onClick={onOpen} style={runRow}><StatusDot status={run.status} warning={workflowUsesWarningTone(run)} /><span style={{ minWidth: 0, textAlign: 'left' }}><strong style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project?.title ?? '小说项目'} · 章节工作流</strong><span style={{ color: color.secondary, fontSize: 11 }}>{statusLabel(run.status)} · {nodeLabel(run.currentNodeKey)}</span></span><span style={{ marginLeft: 'auto', color: color.tertiary, fontSize: 11, whiteSpace: 'nowrap' }}>{formatTime(run.createdAt)}</span></button> }
function StatusDot({ status, warning = false }: { status: WorkflowRun['status']; warning?: boolean }) { if (status === 'cancelled') return <span aria-label="已取消" style={{ width: 9, height: 9, flex: '0 0 auto', borderRadius: '50%', background: color.tertiary }} />; return <StateDot state={warning || status === 'waiting_approval' || status === 'paused' ? 'warning' : status === 'succeeded' ? 'done' : status === 'failed' ? 'error' : 'ongoing'} size={9} /> }
function statusLabel(status: WorkflowRun['status']) { return ({ running: '正在运行', paused: '已暂停', waiting_approval: '等待审批', succeeded: '已完成', failed: '本章生成暂未完成', cancel_requested: '正在取消', cancelled: '已取消' } as const)[status] }
function nodeLabel(key: string | null) { if (!key) return '运行结束'; return ({ freeze_input_snapshot: '冻结输入快照', retrieve_context: '准备章节上下文', plan_scenes: '整理章节结构', validate_scene_plan: '检查章节结构', generate_draft: '生成章节初稿', plot_review: '剧情检查（流程占位）', character_review: '人物检查（流程占位）', timeline_review: '时间线检查（流程占位）', style_review: '文风检查（流程占位）', aggregate_review: '汇总检查（流程占位）', conditional_revision_loop: '判断是否建立返修版本', wait_chapter_approval: '等待章节审批', commit_approved_version: '批准正文版本', extract_canon_candidates: '提取故事事实', validate_canon_candidates: '验证故事事实', commit_canon: '提交故事事实', refresh_summaries_and_indexes: '完成运行' } as Record<string,string>)[key] ?? key }
function isPlaceholderReviewNode(key: string | null): boolean { return ['plot_review','character_review','timeline_review','style_review','aggregate_review'].includes(key ?? '') }
function workflowAtOrBeforeDraft(run: WorkflowRun): boolean { const draftIndex = run.definition.nodes.indexOf('generate_draft'); const currentIndex = run.currentNodeKey ? run.definition.nodes.indexOf(run.currentNodeKey) : -1; return draftIndex < 0 || currentIndex < 0 || currentIndex <= draftIndex }
function workflowFailure(run: WorkflowRun): { code: string | null; message: string } | null { if (!run.errorJson) return null; try { const parsed = JSON.parse(run.errorJson) as { code?: unknown; message?: unknown }; return { code: typeof parsed.code === 'string' ? parsed.code : null, message: typeof parsed.message === 'string' ? parsed.message : run.errorJson } } catch { return { code: null, message: run.errorJson } } }
function workflowUsesWarningTone(run: WorkflowRun): boolean { return Boolean(workflowCompletionAdvisory(run) || workflowFailure(run)?.code === 'revision-conflict') }
function workflowLengthAdvisory(run: WorkflowRun): { targetWords: number; actualWords: number } | null {
  const node = [...run.nodes].reverse().find(item => item.nodeKey === 'generate_draft' && item.status === 'succeeded' && item.outputJson)
  if (!node?.outputJson) return null
  try {
    const output = JSON.parse(node.outputJson) as { lengthAdvisory?: { targetWords?: unknown; actualWords?: unknown } | null }
    const targetWords = Number(output.lengthAdvisory?.targetWords)
    const actualWords = Number(output.lengthAdvisory?.actualWords)
    return Number.isFinite(targetWords) && targetWords > 0 && Number.isFinite(actualWords) && actualWords > 0
      ? { targetWords: Math.trunc(targetWords), actualWords: Math.trunc(actualWords) }
      : null
  } catch { return null }
}
function workflowCompletionAdvisory(run: WorkflowRun): string | null {
  const node = [...run.nodes].reverse().find(item => item.nodeKey === 'generate_draft' && item.status === 'succeeded' && item.outputJson)
  if (!node?.outputJson) return null
  try {
    const output = JSON.parse(node.outputJson) as { completionAdvisory?: unknown }
    const advisory = output.completionAdvisory
    if (!advisory) return null
    if (typeof advisory === 'object' && advisory !== null && 'active' in advisory && (advisory as { active?: unknown }).active === false) return null
    return '已保留可审阅正文；模型到达输出上限，结尾可能未完整。请检查结尾，必要时编辑后再批准。'
  } catch { return null }
}
function workflowPostProcessingWarnings(run: WorkflowRun): Array<{ label: string; message: string }> {
  const node = [...run.nodes].reverse().find(item => item.nodeKey === 'refresh_summaries_and_indexes' && item.status === 'succeeded' && item.outputJson)
  if (!node?.outputJson) return []
  try {
    const output = JSON.parse(node.outputJson) as {
      postProcessingWarnings?: Array<{ stage?: unknown; message?: unknown }>
      memoryRefreshError?: unknown
      relationshipExtractionError?: unknown
    }
    const warnings: Array<{ label: string; message: string }> = []
    for (const warning of Array.isArray(output.postProcessingWarnings) ? output.postProcessingWarnings : []) {
      if (!warning || typeof warning.message !== 'string' || !warning.message.trim()) continue
      const label = warning.stage === 'memory-summary' ? '长篇记忆摘要' : warning.stage === 'relationship-extraction' ? '实体关系候选提取' : '后处理'
      warnings.push({ label, message: postProcessingWarningMessage(warning.stage, warning.message) })
    }
    const appendLegacyWarning = (label: string, stage: string, value: unknown) => {
      if (typeof value !== 'string' || !value.trim() || warnings.some(warning => warning.label === label)) return
      warnings.push({ label, message: postProcessingWarningMessage(stage, value) })
    }
    appendLegacyWarning('长篇记忆摘要', 'memory-summary', output.memoryRefreshError)
    appendLegacyWarning('实体关系候选提取', 'relationship-extraction', output.relationshipExtractionError)
    return warnings
  } catch { return [] }
}
function postProcessingWarningMessage(stage: unknown, message: string): string {
  if (stage === 'memory-summary') return '本次未完成长篇记忆摘要，已使用批准正文生成基础回退索引，可稍后重新生成摘要'
  if (stage === 'relationship-extraction') return '本次未形成可提交的关系候选，正文与其他知识索引不受影响，可稍后重新提取'
  return message.trim().replace(/[。；;]+$/u, '')
}
function workflowHasPersistentNotice(run: WorkflowRun): boolean {
  return Boolean(workflowLengthAdvisory(run) || workflowCompletionAdvisory(run) || workflowPostProcessingWarnings(run).length > 0 || run.canonCandidates.some(candidate => candidate.status === 'rejected'))
}
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
async function startWorkflow(chapterId: string, refresh: (quiet?: boolean) => Promise<void>) { await api(`/chapters/${encodeURIComponent(chapterId)}/workflows`, { method: 'POST', body: '{}' }); await refresh(true) }

function TreeNav({ icon, label, active, disabled, badge, onClick }: { icon: ReactNode; label: string; active?: boolean; disabled?: boolean; badge?: number; onClick?: () => void }) { return <button className="novel-tree-nav" type="button" aria-current={active ? 'page' : undefined} disabled={disabled} onClick={onClick} style={{ ...treeNav, background: active ? color.active : 'transparent', opacity: disabled ? .5 : 1 }}>{icon}<span>{label}</span>{badge ? <span style={badgeStyle}>{badge}</span> : null}</button> }
function SectionHeading({ title, meta }: { title: string; meta?: string }) { return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h2>{meta && <span style={{ color: color.tertiary, fontSize: 11 }}>{meta}</span>}</div> }
function MiniStat({ value, label }: { value: number; label: string }) { return <div style={{ textAlign: 'left' }}><strong style={{ display: 'block', fontSize: 16 }}>{value}</strong><span style={{ color: color.tertiary, fontSize: 10 }}>{label}</span></div> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: 'grid', gap: 6, color: color.secondary, fontSize: 11 }}>{label}{children}</label> }
function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div style={{ display: 'grid', placeItems: 'center', padding: '54px 24px', textAlign: 'center', color: color.secondary }}><span style={{ color: color.tertiary }}>{icon}</span><strong style={{ marginTop: 12, color: color.text, fontSize: 13 }}>{title}</strong><p style={{ maxWidth: 320, margin: '6px 0 14px', fontSize: 12, lineHeight: 1.6 }}>{text}</p>{action}</div> }
function ErrorNotice({ message }: { message: string }) { return <div role="alert" style={{ margin: 12, padding: '9px 12px', border: `1px solid ${color.danger}`, borderRadius: 7, color: color.danger, fontSize: 12 }}><IconWarningOutline16 size={14} /> {message}</div> }

const topBar: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 8px', borderBottom: `1px solid ${color.border}`, background: color.layer }
const centered: CSSProperties = { display: 'grid', placeItems: 'center', color: color.secondary }
const panel: CSSProperties = { border: `1px solid ${color.border}`, borderRadius: 9, background: color.layer, overflow: 'hidden' }
const pageTitle: CSSProperties = { margin: 0, fontSize: 23, lineHeight: 1.25, fontWeight: 600, letterSpacing: '-.02em' }
const pageSubtitle: CSSProperties = { margin: '7px 0 0', color: color.secondary, fontSize: 13, lineHeight: 1.6 }
const sectionLabel: CSSProperties = { color: color.tertiary, fontSize: 10, fontWeight: 600, letterSpacing: '.04em' }
const folderTile: CSSProperties = { width: 35, height: 35, borderRadius: 8, display: 'grid', placeItems: 'center', background: color.module, color: color.secondary }
const sidePanel: CSSProperties = { minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${color.border}`, background: color.module }
const mobileDrawerLeft: CSSProperties = { position: 'absolute', zIndex: 12, inset: 0, right: 54, boxShadow: '12px 0 32px rgba(0,0,0,.14)' }
const sideHeader: CSSProperties = { height: 46, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', borderBottom: `1px solid ${color.borderSoft}`, fontSize: 12 }
const treeNav: CSSProperties = { width: '100%', minHeight: 34, display: 'grid', gridTemplateColumns: '20px minmax(0,1fr) auto', alignItems: 'center', gap: 6, padding: '0 8px', border: 0, borderRadius: 6, background: 'transparent', color: color.text, cursor: 'pointer', textAlign: 'left', fontSize: 12 }
const treeGroup: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minHeight: 30, padding: '0 8px', color: color.secondary, fontSize: 11, fontWeight: 600 }
const treeRow: CSSProperties = { width: '100%', minHeight: 33, display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) 10px', alignItems: 'center', gap: 5, padding: '0 8px 0 30px', border: 0, borderRadius: 6, color: color.text, cursor: 'pointer', textAlign: 'left', fontSize: 12 }
const badgeStyle: CSSProperties = { minWidth: 17, height: 17, display: 'grid', placeItems: 'center', borderRadius: 9, background: color.active, color: color.secondary, fontSize: 10 }
const librarySegmentButton: CSSProperties = { minHeight: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 11, whiteSpace: 'nowrap' }
const libraryCountBadge: CSSProperties = { minWidth: 17, height: 17, display: 'inline-grid', placeItems: 'center', padding: '0 3px', borderRadius: 9, background: color.module, color: color.secondary, fontSize: 9, fontVariantNumeric: 'tabular-nums' }
const versionBadgeStyle: CSSProperties = { padding: '1px 5px', borderRadius: 5, background: color.module, color: color.brand, fontSize: 9, fontWeight: 600 }
const diffNumberStyle: CSSProperties = { padding: '9px 5px 0', borderRight: `1px solid ${color.borderSoft}`, color: color.tertiary, textAlign: 'right', fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: 9, fontVariantNumeric: 'tabular-nums' }
const runRow: CSSProperties = { width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: '12px minmax(0,1fr) auto', alignItems: 'center', gap: 9, padding: '9px 12px', border: 0, borderBottom: `1px solid ${color.borderSoft}`, background: 'transparent', color: color.text, cursor: 'pointer' }
const inputStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', height: 36, border: `1px solid ${color.border}`, borderRadius: 7, padding: '0 10px', background: color.bg, color: color.text, font: 'inherit', fontSize: 12 }
const textareaStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', resize: 'vertical', border: `1px solid ${color.border}`, borderRadius: 7, padding: 9, background: color.bg, color: color.text, font: 'inherit', fontSize: 12, lineHeight: 1.5 }
const editorStyle: CSSProperties = { boxSizing: 'border-box', width: '100%', height: '100%', resize: 'none', border: 0, padding: 'clamp(34px,7vh,74px) clamp(24px,9vw,110px)', background: color.layer, color: color.text, fontFamily: 'Iowan Old Style, Songti SC, STSong, serif', fontSize: 17, lineHeight: 1.9 }
const plainNavButton: CSSProperties = { minHeight: 36, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-primary, #24262b)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }

const STUDIO_SCOPED_CSS = `
[data-novel-studio] :is(button,input,select,textarea,[tabindex]):focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6) !important;
  outline-offset: 2px;
}
[data-novel-studio] :is(.novel-tree-nav,.novel-version-row,.novel-inspector-tab) {
  transition: background-color 160ms ease, color 160ms ease;
}
[data-novel-studio] :is(.novel-tree-nav,.novel-version-row,.novel-inspector-tab):hover:not(:disabled) {
  background: var(--dsw-specific-sidebar-nav-item-hover, #f1f3f5) !important;
}
@media (prefers-reduced-motion: reduce) {
  [data-novel-studio] :is(.novel-tree-nav,.novel-version-row,.novel-inspector-tab) { transition: none; }
}`

export const inject = ['slots', 'workspaces']
export function apply(ctx: ClientContext): void {
  let openStudio: ((sessionId?: string) => void) | undefined; let closeStudio: (() => void) | undefined
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.footer.action', id: 'novel-studio', order: -20, inject: () => ({ openStudio: (sessionId?: string) => { openStudio?.(sessionId) } }) }, SidebarEntry), 'novel-studio: sidebar entry')
  ctx.effect(() => ctx.slots.register({ name: 'shell.overlay', id: 'novel-studio', order: 20, inject: () => { const state: { open: boolean; sessionId?: string } = { open: false }; const listeners = new Set<() => void>(); const notify = () => { for (const listener of listeners) listener() }; openStudio = sessionId => { state.open = true; state.sessionId = sessionId; notify() }; closeStudio = () => { state.open = false; notify() }; function Gate(props: OverlayProps) { const [, render] = useState(0); useEffect(() => { const listener = () => { render(value => value + 1) }; listeners.add(listener); return () => { listeners.delete(listener) } }, []); return state.open ? <StudioOverlay {...props} sessionId={state.sessionId} workspaces={ctx.workspaces} closeStudio={() => { closeStudio?.() }} /> : null } return { Gate } } }, ({ Gate, ...props }: OverlayProps & { Gate: (props: OverlayProps) => JSX.Element | null }) => <Gate {...props} />), 'novel-studio: workspace overlay')
}
