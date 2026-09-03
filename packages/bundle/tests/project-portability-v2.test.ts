import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { DomainError } from '../src/domain/model.js'
import {
  normalizePortableProjectSnapshot,
  PORTABLE_PROJECT_FORMAT,
  PORTABLE_PROJECT_SCHEMA_VERSION,
  PORTABLE_PROJECT_SCHEMA_VERSION_V1,
  type PortableProjectSnapshotV1,
  type PortableProjectSnapshotV2,
} from '../src/domain/project-portability.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'

const at = (second: number): string => `2026-08-27T00:00:${String(second).padStart(2, '0')}.000Z`
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function v1Snapshot(): PortableProjectSnapshotV1 {
  const content = '批准正文。'
  return {
    format: PORTABLE_PROJECT_FORMAT,
    schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION_V1,
    exportedAt: at(9),
    project: {
      title: '迁移测试', language: 'zh-CN', genre: '悬疑', audience: null,
      targetWordCount: 300_000, chapterTargetWords: 2_500, revision: 7, currentBookKey: 'book-1',
    },
    projectRules: { styleRules: '短句。', chapterGoal: '推进谜团。', forbiddenContent: '', revision: 2 },
    styleProfile: {
      presetId: 'web-fast', source: 'builtin', name: '网文快节奏', summary: '', sampleHash: null, revision: 1,
      attributes: {
        narrativeVoice: '', pointOfView: '', tense: '', sentenceRhythm: '', paragraphRhythm: '', dialogueStyle: '',
        descriptionStyle: '', emotionalCadence: '', pacing: '', imagery: '', expansionRules: [], avoid: [],
      },
    },
    books: [{
      key: 'book-1', title: '第一册', position: 1, createdAt: at(0),
      volumes: [{ key: 'volume-1', title: '第一卷', position: 1, createdAt: at(0) }],
      chapters: [{
        key: 'chapter-1', volumeKey: 'volume-1', chapterNumber: 1, title: '第一章 雾港', status: 'approved',
        currentDraftVersionKey: 'version-1', currentApprovedVersionKey: 'version-1', revision: 1,
        createdAt: at(0), updatedAt: at(1),
        versions: [{
          key: 'version-1', parentVersionKey: null, status: 'approved', content, contentHash: sha256(content),
          wordCount: 5, origin: 'user', createdBy: 'user', createdAt: at(0), approvedAt: at(1),
        }],
      }],
    }],
    foundations: [],
  }
}

function v2Snapshot(): PortableProjectSnapshotV2 {
  const base = v1Snapshot()
  const firstMemory = '主角不能主动说出真名。'
  const currentMemory = '主角在第十章前不能主动说出真名。'
  return {
    ...base,
    schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION,
    authorMemories: [{
      key: 'memory-1', origin: 'user', scope: 'project', category: 'constraint', state: 'active', promptPolicy: 'auto',
      sourceKey: 'author-memory-1', revision: 3, currentRevisionKey: 'memory-revision-2', createdAt: at(1), updatedAt: at(5),
      revisions: [{
        key: 'memory-revision-1', revision: 1, content: firstMemory, structuredJson: '{}', contentHash: sha256(firstMemory),
        actor: 'user', parentRevisionKey: null, provider: null, model: null, promptHash: null, createdAt: at(1),
        sources: [{
          key: 'memory-source-1', sourceType: 'manuscript-version', sourceKey: 'chapter-1', sourceVersionKey: 'version-1',
          label: '第一章批准版', createdAt: at(1),
        }],
      }, {
        key: 'memory-revision-2', revision: 2, content: currentMemory, structuredJson: '{"deadline":10}', contentHash: sha256(currentMemory),
        actor: 'user', parentRevisionKey: 'memory-revision-1', provider: null, model: null, promptHash: null, createdAt: at(4),
        sources: [{
          key: 'memory-source-2', sourceType: 'foundation-version', sourceKey: 'outline', sourceVersionKey: null,
          label: '作者确认约束', createdAt: at(4),
        }],
      }],
    }],
    relationshipEntities: [{
      key: 'entity-lin', type: 'character', name: '林默', aliases: ['阿默'], description: '调查员。',
      sourceManuscriptVersion: { chapterKey: 'chapter-1', versionKey: 'version-1' }, createdAt: at(1), updatedAt: at(2),
    }, {
      key: 'entity-harbor', type: 'location', name: '雾港', aliases: [], description: '常年被雾笼罩的港口。',
      sourceManuscriptVersion: null, createdAt: at(1), updatedAt: at(2),
    }],
    relationships: [{
      key: 'relationship-1', sourceEntityKey: 'entity-lin', targetEntityKey: 'entity-harbor', predicateKey: 'located-at',
      label: '曾居于', category: 'location', directionality: 'directed', factLayer: 'canon', validFromStoryOrder: 1,
      validToStoryOrder: 2, status: 'superseded', supersedesRelationshipKey: null, createdBy: 'ai_confirmed', revision: 1,
      createdAt: at(2), updatedAt: at(3), evidence: [],
    }, {
      key: 'relationship-2', sourceEntityKey: 'entity-lin', targetEntityKey: 'entity-harbor', predicateKey: 'located-at',
      label: '现居于', category: 'location', directionality: 'directed', factLayer: 'canon', validFromStoryOrder: 1,
      validToStoryOrder: 2, status: 'active', supersedesRelationshipKey: 'relationship-1', createdBy: 'user', revision: 2,
      createdAt: at(3), updatedAt: at(4), evidence: [{
        key: 'evidence-1', sourceType: 'manuscript-version', sourceKey: 'chapter-1', sourceVersionKey: 'version-1',
        label: '第一章第一个场景', excerptStart: 0, excerptEnd: 5, contentHash: sha256('批准正文。'), createdAt: at(3),
      }],
    }],
  }
}

