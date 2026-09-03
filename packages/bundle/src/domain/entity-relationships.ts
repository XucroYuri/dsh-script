export type EntityRelationshipCategory =
  | 'family'
  | 'emotion'
  | 'alliance'
  | 'conflict'
  | 'membership'
  | 'possession'
  | 'location'
  | 'knowledge'
  | 'causality'
  | 'other'

export type EntityRelationshipDirectionality = 'directed' | 'symmetric'
export type EntityRelationshipFactLayer = 'planned' | 'canon' | 'author_asserted'
export type EntityRelationshipStatus = 'active' | 'superseded'
export type EntityRelationshipCreatedBy = 'user' | 'ai_confirmed' | 'ai_yolo'
export type EntityRelationshipCandidateStatus = 'pending' | 'ambiguous' | 'confirmed' | 'rejected'
export type RelationshipAutomationMode = 'auto' | 'yolo'
export type RelationshipExtractionRunStatus = 'queued' | 'running' | 'waiting_review' | 'succeeded' | 'blocked' | 'failed' | 'cancelled'

export interface RelationshipEntityNode {
  id: string
  projectId?: string
  type: string
  name: string
  aliases?: readonly string[]
  description?: string
}

export interface RelationshipTimeRange {
  validFromStoryOrder: number | null
  validToStoryOrder: number | null
}

export interface EntityRelationship extends RelationshipTimeRange {
  id: string
  projectId: string
  sourceEntityId: string
  targetEntityId: string
  predicateKey: string
  label: string
  category: EntityRelationshipCategory
  directionality: EntityRelationshipDirectionality
  factLayer: EntityRelationshipFactLayer
  status: EntityRelationshipStatus
  supersedesRelationshipId: string | null
  createdBy: EntityRelationshipCreatedBy
  fingerprint: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface EntityRelationshipEvidence {
  id: string
  relationshipId: string
  sourceType: string
  sourceId: string
  sourceVersionId: string | null
  label: string
  excerptStart: number | null
  excerptEnd: number | null
  contentHash: string
  createdAt: string
  /** Hydrated by a read API when the source is available. It is not persisted on the evidence row. */
  excerpt?: string
}

export interface EntityRelationshipCandidate extends RelationshipTimeRange {
  id: string
  runId: string
  sourceEntityId: string | null
  targetEntityId: string | null
  sourceLabel: string
  targetLabel: string
  predicateKey: string
  label: string
  category: EntityRelationshipCategory
  directionality: EntityRelationshipDirectionality
  factLayer: EntityRelationshipFactLayer
  confidence: number
  status: EntityRelationshipCandidateStatus
  evidence: readonly EntityRelationshipEvidence[]
  fingerprint: string
  createdAt: string
  updatedAt: string
}

export interface RelationshipExtractionRun {
  id: string
  projectId: string
  automationMode: RelationshipAutomationMode
  status: RelationshipExtractionRunStatus
  provider: string
  model: string
  promptHash: string
  sourceSnapshotJson: string
  errorJson: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface RelationshipFingerprintInput extends RelationshipTimeRange {
  sourceEntityId?: string | null
  targetEntityId?: string | null
  sourceLabel?: string
  targetLabel?: string
  predicateKey: string
  directionality: EntityRelationshipDirectionality
  factLayer: EntityRelationshipFactLayer
}

export interface CanonicalRelationshipEndpoints {
  sourceEntityId: string | null
  targetEntityId: string | null
  sourceLabel: string
  targetLabel: string
  sourceReference: string
  targetReference: string
  swapped: boolean
}

export type RelationshipCandidateDecision =
  | {
      action: 'confirm'
      sourceEntityId?: string
      targetEntityId?: string
      sourceLabel?: string
      targetLabel?: string
      predicateKey?: string
      label?: string
      category?: EntityRelationshipCategory
      directionality?: EntityRelationshipDirectionality
      factLayer?: EntityRelationshipFactLayer
      validFromStoryOrder?: number | null
      validToStoryOrder?: number | null
      decidedAt?: string
    }
  | { action: 'reject'; decidedAt?: string }

export type RelationshipCandidateConfirmIssue =
  | 'already_decided'
  | 'missing_source_entity'
  | 'missing_target_entity'
  | 'same_entity'
  | 'missing_predicate'
  | 'missing_label'
  | 'invalid_confidence'
  | 'invalid_time_range'

export interface RelationshipCandidateConfirmability {
  ok: boolean
  issues: readonly RelationshipCandidateConfirmIssue[]
}

export interface RelationshipNeighborhoodOptions {
  rootEntityId?: string | null
  maxDepth?: 1 | 2
  maxNodes?: number
  maxRelationships?: number
  factLayers?: readonly EntityRelationshipFactLayer[]
  categories?: readonly EntityRelationshipCategory[]
  atStoryOrder?: number | null
  includeSuperseded?: boolean
}

export interface RelationshipNeighborhoodNode extends RelationshipEntityNode {
  depth: number
  degree: number
}

export interface RelationshipNeighborhood {
  rootEntityId: string | null
  nodes: readonly RelationshipNeighborhoodNode[]
  relationships: readonly EntityRelationship[]
  totalReachableNodes: number
  totalEligibleRelationships: number
  truncated: { nodes: boolean; relationships: boolean }
}

export interface RelationshipLayoutOptions {
  width?: number
  height?: number
  padding?: number
}

export interface RelationshipLayoutNode extends RelationshipNeighborhoodNode {
  x: number
  y: number
}

export interface RelationshipLayout {
  width: number
  height: number
  nodes: readonly RelationshipLayoutNode[]
}

export const RELATIONSHIP_NEIGHBORHOOD_LIMITS = Object.freeze({
  defaultDepth: 2 as const,
  defaultNodes: 28,
  defaultRelationships: 64,
  maximumNodes: 80,
  maximumRelationships: 180,
})

export class EntityRelationshipDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntityRelationshipDomainError'
  }
}

