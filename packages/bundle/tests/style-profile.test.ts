import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelGateway } from '../src/generation/model-gateway.js'
import { GenerationService } from '../src/generation/service.js'
import { renderBudgetedGenerationPrompt } from '../src/prompt-assets/render.js'
import { SqliteNovelRepository } from '../src/storage-sqlite/database.js'
import { approveTestFoundation } from './foundation-helper.js'

const roots: string[] = []

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'novel-studio-style-profile-'))
  roots.push(root)
  return new SqliteNovelRepository({ dataRoot: root })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('structured project writing styles', () => {
  it('defaults new projects to a builtin style and supports revision-protected preset changes', () => {
    const repo = repository()
    const project = repo.createProject({ title: '文风项目' }).project
    const initial = repo.getProjectStyleProfile(project.id)
    expect(initial).toMatchObject({ presetId: 'web-fast', source: 'builtin', revision: 1 })
    expect(initial.attributes.expansionRules.length).toBeGreaterThan(0)

    const changed = repo.setProjectStylePreset(project.id, 'suspense-cinematic', initial.revision)
    expect(changed).toMatchObject({ presetId: 'suspense-cinematic', name: '悬疑电影感', revision: 2 })
    expect(() => repo.setProjectStylePreset(project.id, 'literary-calm', initial.revision)).toThrow(/changed from revision/)
    repo.close()
  })

  it('keeps style in the generation context and prompt without mixing it into story facts', () => {
    const repo = repository()
    const project = repo.createProject({ title: '文风注入' }).project
    approveTestFoundation(repo, project.id)
    const chapter = repo.createChapter(project.id, '第一章')
    const context = repo.getGenerationContext(chapter.id, 'chapter-draft')
    expect(context.styleProfile?.presetId).toBe('web-fast')
    const assembled = renderBudgetedGenerationPrompt(context, {
      contextWindow: 32_000,
      contextWindowSource: 'provider',
      maxOutputTokens: 4_000,
      system: 'Novel Studio system prompt',
    })
    expect(assembled.prompt).toContain('结构化文风配置')
    expect(assembled.prompt).toContain('扩写规则')
    expect(assembled.prompt).toContain('基建组装哈希')
    repo.close()
  })

  it('extracts an abstract style profile, stores only a sample hash, and records the profile in generation snapshots', async () => {
    const repo = repository()
    const project = repo.createProject({ title: '样文提炼' }).project
    const chapter = repo.createChapter(project.id, '第一章')
    const sample = '这是一段只用于测试文风提炼的样文。'.repeat(80)
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'style-model' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate(request) {
        if (request.prompt.includes('样文（只用于本次分析')) {
          return { text: JSON.stringify({
            name: '冷静推进',
            summary: '以有限视角和可见行动推进情节。',
            attributes: {
              narrativeVoice: '冷静而贴近行动。', pointOfView: '第三人称有限。', tense: '当下感。',
              sentenceRhythm: '长短句交替。', paragraphRhythm: '短段落推进。', dialogueStyle: '对白承担试探。',
              descriptionStyle: '细节服务于行动。', emotionalCadence: '情绪通过选择呈现。', pacing: '每场提高压力。',
              imagery: '少量稳定意象。', expansionRules: ['增加阻力与后果'], avoid: ['空泛总结'],
            },
          }) }
        }
        if (request.prompt.includes('不写完整正文')) {
          return { text: JSON.stringify({ chapterGoal: '推进冲突', scenes: [{ scenePurpose: '建立开场压力' }], risks: [] }) }
        }
        return { text: JSON.stringify({ title: '第一章', manuscript: '正文'.repeat(350), uncertainties: [], selfCheck: { goalAdvanced: true, scenePlanFollowed: true, knownContinuityRisks: [] } }) }
      },
    }
    const service = new GenerationService(repo, gateway)
    const extracted = await service.extractWritingStyle(project.id, '我的样文风格', sample, 1)
    expect(extracted).toMatchObject({ source: 'extracted', name: '冷静推进', revision: 2 })
    expect(extracted.sampleHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(extracted)).not.toContain(sample)

    approveTestFoundation(repo, project.id)
    await service.generate(chapter.id, 'scene-plan')
    const result = await service.generate(chapter.id, 'chapter-draft')
    const snapshot = JSON.parse(result.modelRun.inputSnapshotJson) as { styleProfile?: { profileId: string; revision: number; sampleHash: string | null; name: string } }
    expect(snapshot.styleProfile).toMatchObject({ profileId: extracted.profileId, revision: extracted.revision, sampleHash: extracted.sampleHash, name: extracted.name })
    repo.close()
  })

  it('rejects samples that are too short before calling the model', async () => {
    const repo = repository()
    const project = repo.createProject({ title: '短样文' }).project
    let called = false
    const gateway: ModelGateway = {
      selection: () => ({ provider: 'mock', model: 'style-model' }),
      providers: () => [{ id: 'mock', name: 'Mock' }],
      async generate() { called = true; return { text: '{}' } },
    }
    await expect(new GenerationService(repo, gateway).extractWritingStyle(project.id, '', '太短了', 1)).rejects.toThrow('至少需要 300')
    expect(called).toBe(false)
    repo.close()
  })
})
