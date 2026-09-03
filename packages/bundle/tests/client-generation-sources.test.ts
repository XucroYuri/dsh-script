import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')

describe('Novel Studio generation source panel', () => {
  it('loads the chapter-specific source trace and does not render a fake list before a run', () => {
    expect(clientSource).toContain('/generation-sources')
    expect(clientSource).toContain("sources && sources.status !== 'unavailable'")
    expect(clientSource).toContain('function GenerationSourcesPanel')
    expect(clientSource).toContain('本次生成使用的资料')
  })

  it('communicates actual prompt inclusion and context-budget truncation', () => {
    expect(clientSource).toContain('sources.items.filter(item => item.used)')
    expect(clientSource).toContain('sources.items.filter(item => !item.used)')
    expect(clientSource).toContain('实际使用')
    expect(clientSource).toContain('未纳入')
    expect(clientSource).toContain('部分资料因上下文预算未纳入本次生成')
    expect(clientSource).toContain('正在记录本次生成实际读取的资料')
  })

  it('shows source-load failures distinctly and offers an explicit retry', () => {
    expect(clientSource).toContain('generationSourcesError')
    expect(clientSource).toContain('function GenerationSourcesInspector')
    expect(clientSource).toContain('本章资料读取失败')
    expect(clientSource).toContain('重试读取资料')
    expect(clientSource).toContain('retrySources={loadGenerationSources}')
    expect(clientSource).not.toContain("catch { /* The workspace-level connection notice owns transient polling errors. */ }")
  })
})