export function normalizeRelationshipText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

export function normalizeRelationshipPredicateKey(value: string): string {
  return normalizeRelationshipText(value)
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/[^\p{Letter}\p{Number}.:-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^[.:-]+|[.:-]+$/gu, '')
}

export function validateRelationshipTimeRange(range: RelationshipTimeRange): RelationshipTimeRange {
  const validFromStoryOrder = validateStoryOrder(range.validFromStoryOrder, 'validFromStoryOrder')
  const validToStoryOrder = validateStoryOrder(range.validToStoryOrder, 'validToStoryOrder')
  if (validFromStoryOrder !== null && validToStoryOrder !== null && validFromStoryOrder > validToStoryOrder) {
    throw new EntityRelationshipDomainError('Relationship start order must not be greater than its end order.')
  }
  return { validFromStoryOrder, validToStoryOrder }
}

export function relationshipOccursAt(relationship: RelationshipTimeRange, storyOrder: number | null | undefined): boolean {
  const range = validateRelationshipTimeRange(relationship)
  if (storyOrder === null || storyOrder === undefined) return true
  const checkedOrder = validateStoryOrder(storyOrder, 'storyOrder')
  if (checkedOrder === null) return true
  return (range.validFromStoryOrder === null || range.validFromStoryOrder <= checkedOrder)
    && (range.validToStoryOrder === null || checkedOrder <= range.validToStoryOrder)
}

export function canonicalizeRelationshipEndpoints(input: {
  sourceEntityId?: string | null
  targetEntityId?: string | null
  sourceLabel?: string
  targetLabel?: string
  directionality: EntityRelationshipDirectionality
}): CanonicalRelationshipEndpoints {
  const sourceEntityId = normalizeOptionalIdentifier(input.sourceEntityId)
  const targetEntityId = normalizeOptionalIdentifier(input.targetEntityId)
  const sourceLabel = normalizeRelationshipText(input.sourceLabel ?? '')
  const targetLabel = normalizeRelationshipText(input.targetLabel ?? '')
  const sourceReference = endpointReference(sourceEntityId, sourceLabel)
  const targetReference = endpointReference(targetEntityId, targetLabel)
  if (!sourceReference || !targetReference) {
    throw new EntityRelationshipDomainError('Both relationship endpoints need an entity id or a label.')
  }
  const swapped = input.directionality === 'symmetric' && compareText(sourceReference, targetReference) > 0
  return swapped
    ? { sourceEntityId: targetEntityId, targetEntityId: sourceEntityId, sourceLabel: targetLabel, targetLabel: sourceLabel, sourceReference: targetReference, targetReference: sourceReference, swapped }
    : { sourceEntityId, targetEntityId, sourceLabel, targetLabel, sourceReference, targetReference, swapped }
}

