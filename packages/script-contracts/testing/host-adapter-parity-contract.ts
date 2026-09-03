import { describe, expect, it } from 'vitest'
import type { HostAdapterPort, HostInvocation } from '../src/host-contract.js'

export interface HostAdapterParityHarness {
  codex: HostAdapterPort
  dsh: HostAdapterPort
  hierarchyRead: Extract<HostInvocation, { operation: 'get-project-hierarchy' }>
  createSeason: Extract<HostInvocation, { operation: 'create-season' }>
  createSeasonWithOtherHash: Extract<HostInvocation, { operation: 'create-season' }>
  forbiddenHierarchyRead: Extract<HostInvocation, { operation: 'get-project-hierarchy' }>
}

export function hostAdapterParityContract(name: string, createHarness: () => HostAdapterParityHarness): void {
  describe(name, () => {
    it('negotiates identical capabilities while preserving distinct HostIdentity', async () => {
      const harness = createHarness()
      const invocation = { requestId: 'capabilities-1', operation: 'capabilities' as const }
      const [codex, dsh] = await Promise.all([harness.codex.invoke(invocation), harness.dsh.invoke(invocation)])
      expect(codex.ok).toBe(true)
      expect(dsh.ok).toBe(true)
      if (!codex.ok || !dsh.ok || codex.result.operation !== 'capabilities' || dsh.result.operation !== 'capabilities') return
      expect(codex.result.capabilities).toEqual(dsh.result.capabilities)
      expect(codex.result.host.kind).toBe('codex')
      expect(dsh.result.host.kind).toBe('dsh')
    })

    it('returns identical hierarchy results', async () => {
      const harness = createHarness()
      const [codex, dsh] = await Promise.all([harness.codex.invoke(harness.hierarchyRead), harness.dsh.invoke(harness.hierarchyRead)])
      expect(codex).toEqual(dsh)
    })

    it('returns the same forbidden response for an unauthorized actor', async () => {
      const harness = createHarness()
      const [codex, dsh] = await Promise.all([harness.codex.invoke(harness.forbiddenHierarchyRead), harness.dsh.invoke(harness.forbiddenHierarchyRead)])
      expect(codex).toEqual(dsh)
      expect(codex).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    })

    it('creates one Season and first Episode, then replays identically across hosts', async () => {
      const harness = createHarness()
      const codex = await harness.codex.invoke(harness.createSeason)
      const dsh = await harness.dsh.invoke(harness.createSeason)
      expect(codex).toEqual(dsh)
      expect(codex).toMatchObject({ ok: true, result: { operation: 'create-season', projectRevision: 2, season: { position: 2 }, episode: { position: 1, storyOrder: 2 } } })
    })

    it('returns the same revision-conflict for idempotency key reuse with another request hash', async () => {
      const harness = createHarness()
      await harness.codex.invoke(harness.createSeason)
      const [codex, dsh] = await Promise.all([
        harness.codex.invoke(harness.createSeasonWithOtherHash),
        harness.dsh.invoke(harness.createSeasonWithOtherHash),
      ])
      expect(codex).toEqual(dsh)
      expect(codex).toMatchObject({ ok: false, error: { code: 'revision-conflict' } })
    })
  })
}
