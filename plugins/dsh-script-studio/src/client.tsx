import { useEffect, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { HOST_CONTRACT_VERSION, type HostResponseEnvelope } from '@script-studio/contracts/host'
import type { GetProjectHierarchyResponse } from '@script-studio/contracts/dto'
import { HOST_ROUTE } from './dsh-adapter/routes.js'

type FooterProps = PropsRuntime<'sidebar.footer.action'>
type OverlayProps = PropsRuntime<'shell.overlay'>

const HOST = {
  kind: 'dsh' as const,
  name: 'DeepSeek Harness',
  hostVersion: '0.1.0-rc.7',
  hostInstanceId: 'dsh-client',
  adapterVersion: '0.1.0',
}
const ACTOR = { teamId: 'team-1', memberId: 'member-writer', role: 'writer' as const }
const PROJECT_ID = 'project-1'

function SidebarEntry({ wide, openStudio }: FooterProps & { openStudio: () => void }): ReactNode {
  return <button
    type="button"
    aria-label="打开剧本工作室"
    title="剧本工作室"
    onClick={openStudio}
    style={{
      width: '100%',
      minHeight: 36,
      display: 'flex',
      alignItems: 'center',
      justifyContent: wide ? 'flex-start' : 'center',
      gap: 8,
      padding: wide ? '8px 10px' : 8,
      border: 0,
      borderRadius: 6,
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #24262b)',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: 12,
    }}
  >
    <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>▤</span>
    {wide && <span>剧本工作室</span>}
  </button>
}

function requestEnvelope(invocation: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ contractVersion: HOST_CONTRACT_VERSION, host: HOST, invocation }),
  }
}

async function invoke(invocation: Record<string, unknown>): Promise<HostResponseEnvelope> {
  const response = await fetch(HOST_ROUTE, requestEnvelope(invocation))
  const body = await response.json() as HostResponseEnvelope
  if (!response.ok && body.ok) throw new Error(`Host request failed with HTTP ${response.status}.`)
  return body
}

function responseError(response: HostResponseEnvelope): never {
  if (response.ok) throw new Error('Expected a failed Host response.')
  throw new Error(`${response.error.code}: ${response.error.message}`)
}

function hierarchyFrom(response: HostResponseEnvelope): GetProjectHierarchyResponse {
  if (!response.ok) return responseError(response)
  if (response.result.operation !== 'get-project-hierarchy') throw new Error('Host returned an unexpected operation.')
  return response.result.hierarchy
}

function CapabilityBadge({ label, enabled }: { label: string; enabled: boolean }): ReactNode {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: enabled ? '#236b45' : '#73777f', fontSize: 11 }}>
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: enabled ? '#46a56f' : '#b6bbc3' }} />
    {label}
  </span>
}

