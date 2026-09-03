import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client-relationships.tsx', import.meta.url), 'utf8')

describe('standalone entity relationship client', () => {
  it('stays props-driven and independent from the shared client and API modules', () => {
    expect(clientSource).toContain('export interface EntityRelationshipsPanelProps')
    expect(clientSource).toContain('export function EntityRelationshipsPanel')
    expect(clientSource).toContain('onRequestEvidence?:')
    expect(clientSource).toContain('onDecideCandidate?:')
    expect(clientSource).toContain('onDecideCandidates?:')
    expect(clientSource).toContain('onQueryStateChange?:')
    expect(clientSource).toContain('onLoadMoreRelationships?:')
    expect(clientSource).not.toContain("from '../domain/model.js'")
    expect(clientSource).not.toContain("from './client.js'")
    expect(clientSource).not.toContain("from './contract.js'")
    expect(clientSource).not.toContain('fetch(')
  })

  it('uses one bounded deterministic neighborhood for the enhanced graph view', () => {
    expect(clientSource).toContain('buildRelationshipNeighborhood(nodes, visibleRelationships')
    expect(clientSource).toContain('maxNodes: filters.depth === 2 ? 80 : 60')
    expect(clientSource).toContain('maxRelationships: filters.depth === 2 ? 180 : 120')
    expect(clientSource).toContain('layoutRelationshipNeighborhood(neighborhood)')
    expect(clientSource).toContain('当前仅显示有界邻域')
  })

  it('exposes server-backed relationship filters and paginated formal results', () => {
    expect(clientSource).toContain('<span>类别</span>')
    expect(clientSource).toContain('<span>事实层</span>')
    expect(clientSource).toContain('<span>截至故事序</span>')
    expect(clientSource).toContain('<span>跳数</span>')
    expect(clientSource).toContain('<span>中心实体</span>')
    expect(clientSource).toContain('updateFilters({ rootEntityId: event.target.value || null })')
    expect(clientSource).toContain('一跳 · 60/120')
    expect(clientSource).toContain('二跳 · 80/180')
    expect(clientSource).toContain('已载入 {relationships.length} / {total} 条正式关系')
    expect(clientSource).toContain("载入更多")
  })

  it('falls back to a semantic list on narrow screens', () => {
    expect(clientSource).toContain("window.matchMedia('(max-width: 760px)')")
    expect(clientSource).toContain("compact && mode === 'graph' ? 'list' : mode")
    expect(clientSource).toContain('role="tabpanel" className="ns-rel__list-panel"')
    expect(clientSource).toContain('className="ns-rel__table-scroll"')
    expect(clientSource).toContain('className="ns-rel__cards"')
    expect(clientSource).toContain('窄屏使用关系列表')
  })

  it('provides graph keyboard navigation and a focus-managed evidence dialog', () => {
    expect(clientSource).toContain("event.key === 'ArrowRight'")
    expect(clientSource).toContain("event.key === 'ArrowLeft'")
    expect(clientSource).toContain("event.key === 'Home'")
    expect(clientSource).toContain("event.key === 'End'")
    expect(clientSource).toContain('role="dialog" aria-modal="true"')
    expect(clientSource).toContain("if (event.key === 'Escape')")
    expect(clientSource).toContain('evidenceCloseRef.current?.focus()')
    expect(clientSource).toContain('opener.focus()')
  })

  it('keeps AI candidates pending until an explicit confirm or reject callback', () => {
    expect(clientSource).toContain("candidate.status === 'pending' || candidate.status === 'ambiguous'")
    expect(clientSource).toContain('relationshipCandidateConfirmability(reviewedCandidate)')
    expect(clientSource).toContain('await onDecideCandidate({ candidateId: candidate.id, decision })')
    expect(clientSource).toContain('sourceEntityId: draft.sourceEntityId ?? undefined')
    expect(clientSource).toContain("action: 'confirm', ...draft")
    expect(clientSource).toContain('确认关系')
    expect(clientSource).toContain('拒绝')
    expect(clientSource).toContain('AI 提取结果需要确认后才进入关系事实。')
  })

  it('supports editing every confirmable field and deciding candidates in bulk', () => {
    expect(clientSource).toContain('检查并修改关系字段')
    for (const label of ['源实体', '目标实体', '显示关系', '谓词键', '类别', '方向', '事实层', '有效故事序（起）', '有效故事序（止）']) {
      expect(clientSource).toContain(`<span>${label}</span>`)
    }
    expect(clientSource).toContain('选择全部 {candidates.length} 条')
    expect(clientSource).toContain('批量拒绝')
    expect(clientSource).toContain('批量确认')
    expect(clientSource).toContain('await onDecideCandidates(requests)')
    expect(clientSource).toContain('当前为归档只读模式。可以查看候选及证据，但不能确认、拒绝或修改。')
    expect(clientSource).not.toContain('接入 onDecideCandidate')
  })

  it('shows evidence load failures and allows retry without claiming there is no evidence', () => {
    expect(clientSource).toContain("status: 'error'")
    expect(clientSource).toContain("void loadEvidence(selectedRelationship.id)")
    expect(clientSource).toContain('证据载入失败。')
    expect(clientSource).toContain('正在载入证据...')
  })

  it('contains no forbidden long dash characters in visible copy', () => {
    expect(clientSource).not.toMatch(/[—–]/u)
  })
})