describe('portable project snapshot v2', () => {
  it('keeps v1 import compatibility while normalizing through the strict allowlist', () => {
    const legacy = { ...v1Snapshot(), workflows: [{ id: 'must-not-cross-hosts' }], modelRuns: [{ secret: 'provider-trace' }] }
    const normalized = normalizePortableProjectSnapshot(JSON.stringify(legacy))
    expect(normalized.schemaVersion).toBe(1)
    expect(normalized).not.toHaveProperty('workflows')
    expect(normalized).not.toHaveProperty('modelRuns')
    expect(normalized).not.toHaveProperty('authorMemories')
  })

  it('carries every immutable author-memory revision and formal relationship history only', () => {
    const portable = {
      ...v2Snapshot(),
      batches: [{ id: 'batch-secret' }],
      workflows: [{ id: 'workflow-secret' }],
      modelRuns: [{ id: 'model-run-secret' }],
      relationshipCandidates: [{ id: 'candidate-secret' }],
      relationshipExtractionRuns: [{ id: 'extraction-secret' }],
      derivedMemories: [{ origin: 'derived', content: 'regenerable-secret' }],
      memoryUsages: [{ modelRunId: 'model-run-secret' }],
    }
    const normalized = normalizePortableProjectSnapshot(portable)
    expect(normalized.schemaVersion).toBe(2)
    if (normalized.schemaVersion !== 2) throw new Error('expected v2')
    expect(normalized.authorMemories[0]?.revisions.map(revision => revision.revision)).toEqual([1, 2])
    expect(normalized.relationships.map(relationship => relationship.status)).toEqual(['superseded', 'active'])
    expect(normalized.relationships[1]?.evidence).toHaveLength(1)
    expect(normalized.relationshipEntities.map(entity => entity.key)).toEqual(['entity-lin', 'entity-harbor'])
    const serialized = JSON.stringify(normalized)
    for (const excluded of ['batch-secret', 'workflow-secret', 'model-run-secret', 'candidate-secret', 'extraction-secret', 'regenerable-secret']) {
      expect(serialized).not.toContain(excluded)
    }
  })

  it('rejects derived memory, broken immutable history, forged hashes, and machine-local sources', () => {
    const mutations: Array<(snapshot: any) => void> = [
      snapshot => { snapshot.authorMemories[0].origin = 'derived' },
      snapshot => { snapshot.authorMemories[0].revisions[1].revision = 3 },
      snapshot => { snapshot.authorMemories[0].revisions[1].parentRevisionKey = null },
      snapshot => { snapshot.authorMemories[0].revisions[1].contentHash = sha256('tampered') },
      snapshot => { snapshot.authorMemories[0].revisions[1].structuredJson = '{bad json' },
      snapshot => { snapshot.authorMemories[0].revisions[1].sources[0].sourceKey = 'C:\\Users\\writer\\memory.md' },
      snapshot => { snapshot.authorMemories[0].state = 'conflicted' },
    ]
    for (const mutate of mutations) {
      const malicious = structuredClone(v2Snapshot())
      mutate(malicious)
      expect(() => normalizePortableProjectSnapshot(malicious)).toThrow(DomainError)
    }
  })

  it('rejects dangling, ambiguous, cyclic, duplicate, and out-of-range formal relationships', () => {
    const mutations: Array<(snapshot: any) => void> = [
      snapshot => { snapshot.relationships[1].targetEntityKey = 'missing-entity' },
      snapshot => { snapshot.relationships[1].sourceEntityKey = 'entity-harbor'; snapshot.relationships[1].targetEntityKey = 'entity-harbor' },
      snapshot => { snapshot.relationships[1].validFromStoryOrder = 9; snapshot.relationships[1].validToStoryOrder = 2 },
      snapshot => { snapshot.relationships[1].supersedesRelationshipKey = 'missing-relationship' },
      snapshot => { snapshot.relationships[0].supersedesRelationshipKey = 'relationship-2'; snapshot.relationships[0].revision = 3 },
      snapshot => { snapshot.relationshipEntities.push({ ...snapshot.relationshipEntities[0], key: 'unused-entity', name: '未使用人物' }) },
      snapshot => { snapshot.relationshipEntities[0].sourceManuscriptVersion.versionKey = 'missing-version' },
      snapshot => { snapshot.relationships[1].evidence[0].contentHash = 'not-a-hash' },
    ]
    for (const mutate of mutations) {
      const malicious = structuredClone(v2Snapshot())
      mutate(malicious)
      expect(() => normalizePortableProjectSnapshot(malicious)).toThrow(DomainError)
    }

    const duplicate = v2Snapshot()
    duplicate.relationships[0] = { ...duplicate.relationships[0]!, status: 'active' }
    duplicate.relationships[1] = { ...duplicate.relationships[1]!, supersedesRelationshipKey: null, revision: 1 }
    expect(() => normalizePortableProjectSnapshot(duplicate)).toThrow(DomainError)
  })

  it('rejects unsupported schema versions and oversized or binary text', () => {
    expect(() => normalizePortableProjectSnapshot({ ...v2Snapshot(), schemaVersion: 3 })).toThrow(/schema 1.*2/u)
    const binary = v2Snapshot()
    binary.authorMemories[0]!.revisions[1]!.content = '坏\0内容'
    expect(() => normalizePortableProjectSnapshot(binary)).toThrow(DomainError)
  })
})

