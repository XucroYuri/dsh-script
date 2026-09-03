import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { CallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  createStage2DevHostFixture,
  STAGE_2_DEV_ACTOR,
  type Stage2DevHostFixture,
} from '@script-studio/application'
import {
  HOST_CONTRACT_VERSION,
  type HostActor,
  type HostIdentity,
  type HostInvocation,
  type HostRequestEnvelope,
  type HostResponseEnvelope,
} from '@script-studio/contracts/host'
import {
  asEpisodeId,
  asIdempotencyKey,
  asMemberId,
  asProjectId,
  asRequestHash,
  asSeasonId,
  asTeamId,
  DomainError,
  type MemberRole,
} from '@script-studio/domain'
import { HOST_ROUTE, TOOL_SMOKE_ROUTE } from './routes.js'

export { HOST_ROUTE, TOOL_SMOKE_ROUTE } from './routes.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    scriptStudioHost: ScriptStudioHostService
  }
}

export class ScriptStudioHostService extends Service {
  readonly fixture: Stage2DevHostFixture
  readonly identity: HostIdentity = {
    kind: 'dsh',
    name: 'DeepSeek Harness',
    hostVersion: '0.1.0-rc.7',
    hostInstanceId: `dsh-${process.pid}`,
    adapterVersion: '0.1.0',
  }

  constructor(ctx: Context) {
    super(ctx, 'scriptStudioHost')
    this.fixture = createStage2DevHostFixture()
  }

  invoke(invocation: HostInvocation): Promise<HostResponseEnvelope> {
    return this.fixture.api.handle({ contractVersion: HOST_CONTRACT_VERSION, host: this.identity, invocation })
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('validation', `${label} must be an object.`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DomainError('validation', `${label} must be a non-empty string.`)
  return value
}

function role(value: unknown): MemberRole {
  const roles: readonly MemberRole[] = ['owner', 'admin', 'editor', 'writer', 'reviewer', 'viewer']
  const candidate = string(value, 'actor.role')
  if (!roles.includes(candidate as MemberRole)) throw new DomainError('validation', 'actor.role is not supported.')
  return candidate as MemberRole
}

function actor(value: unknown): HostActor {
  const input = object(value, 'actor')
  return { teamId: asTeamId(string(input.teamId, 'actor.teamId')), memberId: asMemberId(string(input.memberId, 'actor.memberId')), role: role(input.role) }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new DomainError('validation', `${label} must be a positive integer.`)
  return value as number
}

function requestIdOf(value: unknown): string {
  try {
    const input = object(value, 'request')
    const invocation = object(input.invocation, 'invocation')
    return typeof invocation.requestId === 'string' && invocation.requestId.trim() ? invocation.requestId : 'invalid-request'
  } catch {
    return 'invalid-request'
  }
}

export function parseHostRequest(value: unknown): HostRequestEnvelope {
  const input = object(value, 'request')
  const contractVersion = string(input.contractVersion, 'contractVersion')
  const hostInput = object(input.host, 'host')
  if (hostInput.kind !== 'dsh') throw new DomainError('validation', 'DSH Host requires host.kind=dsh.')
  const host: HostIdentity = {
    kind: 'dsh',
    name: string(hostInput.name, 'host.name'),
    hostVersion: string(hostInput.hostVersion, 'host.hostVersion'),
    hostInstanceId: string(hostInput.hostInstanceId, 'host.hostInstanceId'),
    adapterVersion: string(hostInput.adapterVersion, 'host.adapterVersion'),
  }
  const invocationInput = object(input.invocation, 'invocation')
  const requestId = string(invocationInput.requestId, 'invocation.requestId')
  const operation = string(invocationInput.operation, 'invocation.operation')
  if (operation === 'capabilities') return { contractVersion, host, invocation: { requestId, operation } }
  const invocationActor = actor(invocationInput.actor)
  const payload = object(invocationInput.payload, 'invocation.payload')
  const projectId = asProjectId(string(payload.projectId, 'payload.projectId'))
  if (operation === 'get-project-hierarchy') {
    return { contractVersion, host, invocation: { requestId, operation, actor: invocationActor, payload: { projectId } } }
  }
  if (operation !== 'create-season') throw new DomainError('validation', `Unsupported Host operation: ${operation}.`)
  return {
    contractVersion,
    host,
    invocation: {
      requestId,
      operation,
      actor: invocationActor,
      payload: {
        projectId,
        seasonId: asSeasonId(string(payload.seasonId, 'payload.seasonId')),
        title: string(payload.title, 'payload.title'),
        firstEpisodeId: asEpisodeId(string(payload.firstEpisodeId, 'payload.firstEpisodeId')),
        firstEpisodeTitle: string(payload.firstEpisodeTitle, 'payload.firstEpisodeTitle'),
        expectedProjectRevision: positiveInteger(payload.expectedProjectRevision, 'payload.expectedProjectRevision'),
        idempotencyKey: asIdempotencyKey(string(payload.idempotencyKey, 'payload.idempotencyKey')),
        requestHash: asRequestHash(string(payload.requestHash, 'payload.requestHash')),
      },
    },
  }
}

function errorResponse(value: unknown, cause: unknown): HostResponseEnvelope {
  const error = cause instanceof DomainError ? cause : new DomainError('validation', cause instanceof Error ? cause.message : String(cause))
  return {
    requestId: requestIdOf(value),
    contractVersion: HOST_CONTRACT_VERSION,
    ok: false,
    error: { code: error.code, message: error.message, requestId: requestIdOf(value), details: error.details },
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(encoded))
  res.end(encoded)
}

function statusFor(response: HostResponseEnvelope): number {
  if (response.ok) return 200
  return ({ validation: 400, forbidden: 403, 'not-found': 404, 'invalid-state': 409, 'revision-conflict': 409 } as const)[response.error.code]
}

function readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let body = ''
    const onData = (chunk: Buffer | string) => {
      size += Buffer.byteLength(chunk)
      if (size > maxBytes) {
        cleanup()
        reject(new DomainError('validation', 'Host request body is too large.'))
        req.destroy()
        return
      }
      body += chunk.toString()
    }
    const onEnd = () => { cleanup(); resolve(body) }
    const onError = (cause: Error) => { cleanup(); reject(cause) }
    const cleanup = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError) }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

