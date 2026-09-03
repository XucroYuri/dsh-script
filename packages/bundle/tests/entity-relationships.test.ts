import { describe, expect, it } from 'vitest'
import {
  EntityRelationshipDomainError,
  applyRelationshipCandidateDecision,
  buildRelationshipNeighborhood,
  canonicalizeRelationshipEndpoints,
  layoutRelationshipNeighborhood,
  normalizeRelationshipPredicateKey,
  normalizeRelationshipText,
  relationshipCandidateConfirmability,
  relationshipFingerprint,
  relationshipOccursAt,
  validateRelationshipTimeRange,
  type EntityRelationship,
  type EntityRelationshipCandidate,
  type RelationshipEntityNode,
} from '../src/domain/entity-relationships.js'

const nodes: RelationshipEntityNode[] = [
  { id: 'a', projectId: 'project-1', type: 'character', name: '阿岚' },
  { id: 'b', projectId: 'project-1', type: 'character', name: '白砚' },
  { id: 'c', projectId: 'project-1', type: 'faction', name: '潮汐会' },
  { id: 'd', projectId: 'project-1', type: 'location', name: '灯塔' },
  { id: 'e', projectId: 'project-1', type: 'item', name: '旧罗盘' },
]

function relationship(
  id: string,
  sourceEntityId: string,
  targetEntityId: string,
  overrides: Partial<EntityRelationship> = {},
): EntityRelationship {
  const base = {
    id,
    projectId: 'project-1',
    sourceEntityId,
    targetEntityId,
    predicateKey: 'knows',
    label: '认识',
    category: 'knowledge' as const,
    directionality: 'directed' as const,
    factLayer: 'canon' as const,
    validFromStoryOrder: null,
    validToStoryOrder: null,
    status: 'active' as const,
    supersedesRelationshipId: null,
    createdBy: 'user' as const,
    fingerprint: '',
    revision: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
  return { ...base, ...overrides }
}

function candidate(overrides: Partial<EntityRelationshipCandidate> = {}): EntityRelationshipCandidate {
  const base: EntityRelationshipCandidate = {
    id: 'candidate-1',
    runId: 'run-1',
    sourceEntityId: 'b',
    targetEntityId: 'a',
    sourceLabel: '白砚',
    targetLabel: '阿岚',
    predicateKey: ' Allies_With ',
    label: '盟友',
    category: 'alliance',
    directionality: 'symmetric',
    factLayer: 'canon',
    validFromStoryOrder: 12,
    validToStoryOrder: null,
    confidence: 0.83,
    status: 'pending',
    evidence: [],
    fingerprint: 'stale',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
  return { ...base, ...overrides }
}

describe('entity relationship normalization and identity', () => {
  it('normalizes Unicode text and stable predicate keys', () => {
    expect(normalizeRelationshipText('  Ａlice\n  与  白砚  ')).toBe('Alice 与 白砚')
    expect(normalizeRelationshipPredicateKey('  Allies_With / 共同战线  ')).toBe('allies-with-共同战线')
  })

  it('canonicalizes symmetric endpoints and gives them one fingerprint', () => {
    const endpoints = canonicalizeRelationshipEndpoints({
      sourceEntityId: 'b', targetEntityId: 'a', sourceLabel: '白砚', targetLabel: '阿岚', directionality: 'symmetric',
    })
    expect(endpoints).toMatchObject({ sourceEntityId: 'a', targetEntityId: 'b', sourceLabel: '阿岚', targetLabel: '白砚', swapped: true })

    const forward = relationshipFingerprint({ sourceEntityId: 'a', targetEntityId: 'b', predicateKey: 'allies-with', directionality: 'symmetric', factLayer: 'canon', validFromStoryOrder: 1, validToStoryOrder: null })
    const reverse = relationshipFingerprint({ sourceEntityId: 'b', targetEntityId: 'a', predicateKey: 'ALLIES_WITH', directionality: 'symmetric', factLayer: 'canon', validFromStoryOrder: 1, validToStoryOrder: null })
    const directed = relationshipFingerprint({ sourceEntityId: 'b', targetEntityId: 'a', predicateKey: 'allies-with', directionality: 'directed', factLayer: 'canon', validFromStoryOrder: 1, validToStoryOrder: null })
    expect(reverse).toBe(forward)
    expect(directed).not.toBe(forward)
  })
})

describe('entity relationship time ranges and candidate decisions', () => {
  it('uses inclusive story-order intervals and rejects invalid ranges', () => {
    expect(relationshipOccursAt({ validFromStoryOrder: 4, validToStoryOrder: 8 }, 4)).toBe(true)
    expect(relationshipOccursAt({ validFromStoryOrder: 4, validToStoryOrder: 8 }, 8)).toBe(true)
    expect(relationshipOccursAt({ validFromStoryOrder: 4, validToStoryOrder: 8 }, 9)).toBe(false)
    expect(relationshipOccursAt({ validFromStoryOrder: null, validToStoryOrder: null }, null)).toBe(true)
    expect(() => validateRelationshipTimeRange({ validFromStoryOrder: 9, validToStoryOrder: 8 })).toThrow(EntityRelationshipDomainError)
    expect(() => validateRelationshipTimeRange({ validFromStoryOrder: 1.5, validToStoryOrder: null })).toThrow(EntityRelationshipDomainError)
  })

  it('confirms only resolved candidates, canonicalizes symmetric endpoints, and refreshes identity', () => {
    const confirmed = applyRelationshipCandidateDecision(candidate(), { action: 'confirm', decidedAt: '2026-08-27T01:00:00.000Z' })
    expect(confirmed).toMatchObject({
      status: 'confirmed', sourceEntityId: 'a', targetEntityId: 'b', sourceLabel: '阿岚', targetLabel: '白砚', predicateKey: 'allies-with',
      updatedAt: '2026-08-27T01:00:00.000Z',
    })
    expect(confirmed.fingerprint).toBe(relationshipFingerprint(confirmed))
    expect(relationshipCandidateConfirmability(candidate({ sourceEntityId: null }))).toEqual({ ok: false, issues: ['missing_source_entity'] })
    expect(relationshipCandidateConfirmability(candidate({ confidence: 1.2 }))).toEqual({ ok: false, issues: ['invalid_confidence'] })
    expect(() => applyRelationshipCandidateDecision(candidate({ targetEntityId: null }), { action: 'confirm' })).toThrow(EntityRelationshipDomainError)
  })

  it('allows a reviewer to reject an ambiguous candidate without resolving endpoints', () => {
    const rejected = applyRelationshipCandidateDecision(candidate({ sourceEntityId: null, status: 'ambiguous' }), { action: 'reject' })
    expect(rejected.status).toBe('rejected')
    expect(rejected.sourceEntityId).toBeNull()
    expect(() => applyRelationshipCandidateDecision(rejected, { action: 'reject' })).toThrow(EntityRelationshipDomainError)
  })
})

describe('bounded relationship neighborhoods and deterministic layout', () => {
  const relationships = [
    relationship('r1', 'a', 'b'),
    relationship('r2', 'a', 'c', { factLayer: 'planned', category: 'alliance', predicateKey: 'joins', label: '加入' }),
    relationship('r3', 'b', 'd', { validFromStoryOrder: 10 }),
    relationship('r4', 'c', 'e', { category: 'possession', predicateKey: 'owns', label: '持有' }),
    relationship('r5', 'd', 'e', { status: 'superseded' }),
  ]

  it('walks both directions, filters by layer and time, and reports truncation', () => {
    const canonAtFive = buildRelationshipNeighborhood(nodes, relationships, { rootEntityId: 'a', atStoryOrder: 5, factLayers: ['canon'], maxDepth: 2 })
    expect(canonAtFive.nodes.map(node => [node.id, node.depth])).toEqual([['a', 0], ['b', 1]])
    expect(canonAtFive.relationships.map(edge => edge.id)).toEqual(['r1'])

    const bounded = buildRelationshipNeighborhood(nodes, relationships, { rootEntityId: 'a', maxDepth: 2, maxNodes: 3, maxRelationships: 1 })
    expect(bounded.nodes).toHaveLength(3)
    expect(bounded.relationships).toHaveLength(1)
    expect(bounded.truncated.nodes).toBe(true)
    expect(bounded.truncated.relationships).toBe(true)
  })

  it('is independent of input order and keeps every layout coordinate inside the canvas', () => {
    const first = buildRelationshipNeighborhood(nodes, relationships, { rootEntityId: 'a', maxDepth: 2 })
    const second = buildRelationshipNeighborhood([...nodes].reverse(), [...relationships].reverse(), { rootEntityId: 'a', maxDepth: 2 })
    expect(second).toEqual(first)

    const layout = layoutRelationshipNeighborhood(first, { width: 720, height: 440, padding: 56 })
    expect(layoutRelationshipNeighborhood(first, { width: 720, height: 440, padding: 56 })).toEqual(layout)
    const root = layout.nodes.find(node => node.id === 'a')
    expect(root).toMatchObject({ x: 360, y: 220, depth: 0 })
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(56)
      expect(node.x).toBeLessThanOrEqual(664)
      expect(node.y).toBeGreaterThanOrEqual(56)
      expect(node.y).toBeLessThanOrEqual(384)
    }
  })
})