describe('portable project snapshot v2 SQLite integration', () => {
  it('round-trips author history and formal relationships with fresh IDs while excluding runtime state', () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-portability-v2-'))
    roots.push(root)
    const repo = new SqliteNovelRepository({ dataRoot: root })
    try {
      const imported = repo.importManuscript({
        format: 'txt', sourceName: '迁移源.txt', content: '第一章 雾港\n林默抵达雾港。',
      })
      const projectId = imported.project.project.id
      const chapter = repo.getChapter(imported.chapterIds[0]!)
      const approvedChapter = repo.approveVersion(chapter.id, chapter.currentDraftVersionId!, chapter.revision)
      const sourceVersionId = approvedChapter.currentApprovedVersionId!

      const firstMemory = repo.createUserMemory(projectId, {
        content: '林默在第十章前不能公开真实身份。', scope: 'project', category: 'constraint', promptPolicy: 'auto',
      }, repo.getProjectTree(projectId).project.revision)
      const currentMemory = repo.updateUserMemory(firstMemory.id, {
        content: '林默在第十二章前不能公开真实身份。', category: 'constraint', promptPolicy: 'auto', baseRevision: firstMemory.revision,
        projectRevision: repo.getProjectTree(projectId).project.revision,
      })

      const sourceEntityId = 'source-entity-lin'
      const targetEntityId = 'source-entity-harbor'
      const seed = new DatabaseSync(repo.databasePath)
      try {
        seed.exec('PRAGMA foreign_keys=ON')
        const timestamp = new Date().toISOString()
        seed.prepare('INSERT INTO story_entities(id,project_id,entity_type,name,description,source_manuscript_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(sourceEntityId, projectId, 'character', '林默', '调查员。', sourceVersionId, timestamp, timestamp)
        seed.prepare('INSERT INTO story_entities(id,project_id,entity_type,name,description,source_manuscript_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(targetEntityId, projectId, 'location', '雾港', '常年被雾笼罩的港口。', sourceVersionId, timestamp, timestamp)
        seed.prepare('INSERT INTO entity_aliases(id,entity_id,alias,created_at) VALUES (?,?,?,?)')
          .run('source-entity-alias', sourceEntityId, '阿默', timestamp)
      } finally {
        seed.close()
      }

      const firstRelationship = repo.createEntityRelationship(projectId, {
        sourceEntityId, targetEntityId, predicateKey: 'located-at', label: '抵达', category: 'location', directionality: 'directed',
        factLayer: 'canon', validFromStoryOrder: 1, validToStoryOrder: 1,
      }, repo.getProjectTree(projectId).project.revision)
      const evidenceId = 'source-relationship-evidence'
      const evidenceStore = new DatabaseSync(repo.databasePath)
      try {
        evidenceStore.exec('PRAGMA foreign_keys=ON')
        evidenceStore.prepare(`INSERT INTO entity_relationship_evidence(
          id,relationship_id,source_type,source_id,source_version_id,label,excerpt_start,excerpt_end,content_hash,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          evidenceId, firstRelationship.id, 'manuscript-version', sourceVersionId, sourceVersionId, '第一章批准正文', 0, 8,
          sha256('林默抵达雾港。'), new Date().toISOString(),
        )
      } finally {
        evidenceStore.close()
      }
      const currentRelationship = repo.reviseEntityRelationship(projectId, firstRelationship.id, {
        label: '现身于', predicateKey: 'located-at', category: 'location', directionality: 'directed', factLayer: 'canon',
        validFromStoryOrder: 1, validToStoryOrder: 1,
      }, repo.getProjectTree(projectId).project.revision)

      const workflow = repo.startChapterWorkflow(chapter.id)
      const extractionRunId = repo.createRelationshipExtractionRun(projectId, 'auto', { provider: 'test', model: 'test' }, '{}', sha256('relationship prompt'))
      const candidates = repo.completeRelationshipExtractionRun(extractionRunId, [{
        sourceEntityId: null, targetEntityId: null, sourceLabel: '未知甲', targetLabel: '未知乙', predicateKey: 'knows', label: '认识',
        category: 'knowledge', directionality: 'directed', factLayer: 'planned', validFromStoryOrder: null, validToStoryOrder: null,
        confidence: 0.4, evidenceJson: '[]', fingerprint: 'unresolved-candidate',
      }])

      const exported = repo.exportProjectSnapshot(projectId)
      const snapshot = JSON.parse(exported.content) as PortableProjectSnapshotV2
      expect(snapshot.schemaVersion).toBe(2)
      expect(snapshot.authorMemories).toHaveLength(1)
      expect(snapshot.authorMemories[0]?.revisions.map(revision => revision.content)).toEqual([
        '林默在第十章前不能公开真实身份。', '林默在第十二章前不能公开真实身份。',
      ])
      expect(snapshot.authorMemories[0]?.sourceKey).toBe('author-memory-1')
      expect(snapshot.relationships.map(relationship => relationship.status).sort()).toEqual(['active', 'superseded'])
      expect(snapshot.relationships.flatMap(relationship => relationship.evidence)).toHaveLength(2)
      expect(snapshot.relationshipEntities).toHaveLength(2)
      for (const runtimeId of [workflow.id, extractionRunId, candidates[0]!.id]) expect(exported.content).not.toContain(runtimeId)
      for (const oldId of [firstMemory.id, currentMemory.currentRevision.id, sourceEntityId, targetEntityId, firstRelationship.id, currentRelationship.id, evidenceId]) {
        expect(exported.content).not.toContain(oldId)
      }

      const restored = repo.restoreProjectSnapshot(snapshot, '迁移恢复副本')
      expect(restored.project.id).not.toBe(projectId)
      const restoredMemories = repo.searchMemory(restored.project.id, { origin: 'user' }).items
      expect(restoredMemories).toHaveLength(1)
      expect(restoredMemories[0]?.id).not.toBe(firstMemory.id)
      expect(restoredMemories[0]?.sourceKey).toBe('portable:author-memory-1')
      expect(restoredMemories[0]?.currentRevision.content).toBe('林默在第十二章前不能公开真实身份。')
      const restoredRevisions = repo.listMemoryRevisions(restoredMemories[0]!.id).sort((left, right) => left.revision - right.revision)
      expect(restoredRevisions.map(revision => revision.content)).toEqual([
        '林默在第十章前不能公开真实身份。', '林默在第十二章前不能公开真实身份。',
      ])
      expect(restoredRevisions.map(revision => revision.id)).not.toContain(currentMemory.currentRevision.id)

      const restoredGraph = repo.getRelationshipGraph(restored.project.id)
      expect(restoredGraph.nodes.map(node => node.name)).toEqual(expect.arrayContaining(['林默', '雾港']))
      expect(restoredGraph.nodes.map(node => node.id)).not.toContain(sourceEntityId)
      expect(restoredGraph.edges).toHaveLength(1)
      expect(restoredGraph.edges[0]).toMatchObject({ label: '现身于', status: 'active', revision: 2, evidenceCount: 1 })
      expect(restoredGraph.edges[0]?.id).not.toBe(currentRelationship.id)
      expect(repo.getRelationshipEvidence(restored.project.id, restoredGraph.edges[0]!.id)).toHaveLength(1)

      const inspect = new DatabaseSync(repo.databasePath, { readOnly: true })
      try {
        const relationshipRows = inspect.prepare('SELECT id,status,supersedes_relationship_id FROM entity_relationships WHERE project_id=? ORDER BY revision').all(restored.project.id) as Array<Record<string, unknown>>
        expect(relationshipRows).toHaveLength(2)
        expect(relationshipRows.map(row => String(row.id))).not.toContain(firstRelationship.id)
        expect(relationshipRows.map(row => String(row.id))).not.toContain(currentRelationship.id)
        expect(relationshipRows[1]?.supersedes_relationship_id).toBe(relationshipRows[0]?.id)
        expect(Number((inspect.prepare('SELECT COUNT(*) value FROM entity_relationship_evidence WHERE relationship_id IN (SELECT id FROM entity_relationships WHERE project_id=?)').get(restored.project.id) as { value: number }).value)).toBe(2)
        expect(Number((inspect.prepare('SELECT COUNT(*) value FROM workflow_runs WHERE project_id=?').get(restored.project.id) as { value: number }).value)).toBe(0)
        expect(Number((inspect.prepare('SELECT COUNT(*) value FROM relationship_extraction_runs WHERE project_id=?').get(restored.project.id) as { value: number }).value)).toBe(0)
        const restoredIds = JSON.stringify([
          ...inspect.prepare('SELECT id FROM memory_items WHERE project_id=?').all(restored.project.id),
          ...inspect.prepare('SELECT id FROM story_entities WHERE project_id=?').all(restored.project.id),
          ...relationshipRows,
        ])
        for (const oldId of [firstMemory.id, sourceEntityId, targetEntityId, firstRelationship.id, currentRelationship.id]) expect(restoredIds).not.toContain(oldId)
      } finally {
        inspect.close()
      }

      const legacy = v1Snapshot()
      const restoredLegacy = repo.restoreProjectSnapshot(legacy, 'V1 兼容副本')
      const legacyInspect = new DatabaseSync(repo.databasePath, { readOnly: true })
      try {
        expect(Number((legacyInspect.prepare("SELECT COUNT(*) value FROM memory_items WHERE project_id=? AND origin='user'").get(restoredLegacy.project.id) as { value: number }).value)).toBe(0)
        expect(Number((legacyInspect.prepare('SELECT COUNT(*) value FROM entity_relationships WHERE project_id=?').get(restoredLegacy.project.id) as { value: number }).value)).toBe(0)
      } finally {
        legacyInspect.close()
      }
    } finally {
      repo.close()
    }
  })
})
