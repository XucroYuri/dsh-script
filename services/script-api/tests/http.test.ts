import { createServer, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  SCRIPT_STUDIO_API_VERSION,
  type ScriptStudioApiPort,
  type ScriptStudioApiResult,
} from '../src/index.js'
import { createScriptStudioHttpHandler } from '../src/http.js'

const route = '/api/script-studio/v1/projects/project-1/hierarchy'

async function withServer(api: ScriptStudioApiPort, run: (url: string) => Promise<void>): Promise<void> {
  const server: Server = createServer(createScriptStudioHttpHandler(api))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.')
  try { await run(`http://127.0.0.1:${address.port}`) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}

function okResult(): ScriptStudioApiResult {
  return {
    status: 200,
    body: { ok: true, contractVersion: SCRIPT_STUDIO_API_VERSION, result: {} as never },
  }
}

describe('Script Studio Node HTTP composition', () => {
  it('converts pathname/headers/request id and preserves API JSON response headers', async () => {
    const seen: Array<{ method: string; path: string; authorization?: string; requestId: string }> = []
    const api: ScriptStudioApiPort = {
      async handle(request) {
        seen.push({ method: request.method, path: request.path, authorization: request.headers.authorization, requestId: request.requestId })
        return okResult()
      },
    }

    await withServer(api, async url => {
      const response = await fetch(`${url}${route}?ignored=query`, { headers: { authorization: 'Bearer valid-token', 'x-request-id': 'req-1' } })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual(okResult().body)
    })

    expect(seen).toEqual([{ method: 'GET', path: route, authorization: 'Bearer valid-token', requestId: 'req-1' }])
  })

  it('replaces an unsafe request id without changing the API error contract', async () => {
    const api: ScriptStudioApiPort = {
      async handle(request) {
        return {
          status: 401,
          body: {
            ok: false,
            contractVersion: SCRIPT_STUDIO_API_VERSION,
            error: { code: 'forbidden', message: 'A verified cloud session is required.', requestId: request.requestId },
          },
        } as ScriptStudioApiResult
      },
    }

    await withServer(api, async url => {
      const response = await fetch(`${url}${route}`, { headers: { 'x-request-id': 'contains spaces' } })
      const body = await response.json() as { error: { requestId: string } }
      expect(response.status).toBe(401)
      expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/)
    })
  })

  it('maps unexpected API failures to a safe generic 500 response', async () => {
    const api: ScriptStudioApiPort = { async handle() { throw new Error('database secret') } }

    await withServer(api, async url => {
      const response = await fetch(`${url}${route}`)
      const body = await response.text()
      expect(response.status).toBe(500)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(body).toContain('Internal server error.')
      expect(body).not.toContain('database secret')
    })
  })
})