export function relationshipFingerprint(input: RelationshipFingerprintInput): string {
  const predicateKey = normalizeRelationshipPredicateKey(input.predicateKey)
  if (!predicateKey) throw new EntityRelationshipDomainError('Relationship predicate key must not be empty.')
  const endpoints = canonicalizeRelationshipEndpoints(input)
  const range = validateRelationshipTimeRange(input)
  return JSON.stringify([
    'entity-relationship',
    1,
    input.directionality,
    endpoints.sourceReference,
    endpoints.targetReference,
    predicateKey,
    input.factLayer,
    range.validFromStoryOrder,
    range.validToStoryOrder,
  ])
}

export function relationshipCandidateConfirmability(candidate: EntityRelationshipCandidate): RelationshipCandidateConfirmability {
  const issues: RelationshipCandidateConfirmIssue[] = []
  if (candidate.status === 'confirmed' || candidate.status === 'rejected') issues.push('already_decided')
  if (!normalizeOptionalIdentifier(candidate.sourceEntityId)) issues.push('missing_source_entity')
  if (!normalizeOptionalIdentifier(candidate.targetEntityId)) issues.push('missing_target_entity')
  if (candidate.sourceEntityId && candidate.targetEntityId && candidate.sourceEntityId === candidate.targetEntityId) issues.push('same_entity')
  if (!normalizeRelationshipPredicateKey(candidate.predicateKey)) issues.push('missing_predicate')
  if (!normalizeRelationshipText(candidate.label)) issues.push('missing_label')
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) issues.push('invalid_confidence')
  try {
    validateRelationshipTimeRange(candidate)
  } catch {
    issues.push('invalid_time_range')
  }
  return { ok: issues.length === 0, issues }
}

export function applyRelationshipCandidateDecision(
  candidate: EntityRelationshipCandidate,
  decision: RelationshipCandidateDecision,
): EntityRelationshipCandidate {
  if (candidate.status === 'confirmed' || candidate.status === 'rejected') {
    throw new EntityRelationshipDomainError('A decided relationship candidate cannot be decided again.')
  }
  if (decision.action === 'reject') {
    return { ...candidate, status: 'rejected', updatedAt: decision.decidedAt ?? candidate.updatedAt }
  }

  const directionality = decision.directionality ?? candidate.directionality
  const endpoints = canonicalizeRelationshipEndpoints({
    sourceEntityId: decision.sourceEntityId ?? candidate.sourceEntityId,
    targetEntityId: decision.targetEntityId ?? candidate.targetEntityId,
    sourceLabel: decision.sourceLabel ?? candidate.sourceLabel,
    targetLabel: decision.targetLabel ?? candidate.targetLabel,
    directionality,
  })
  const next: EntityRelationshipCandidate = {
    ...candidate,
    sourceEntityId: endpoints.sourceEntityId,
    targetEntityId: endpoints.targetEntityId,
    sourceLabel: endpoints.sourceLabel,
    targetLabel: endpoints.targetLabel,
    predicateKey: normalizeRelationshipPredicateKey(decision.predicateKey ?? candidate.predicateKey),
    label: normalizeRelationshipText(decision.label ?? candidate.label),
    category: decision.category ?? candidate.category,
    directionality,
    factLayer: decision.factLayer ?? candidate.factLayer,
    validFromStoryOrder: decision.validFromStoryOrder === undefined ? candidate.validFromStoryOrder : decision.validFromStoryOrder,
    validToStoryOrder: decision.validToStoryOrder === undefined ? candidate.validToStoryOrder : decision.validToStoryOrder,
    status: 'confirmed',
    updatedAt: decision.decidedAt ?? candidate.updatedAt,
    fingerprint: '',
  }
  const confirmability = relationshipCandidateConfirmability({ ...next, status: 'pending' })
  if (!confirmability.ok) {
    throw new EntityRelationshipDomainError(`Relationship candidate cannot be confirmed: ${confirmability.issues.join(', ')}.`)
  }
  return {
    ...next,
    fingerprint: relationshipFingerprint(next),
  }
}