function StudioOverlay({ closeStudio }: OverlayProps & { closeStudio: () => void }): ReactNode {
  const [hierarchy, setHierarchy] = useState<GetProjectHierarchyResponse | null>(null)
  const [title, setTitle] = useState('第二季')
  const [episodeTitle, setEpisodeTitle] = useState('第一集')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHierarchy = async () => {
    setLoading(true)
    try {
      const response = await invoke({ requestId: `dsh-ui-read-${Date.now()}`, operation: 'get-project-hierarchy', actor: ACTOR, payload: { projectId: PROJECT_ID } })
      setHierarchy(hierarchyFrom(response))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadHierarchy() }, [])

  const createSeason = async () => {
    if (!hierarchy || !title.trim() || !episodeTitle.trim()) return
    setBusy(true)
    try {
      const key = `dsh-ui-season-${hierarchy.seasons.length + 1}`
      const response = await invoke({
        requestId: `dsh-ui-create-${Date.now()}`,
        operation: 'create-season',
        actor: ACTOR,
        payload: {
          projectId: PROJECT_ID,
          seasonId: `season-${hierarchy.seasons.length + 1}`,
          title,
          firstEpisodeId: `episode-${hierarchy.episodes.length + 1}`,
          firstEpisodeTitle: episodeTitle,
          expectedProjectRevision: hierarchy.project.revision,
          idempotencyKey: key,
          requestHash: key,
        },
      })
      if (!response.ok) return responseError(response)
      await loadHierarchy()
      setTitle(`第${hierarchy.seasons.length + 2}季`)
      setEpisodeTitle('第一集')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <div role="dialog" aria-modal="true" aria-label="剧本工作室" style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(15, 18, 24, .42)' }}>
    <main style={{ boxSizing: 'border-box', width: 'min(680px, 100%)', maxHeight: 'min(760px, 100%)', overflow: 'auto', borderRadius: 12, background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #24262b)', boxShadow: '0 18px 70px rgba(0, 0, 0, .22)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '20px 22px 14px', borderBottom: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>剧本工作室</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary, #73777f)', fontSize: 12 }}>Stage 2 本地开发宿主组合面板</p>
        </div>
        <button type="button" aria-label="关闭剧本工作室" onClick={closeStudio} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
      </header>
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '12px 22px', background: 'var(--dsw-alias-bg-layer-1, #f7f8fa)' }}>
        <CapabilityBadge label="层级读取" enabled />
        <CapabilityBadge label="创建 Season" enabled />
        <CapabilityBadge label="云端协作" enabled={false} />
        <CapabilityBadge label="实时事件流" enabled={false} />
      </section>
      <section style={{ padding: 22 }}>
        {loading && <p aria-live="polite">正在读取项目层级…</p>}
        {error && <div role="alert" style={{ marginBottom: 14, padding: 10, borderRadius: 7, background: '#fff2f0', color: '#a2382d', fontSize: 12 }}>{error}</div>}
        {hierarchy && <>
          <div style={{ display: 'grid', gap: 5, marginBottom: 20, fontSize: 13 }}>
            <strong>{hierarchy.project.title}</strong>
            <span style={{ color: 'var(--dsw-alias-label-secondary, #73777f)', fontSize: 12 }}>{hierarchy.team.name} / {hierarchy.ip.name} · {hierarchy.project.medium === 'episodic' ? '剧集' : '电影'} · revision {hierarchy.project.revision}</span>
          </div>
          <div style={{ display: 'grid', gap: 9 }}>
            {hierarchy.seasons.map(season => <div key={season.id} style={{ padding: 12, border: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)', borderRadius: 8 }}>
              <strong style={{ fontSize: 13 }}>S{season.position} · {season.title}</strong>
              <div style={{ marginTop: 6, color: 'var(--dsw-alias-label-secondary, #73777f)', fontSize: 12 }}>{hierarchy.episodes.filter(episode => episode.seasonId === season.id).map(episode => `E${episode.position} · ${episode.title}`).join('；') || '暂无 Episode'}</div>
            </div>)}
          </div>
          <form onSubmit={event => { event.preventDefault(); void createSeason() }} style={{ display: 'grid', gap: 9, marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)' }}>
            <strong style={{ fontSize: 13 }}>创建下一季（本地开发 API）</strong>
            <label style={{ display: 'grid', gap: 5, fontSize: 11 }}>Season 标题<input value={title} onChange={event => setTitle(event.target.value)} style={{ minHeight: 32, padding: '0 8px', border: '1px solid #d8dce2', borderRadius: 6, font: 'inherit' }} /></label>
            <label style={{ display: 'grid', gap: 5, fontSize: 11 }}>第一集标题<input value={episodeTitle} onChange={event => setEpisodeTitle(event.target.value)} style={{ minHeight: 32, padding: '0 8px', border: '1px solid #d8dce2', borderRadius: 6, font: 'inherit' }} /></label>
            <button type="submit" disabled={busy || loading} style={{ justifySelf: 'start', minHeight: 34, padding: '0 13px', border: 0, borderRadius: 6, background: '#356dcc', color: '#fff', cursor: busy ? 'wait' : 'pointer', font: 'inherit', fontSize: 12 }}>{busy ? '正在创建…' : '创建 Season 与第一集'}</button>
          </form>
        </>}
      </section>
      <footer style={{ padding: '12px 22px 16px', borderTop: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)', color: 'var(--dsw-alias-label-tertiary, #969ba4)', fontSize: 11 }}>仅用于 Stage 2 本地组合验证；当前不声明云端权限、Canon 推进或生产数据能力。</footer>
    </main>
  </div>
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  let openStudio: (() => void) | undefined
  let closeStudio: (() => void) | undefined
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.footer.action', id: 'script-studio', order: -20, inject: () => ({ openStudio: () => { openStudio?.() } }) }, SidebarEntry), 'script-studio: sidebar entry')
  ctx.effect(() => ctx.slots.register({
    name: 'shell.overlay',
    id: 'script-studio',
    order: 20,
    inject: () => {
      const state = { open: false }
      const listeners = new Set<() => void>()
      const notify = () => { for (const listener of listeners) listener() }
      openStudio = () => { state.open = true; notify() }
      closeStudio = () => { state.open = false; notify() }
      function Gate(props: OverlayProps): ReactNode {
        const [, render] = useState(0)
        useEffect(() => { const listener = () => { render(value => value + 1) }; listeners.add(listener); return () => { listeners.delete(listener) } }, [])
        return state.open ? <StudioOverlay {...props} closeStudio={() => { closeStudio?.() }} /> : null
      }
      return { Gate }
    },
  }, ({ Gate, ...props }: OverlayProps & { Gate: (props: OverlayProps) => ReactNode }) => <Gate {...props} />), 'script-studio: workspace overlay')
}
