import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelGateway } from '../src/generation/model-gateway.js'
import { GenerationService } from '../src/generation/service.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('long-memory story boundary', () => {
  it('rebuilds an early reapproval from prior approved chapters without future-summary leakage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-studio-memory-boundary-'))
    roots.push(root)
    const repository = new SqliteNovelRepository({ dataRoot: root })
    const project = repository.createProject({ title: '安全回溯' }).project
    approveTestFoundation(repository, project.id)
    const chapters = [1, 2, 3, 4].map(index => repository.createChapter(project.id, `第${index}章`))
    const approvedIds: string[] = []
    for (const [index, chapter] of chapters.entries()) {
      const draft = repository.saveDraft(chapter.id, { content: `第${index + 1}章批准正文。${index === 3 ? 'FUTURE_ONLY_MARKER 幕后人物已现身。' : ''}`, baseRevision: chapter.revision })
      const approved = repository.approveVersion(chapter.id, draft.currentDraftVersionId!, draft.revision)
      approvedIds.push(approved.currentApprovedVersionId!)
      repository.upsertKnowledgeSummary(project.id, {
        scope: 'chapter', sourceId: chapter.id, sourceVersionId: approved.currentApprovedVersionId, structuredJson: '{}',
        compactNarrative: `第${index + 1}章安全摘要。${index === 3 ? 'FUTURE_ONLY_MARKER' : ''}`,
        sourceStartChapter: index + 1, sourceEndChapter: index + 1, sourceVersionIds: [approved.currentApprovedVersionId!],
        provider: 'test', model: 'summary', promptHash: `chapter-${index + 1}`,
      })
    }
    repository.upsertKnowledgeSummary(project.id, {
      scope: 'project', sourceId: project.id, sourceVersionId: approvedIds[3]!, structuredJson: '{}',
      compactNarrative: '覆盖到第四章的旧滚动摘要：FUTURE_ONLY_MARKER。', sourceStartChapter: 1, sourceEndChapter: 4,
      sourceVersionIds: approvedIds, provider: 'test', model: 'summary', promptHash: 'future-project-summary',
    })

    const chapter2 = repository.getChapter(chapters[1]!.id)
    const replacement = repository.saveDraft(chapter2.id, { content: '第二章重新批准正文：线索改为白鲸暗号。', baseRevision: chapter2.revision })
    const postProcessing = repository.approveVersionAndStartPostProcessing(chapter2.id, replacement.currentDraftVersionId!, replacement.revision)
    const refreshContext = repository.getKnowledgeRefreshContext(postProcessing.workflow.id)
    expect(refreshContext.previousProject).toBeNull()
    expect(refreshContext.safePriorChapterSummaries.map(item => item.chapterNumber)).toEqual([1])
    expect(refreshContext.safePriorChapterSummaries.map(item => item.summary.compactNarrative).join('\n')).not.toContain('FUTURE_ONLY_MARKER')

    let prompt = ''
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'safe-memory' }), providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        prompt = request.prompt
        const value = (label: string) => ({ compactNarrative: `${label} 安全摘要`, structuredSummary: {} })
        return { text: JSON.stringify({ foundation: value('foundation'), chapter: value('chapter'), arc: value('arc'), volume: value('volume'), book: value('book'), project: value('project') }) }
      },
    }
    const summaries = await new GenerationService(repository, gateway).refreshLongNovelMemory(postProcessing.workflow.id)
    expect(prompt).toContain('第1章安全摘要')
    expect(prompt).not.toContain('FUTURE_ONLY_MARKER')
    const rebuiltProject = summaries.find(item => item.scope === 'project')!
    expect(rebuiltProject.sourceVersionIds).toEqual([approvedIds[0], replacement.currentDraftVersionId])
    expect(rebuiltProject.sourceVersionIds).not.toEqual(expect.arrayContaining([approvedIds[2], approvedIds[3]]))
    repository.upsertKnowledgeSummary(project.id, rebuiltProject)
    const projectMemory = repository.searchMemory(project.id, { origin: 'derived', scope: 'project' }).items[0]!
    expect(projectMemory.revision).toBe(2)
    expect(projectMemory.sources.map(source => source.sourceVersionId).filter(Boolean).sort()).toEqual([...rebuiltProject.sourceVersionIds].sort())
    repository.setWorkflowStatus(postProcessing.workflow.id, 'cancel_requested')
    repository.close()
  })
})