export function buildRelationshipNeighborhood(
  nodes: readonly RelationshipEntityNode[],
  relationships: readonly EntityRelationship[],
  options: RelationshipNeighborhoodOptions = {},
): RelationshipNeighborhood {
  const nodeIndex = uniqueNodes(nodes)
  const sortedNodes = [...nodeIndex.values()].sort(compareNode)
  if (sortedNodes.length === 0) return emptyNeighborhood()

  const maxDepth = options.maxDepth === 1 ? 1 : RELATIONSHIP_NEIGHBORHOOD_LIMITS.defaultDepth
  const maxNodes = boundedInteger(options.maxNodes, RELATIONSHIP_NEIGHBORHOOD_LIMITS.defaultNodes, RELATIONSHIP_NEIGHBORHOOD_LIMITS.maximumNodes)
  const maxRelationships = boundedInteger(options.maxRelationships, RELATIONSHIP_NEIGHBORHOOD_LIMITS.defaultRelationships, RELATIONSHIP_NEIGHBORHOOD_LIMITS.maximumRelationships)
  const factLayers = options.factLayers ? new Set(options.factLayers) : null
  const categories = options.categories ? new Set(options.categories) : null
  const eligibleRelationships = relationships
    .filter(relationship => (options.includeSuperseded || relationship.status === 'active')
      && nodeIndex.has(relationship.sourceEntityId)
      && nodeIndex.has(relationship.targetEntityId)
      && (!factLayers || factLayers.has(relationship.factLayer))
      && (!categories || categories.has(relationship.category))
      && relationshipOccursAt(relationship, options.atStoryOrder))
    .sort(compareRelationship)

  const adjacency = new Map<string, Array<{ entityId: string; relationship: EntityRelationship }>>()
  const degree = new Map<string, number>()
  for (const relationship of eligibleRelationships) {
    appendAdjacency(adjacency, relationship.sourceEntityId, relationship.targetEntityId, relationship)
    appendAdjacency(adjacency, relationship.targetEntityId, relationship.sourceEntityId, relationship)
    degree.set(relationship.sourceEntityId, (degree.get(relationship.sourceEntityId) ?? 0) + 1)
    degree.set(relationship.targetEntityId, (degree.get(relationship.targetEntityId) ?? 0) + 1)
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => compareNode(nodeIndex.get(left.entityId)!, nodeIndex.get(right.entityId)!) || compareRelationship(left.relationship, right.relationship))
  }

  const requestedRoot = normalizeOptionalIdentifier(options.rootEntityId)
  const rootEntityId = requestedRoot && nodeIndex.has(requestedRoot)
    ? requestedRoot
    : [...sortedNodes].sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || compareNode(left, right))[0]?.id ?? null
  if (!rootEntityId) return emptyNeighborhood()

  const depths = new Map<string, number>([[rootEntityId, 0]])
  const visitOrder: string[] = [rootEntityId]
  for (let cursor = 0; cursor < visitOrder.length; cursor += 1) {
    const entityId = visitOrder[cursor]!
    const depth = depths.get(entityId)!
    if (depth >= maxDepth) continue
    for (const neighbor of adjacency.get(entityId) ?? []) {
      if (depths.has(neighbor.entityId)) continue
      depths.set(neighbor.entityId, depth + 1)
      visitOrder.push(neighbor.entityId)
    }
  }

  const selectedIds = visitOrder.slice(0, maxNodes)
  const selectedSet = new Set(selectedIds)
  const selectedRelationships = eligibleRelationships.filter(relationship => selectedSet.has(relationship.sourceEntityId) && selectedSet.has(relationship.targetEntityId))
  const returnedRelationships = selectedRelationships.slice(0, maxRelationships)
  const returnedNodes = selectedIds.map(entityId => ({
    ...nodeIndex.get(entityId)!,
    depth: depths.get(entityId)!,
    degree: degree.get(entityId) ?? 0,
  }))

  return {
    rootEntityId,
    nodes: returnedNodes,
    relationships: returnedRelationships,
    totalReachableNodes: visitOrder.length,
    totalEligibleRelationships: eligibleRelationships.length,
    truncated: {
      nodes: visitOrder.length > returnedNodes.length,
      relationships: selectedRelationships.length > returnedRelationships.length,
    },
  }
}

