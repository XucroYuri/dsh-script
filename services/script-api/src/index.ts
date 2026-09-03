import type {
  AccessTokenVerifierPort, ApiError, CloudHierarchyRepositoryPort, GetProjectHierarchyResponse, ScriptStudioApiRequest, ScriptStudioApiResponse,
} from '@script-studio/contracts'
import { asProjectId, DomainError } from '@script-studio/domain'

export const SCRIPT_STUDIO_API_VERSION = '1.0.0' as const
export const PROJECT_HIERARCHY_ROUTE = '/api/script-studio/v1/projects/:projectId/hierarchy'

interface ErrorBody {
  ok: false
  contractVersion: typeof SCRIPT_STUDIO_API_VERSION
  error: ApiError
}

interface SuccessBody {
  ok: true
  contractVersion: typeof SCRIPT_STUDIO_API_VERSION
  result: GetProjectHierarchyResponse
}

export type ScriptStudioApiResult = ScriptStudioApiResponse<SuccessBody | ErrorBody>

function header(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const expected = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected)?.[1]
  return entry?.trim() || undefined
}

function unauthorized(requestId: string): ScriptStudioApiResult {
  return {
    status: 401,
    body: {
      ok: false,
      contractVersion: SCRIPT_STUDIO_API_VERSION,
      error: { code: 'forbidden', message: 'A verified cloud session is required.', requestId, details: { authentication: 'required' } },
    },
  }
}

function failure(requestId: string, status: number, cause: unknown): ScriptStudioApiResult {
  const error = cause instanceof DomainError ? cause : new DomainError('invalid-state', cause instanceof Error ? cause.message : String(cause))
  return {
    status,
    body: {
      ok: false,
      contractVersion: SCRIPT_STUDIO_API_VERSION,
      error: { code: error.code, message: error.message, requestId, details: error.details },
    },
  }
}

export class ScriptStudioApi {
  constructor(
    private readonly sessions: AccessTokenVerifierPort,
    private readonly hierarchy: CloudHierarchyRepositoryPort,
  ) {}

  async handle(request: ScriptStudioApiRequest): Promise<ScriptStudioApiResult> {
    const match = request.method === 'GET' ? request.path.match(/^\/api\/script-studio\/v1\/projects\/([^/]+)\/hierarchy$/) : null
    if (!match) return failure(request.requestId, 404, new DomainError('not-found', 'Script Studio API route was not found.'))

    const authorization = header(request.headers, 'authorization')
    if (!authorization || !/^Bearer\s+[^\s]+$/i.test(authorization)) return unauthorized(request.requestId)
    const accessToken = authorization.replace(/^Bearer\s+/i, '')
    let session
    try { session = await this.sessions.verify(accessToken) }
    catch { return unauthorized(request.requestId) }
    if (!session) return unauthorized(request.requestId)

    let projectId
    try { projectId = asProjectId(decodeURIComponent(match[1]!)) }
    catch (cause) { return failure(request.requestId, 400, cause) }

    try {
      const value = await this.hierarchy.getProjectHierarchy(session.teamId, projectId)
      if (!value) return failure(request.requestId, 404, new DomainError('not-found', 'Project hierarchy was not found.'))
      return { status: 200, body: { ok: true, contractVersion: SCRIPT_STUDIO_API_VERSION, result: value } }
    } catch (cause) {
      return failure(request.requestId, cause instanceof DomainError && cause.code === 'forbidden' ? 403 : 500, cause)
    }
  }
}
