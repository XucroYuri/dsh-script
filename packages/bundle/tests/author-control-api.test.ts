import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomainError, type ChapterGenerationBatch, type MemoryItem, type RelationshipCandidateBatchDecision } from '../src/domain/model.js'
import type { GenerationService } from '../src/generation/service.js'
import type { FoundationGenerationRunner } from '../src/generation/foundation-runner.js'
import type { FoundationInteractionDriver } from '../src/generation/foundation-interaction.js'
import { handleNovelApi } from '../src/host-api/api.js'
import type { NovelRepository } from '../src/storage/repository.js'
import type { WorkflowEngine } from '../src/workflow/engine.js'
import type { WorkflowRunner } from '../src/workflow/runner.js'

const BASE_PATH = '/api/novel-studio/v1'
const servers: ReturnType<typeof createServer>[] = []

function batchFixture(input: Partial<ChapterGenerationBatch> = {}): ChapterGenerationBatch {
  return {
    id: 'batch-1', projectId: 'project-1', mode: 'selected', automationMode: 'auto', status: 'queued', requestedCount: 2,
    policyJson: '{}', revision: 1, errorJson: null, plan: null, items: [], createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z', startedAt: null, finishedAt: null, ...input,
  }
}

function memoryFixture(input: Partial<MemoryItem> = {}): MemoryItem {
  const currentRevision = {
    id: 'memory-revision-1', itemId: 'memory-1', revision: 1, content: '人物绝不失信。', structuredJson: '{}', contentHash: 'hash',
    actor: 'user' as const, parentRevisionId: null, provider: null, model: null, promptHash: null, createdAt: '2026-08-27T00:00:00.000Z',
  }
  return {
    id: 'memory-1', projectId: 'project-1', origin: 'user', storage: 'database', scope: 'project', category: 'constraint', state: 'active',
    promptPolicy: 'auto', sourceKey: 'user:memory-1', revision: 1, currentRevision, sources: [], recentUsages: [],
    createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', ...input,
  }
}

async function apiServer(
  repository: Partial<NovelRepository>,
  runnerInput: Partial<WorkflowRunner> = {},
  planImpl?: (batchId: string) => Promise<ChapterGenerationBatch>,
) {
  const planChapterBatch = vi.fn(planImpl ?? (async (batchId: string) => repository.getChapterBatch?.(batchId) ?? batchFixture({ id: batchId })))
  const generation = {
    status: () => ({ selection: { provider: 'deepseek', model: 'deepseek-v4' }, providers: [], ready: true }),
    planChapterBatch,
  } as unknown as GenerationService
  const runner = { resume: vi.fn(), retry: vi.fn(), ...runnerInput } as unknown as WorkflowRunner
  const unavailable = undefined as unknown as FoundationGenerationRunner & FoundationInteractionDriver & WorkflowEngine
  const server = createServer((req, res) => {
    void handleNovelApi(req, res, repository as NovelRepository, generation, unavailable, unavailable, unavailable, runner, BASE_PATH)
  })
  servers.push(server)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address() as AddressInfo
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${BASE_PATH}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    })
    return { status: response.status, body: await response.json() as any }
  }
  return { request, runner, planChapterBatch }
}

afterEach(async () => {
  const pending = servers.splice(0)
  await Promise.all(pending.map(server => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error) reject(error); else resolve() })
  })))
})