export function layoutRelationshipNeighborhood(
  neighborhood: RelationshipNeighborhood,
  options: RelationshipLayoutOptions = {},
): RelationshipLayout {
  const width = boundedDimension(options.width, 760, 320, 1600)
  const height = boundedDimension(options.height, 480, 280, 1000)
  const padding = boundedDimension(options.padding, 62, 36, Math.max(36, Math.min(width, height) / 3))
  const centerX = width / 2
  const centerY = height / 2
  const availableX = Math.max(1, centerX - padding)
  const availableY = Math.max(1, centerY - padding)
  const rings = new Map<number, RelationshipNeighborhoodNode[]>()
  for (const node of neighborhood.nodes) {
    const ring = rings.get(node.depth) ?? []
    ring.push(node)
    rings.set(node.depth, ring)
  }
  for (const ring of rings.values()) ring.sort(compareNode)

  const positioned: RelationshipLayoutNode[] = []
  for (const [depth, ring] of [...rings.entries()].sort(([left], [right]) => left - right)) {
    if (depth === 0) {
      for (const node of ring) positioned.push({ ...node, x: roundCoordinate(centerX), y: roundCoordinate(centerY) })
      continue
    }
    const radiusFactor = depth === 1 ? 0.56 : 1
    const angleOffset = -Math.PI / 2 + (depth === 2 ? Math.PI / Math.max(ring.length, 1) : 0)
    ring.forEach((node, index) => {
      const angle = angleOffset + (Math.PI * 2 * index) / Math.max(ring.length, 1)
      positioned.push({
        ...node,
        x: roundCoordinate(centerX + Math.cos(angle) * availableX * radiusFactor),
        y: roundCoordinate(centerY + Math.sin(angle) * availableY * radiusFactor),
      })
    })
  }
  return { width, height, nodes: positioned }
}

function validateStoryOrder(value: number | null, field: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value)) throw new EntityRelationshipDomainError(`${field} must be a safe integer or null.`)
  return value
}

function normalizeOptionalIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = normalizeRelationshipText(value)
  return normalized || null
}

function endpointReference(entityId: string | null, label: string): string {
  if (entityId) return `id:${entityId}`
  const normalizedLabel = normalizeRelationshipText(label).toLowerCase()
  return normalizedLabel ? `label:${normalizedLabel}` : ''
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNode(left: RelationshipEntityNode, right: RelationshipEntityNode): number {
  const leftName = normalizeRelationshipText(left.name).toLowerCase()
  const rightName = normalizeRelationshipText(right.name).toLowerCase()
  return compareText(leftName, rightName) || compareText(left.id, right.id)
}

function compareRelationship(left: EntityRelationship, right: EntityRelationship): number {
  const leftKey = left.fingerprint || relationshipFingerprint(left)
  const rightKey = right.fingerprint || relationshipFingerprint(right)
  return compareText(leftKey, rightKey) || compareText(left.id, right.id)
}

function uniqueNodes(nodes: readonly RelationshipEntityNode[]): Map<string, RelationshipEntityNode> {
  const index = new Map<string, RelationshipEntityNode>()
  for (const node of [...nodes].sort(compareNode)) {
    const id = normalizeOptionalIdentifier(node.id)
    if (!id || index.has(id)) continue
    index.set(id, { ...node, id, name: normalizeRelationshipText(node.name) || id })
  }
  return index
}

function appendAdjacency(
  adjacency: Map<string, Array<{ entityId: string; relationship: EntityRelationship }>>,
  sourceEntityId: string,
  targetEntityId: string,
  relationship: EntityRelationship,
): void {
  const neighbors = adjacency.get(sourceEntityId) ?? []
  neighbors.push({ entityId: targetEntityId, relationship })
  adjacency.set(sourceEntityId, neighbors)
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(maximum, Math.floor(value)))
}

function boundedDimension(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, value))
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100
}

function emptyNeighborhood(): RelationshipNeighborhood {
  return {
    rootEntityId: null,
    nodes: [],
    relationships: [],
    totalReachableNodes: 0,
    totalEligibleRelationships: 0,
    truncated: { nodes: false, relationships: false },
  }
}
