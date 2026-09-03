import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

async function startServer() {
  const child = spawn(process.execPath, [resolve(root, 'mcp/server.mjs'), '--stdio'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  const responses = new Map<string | number, Record<string, unknown>>()
  const waiters = new Map<string | number, (value: Record<string, unknown>) => void>()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const response = JSON.parse(line) as { id?: string | number; [key: string]: unknown }
      if (response.id === undefined) continue
      const waiter = waiters.get(response.id)
      if (waiter) { waiters.delete(response.id); waiter(response) }
      else responses.set(response.id, response)
    }
  })
  const request = (id: string, method: string, params?: Record<string, unknown>) => new Promise<Record<string, unknown>>(resolvePromise => {
    const existing = responses.get(id)
    if (existing) { responses.delete(id); resolvePromise(existing); return }
    waiters.set(id, resolvePromise)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
  })
  return { child, request }
}

describe('Codex MCP stdio server', () => {
  it('negotiates, lists tools, executes a read, and preserves command errors', async () => {
    const server = await startServer()
    try {
      expect(await server.request('initialize', 'initialize')).toMatchObject({ result: { capabilities: { tools: { listChanged: false } } } })
      const listed = await server.request('list', 'tools/list')
      expect((listed.result as { tools: Array<{ name: string }> }).tools.map(tool => tool.name)).toEqual([
        'script_studio_capabilities',
        'script_studio_get_project_hierarchy',
        'script_studio_create_season',
      ])
      const hierarchy = await server.request('read', 'tools/call', { name: 'script_studio_get_project_hierarchy', arguments: { projectId: 'project-1' } })
      expect(hierarchy).toMatchObject({ result: { content: [{ type: 'text' }] } })
      const conflict = await server.request('conflict', 'tools/call', { name: 'script_studio_create_season', arguments: { projectId: 'project-1', seasonId: 'season-2', title: '第二季', firstEpisodeId: 'episode-2', firstEpisodeTitle: '第一集', expectedProjectRevision: 1, idempotencyKey: 'same-key', requestHash: 'hash-a' } })
      expect(conflict).toMatchObject({ result: { content: [{ type: 'text' }] } })
      const replayConflict = await server.request('replay-conflict', 'tools/call', { name: 'script_studio_create_season', arguments: { projectId: 'project-1', seasonId: 'season-3', title: '第三季', firstEpisodeId: 'episode-3', firstEpisodeTitle: '第一集', expectedProjectRevision: 1, idempotencyKey: 'same-key', requestHash: 'hash-b' } })
      expect(replayConflict).toMatchObject({ result: { isError: true }, id: 'replay-conflict' })
    } finally {
      server.child.kill()
      await once(server.child, 'exit')
    }
  })
})
