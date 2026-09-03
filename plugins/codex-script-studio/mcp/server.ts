import { CodexScriptStudioAdapter } from '../src/index.ts'
import { createStage2DevHostFixture, type Stage2DevHostFixture } from '@script-studio/application'
import { HOST_CONTRACT_VERSION, type HostInvocation, type HostResponseEnvelope } from '@script-studio/contracts/host'
import { asEpisodeId, asIdempotencyKey, asProjectId, asRequestHash, asSeasonId } from '@script-studio/domain'

type JsonRpcId = string | number | null
type JsonRpcRequest = { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: Record<string, unknown> }
type JsonRpcResponse = { jsonrpc: '2.0'; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } }

const fixture = createStage2DevHostFixture()
const adapter = new CodexScriptStudioAdapter(fixture.api, {
  hostVersion: '0.150.1',
  hostInstanceId: 'codex-mcp-stdio',
  adapterVersion: '0.1.0',
})

const TOOLS = [
  {
    name: 'script_studio_capabilities',
    description: 'Negotiate the Script Studio Host Contract capabilities for this Codex adapter.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'script_studio_get_project_hierarchy',
    description: 'Read the Team, IP, Project, Season, and Episode hierarchy for a Script Studio project.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['projectId'], properties: { projectId: { type: 'string', minLength: 1 } } },
  },
  {
    name: 'script_studio_create_season',
    description: 'Create one episodic Season and its first Episode using an expected Project revision and idempotency key.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'seasonId', 'title', 'firstEpisodeId', 'firstEpisodeTitle', 'expectedProjectRevision', 'idempotencyKey', 'requestHash'],
      properties: {
        projectId: { type: 'string', minLength: 1 },
        seasonId: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        firstEpisodeId: { type: 'string', minLength: 1 },
        firstEpisodeTitle: { type: 'string', minLength: 1 },
        expectedProjectRevision: { type: 'integer', minimum: 1 },
        idempotencyKey: { type: 'string', minLength: 1 },
        requestHash: { type: 'string', minLength: 1 },
      },
    },
  },
] as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('arguments must be an object')
  return value as Record<string, unknown>
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-empty string`)
  return value
}

function expectedRevision(args: Record<string, unknown>): number {
  const value = args.expectedProjectRevision
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('expectedProjectRevision must be a positive integer')
  return value as number
}

function invocationFor(name: string, rawArgs: unknown, currentFixture: Stage2DevHostFixture): HostInvocation {
  const args = record(rawArgs)
  if (name === 'script_studio_capabilities') return { requestId: `mcp-capabilities-${Date.now()}`, operation: 'capabilities' }
  const projectId = requiredString(args, 'projectId')
  if (name === 'script_studio_get_project_hierarchy') {
    return {
      requestId: `mcp-hierarchy-${Date.now()}`,
      operation: 'get-project-hierarchy',
      actor: currentFixture.actor,
      payload: { projectId: asProjectId(projectId) },
    }
  }
  if (name !== 'script_studio_create_season') throw new Error(`Unknown Script Studio tool: ${name}`)
  return {
    requestId: `mcp-create-season-${Date.now()}`,
    operation: 'create-season',
    actor: currentFixture.actor,
    payload: {
      projectId: asProjectId(projectId),
      seasonId: asSeasonId(requiredString(args, 'seasonId')),
      title: requiredString(args, 'title'),
      firstEpisodeId: asEpisodeId(requiredString(args, 'firstEpisodeId')),
      firstEpisodeTitle: requiredString(args, 'firstEpisodeTitle'),
      expectedProjectRevision: expectedRevision(args),
      idempotencyKey: asIdempotencyKey(requiredString(args, 'idempotencyKey')),
      requestHash: asRequestHash(requiredString(args, 'requestHash')),
    },
  }
}

async function invoke(name: string, args: unknown): Promise<HostResponseEnvelope> {
  return adapter.invoke(invocationFor(name, args, fixture))
}

function textResult(response: HostResponseEnvelope): { content: [{ type: 'text'; text: string }]; isError?: boolean } {
  return response.ok
    ? { content: [{ type: 'text', text: JSON.stringify(response.result) }] }
    : { content: [{ type: 'text', text: JSON.stringify({ code: response.error.code, message: response.error.message, requestId: response.error.requestId }) }], isError: true }
}

async function handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (request.method.startsWith('notifications/')) return null
  if (request.id === undefined) return null
  try {
    switch (request.method) {
      case 'initialize':
        return { jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'script-studio', version: HOST_CONTRACT_VERSION } } }
      case 'ping':
        return { jsonrpc: '2.0', id: request.id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } }
      case 'tools/call': {
        const params = request.params ?? {}
        const name = typeof params.name === 'string' ? params.name : ''
        if (!TOOLS.some(tool => tool.name === name)) return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: `Unknown tool: ${name}` } }
        const response = await invoke(name, params.arguments ?? {})
        return { jsonrpc: '2.0', id: request.id, result: textResult(response) }
      }
      default:
        return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } }
    }
  } catch (cause) {
    return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: cause instanceof Error ? cause.message : String(cause) } }
  }
}

function write(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

let buffer = ''
let queue = Promise.resolve()
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    queue = queue.then(async () => {
      let request: JsonRpcRequest
      try { request = JSON.parse(line) as JsonRpcRequest }
      catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return }
      const response = await handle(request)
      if (response) write(response)
    })
  }
})
process.stdin.on('end', () => { void queue })