function registerHostRoute(ctx: Context, service: ScriptStudioHostService): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: HOST_ROUTE,
    async handler(req, res) {
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { ok: false, error: { code: 'validation', message: 'Only POST is supported.', requestId: 'method-not-allowed' } })
        return
      }
      let input: unknown
      try { input = JSON.parse(await readBody(req)) }
      catch (cause) {
        const response = errorResponse(undefined, cause)
        sendJson(res, statusFor(response), response)
        return
      }
      try {
        const response = await service.fixture.api.handle(parseHostRequest(input))
        sendJson(res, statusFor(response), response)
      } catch (cause) {
        const response = errorResponse(input, cause)
        sendJson(res, statusFor(response), response)
      }
    },
  })
}

function registerToolSmokeRoute(ctx: Context): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: TOOL_SMOKE_ROUTE,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { ok: false, error: { code: 'validation', message: 'Only GET is supported.', requestId: 'method-not-allowed' } })
        return
      }
      const controller = new AbortController()
      req.once('aborted', () => { controller.abort() })
      const result = await ctx.tools.execute({
        callId: CallId(`script-studio-smoke-${Date.now()}`),
        name: 'script_studio_capabilities',
        arguments: {},
        signal: controller.signal,
      })
      if (result.isError) {
        sendJson(res, 500, { ok: false, error: result.error.message })
        return
      }
      sendJson(res, 200, { ok: true, toolName: 'script_studio_capabilities', value: result.value })
    },
  })
}

function textResponse(response: HostResponseEnvelope): string {
  return JSON.stringify(response)
}

function requestFor(service: ScriptStudioHostService, invocation: HostInvocation): Promise<HostResponseEnvelope> {
  return service.invoke(invocation)
}

function registerTools(ctx: Context, service: ScriptStudioHostService): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'script_studio_capabilities',
      description: 'Negotiate the Script Studio Host Contract v1 capabilities for this DeepSeek Harness host.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() {
        return textResponse(await requestFor(service, { requestId: `dsh-capabilities-${randomUUID()}`, operation: 'capabilities' }))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'script_studio_get_project_hierarchy',
      description: 'Read the Team/IP/Project/Season/Episode hierarchy for a local Script Studio project.',
      parameters: { projectId: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      isConcurrencySafe: () => true,
      async execute(args) {
        const projectId = asProjectId(string((args as { projectId?: unknown }).projectId, 'projectId'))
        return textResponse(await requestFor(service, { requestId: `dsh-hierarchy-${randomUUID()}`, operation: 'get-project-hierarchy', actor: STAGE_2_DEV_ACTOR, payload: { projectId } }))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'script_studio_create_season',
      description: 'Create one episodic Season and its first Episode using an expected Project revision and idempotency key.',
      parameters: {
        projectId: { type: 'string', required: true },
        seasonId: { type: 'string', required: true },
        title: { type: 'string', required: true },
        firstEpisodeId: { type: 'string', required: true },
        firstEpisodeTitle: { type: 'string', required: true },
        expectedProjectRevision: { type: 'integer', required: true },
        idempotencyKey: { type: 'string', required: true },
        requestHash: { type: 'string', required: true },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const input = args as Record<string, unknown>
        return textResponse(await requestFor(service, {
          requestId: `dsh-create-season-${randomUUID()}`,
          operation: 'create-season',
          actor: STAGE_2_DEV_ACTOR,
          payload: {
            projectId: asProjectId(string(input.projectId, 'projectId')),
            seasonId: asSeasonId(string(input.seasonId, 'seasonId')),
            title: string(input.title, 'title'),
            firstEpisodeId: asEpisodeId(string(input.firstEpisodeId, 'firstEpisodeId')),
            firstEpisodeTitle: string(input.firstEpisodeTitle, 'firstEpisodeTitle'),
            expectedProjectRevision: positiveInteger(input.expectedProjectRevision, 'expectedProjectRevision'),
            idempotencyKey: asIdempotencyKey(string(input.idempotencyKey, 'idempotencyKey')),
            requestHash: asRequestHash(string(input.requestHash, 'requestHash')),
          },
        }))
      },
    })),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

export const name = 'script-studio-host'
export const inject = ['tools', 'webServer']

export function apply(ctx: Context): void {
  ctx.plugin(ScriptStudioHostService)
  ctx.inject(['scriptStudioHost'], readyCtx => {
    readyCtx.effect(() => registerHostRoute(readyCtx, readyCtx.scriptStudioHost), 'script-studio: host HTTP route')
    readyCtx.effect(() => registerToolSmokeRoute(readyCtx), 'script-studio: tool smoke route')
    readyCtx.effect(() => registerTools(readyCtx, readyCtx.scriptStudioHost), 'script-studio: Host Contract tools')
  })
}
