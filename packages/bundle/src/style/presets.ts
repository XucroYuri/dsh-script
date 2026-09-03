import type { StyleProfileAttributes, WritingStylePreset } from '../domain/model.js'

const profile = (attributes: StyleProfileAttributes): StyleProfileAttributes => attributes

export const BUILTIN_STYLE_PRESETS: WritingStylePreset[] = [
  {
    id: 'web-fast',
    name: '快节奏网文',
    summary: '目标明确、冲突密度高、段落推进快，适合持续追读的类型小说。',
    attributes: profile({
      narrativeVoice: '贴近主角感受的有限视角；信息随行动逐步揭示。',
      pointOfView: '第三人称有限视角，单场景尽量保持视角稳定。',
      tense: '现代汉语叙事时态，以动作和当下感推进。',
      sentenceRhythm: '长短句交替，关键动作使用短句，避免连续同长度句子。',
      paragraphRhythm: '段落偏短；每个段落完成一个动作、判断或情绪变化。',
      dialogueStyle: '对白承担目标、试探和冲突，不用对白复述背景资料。',
      descriptionStyle: '只写会影响行动或情绪的细节，环境描写服务于冲突。',
      emotionalCadence: '每个场景至少有一次情绪或关系的可见变化，避免平铺直叙。',
      pacing: '开场尽快出现具体目标或异常，场景结尾留下下一步压力。',
      imagery: '少量可复现的核心意象，避免堆砌华丽比喻。',
      expansionRules: ['扩写优先增加行动、阻力、选择和后果', '不靠重复心理独白凑篇幅'],
      avoid: ['空泛总结', '连续解释设定', '无冲突的过场', '模板化的“他知道”“她明白”'],
    }),
  },
  {
    id: 'emotional-web',
    name: '情感推进网文',
    summary: '以关系变化、情绪拉扯和选择后果为阅读驱动力，兼顾情节推进。',
    attributes: profile({
      narrativeVoice: '贴近人物内心但不替人物下结论，让情绪通过细节和选择显现。',
      pointOfView: '第三人称有限视角；关系场景优先锁定冲突承担者。',
      tense: '当下感明确，回忆只在触发当前选择时出现。',
      sentenceRhythm: '情绪升高时句子收紧，缓和时允许较长的感官和动作铺陈。',
      paragraphRhythm: '对话与反应交替；重要情绪转折单独成段。',
      dialogueStyle: '表层话题与真实诉求保持张力，避免所有情绪直接说出口。',
      descriptionStyle: '优先写表情、动作、距离和物件如何暴露关系变化。',
      emotionalCadence: '每个场景至少推进一次信任、误解、靠近或疏离。',
      pacing: '情节节点与情感节点交替，不让感情戏停在原地。',
      imagery: '使用少量与人物关系绑定的反复意象，回收时产生变化。',
      expansionRules: ['扩写优先补足互动反应和未说出口的选择', '新增情绪必须造成后续行为变化'],
      avoid: ['用旁白解释人物“其实很难过”', '无后果的暧昧拉扯', '连续堆叠形容词'],
    }),
  },
  {
    id: 'suspense-cinematic',
    name: '悬疑电影感',
    summary: '强调可见线索、空间调度、信息差和节奏切换，适合悬疑与调查故事。',
    attributes: profile({
      narrativeVoice: '冷静记录可观察事实，关键推断留给人物行动和证据。',
      pointOfView: '第三人称有限视角，严格遵守当前人物的知情边界。',
      tense: '实时推进；回溯必须由物证、对话或身体反应触发。',
      sentenceRhythm: '调查时清晰克制，危险临近时缩短句子并减少解释。',
      paragraphRhythm: '线索、观察、判断、行动分层；揭示点前保留必要停顿。',
      dialogueStyle: '对白包含试探和隐瞒；每次问答都改变信息分布。',
      descriptionStyle: '空间、声音、光线和物件必须承担线索或危险提示。',
      emotionalCadence: '恐惧和紧张通过可验证的身体反应与选择体现。',
      pacing: '每个场景至少新增一个线索、排除一个假设或提高一个风险。',
      imagery: '意象服务于线索回声，不用装饰性比喻掩盖信息。',
      expansionRules: ['扩写优先增加可验证线索和人物行动', '不要用新设定替代已有谜面'],
      avoid: ['全知视角泄露答案', '无证据的反转', '为了神秘而故意含糊'],
    }),
  },
  {
    id: 'literary-calm',
    name: '克制文学叙事',
    summary: '节奏舒展、观察细密、情绪含蓄，强调人物经验和语句质地。',
    attributes: profile({
      narrativeVoice: '稳定、克制、有观察距离；不替读者概括全部意义。',
      pointOfView: '第三人称有限或第一人称，避免无理由跳换。',
      tense: '时间流动自然，回忆与当下通过感官或物件建立联系。',
      sentenceRhythm: '句式有呼吸感，长句承担观察，短句落在决定或余韵。',
      paragraphRhythm: '允许较长段落，但每段必须围绕一个具体经验推进。',
      dialogueStyle: '对白简洁含蓄，停顿、错开和未完成句同样有意义。',
      descriptionStyle: '感官细节具体而节制，避免形容词堆叠。',
      emotionalCadence: '情绪通过反复动作、物件和微小偏差逐渐累积。',
      pacing: '不追求每段爆点，但每场必须留下关系、认知或状态变化。',
      imagery: '意象少而稳定，前后重复时必须产生新的语境。',
      expansionRules: ['扩写优先增加具体经验和关系细节', '不使用空洞哲理替代场景'],
      avoid: ['过度煽情', '万能金句', '无来源的作者评判', '刻意晦涩'],
    }),
  },
]

export const DEFAULT_STYLE_PRESET_ID = 'web-fast'

export function getBuiltinStylePreset(id: string): WritingStylePreset {
  return BUILTIN_STYLE_PRESETS.find(item => item.id === id) ?? BUILTIN_STYLE_PRESETS.find(item => item.id === DEFAULT_STYLE_PRESET_ID)!
}

export function styleProfileText(profile: Pick<WritingStylePreset, 'name' | 'summary' | 'attributes'>): string {
  const attributes = profile.attributes
  return [
    `文风名称：${profile.name}`,
    `文风定位：${profile.summary}`,
    `叙事声音：${attributes.narrativeVoice}`,
    `视角：${attributes.pointOfView}`,
    `时态与时间处理：${attributes.tense}`,
    `句子节奏：${attributes.sentenceRhythm}`,
    `段落节奏：${attributes.paragraphRhythm}`,
    `对白：${attributes.dialogueStyle}`,
    `描写：${attributes.descriptionStyle}`,
    `情绪推进：${attributes.emotionalCadence}`,
    `场景节奏：${attributes.pacing}`,
    `意象：${attributes.imagery}`,
    `扩写规则：${attributes.expansionRules.join('；') || '无'}`,
    `避免：${attributes.avoid.join('；') || '无'}`,
  ].join('\n')
}
