// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createStage2DevHostFixture } from '@script-studio/application'
import type { HostRequestEnvelope, HostResponseEnvelope } from '@script-studio/contracts/host'
import { apply } from '../src/client.js'
import { zhCN as t } from '../src/dsh-adapter/locale.js'

interface Slot { name: string; inject: () => object; component: ComponentType<any> }
let root: Root
let container: HTMLDivElement
let fixture: ReturnType<typeof createStage2DevHostFixture>
let slots: Slot[]
let disposers: (() => void)[]
let fetchMock: ReturnType<typeof vi.fn>
let responseTransform: (body: HostResponseEnvelope) => HostResponseEnvelope

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fixture = createStage2DevHostFixture()
  responseTransform = body => body
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = responseTransform(await fixture.api.handle(JSON.parse(String(init.body)) as HostRequestEnvelope))
    return { ok: body.ok, json: async () => body }
  })
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  slots = []
  disposers = []
  apply({
    effect: (register: () => () => void) => { disposers.push(register()) },
    slots: { register: (definition: Omit<Slot, 'component'>, component: ComponentType<any>) => {
      const slot = { ...definition, component }
      slots.push(slot)
      return () => { slots.splice(slots.indexOf(slot), 1) }
    } },
  } as unknown as ClientContext)
  await act(async () => {
    root.render(<><button data-host="true">Host action</button>{slots.map(slot => createElement(slot.component, { ...slot.inject(), wide: true, key: slot.name }))}</>)
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  for (const dispose of disposers) dispose()
  container.remove()
  vi.unstubAllGlobals()
})

function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)
  if (!result) throw new Error(`Missing button: ${label}`)
  return result
}
async function open() { await act(async () => { button(t.entry).click() }) }
function dialog() { return container.querySelector<HTMLElement>('[role="dialog"]')! }

describe('DSH non-modal development drawer', () => {
  it('uses only the declared slots, click-through background and named non-modal dialog', async () => {
    expect(slots.map(slot => slot.name)).toEqual(['sidebar.footer.action', 'shell.overlay'])
    await open()
    expect(dialog().getAttribute('aria-modal')).toBeNull()
    expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)?.textContent).toBe(t.title)
    expect(document.getElementById(dialog().getAttribute('aria-describedby')!)?.textContent).toBe(t.description)
    expect(dialog().parentElement!.style.pointerEvents).toBe('none')
    expect(dialog().parentElement!.style.background).toBe('')
    expect(dialog().style.pointerEvents).toBe('auto')
    expect(dialog().style.right).toBe('0px')
    const host = button('Host action')
    host.focus()
    expect(document.activeElement).toBe(host)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    host.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    expect(host.closest('[inert], [aria-hidden="true"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes with Escape and the close button, restores the trigger, and can reopen', async () => {
    await open()
    button(t.close).focus()
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(button(t.entry))
    await open()
    await act(async () => { button(t.close).click() })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(button(t.entry))
  })

  it('reports loading, then ready after capabilities and hierarchy resolve', async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    fetchMock.mockImplementationOnce(async () => {
      await waiting
      return { ok: true, json: async () => fixture.api.handle({ contractVersion: '1.0.0', host: { kind: 'dsh', name: 'test', hostVersion: '1', hostInstanceId: 'test', adapterVersion: '1' }, invocation: { requestId: 'loading', operation: 'capabilities' } }) }
    })
    await open()
    expect(dialog().getAttribute('aria-busy')).toBe('true')
    expect(container.textContent).toContain(t.loading)
    expect(container.querySelector('form')).toBeNull()
    await act(async () => { release(); await waiting })
    expect(dialog().getAttribute('aria-busy')).toBe('false')
    expect(container.textContent).toContain(t.ready)
    expect(container.textContent).toContain('层级读取 · 可用')
    expect(container.textContent).toContain('认证会话 · 不可用')
  })

  it('retries failures without exposing server messages', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private server detail'))
    await open()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t.error)
    expect(container.textContent).not.toContain('private server detail')
    await act(async () => { button(t.retry).click() })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('form')).not.toBeNull()
  })

  it('degrades capability badges and skips unsupported reads and commands', async () => {
    responseTransform = body => body.ok && body.result.operation === 'capabilities'
      ? { ...body, result: { ...body.result, capabilities: { ...body.result.capabilities, hierarchyRead: false, commandCreateSeason: false } } }
      : body
    await open()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('层级读取 · 不可用')
    expect(container.textContent).toContain(t.unavailable)
    expect(container.querySelector('form')).toBeNull()
  })

  it('keeps reads available while hiding an unsupported command', async () => {
    responseTransform = body => body.ok && body.result.operation === 'capabilities'
      ? { ...body, result: { ...body.result, capabilities: { ...body.result.capabilities, commandCreateSeason: false } } }
      : body
    await open()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('潮汐尽头')
    expect(container.querySelector('form')).toBeNull()
  })

  it('blocks duplicate submissions while busy and refreshes the hierarchy after writing', async () => {
    await open()
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      await waiting
      const body = await fixture.api.handle(JSON.parse(String(init.body)) as HostRequestEnvelope)
      return { ok: body.ok, json: async () => body }
    })
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(button(t.busy).disabled).toBe(true)
    expect(dialog().getAttribute('aria-busy')).toBe('true')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await act(async () => { release(); await waiting })
    expect(container.textContent).toContain('S2')
    expect(dialog().getAttribute('aria-busy')).toBe('false')
  })

  it('fails closed on a different contract major', async () => {
    responseTransform = body => ({ ...body, contractVersion: '2.0.0' as '1.0.0' })
    await open()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('form')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('unregisters both slots on disposal without mutating the shared fixture', async () => {
    await open()
    await act(async () => { root.render(null) })
    for (const dispose of disposers.splice(0)) dispose()
    expect(slots).toEqual([])
    expect(container.children).toHaveLength(0)
    const response = await fixture.api.handle({ contractVersion: '1.0.0', host: { kind: 'dsh', name: 'test', hostVersion: '1', hostInstanceId: 'test', adapterVersion: '1' }, invocation: { requestId: 'after-uninstall', operation: 'get-project-hierarchy', actor: fixture.actor, payload: { projectId: fixture.projectId } } })
    expect(response.ok).toBe(true)
  })
})
