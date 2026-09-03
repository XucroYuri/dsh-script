import type {
  EpisodeId, IdempotencyKey, MemberId, MemberRole, ProjectId, RequestHash, SeasonId, TeamId,
} from '@script-studio/domain'
import type { ApiError, EpisodeDto, GetProjectHierarchyResponse, SeasonDto } from './dto.js'

export const HOST_CONTRACT_VERSION = '1.0.0' as const
export type HostKind = 'codex' | 'dsh'

export interface HostIdentity {
  kind: HostKind
  name: string
  hostVersion: string
  hostInstanceId: string
  adapterVersion: string
}

export interface HostCapabilities {
  hierarchyRead: boolean
  commandCreateSeason: boolean
  authSession: boolean
  eventStream: boolean
  hostModelGateway: boolean
  interactiveAppSurface: boolean
  telemetry: boolean
}

export const STAGE_2_CAPABILITIES: Readonly<HostCapabilities> = Object.freeze({
  hierarchyRead: true,
  commandCreateSeason: true,
  authSession: false,
  eventStream: false,
  hostModelGateway: false,
  interactiveAppSurface: false,
  telemetry: false,
})

export interface HostActor { teamId: TeamId; memberId: MemberId; role: MemberRole }

export type HostInvocation =
  | { requestId: string; operation: 'capabilities'; actor?: never; payload?: never }
  | { requestId: string; operation: 'get-project-hierarchy'; actor: HostActor; payload: { projectId: ProjectId } }
  | { requestId: string; operation: 'create-season'; actor: HostActor; payload: { projectId: ProjectId; seasonId: SeasonId; title: string; firstEpisodeId: EpisodeId; firstEpisodeTitle: string; expectedProjectRevision: number; idempotencyKey: IdempotencyKey; requestHash: RequestHash } }

export interface HostRequestEnvelope {
  contractVersion: string
  host: HostIdentity
  invocation: HostInvocation
}

export type HostSuccessResult =
  | { operation: 'capabilities'; capabilities: HostCapabilities; host: HostIdentity }
  | { operation: 'get-project-hierarchy'; hierarchy: GetProjectHierarchyResponse }
  | { operation: 'create-season'; season: SeasonDto; episode: EpisodeDto; projectRevision: number }

export type HostResponseEnvelope =
  | { requestId: string; contractVersion: typeof HOST_CONTRACT_VERSION; ok: true; result: HostSuccessResult }
  | { requestId: string; contractVersion: typeof HOST_CONTRACT_VERSION; ok: false; error: ApiError }

export interface ScriptStudioHostApiPort {
  handle(request: HostRequestEnvelope): Promise<HostResponseEnvelope>
}

export interface HostAdapterPort {
  readonly identity: HostIdentity
  invoke(invocation: HostInvocation): Promise<HostResponseEnvelope>
}
