import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')

describe('Novel Studio story timeline view', () => {
  it('shows story progress and approved world-time anchors instead of generation versions', () => {
    expect(clientSource).toContain('当前故事进展')
    expect(clientSource).toContain('全局时间锚点')
    expect(clientSource).toContain('过去、现在与后续既定节点')
    expect(clientSource).toContain("summary.scope === 'chapter' && summary.status === 'current'")
    expect(clientSource).toContain("stage.kind === 'timeline'")
    expect(clientSource).not.toContain('meta={`STORY ${event.storyOrder}`}')
    expect(clientSource).not.toContain('knowledge.timeline.map(event =>')
  })
})