describe('Novel Studio 0.8 author-control Host API', () => {
  it('returns the persisted batch before background planning completes', async () => {
    const planning = batchFixture({ status: 'planning' })
    let finishPlanning!: (batch: ChapterGenerationBatch) => void
    const repository: Partial<NovelRepository> = {
      createChapterBatch: vi.fn(() => planning),
      getChapterBatch: vi.fn(() => planning),
    }
    const { request, planChapterBatch } = await apiServer(repository, {}, async () => new Promise(resolve => { finishPlanning = resolve }))
    const response = await request('/projects/project-1/batches', {
      method: 'POST', body: JSON.stringify({ mode: 'selected', chapterIds: ['chapter-1', 'chapter-2'], count: 2, projectRevision: 42 }),
    })
    expect(response).toMatchObject({ status: 202, body: { id: 'batch-1', status: 'planning' } })
    await vi.waitFor(() => { expect(planChapterBatch).toHaveBeenCalledWith('batch-1') })
    finishPlanning(batchFixture({ status: 'awaiting_plan_approval' }))
  })

  it('routes batch creation, planning approval, queue controls, retry, reorder, skip, and cancellation', async () => {
    let current = batchFixture()
    const repository: Partial<NovelRepository> = {
      createChapterBatch: vi.fn(() => current),
      listChapterBatches: vi.fn(() => [current]),
      getChapterBatch: vi.fn(() => current),
      getProjectTree: vi.fn(() => ({ project: { revision: 42 } }) as any),
      approveChapterBatchPlan: vi.fn(() => current),
      reorderChapterBatch: vi.fn(() => current),
      setChapterBatchRuntimeStatus: vi.fn((_id, status) => {
        current = batchFixture({ ...current, status, plan: current.plan ? { ...current.plan, status: status === 'planning' ? 'planning' : current.plan.status } : null })
        return current
      }),
      setChapterBatchStatus: vi.fn((_id, action) => {
        current = batchFixture({ ...current, status: action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'running' })
        return current
      }),
      dispatchNextBatchItem: vi.fn(() => ({ batch: current, workflow: null })),
      retryChapterBatchItem: vi.fn(() => ({ batch: current, workflow: { id: 'workflow-1' } as any })),
      skipChapterBatchItem: vi.fn(() => current),
    }
    const { request, runner, planChapterBatch } = await apiServer(repository)

    const created = await request('/projects/project-1/batches', { method: 'POST', body: JSON.stringify({ mode: 'selected', chapterIds: ['chapter-2', 'chapter-1'], count: 2, projectRevision: 42 }) })
    expect(created.status).toBe(202)
    expect(repository.createChapterBatch).toHaveBeenCalledWith('project-1', {
      mode: 'selected', automationMode: 'auto', chapterIds: ['chapter-2', 'chapter-1'], startChapterId: undefined, count: 2,
    }, { provider: 'deepseek', model: 'deepseek-v4' }, 42)
    await vi.waitFor(() => { expect(planChapterBatch).toHaveBeenCalledWith('batch-1') })

    const unconfirmedYolo = await request('/projects/project-1/batches', { method: 'POST', body: JSON.stringify({ mode: 'continuous', automationMode: 'yolo', startChapterId: 'chapter-1', count: 3, projectRevision: 42 }) })
    expect(unconfirmedYolo).toMatchObject({ status: 400, body: { error: { code: 'validation' } } })
    current = batchFixture({
      automationMode: 'yolo', status: 'awaiting_plan_approval', requestedCount: 3,
      items: [{ id: 'yolo-item-1', plannedTitle: '自动章', writingGoal: '继续故事', openingContinuity: '承接', endingHook: '钩子', targetWords: 2600 }] as ChapterGenerationBatch['items'],
    })
    const confirmedYolo = await request('/projects/project-1/batches', { method: 'POST', body: JSON.stringify({ mode: 'continuous', automationMode: 'yolo', startChapterId: 'chapter-1', count: 3, confirmed: true, projectRevision: 42 }) })
    expect(confirmedYolo).toMatchObject({ status: 202, body: { automationMode: 'yolo', status: 'awaiting_plan_approval' } })
    await vi.waitFor(() => { expect(repository.approveChapterBatchPlan).toHaveBeenCalledWith('batch-1', expect.any(Array), 42) })
    current = batchFixture()
    const listed = await request('/projects/project-1/batches')
    const detailed = await request('/batches/batch-1')
    expect(listed.body[0].id).toBe('batch-1')
    expect(detailed.body.id).toBe('batch-1')

    const approved = await request('/batches/batch-1/approve-plan', { method: 'POST', body: JSON.stringify({
      baseRevision: 1,
      projectRevision: 42,
      items: [
        { id: 'item-1', plannedTitle: '一', writingGoal: '目标一', openingContinuity: '', endingHook: '钩子一', targetWords: 2500 },
        { id: 'item-2', plannedTitle: '二', writingGoal: '目标二', openingContinuity: '承接一', endingHook: '钩子二', targetWords: 2600 },
      ],
    }) })
    expect(approved.status).toBe(200)
    expect(repository.approveChapterBatchPlan).toHaveBeenCalledWith('batch-1', expect.any(Array), 42)

    expect((await request('/batches/batch-1/reorder', { method: 'POST', body: JSON.stringify({ itemIds: ['item-2', 'item-1'], baseRevision: 1, projectRevision: 42 }) })).status).toBe(200)
    expect(repository.reorderChapterBatch).toHaveBeenCalledWith('batch-1', ['item-2', 'item-1'], 42)
    expect((await request('/batches/batch-1/start', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })).status).toBe(202)
    expect((await request('/batches/batch-1/pause', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })).status).toBe(200)
    expect((await request('/batches/batch-1/resume', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })).status).toBe(202)
    expect((await request('/batches/batch-1/items/item-2/skip', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })).status).toBe(200)

    current = batchFixture({ status: 'blocked', items: [{ id: 'item-1', queueState: 'blocked', workflowRunId: 'workflow-1', workflow: { id: 'workflow-1', status: 'failed' } }] as ChapterGenerationBatch['items'] })
    expect((await request('/batches/batch-1/retry', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })).status).toBe(202)
    expect(repository.retryChapterBatchItem).toHaveBeenCalledWith('batch-1', 'item-1', 42)
    expect(runner.resume).toHaveBeenCalledWith('workflow-1')
    current = batchFixture({
      status: 'blocked', items: [],
      plan: { id: 'plan-1', batchId: 'batch-1', status: 'failed', provider: 'deepseek', model: 'deepseek-v4', promptHash: '', inputSnapshotJson: '{}', outputJson: null, streamedText: '', errorJson: '{"message":"bad plan"}', createdAt: current.createdAt, updatedAt: current.updatedAt, finishedAt: current.updatedAt },
    })
    const retriedPlan = await request('/batches/batch-1/retry', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })
    expect(retriedPlan).toMatchObject({ status: 202, body: { status: 'planning', plan: { status: 'planning' } } })
    expect(repository.setChapterBatchRuntimeStatus).toHaveBeenCalledWith('batch-1', 'planning')
    expect((await request('/batches/batch-1/cancel', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })).status).toBe(200)
  })

  it('routes Memory Browser search, facets, immutable history, diff, CRUD, rescan, conflict resolution, and 409 errors', async () => {
    const memory = memoryFixture()
    const page = { items: [memory], total: 1, nextCursor: null, facets: { category: { constraint: 1 } } }
    const repository: Partial<NovelRepository> = {
      searchMemory: vi.fn(() => page),
      getMemoryItem: vi.fn(() => memory),
      listMemoryRevisions: vi.fn(() => [{ ...memory.currentRevision, sources: [] }]),
      getMemoryRevisionDiff: vi.fn(() => ({ from: memory.currentRevision, to: { ...memory.currentRevision, id: 'memory-revision-2', revision: 2 }, lines: [] })),
      listMemoryUsages: vi.fn(() => ({ items: [{ id: 'usage-1', itemId: memory.id, revisionId: memory.currentRevision.id, modelRunId: 'model-run-1', sectionKey: `memory:${memory.id}`, included: true, truncated: false, estimatedTokens: 18, reason: '按作者约束纳入', createdAt: memory.updatedAt }], total: 31, nextCursor: '30' })),
      createUserMemory: vi.fn(() => memory),
      updateUserMemory: vi.fn((itemId) => {
        if (itemId === 'conflict') throw new DomainError('revision-conflict', 'Memory changed.')
        return memory
      }),
      restoreMemoryRevision: vi.fn(() => memory),
      setMemoryItemArchived: vi.fn(() => memoryFixture({ state: 'archived' })),
      rescanMemoryMarkdown: vi.fn(() => ({ changed: 1, conflicts: [] })),
      listMemoryConflicts: vi.fn(() => []),
      resolveMemoryConflict: vi.fn(() => memory),
    }
    const { request } = await apiServer(repository)

    const searched = await request('/projects/project-1/memory?q=%E4%BA%BA%E7%89%A9&origin=user&storage=database&category=constraint&used=used&limit=25')
    expect(searched.body).toMatchObject({ total: 1, facets: { category: { constraint: 1 } } })
    expect(repository.searchMemory).toHaveBeenCalledWith('project-1', expect.objectContaining({ q: '人物', origin: 'user', storage: 'database', category: 'constraint', used: 'used', limit: 25 }))
    expect((await request('/projects/project-1/memory/facets?state=active')).body).toEqual(page.facets)
    expect((await request('/memory/memory-1')).body.currentRevision.id).toBe('memory-revision-1')
    expect((await request('/memory/memory-1/revisions')).body[0].id).toBe('memory-revision-1')
    expect((await request('/memory/memory-1/usages?limit=30&cursor=0')).body).toMatchObject({ total: 31, nextCursor: '30', items: [{ modelRunId: 'model-run-1', sectionKey: 'memory:memory-1' }] })
    expect(repository.listMemoryUsages).toHaveBeenCalledWith('memory-1', { cursor: '0', limit: 30 })
    expect((await request('/memory/memory-1/diff?from=revision-a&to=revision-b')).status).toBe(200)
    expect(repository.getMemoryRevisionDiff).toHaveBeenCalledWith('memory-1', 'revision-a', 'revision-b')

    expect((await request('/projects/project-1/memory', { method: 'POST', body: JSON.stringify({ content: '硬约束', scope: 'project', category: 'constraint', projectRevision: 42 }) })).status).toBe(201)
    expect((await request('/memory/memory-1', { method: 'POST', body: JSON.stringify({ content: '新版', promptPolicy: 'auto', baseRevision: 1, projectRevision: 42 }) })).status).toBe(200)
    expect((await request('/memory/memory-1/restore', { method: 'POST', body: JSON.stringify({ revisionId: 'memory-revision-1', baseRevision: 2, projectRevision: 42 }) })).status).toBe(200)
    expect((await request('/memory/memory-1/archive', { method: 'POST', body: JSON.stringify({ baseRevision: 3, projectRevision: 42 }) })).body.state).toBe('archived')
    expect((await request('/projects/project-1/memory/rescan', { method: 'POST', body: JSON.stringify({ projectRevision: 42 }) })).body.changed).toBe(1)
    expect((await request('/projects/project-1/memory/conflicts')).body).toEqual([])
    expect((await request('/memory/memory-1/conflicts/conflict-1/resolve', { method: 'POST', body: JSON.stringify({ resolution: 'merged', mergedContent: '作者合并稿', baseRevision: 4, projectRevision: 42 }) })).status).toBe(200)
    expect(repository.resolveMemoryConflict).toHaveBeenCalledWith('memory-1', 'conflict-1', 'merged', 4, 42, '作者合并稿')

    const conflict = await request('/memory/conflict', { method: 'POST', body: JSON.stringify({ content: 'stale', baseRevision: 0, projectRevision: 42 }) })
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'revision-conflict' } } })
  })

  it('routes relationship permissions, bounded graph filters, candidates, decisions, manual creation, and revision', async () => {
    const relationship = { id: 'relationship-1', projectId: 'project-1' } as any
    const candidate = { id: 'candidate-1', status: 'pending', evidenceJson: '[]' } as any
    const relationshipPage = { items: [relationship], total: 51, nextCursor: '40' }
    const extractionRun = { id: 'relationship-run-1', projectId: 'project-1', status: 'waiting_review', candidateCount: 3, pendingCount: 1 } as any
    const repository: Partial<NovelRepository> = {
      getRelationshipMode: vi.fn(() => 'off' as const),
      setRelationshipMode: vi.fn(() => 'auto' as const),
      getRelationshipGraph: vi.fn(() => ({ projectId: 'project-1', mode: 'auto' as const, nodes: [], edges: [], pendingCount: 1, truncated: false })),
      listEntityRelationships: vi.fn(() => relationshipPage),
      listRelationshipExtractionRuns: vi.fn(() => [extractionRun]),
      listRelationshipCandidates: vi.fn(() => [candidate]),
      getRelationshipEvidence: vi.fn(() => [{
        id: 'evidence-1', relationshipId: 'relationship-1', sourceType: 'manuscript-version', sourceId: 'version-1', sourceVersionId: 'version-1',
        label: '第 3 章', excerptStart: 12, excerptEnd: 24, contentHash: 'hash', excerpt: '二人并肩迎敌。', createdAt: '2026-08-27T00:00:00.000Z',
      }]),
      decideRelationshipCandidate: vi.fn((_projectId, _candidateId, decision) => decision === 'confirm' ? relationship : null),
      decideRelationshipCandidates: vi.fn((_projectId: string, decisions: RelationshipCandidateBatchDecision[]) => decisions.map(item => ({ candidateId: item.candidateId, decision: item.decision, relationship: item.decision === 'confirm' ? relationship : null }))),
      createEntityRelationship: vi.fn(() => relationship),
      reviseEntityRelationship: vi.fn(() => relationship),
    }
    const { request } = await apiServer(repository)

    expect((await request('/projects/project-1/relationships/mode')).body).toEqual({ mode: 'off' })
    expect((await request('/projects/project-1/relationships/mode', { method: 'POST', body: JSON.stringify({ mode: 'auto', baseRevision: 9 }) })).body).toEqual({ mode: 'auto' })
    expect(repository.setRelationshipMode).toHaveBeenCalledWith('project-1', 'auto', 9)

    const graph = await request('/projects/project-1/relationships/graph?rootEntityId=entity-1&depth=2&categories=alliance,conflict&factLayers=canon&atStoryOrder=12&limitNodes=70&limitEdges=150')
    expect(graph.body.pendingCount).toBe(1)
    expect(repository.getRelationshipGraph).toHaveBeenCalledWith('project-1', {
      rootEntityId: 'entity-1', depth: 2, categories: ['alliance', 'conflict'], factLayers: ['canon'], atStoryOrder: 12, limitNodes: 70, limitEdges: 150,
    })
    const formal = await request('/projects/project-1/relationships?q=%E7%9B%9F%E5%8F%8B&categories=alliance&factLayers=canon&atStoryOrder=12&cursor=20&limit=40')
    expect(formal.body).toEqual(relationshipPage)
    expect(repository.listEntityRelationships).toHaveBeenCalledWith('project-1', {
      q: '盟友', categories: ['alliance'], factLayers: ['canon'], atStoryOrder: 12, cursor: '20', limit: 40,
    })
    expect((await request('/projects/project-1/relationships/runs?limit=12')).body).toEqual([extractionRun])
    expect(repository.listRelationshipExtractionRuns).toHaveBeenCalledWith('project-1', 12)
    expect((await request('/projects/project-1/relationships/candidates?status=pending')).body[0].id).toBe('candidate-1')

    const confirmed = await request('/projects/project-1/relationships/candidates/candidate-1/confirm', { method: 'POST', body: JSON.stringify({
      sourceEntityId: 'entity-1', targetEntityId: 'entity-2', label: '盟友', predicateKey: 'allied-with', category: 'alliance',
      directionality: 'symmetric', factLayer: 'author_asserted', validFromStoryOrder: 3, validToStoryOrder: 8, projectRevision: 9,
    }) })
    expect(confirmed.body.id).toBe('relationship-1')
    expect(repository.decideRelationshipCandidate).toHaveBeenCalledWith('project-1', 'candidate-1', 'confirm', expect.objectContaining({
      sourceEntityId: 'entity-1', targetEntityId: 'entity-2', label: '盟友', predicateKey: 'allied-with', category: 'alliance',
      directionality: 'symmetric', factLayer: 'author_asserted', validFromStoryOrder: 3, validToStoryOrder: 8,
    }), 9)
    expect((await request('/projects/project-1/relationships/candidates/candidate-1/reject', { method: 'POST', body: JSON.stringify({ projectRevision: 9 }) })).status).toBe(200)
    const batch = await request('/projects/project-1/relationships/candidates/batch', { method: 'POST', body: JSON.stringify({
      projectRevision: 10,
      decisions: [
        { candidateId: 'candidate-1', decision: 'confirm', sourceEntityId: 'entity-2', targetEntityId: 'entity-3', label: '支援', predicateKey: 'supports', category: 'alliance', directionality: 'directed', factLayer: 'planned', validFromStoryOrder: 5, validToStoryOrder: null },
        { candidateId: 'candidate-2', decision: 'reject' },
      ],
    }) })
    expect(batch.body).toHaveLength(2)
    expect(repository.decideRelationshipCandidates).toHaveBeenCalledWith('project-1', [
      expect.objectContaining({ candidateId: 'candidate-1', decision: 'confirm', input: expect.objectContaining({ sourceEntityId: 'entity-2', targetEntityId: 'entity-3', predicateKey: 'supports', validToStoryOrder: null }) }),
      { candidateId: 'candidate-2', decision: 'reject' },
    ], 10)
    const evidence = await request('/projects/project-1/relationships/relationship-1/evidence')
    expect(evidence.body[0]).toMatchObject({ id: 'evidence-1', excerpt: '二人并肩迎敌。' })
    expect(repository.getRelationshipEvidence).toHaveBeenCalledWith('project-1', 'relationship-1')

    const relationshipBody = {
      sourceEntityId: 'entity-1', targetEntityId: 'entity-2', predicateKey: 'allied_with', label: '盟友', category: 'alliance',
      directionality: 'symmetric', factLayer: 'author_asserted', validFromStoryOrder: 3, validToStoryOrder: null, baseRevision: 10,
    }
    expect((await request('/projects/project-1/relationships', { method: 'POST', body: JSON.stringify(relationshipBody) })).status).toBe(201)
    expect(repository.createEntityRelationship).toHaveBeenCalledWith('project-1', expect.objectContaining({ predicateKey: 'allied_with', validToStoryOrder: null }), 10)
    expect((await request('/projects/project-1/relationships/relationship-1/revise', { method: 'POST', body: JSON.stringify({ ...relationshipBody, label: '生死盟友', baseRevision: 11 }) })).status).toBe(200)
    expect(repository.reviseEntityRelationship).toHaveBeenCalledWith('project-1', 'relationship-1', expect.objectContaining({ label: '生死盟友' }), 11)

    const invalidGraph = await request('/projects/project-1/relationships/graph?categories=unknown')
    expect(invalidGraph).toMatchObject({ status: 400, body: { error: { code: 'validation' } } })
  })
})
