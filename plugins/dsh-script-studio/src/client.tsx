import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { HOST_CONTRACT_VERSION, type HostCapabilities, type HostResponseEnvelope } from '@script-studio/contracts/host'
import type { GetProjectHierarchyResponse } from '@script-studio/contracts/dto'
import { DEV_HOST as HOST, DEV_ACTOR as ACTOR, DEV_PROJECT_ID as PROJECT_ID } from './dsh-adapter/dev-fixture.js'
import { zhCN as t } from './dsh-adapter/locale.js'
import { HOST_ROUTE } from './dsh-adapter/routes.js'

type FooterProps = PropsRuntime<'sidebar.footer.action'>
type OverlayProps = PropsRuntime<'shell.overlay'>

function SidebarEntry({ wide, openStudio }: FooterProps & { openStudio: (trigger: HTMLButtonElement) => void }): ReactNode {
  return <button
    type="button"
    aria-label={t.entry}
    title={t.entry}
    onClick={event => openStudio(event.currentTarget)}
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
    {wide && <span>{t.entry}</span>}
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
  if (body.contractVersion?.split('.')[0] !== HOST_CONTRACT_VERSION.split('.')[0]) throw new Error('Unsupported contract version.')
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

function CapabilityBadge({ label, enabled }: { label: string; enabled: boolean | undefined }): ReactNode {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: enabled ? '#236b45' : '#73777f', fontSize: 11 }}>
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: enabled ? '#46a56f' : '#b6bbc3' }} />
    {label} · {enabled === undefined ? t.unknown : enabled ? t.enabled : t.disabled}
  </span>
}

