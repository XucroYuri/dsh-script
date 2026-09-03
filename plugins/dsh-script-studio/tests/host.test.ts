import { describe, expect, it } from 'vitest'
import { HOST_CONTRACT_VERSION } from '@script-studio/contracts/host'
import { DomainError } from '@script-studio/domain'
import { parseHostRequest } from '../src/dsh-adapter/host.js'

const host = { kind: 'dsh' as const, name: 'DeepSeek Harness', hostVersion: '0.1.0-rc.7', hostInstanceId: 'test-host', adapterVersion: '0.1.0' }
const actor = { teamId: 'team-1' as never, memberId: 'member-writer' as never, role: 'writer' as const }

describe('DSH Host Contract request parser', () => {
  it('parses a capabilities request without inventing an actor', () => {
    expect(parseHostRequest({ contractVersion: HOST_CONTRACT_VERSION, host, invocation: { requestId: 'req-1', operation: 'capabilities' } })).toEqual({
      contractVersion: HOST_CONTRACT_VERSION,
      host,
      invocation: { requestId: 'req-1', operation: 'capabilities' },
    })
  })

  it('parses the mutating operation with branded identity fields', () => {
    const request = parseHostRequest({
      contractVersion: HOST_CONTRACT_VERSION,
      host,
      invocation: {
        requestId: 'req-2',
        operation: 'create-season',
        actor,
        payload: {
          projectId: 'project-1', seasonId: 'season-2', title: '第二季', firstEpisodeId: 'episode-2', firstEpisodeTitle: '第一集',
          expectedProjectRevision: 1, idempotencyKey: 'idempotency-2', requestHash: 'hash-2',
        },
      },
    })
    expect(request.invocation.operation).toBe('create-season')
    if (request.invocation.operation === 'create-season') expect(request.invocation.payload.expectedProjectRevision).toBe(1)
  })

  it('rejects a Codex envelope at the DSH boundary', () => {
    expect(() => parseHostRequest({ contractVersion: HOST_CONTRACT_VERSION, host: { ...host, kind: 'codex' }, invocation: { requestId: 'req-3', operation: 'capabilities' } })).toThrow(DomainError)
  })
})
