import type { GenerationPurpose } from '../domain/model.js'

export interface BuiltinPromptDefinition {
  assetId: string
  versionId: string
  version: number
  key: string
  name: string
  purpose: GenerationPurpose
  template: string
  inputSchema: object
  outputSchema: object
}

export const BUILTIN_PROMPT_PACK = {
  id: 'core-zh',
  name: 'Novel Studio 核心中文写作包',
  locale: 'zh-CN',
} as const

const SCENE_PLAN_V1: BuiltinPromptDefinition = {
  assetId: 'prompt-scene-plan',
  versionId: 'prompt-scene-plan-v1',
  version: 1,
  key: 'scene-plan',
  name: '章节场景规划',
  purpose: 'scene-plan',
  inputSchema: { type: 'object', required: ['chapterGoal', 'styleRules', 'existingManuscript'] },
  outputSchema: { type: 'object', required: ['chapterGoal', 'scenes', 'risks'] },
  template: `任务：为指定章节生成可执行场景计划，不写完整正文。

项目：{{projectTitle}}
题材：{{genre}}
章节：{{chapterTitle}}
章节目标：{{chapterGoal}}
项目写作规则：{{styleRules}}
禁止事项：{{forbiddenContent}}
现有正文或上一版本：{{existingManuscript}}

要求：
1. 每个场景必须推进冲突或改变可追踪状态。
2. 不能只为解释设定而存在。
3. 不得擅自补造会影响全书的重大事实。
4. 如果信息不足，在 risks 中明确指出。

只输出合法 JSON，不要使用 Markdown 代码围栏：
{"chapterGoal":"","scenes":[{"scenePurpose":"","openingState":"","characterGoal":"","opposition":"","turn":"","outcome":"","estimatedWords":0}],"risks":[]}`,
}

const CHAPTER_DRAFT_V1: BuiltinPromptDefinition = {
  assetId: 'prompt-chapter-draft',
  versionId: 'prompt-chapter-draft-v1',
  version: 1,
  key: 'chapter-draft',
  name: '章节初稿生成',
  purpose: 'chapter-draft',
  inputSchema: { type: 'object', required: ['chapterGoal', 'styleRules', 'scenePlan'] },
  outputSchema: { type: 'object', required: ['title', 'manuscript', 'uncertainties', 'selfCheck'] },
  template: `任务：根据场景计划生成章节初稿。

项目：{{projectTitle}}
题材：{{genre}}
章节：{{chapterTitle}}
章节目标：{{chapterGoal}}
项目写作规则：{{styleRules}}
禁止事项：{{forbiddenContent}}
场景计划：{{scenePlan}}
现有正文或父版本：{{existingManuscript}}
目标字数：{{targetWords}}

要求：
1. 通过行动、选择、阻力和后果推进剧情。
2. 对话应受人物目标和关系影响。
3. 不得直接声称未提供的设定是既定事实。
4. 模型结果只作为新草稿版本，不得宣称已经批准。
5. canonCandidates 只写正文明确建立的事实。kind 为 fact | timeline | foreshadowing；entityType 为 character | location | faction | item | ability | species | organization | concept | rule；伏笔状态为 planned | planted | reinforced | resolved | abandoned。

只输出合法 JSON，不要使用 Markdown 代码围栏：
{"title":"","manuscript":"","canonCandidates":[{"kind":"fact","subject":"","predicate":"","value":"","entityType":"concept","aliases":[],"storyOrder":0,"foreshadowStatus":null}],"uncertainties":[],"selfCheck":{"goalAdvanced":true,"scenePlanFollowed":true,"knownContinuityRisks":[]}}`,
}

const CHAPTER_DRAFT_V2: BuiltinPromptDefinition = {
  ...CHAPTER_DRAFT_V1,
  versionId: 'prompt-chapter-draft-v2',
  version: 2,
  outputSchema: {
    type: 'object',
    required: ['title', 'manuscript', 'uncertainties', 'selfCheck'],
    properties: {
      canonCandidates: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'subject', 'predicate', 'value', 'entityType', 'evidenceExcerpt'],
          properties: {
            evidenceExcerpt: { type: 'string', minLength: 6, maxLength: 300 },
          },
        },
      },
    },
  },
  template: `任务：根据场景计划生成章节初稿。

项目：{{projectTitle}}
题材：{{genre}}
章节：{{chapterTitle}}
章节目标：{{chapterGoal}}
项目写作规则：{{styleRules}}
禁止事项：{{forbiddenContent}}
场景计划：{{scenePlan}}
现有正文或父版本：{{existingManuscript}}
目标字数：{{targetWords}}

要求：
1. 通过行动、选择、阻力和后果推进剧情。
2. 对话应受人物目标和关系影响。
3. 不得直接声称未提供的设定是既定事实。
4. 模型结果只作为新草稿版本，不得宣称已经批准。
5. canonCandidates 只写正文明确建立的事实。每条候选都必须提供 evidenceExcerpt：从 manuscript 中逐字复制、在正文中只出现一次、可直接支持该事实的 6–300 字符短句；找不到唯一逐字证据时不要输出该候选。kind 为 fact | timeline | foreshadowing；entityType 为 character | location | faction | item | ability | species | organization | concept | rule；伏笔状态为 planned | planted | reinforced | resolved | abandoned。

只输出合法 JSON，不要使用 Markdown 代码围栏：
{"title":"","manuscript":"","canonCandidates":[{"kind":"fact","subject":"","predicate":"","value":"","entityType":"concept","aliases":[],"storyOrder":0,"foreshadowStatus":null,"evidenceExcerpt":"正文中唯一出现且直接支持该事实的逐字短句"}],"uncertainties":[],"selfCheck":{"goalAdvanced":true,"scenePlanFollowed":true,"knownContinuityRisks":[]}}`,
}

/** The current built-in version selected for a newly seeded asset. */
export const BUILTIN_PROMPTS: BuiltinPromptDefinition[] = [SCENE_PLAN_V1, CHAPTER_DRAFT_V2]

/** Every immutable built-in version that must remain available for old generation traces. */
export const BUILTIN_PROMPT_VERSIONS: BuiltinPromptDefinition[] = [SCENE_PLAN_V1, CHAPTER_DRAFT_V1, CHAPTER_DRAFT_V2]

export const BUILTIN_PROMPT_UPGRADES = [{
  assetId: CHAPTER_DRAFT_V2.assetId,
  purpose: CHAPTER_DRAFT_V2.purpose,
  previousVersionId: CHAPTER_DRAFT_V1.versionId,
  currentVersionId: CHAPTER_DRAFT_V2.versionId,
}] as const
