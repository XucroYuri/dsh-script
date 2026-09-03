import { describe, expect, it } from 'vitest'
import {
  budgetedScenePlanJson,
  chapterDraftBudget,
  chapterDraftLengthAdvisory,
  effectiveChapterTargetWords,
  normalizeScenePlanWordBudget,
} from '../src/generation/chapter-budget.js'

type TargetContext = Parameters<typeof effectiveChapterTargetWords>[0]

function targetContext(chapterBriefTargetWords: number | null, projectTargetWords: number | null): TargetContext {
  return {
    chapterBrief: chapterBriefTargetWords === null ? null : { targetWords: chapterBriefTargetWords },
    project: { chapterTargetWords: projectTargetWords },
  } as unknown as TargetContext
}

describe('chapter generation budget', () => {
  it('resolves the effective target from chapter brief, project, then product default', () => {
    expect(effectiveChapterTargetWords(targetContext(3_600, 2_800))).toBe(3_600)
    expect(effectiveChapterTargetWords(targetContext(null, 2_800))).toBe(2_800)
    expect(effectiveChapterTargetWords(targetContext(null, null))).toBe(2_000)
  })

  it('gives a 2,000-word chapter at least 8,000 output tokens', () => {
    const budget = chapterDraftBudget(2_000, null)

    expect(budget.targetWords).toBe(2_000)
    expect(budget.desiredMaxTokens).toBeGreaterThanOrEqual(8_000)
    expect(budget.maxTokens).toBeGreaterThanOrEqual(8_000)
    expect(budget.constrained).toBe(false)
  })

  it('does not exceed a provider output-token capacity', () => {
    const budget = chapterDraftBudget(2_000, 6_000)

    expect(budget.providerMaxTokens).toBe(6_000)
    expect(budget.maxTokens).toBe(6_000)
    expect(budget.maxTokens).toBeLessThanOrEqual(budget.providerMaxTokens!)
    expect(budget.desiredMaxTokens).toBeGreaterThan(budget.maxTokens)
    expect(budget.constrained).toBe(true)
    expect(budget.safeTargetWords).toBeLessThan(budget.targetWords * 2)
  })

  it('keeps large word targets and uses a known provider capacity without an extra 16k ceiling', () => {
    expect(effectiveChapterTargetWords(targetContext(50_000, 2_800))).toBe(50_000)

    const knownProvider = chapterDraftBudget(30_000, 64_000)
    expect(knownProvider).toMatchObject({
      targetWords: 30_000,
      desiredMaxTokens: 47_000,
      maxTokens: 47_000,
      providerMaxTokens: 64_000,
      capacitySource: 'provider',
      constrained: false,
    })
    expect(knownProvider.maxTokens).toBeGreaterThan(16_000)

    const unknownProvider = chapterDraftBudget(30_000, null)
    expect(unknownProvider).toMatchObject({ maxTokens: 16_000, capacitySource: 'fallback', constrained: true })
  })

  it('reports target drift as a non-blocking advisory without defining accepted limits', () => {
    expect(chapterDraftLengthAdvisory(2_000, 2_000)).toBeNull()
    expect(chapterDraftLengthAdvisory(1_200, 419)).toMatchObject({
      kind: 'shorter-than-target', targetWords: 1_200, actualWords: 419,
      recommendedMinWords: 1_020, recommendedMaxWords: 1_260,
    })
    expect(chapterDraftLengthAdvisory(1_200, 1_801)).toMatchObject({
      kind: 'longer-than-target', targetWords: 1_200, actualWords: 1_801,
      recommendedMinWords: 1_020, recommendedMaxWords: 1_260,
    })
  })

  it('normalizes a 9,000-word scene plan to 2,000 words without losing its structure', () => {
    const scenePlan = {
      chapterGoal: '主角在封锁港口找到失踪案的新线索',
      risks: ['不能提前揭示幕后联络人'],
      planningNote: { continuityAnchor: '承接上一章的北岸暗号' },
      scenes: [
        { scenePurpose: '进入封锁区', openingState: '巡逻换岗', beats: ['避开守卫'], estimatedWords: 1_500 },
        { scenePurpose: '检查旧仓库', openingState: '仓门上锁', beats: ['找到撬痕'], estimatedWords: 2_000 },
        { scenePurpose: '追踪北岸暗号', openingState: '线索中断', beats: ['辨认新刻痕'], estimatedWords: 2_500 },
        { scenePurpose: '带着证据撤离', openingState: '巡逻折返', beats: ['制造声东击西'], estimatedWords: 3_000 },
      ],
    }

    const { output, audit } = normalizeScenePlanWordBudget(scenePlan, 2_000)
    const normalizedScenes = output.scenes as Array<Record<string, unknown>>

    expect(audit).toEqual({
      targetWords: 2_000,
      originalEstimatedWords: 9_000,
      normalizedEstimatedWords: 2_000,
      normalized: true,
    })
    expect(normalizedScenes.reduce((sum, scene) => sum + Number(scene.estimatedWords), 0)).toBe(2_000)
    expect(normalizedScenes).toHaveLength(scenePlan.scenes.length)
    expect(output).toMatchObject({
      chapterGoal: scenePlan.chapterGoal,
      risks: scenePlan.risks,
      planningNote: scenePlan.planningNote,
    })
    expect(normalizedScenes.map(({ estimatedWords: _estimatedWords, ...scene }) => scene)).toEqual(
      scenePlan.scenes.map(({ estimatedWords: _estimatedWords, ...scene }) => scene),
    )
    expect(scenePlan.scenes.reduce((sum, scene) => sum + scene.estimatedWords, 0)).toBe(9_000)

    const promptPlan = JSON.parse(budgetedScenePlanJson(JSON.stringify(scenePlan), 2_000)) as Record<string, unknown>
    expect(promptPlan.wordBudget).toEqual({ targetWords: 2_000, normalizedEstimatedWords: 2_000 })
    expect(JSON.stringify(promptPlan)).not.toContain('originalEstimatedWords')
    expect(JSON.stringify(promptPlan)).not.toContain('9000')
  })
})