function StudioOverlay({ closeStudio }: OverlayProps & { closeStudio: () => void }): ReactNode {
  const [hierarchy, setHierarchy] = useState<GetProjectHierarchyResponse | null>(null)
  const [title, setTitle] = useState(t.season(2))
  const [episodeTitle, setEpisodeTitle] = useState(t.firstEpisode)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [capabilities, setCapabilities] = useState<HostCapabilities | null>(null)
  const requestGeneration = useRef(0)
  const pendingWrite = useRef(false)
  const mounted = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const [error, setError] = useState<string | null>(null)

  const loadHierarchy = async () => {
    const generation = ++requestGeneration.current
    setLoading(true)
    setError(null)
    setHierarchy(null)
    setCapabilities(null)
    try {
      const negotiated = await invoke({ requestId: `dsh-ui-capabilities-${Date.now()}`, operation: 'capabilities' })
      if (!negotiated.ok) return responseError(negotiated)
      if (negotiated.result.operation !== 'capabilities') throw new Error('Unexpected operation.')
      const received = negotiated.result.capabilities
      if (!received || typeof received !== 'object') throw new Error('Invalid capabilities.')
      const available = Object.fromEntries(Object.keys(t.capabilities).map(key => [key, received[key as keyof HostCapabilities] === true])) as unknown as HostCapabilities
      let loaded: GetProjectHierarchyResponse | null = null
      if (available.hierarchyRead === true) {
        loaded = hierarchyFrom(await invoke({ requestId: `dsh-ui-read-${Date.now()}`, operation: 'get-project-hierarchy', actor: ACTOR, payload: { projectId: PROJECT_ID } }))
      }
      if (generation !== requestGeneration.current) return
      setCapabilities(available)
      setHierarchy(loaded)
    } catch {
      if (generation === requestGeneration.current) setError(t.error)
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    void loadHierarchy()
    return () => { mounted.current = false; requestGeneration.current++ }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        closeStudio()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [closeStudio])

  const createSeason = async () => {
    if (pendingWrite.current || loading || error || capabilities?.commandCreateSeason !== true || !hierarchy || !title.trim() || !episodeTitle.trim()) return
    pendingWrite.current = true
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
      if (!mounted.current) return
      if (response.result.operation !== 'create-season') throw new Error('Unexpected operation.')
      await loadHierarchy()
      setTitle(t.season(hierarchy.seasons.length + 2))
      setEpisodeTitle(t.firstEpisode)
    } catch {
      if (mounted.current) setError(t.error)
    } finally {
      pendingWrite.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <div style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }}>
    <section role="dialog" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={loading || busy} style={{ position: 'absolute', insetBlock: 0, right: 0, boxSizing: 'border-box', width: 'min(440px, 100%)', overflow: 'auto', overflowWrap: 'anywhere', pointerEvents: 'auto', background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #24262b)', boxShadow: '-4px 0 24px rgba(0, 0, 0, .14)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '20px 22px 14px', borderBottom: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)' }}>
        <div>
          <h1 id={titleId} style={{ margin: 0, fontSize: 18 }}>{t.title}</h1>
          <p id={descriptionId} style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary, #73777f)', fontSize: 12 }}>{t.description}</p>
        </div>
        <button type="button" aria-label={t.close} onClick={closeStudio} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
      </header>
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '12px 22px', background: 'var(--dsw-alias-bg-layer-1, #f7f8fa)' }}>
        {(Object.keys(t.capabilities) as (keyof HostCapabilities)[]).map(key => <CapabilityBadge key={key} label={t.capabilities[key]} enabled={capabilities?.[key]} />)}
      </section>
      <section style={{ padding: 22 }}>
        <p role="status">{busy ? t.busy : loading ? t.loading : error ? null : t.ready}</p>
        {!loading && !error && capabilities?.hierarchyRead !== true && <p>{t.unavailable}</p>}
        {error && <div role="alert" style={{ marginBottom: 14, padding: 10, borderRadius: 7, background: '#fff2f0', color: '#a2382d', fontSize: 12 }}>{error} <button type="button" disabled={loading || busy} onClick={() => { void loadHierarchy() }}>{t.retry}</button></div>}
        {hierarchy && <>
          <div style={{ display: 'grid', gap: 5, marginBottom: 20, fontSize: 13 }}>
            <strong>{hierarchy.project.title}</strong>
            <span style={{ color: 'var(--dsw-alias-label-secondary, #73777f)', fontSize: 12 }}>{hierarchy.team.name} / {hierarchy.ip.name} · {hierarchy.project.medium === 'episodic' ? t.episodic : t.film} · {t.revision} {hierarchy.project.revision}</span>
          </div>
          <div style={{ display: 'grid', gap: 9 }}>
            {hierarchy.seasons.map(season => <div key={season.id} style={{ padding: 12, border: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)', borderRadius: 8 }}>
              <strong style={{ fontSize: 13 }}>{t.seasonLabel(season.position, season.title)}</strong>
              <div style={{ marginTop: 6, color: 'var(--dsw-alias-label-secondary, #73777f)', fontSize: 12 }}>{hierarchy.episodes.filter(episode => episode.seasonId === season.id).map(episode => t.episodeLabel(episode.position, episode.title)).join('；') || t.noEpisodes}</div>
            </div>)}
          </div>
          {capabilities?.commandCreateSeason === true ? <form onSubmit={event => { event.preventDefault(); void createSeason() }} style={{ display: 'grid', gap: 9, marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)' }}>
            <strong style={{ fontSize: 13 }}>{t.createHeading}</strong>
            <label style={{ display: 'grid', gap: 5, fontSize: 11 }}>{t.seasonTitle}<input disabled={busy || loading} value={title} onChange={event => setTitle(event.target.value)} style={{ minHeight: 32, padding: '0 8px', border: '1px solid #d8dce2', borderRadius: 6, font: 'inherit' }} /></label>
            <label style={{ display: 'grid', gap: 5, fontSize: 11 }}>{t.episodeTitle}<input disabled={busy || loading} value={episodeTitle} onChange={event => setEpisodeTitle(event.target.value)} style={{ minHeight: 32, padding: '0 8px', border: '1px solid #d8dce2', borderRadius: 6, font: 'inherit' }} /></label>
            <button type="submit" disabled={busy || loading || !!error || !title.trim() || !episodeTitle.trim()} style={{ justifySelf: 'start', minHeight: 34, padding: '0 13px', border: 0, borderRadius: 6, background: '#356dcc', color: '#fff', cursor: busy ? 'wait' : 'pointer', font: 'inherit', fontSize: 12 }}>{busy ? t.busy : t.create}</button>
          </form> : <p>{t.capabilities.commandCreateSeason}：{t.unavailable}</p>}
        </>}
      </section>
      <footer style={{ padding: '12px 22px 16px', borderTop: '1px solid var(--dsw-alias-border-secondary, #e4e7eb)', color: 'var(--dsw-alias-label-tertiary, #969ba4)', fontSize: 11 }}>{t.footer}</footer>
    </section>
  </div>
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  let trigger: HTMLButtonElement | undefined
  const state = { open: false }
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) listener() }
  const openStudio = (button: HTMLButtonElement) => { trigger = button; state.open = true; notify() }
  const closeStudio = () => {
    state.open = false
    notify()
    if (trigger?.isConnected) trigger.focus()
  }
  function Gate(props: OverlayProps): ReactNode {
    const [, render] = useState(0)
    useEffect(() => {
      const listener = () => { render(value => value + 1) }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }, [])
    return state.open ? <StudioOverlay {...props} closeStudio={closeStudio} /> : null
  }
  ctx.effect(() => ctx.slots.register({ name: 'sidebar.footer.action', id: 'script-studio', order: -20, inject: () => ({ openStudio }) }, SidebarEntry), 'script-studio: sidebar entry')
  ctx.effect(() => ctx.slots.register({ name: 'shell.overlay', id: 'script-studio', order: 20, inject: () => ({}) }, Gate), 'script-studio: workspace overlay')
}
