import type { MemberId, TeamId } from '@script-studio/domain'

export const CLOUD_MIGRATION_ID = '0001_cloud_authority' as const

export const CLOUD_TENANT_TABLES = [
  'team_members', 'ips', 'projects', 'seasons', 'episodes', 'sequences', 'scenes', 'beats',
  'content_objects', 'audit_events', 'idempotency_keys', 'outbox_events',
] as const

export type CloudTenantTable = (typeof CLOUD_TENANT_TABLES)[number]

export interface CloudTenantSession {
  teamId: TeamId
  memberId: MemberId
}

export interface SessionSettingStatement {
  text: string
  values: readonly [string]
}

/**
 * Creates transaction-local settings consumed by the database RLS policies.
 * The API must execute these statements after beginning a transaction and
 * derive the values from verified OIDC/session claims, never from Client input.
 */
export function tenantSessionStatements(session: CloudTenantSession): readonly [SessionSettingStatement, SessionSettingStatement] {
  return [
    { text: "select set_config('app.team_id', $1, true)", values: [session.teamId] },
    { text: "select set_config('app.member_id', $1, true)", values: [session.memberId] },
  ]
}
