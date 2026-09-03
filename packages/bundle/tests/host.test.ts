import { describe, expect, it } from 'vitest'
import {
  DOCTOR_ROUTE,
  DOCTOR_TOOL_SMOKE_ROUTE,
  NOVEL_API_ROUTE,
  NOVEL_STUDIO_PACKAGE,
  NOVEL_STUDIO_VERSION,
  SUPPORTED_HARNESS_VERSION,
} from '../src/dsh-adapter/contract.js'
import { inject as hostInject } from '../src/dsh-adapter/host.js'

describe('Novel Studio Harness contract', () => {
  it('pins the verified Harness and stable doctor surface', () => {
    expect(SUPPORTED_HARNESS_VERSION).toBe('0.1.0-rc.7')
    expect(NOVEL_STUDIO_PACKAGE).toBe('@novel-studio/dsh-novel-studio')
    expect(NOVEL_STUDIO_VERSION).toBe('0.8.0-author-control.6')
    expect(DOCTOR_ROUTE).toBe('/api/novel-studio/doctor')
    expect(DOCTOR_TOOL_SMOKE_ROUTE).toBe('/api/novel-studio/doctor/tool-smoke')
    expect(NOVEL_API_ROUTE).toBe('/api/novel-studio/v1')
  })

  it('waits for the official credentials service before startup recovery', () => {
    expect(hostInject).toContain('credentials')
    expect(hostInject.indexOf('credentials')).toBeGreaterThan(hostInject.indexOf('llm'))
  })
})
