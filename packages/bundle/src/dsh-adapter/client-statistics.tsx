import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterGenerationStatistics, GenerationPurposeStatistics, GenerationStatisticsTotals, ProjectGenerationStatistics } from '../domain/model.js'
import type { NovelClientRequest } from './client-memory.js'

export interface ProjectStatisticsPanelProps {
  projectId: string
  projectTitle: string
  narrow?: boolean
  request: NovelClientRequest
  onOpenChapter?: (chapterId: string) => void | Promise<void>
}

const purposeCopy: Record<GenerationPurposeStatistics['purpose'], { title: string; detail: string }> = {
  'scene-plan': { title: '场景规划', detail: '拆解章节目标、场景和承接关系' },
  'chapter-draft': { title: '正文生成', detail: '生成并成功保存为不可变正文版本' },
}

export function ProjectStatisticsPanel({ projectId, projectTitle, narrow = false, request, onOpenChapter }: ProjectStatisticsPanelProps) {
  const [statistics, setStatistics] = useState<ProjectGenerationStatistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setStatistics(current => current?.project.id === projectId ? current : null)
    try {
      const next = await request<ProjectGenerationStatistics>(`/projects/${encodeURIComponent(projectId)}/statistics`)
      if (requestId === requestIdRef.current) { setStatistics(next); setError(null) }
    } catch (cause) {
      if (requestId === requestIdRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (requestId === requestIdRef.current) setLoading(false) }
  }, [projectId, request])
  useEffect(() => { void load() }, [load])

  const content = statistics
    ? <StatisticsContent statistics={statistics} narrow={narrow} onOpenChapter={onOpenChapter} />
    : loading
      ? <StatisticsSkeleton />
      : <section className="ns-statistics__error" role="alert"><strong>创作统计读取失败</strong><span>{error ?? '暂时无法读取运行记录。'}</span><button type="button" onClick={() => { void load() }}>重试读取</button></section>

  return <div className={`ns-statistics${narrow ? ' ns-statistics--narrow' : ''}`}>
    <style>{statisticsStyles}</style>
    <header className="ns-statistics__header">
      <div><span className="ns-statistics__eyebrow">{statistics?.project.title ?? projectTitle}</span><h1>创作统计</h1><p>按真实章节运行记录汇总调用、Token 与 AI 正文产出。</p></div>
      <button className="ns-statistics__refresh" type="button" disabled={loading} onClick={() => { void load() }}>{loading ? '读取中…' : '刷新'}</button>
    </header>
    {error && statistics && <div className="ns-statistics__inline-error" role="alert"><span>{error}</span><button type="button" onClick={() => { void load() }}>重试</button></div>}
    {content}
  </div>
}

function StatisticsContent({ statistics, narrow, onOpenChapter }: { statistics: ProjectGenerationStatistics; narrow: boolean; onOpenChapter?: (chapterId: string) => void | Promise<void> }) {
  const totals = statistics.totals
  const terminalRuns = totals.succeededRuns + totals.failedRuns
  const successRate = terminalRuns ? totals.succeededRuns / terminalRuns : null
  const totalTokens = reportedTokens(totals)
  const draftRuns = statistics.purposes.find(item => item.purpose === 'chapter-draft')?.runs ?? 0
  const planRuns = statistics.purposes.find(item => item.purpose === 'scene-plan')?.runs ?? 0
  const tokenCoverage = totals.runs ? totals.usageReportedRuns / totals.runs : null

  return <main className="ns-statistics__body">
    <section className="ns-statistics__summary" aria-label="项目生成汇总">
      <div className="ns-statistics__primary-metric"><span>章节 AI 调用</span><strong>{formatNumber(totals.runs)}</strong><small>正文 {formatNumber(draftRuns)} · 规划 {formatNumber(planRuns)}</small></div>
      <dl>
        <Metric label="已记录 Token" value={formatNumber(totalTokens)} detail={`输入 ${formatNumber(totals.inputTokens)} · 输出 ${formatNumber(totals.outputTokens)} · 缓存 ${formatNumber(totals.cacheReadTokens + totals.cacheWriteTokens)}`} />
        <Metric label="AI 正文产出" value={`${formatNumber(totals.generatedWords)} 字`} detail={`${formatNumber(totals.generatedDrafts)} 次正文完成`} />
        <Metric label="调用成功率" value={successRate === null ? '—' : formatPercent(successRate)} detail={`成功 ${formatNumber(totals.succeededRuns)} · 失败 ${formatNumber(totals.failedRuns)}${totals.runningRuns ? ` · 进行中 ${formatNumber(totals.runningRuns)}` : ''}`} />
      </dl>
      <div className={`ns-statistics__coverage${tokenCoverage !== null && tokenCoverage < 1 ? ' ns-statistics__coverage--partial' : ''}`}>
        <span>{totals.runs === 0 ? '还没有章节 AI 调用记录。' : totals.usageReportedRuns === totals.runs ? `全部 ${formatNumber(totals.runs)} 次调用均有实际 Token 记录。` : `${formatNumber(totals.usageReportedRuns)} / ${formatNumber(totals.runs)} 次调用有实际 Token 记录；其余不估算。`}</span>
      </div>
    </section>

    <section className="ns-statistics__section" aria-labelledby="statistics-purpose-title">
      <header><div><span>调用构成</span><h2 id="statistics-purpose-title">时间花在了哪里</h2></div><small>Token 为模型实际上报值</small></header>
      <div className="ns-statistics__purpose-list">{statistics.purposes.map(item => <PurposeRow key={item.purpose} item={item} totalTokens={totalTokens} />)}</div>
    </section>

    <section className="ns-statistics__section ns-statistics__chapters" aria-labelledby="statistics-chapters-title">
      <header><div><span>章节明细</span><h2 id="statistics-chapters-title">逐章消耗与产出</h2></div><small>{formatNumber(statistics.chapters.length)} 章</small></header>
      {statistics.chapters.length === 0
        ? <div className="ns-statistics__empty"><strong>还没有章节</strong><span>创建第一章并开始生成后，这里会出现调用、Token 和正文产出。</span></div>
        : <div className="ns-statistics__chapter-list">
          {!narrow && <div className="ns-statistics__chapter-head" aria-hidden="true"><span>章节</span><span>调用</span><span>成功 / 失败</span><span>输入 / 输出 Token</span><span>AI 正文</span><span>最近运行</span></div>}
          {statistics.chapters.map(chapter => <ChapterRow key={chapter.chapterId} chapter={chapter} onOpenChapter={onOpenChapter} />)}
        </div>}
    </section>

    <p className="ns-statistics__scope">统计范围为场景规划与正文生成；人工稿、自动保存、失败残片和未上报 Token 不会混入产出数字。</p>
  </main>
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div>
}

function PurposeRow({ item, totalTokens }: { item: GenerationPurposeStatistics; totalTokens: number }) {
  const copy = purposeCopy[item.purpose]
  const tokens = reportedTokens(item)
  const share = totalTokens ? tokens / totalTokens : 0
  return <article className="ns-statistics__purpose">
    <div className="ns-statistics__purpose-copy"><strong>{copy.title}</strong><span>{copy.detail}</span></div>
    <div className="ns-statistics__purpose-bar" aria-label={`${copy.title}占已记录 Token 的 ${formatPercent(share)}`}><i style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} /></div>
    <div className="ns-statistics__purpose-numbers"><strong>{formatNumber(item.runs)} 次</strong><span>{item.runs ? `${formatNumber(tokens)} Token · ${formatNumber(item.usageReportedRuns)}/${formatNumber(item.runs)} 次有记录` : '尚无调用记录'}</span></div>
    <div className="ns-statistics__purpose-output"><strong>{item.purpose === 'chapter-draft' ? `${formatNumber(item.generatedWords)} 字` : `${formatNumber(item.outputTokens)} Token`}</strong><span>{item.purpose === 'chapter-draft' ? `${formatNumber(item.generatedDrafts)} 次正文完成` : '模型输出'}</span></div>
  </article>
}

function ChapterRow({ chapter, onOpenChapter }: { chapter: ChapterGenerationStatistics; onOpenChapter?: (chapterId: string) => void | Promise<void> }) {
  const totalTokens = reportedTokens(chapter)
  const body = <>
    <span className="ns-statistics__chapter-name"><strong><b>{String(chapter.chapterNumber).padStart(2, '0')}</b>{chapter.chapterTitle}</strong><small>{chapter.volumeTitle} · {chapterStatusLabel(chapter.status)}</small></span>
    <ChapterCell label="调用" value={`${formatNumber(chapter.runs)} 次`} detail={chapter.runningRuns ? `${chapter.runningRuns} 次进行中` : chapter.runs ? `${chapter.usageReportedRuns}/${chapter.runs} 次有 Token` : '尚无调用'} />
    <ChapterCell label="成功 / 失败" value={`${formatNumber(chapter.succeededRuns)} / ${formatNumber(chapter.failedRuns)}`} detail={chapter.failedRuns ? '有失败记录' : chapter.runs ? '无失败记录' : '尚未调用'} />
    <ChapterCell label="Token 消耗" value={formatNumber(totalTokens)} detail={`输入 ${formatNumber(chapter.inputTokens)} · 输出 ${formatNumber(chapter.outputTokens)}${chapter.cacheReadTokens + chapter.cacheWriteTokens ? ` · 缓存 ${formatNumber(chapter.cacheReadTokens + chapter.cacheWriteTokens)}` : ''}`} />
    <ChapterCell label="AI 正文" value={`${formatNumber(chapter.generatedWords)} 字`} detail={`${formatNumber(chapter.generatedDrafts)} 次完成`} />
    <ChapterCell label="最近运行" value={chapter.lastRunAt ? formatDate(chapter.lastRunAt) : '—'} detail={chapter.lastRunAt ? formatTime(chapter.lastRunAt) : '暂无记录'} />
  </>
  if (!onOpenChapter) return <div className="ns-statistics__chapter-row">{body}</div>
  return <button className="ns-statistics__chapter-row" type="button" onClick={() => { void onOpenChapter(chapter.chapterId) }} aria-label={`打开第 ${chapter.chapterNumber} 章 ${chapter.chapterTitle}`}>{body}</button>
}

function ChapterCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <span className="ns-statistics__chapter-cell"><em>{label}</em><strong>{value}</strong><small>{detail}</small></span>
}

function StatisticsSkeleton() {
  return <main className="ns-statistics__body" aria-label="正在读取创作统计"><section className="ns-statistics__skeleton ns-statistics__summary"><i /><i /><i /><i /></section><section className="ns-statistics__skeleton ns-statistics__section"><i /><i /><i /></section></main>
}

function chapterStatusLabel(status: ChapterGenerationStatistics['status']): string { return status === 'approved' ? '已批准' : status === 'draft' ? '有草稿' : '空白' }
function reportedTokens(value: Pick<GenerationStatisticsTotals, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number { return value.inputTokens + value.outputTokens + value.cacheReadTokens + value.cacheWriteTokens }
function formatNumber(value: number): string { return new Intl.NumberFormat('zh-CN').format(value) }
function formatPercent(value: number): string { return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(value) }
function formatDate(value: string): string { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value)) }
function formatTime(value: string): string { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) }

const statisticsStyles = `
.ns-statistics{--s-bg:var(--dsw-alias-bg-module-platform,#f5f6f7);--s-layer:var(--dsw-alias-bg-layer-1,#fff);--s-hover:var(--dsw-specific-sidebar-nav-item-hover,#f1f3f5);--s-text:var(--dsw-alias-label-primary,#202124);--s-muted:var(--dsw-alias-label-secondary,#666b73);--s-faint:var(--dsw-alias-label-tertiary,#8a9099);--s-border:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--s-border-soft:var(--dsw-alias-border-l1,rgba(0,0,0,.05));--s-brand:var(--dsw-alias-state-business-primary,#4176e6);--s-warning:#b66a00;height:100%;min-width:0;overflow:auto;color:var(--s-text);background:var(--s-bg);font-family:var(--dsw-font-family,"PingFang SC","Microsoft YaHei",sans-serif)}
.ns-statistics *{box-sizing:border-box}.ns-statistics button{font:inherit}.ns-statistics button:focus-visible{outline:2px solid var(--s-brand);outline-offset:2px}.ns-statistics__header{max-width:1180px;margin:0 auto;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:30px 30px 18px}.ns-statistics__eyebrow{color:var(--s-faint);font-size:10px;font-weight:600;letter-spacing:.06em}.ns-statistics__header h1{margin:7px 0 0;font-size:25px;line-height:1.2;letter-spacing:-.035em}.ns-statistics__header p{margin:7px 0 0;color:var(--s-muted);font-size:12px;line-height:1.55}.ns-statistics__refresh{min-width:62px;height:32px;padding:0 12px;border:1px solid var(--s-border);border-radius:8px;color:var(--s-text);background:var(--s-layer);cursor:pointer;font-size:10px}.ns-statistics__refresh:hover{background:var(--s-hover)}.ns-statistics__refresh:disabled{cursor:wait;opacity:.55}.ns-statistics__inline-error{max-width:1120px;margin:0 auto 10px;display:flex;justify-content:space-between;gap:12px;padding:8px 11px;border-left:2px solid #c73737;color:#a62c2c;background:rgba(199,55,55,.06);font-size:10px}.ns-statistics__inline-error button{border:0;color:inherit;background:transparent;cursor:pointer}
.ns-statistics__body{max-width:1180px;margin:0 auto;padding:0 30px 58px}.ns-statistics__summary,.ns-statistics__section{border:1px solid var(--s-border);border-radius:10px;background:var(--s-layer);overflow:hidden}.ns-statistics__summary{display:grid;grid-template-columns:minmax(220px,1.15fr) minmax(0,2.85fr)}.ns-statistics__primary-metric{min-height:150px;display:flex;flex-direction:column;justify-content:center;padding:24px 26px;border-right:1px solid var(--s-border-soft)}.ns-statistics__primary-metric>span,.ns-statistics__summary dt{color:var(--s-muted);font-size:10px}.ns-statistics__primary-metric>strong{margin:5px 0 3px;font-size:44px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.055em}.ns-statistics__primary-metric>small,.ns-statistics__summary dl small{color:var(--s-faint);font-size:9px}.ns-statistics__summary dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0}.ns-statistics__summary dl>div{min-width:0;display:flex;flex-direction:column;justify-content:center;padding:22px;border-right:1px solid var(--s-border-soft)}.ns-statistics__summary dl>div:last-child{border-right:0}.ns-statistics__summary dt{margin:0}.ns-statistics__summary dd{margin:6px 0 4px;overflow:hidden;text-overflow:ellipsis;font-size:21px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.025em;white-space:nowrap}.ns-statistics__coverage{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:39px;padding:8px 13px;border-top:1px solid var(--s-border-soft);color:var(--s-muted);background:var(--s-bg);font-size:9px}.ns-statistics__coverage small{color:var(--s-faint)}.ns-statistics__coverage--partial{box-shadow:inset 2px 0 var(--s-warning)}
.ns-statistics__section{margin-top:15px}.ns-statistics__section>header{min-height:58px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:13px 16px 12px;border-bottom:1px solid var(--s-border-soft)}.ns-statistics__section>header span{color:var(--s-faint);font-size:8px;font-weight:600;letter-spacing:.08em}.ns-statistics__section>header h2{margin:3px 0 0;font-size:14px;line-height:1.3;letter-spacing:-.015em}.ns-statistics__section>header>small{color:var(--s-faint);font-size:9px}.ns-statistics__purpose{display:grid;grid-template-columns:minmax(180px,1.35fr) minmax(120px,1fr) minmax(190px,1fr) minmax(120px,.7fr);align-items:center;gap:20px;min-height:78px;padding:13px 16px;border-bottom:1px solid var(--s-border-soft)}.ns-statistics__purpose:last-child{border-bottom:0}.ns-statistics__purpose-copy,.ns-statistics__purpose-numbers,.ns-statistics__purpose-output{min-width:0;display:grid;gap:4px}.ns-statistics__purpose strong{font-size:11px;font-variant-numeric:tabular-nums}.ns-statistics__purpose span{overflow:hidden;color:var(--s-faint);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.ns-statistics__purpose-bar{height:4px;border-radius:999px;background:var(--s-bg);overflow:hidden}.ns-statistics__purpose-bar i{display:block;height:100%;border-radius:inherit;background:var(--s-brand)}.ns-statistics__purpose-output{text-align:right}
.ns-statistics__chapter-head,.ns-statistics__chapter-row{display:grid;grid-template-columns:minmax(210px,1.45fr) minmax(72px,.55fr) minmax(90px,.7fr) minmax(150px,1fr) minmax(100px,.75fr) minmax(90px,.65fr);align-items:center;gap:14px;padding:0 16px}.ns-statistics__chapter-head{min-height:34px;color:var(--s-faint);background:var(--s-bg);font-size:8px}.ns-statistics__chapter-row{width:100%;min-height:66px;border:0;border-top:1px solid var(--s-border-soft);color:var(--s-text);background:transparent;text-align:left}.ns-statistics__chapter-list>.ns-statistics__chapter-row:first-of-type{border-top:0}.ns-statistics button.ns-statistics__chapter-row{cursor:pointer}.ns-statistics button.ns-statistics__chapter-row:hover{background:var(--s-hover)}.ns-statistics__chapter-name,.ns-statistics__chapter-cell{min-width:0;display:grid;gap:4px}.ns-statistics__chapter-name>strong{display:flex;align-items:baseline;gap:9px;overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.ns-statistics__chapter-name b{color:var(--s-faint);font-size:8px;font-variant-numeric:tabular-nums}.ns-statistics__chapter-name small,.ns-statistics__chapter-cell small{overflow:hidden;color:var(--s-faint);font-size:8px;text-overflow:ellipsis;white-space:nowrap}.ns-statistics__chapter-cell em{display:none}.ns-statistics__chapter-cell strong{font-size:10px;font-style:normal;font-variant-numeric:tabular-nums}.ns-statistics__empty{min-height:180px;display:grid;place-items:center;align-content:center;padding:24px;text-align:center}.ns-statistics__empty strong{font-size:13px}.ns-statistics__empty span{max-width:360px;margin-top:6px;color:var(--s-muted);font-size:10px;line-height:1.6}.ns-statistics__scope{margin:12px 2px 0;color:var(--s-faint);font-size:9px;line-height:1.55}
.ns-statistics__error{max-width:1120px;min-height:190px;margin:0 auto;display:grid;place-items:center;align-content:center;padding:24px;border:1px solid var(--s-border);border-radius:10px;background:var(--s-layer);text-align:center}.ns-statistics__error strong{font-size:13px}.ns-statistics__error span{max-width:480px;margin-top:6px;color:var(--s-muted);font-size:10px}.ns-statistics__error button{margin-top:12px;min-height:32px;padding:0 11px;border:1px solid var(--s-border);border-radius:7px;background:var(--s-layer);cursor:pointer;font-size:10px}.ns-statistics__skeleton{animation:ns-statistics-pulse 1.2s ease-in-out infinite}.ns-statistics__skeleton i{display:block;min-height:60px;margin:15px;border-radius:7px;background:var(--s-bg)}@keyframes ns-statistics-pulse{50%{opacity:.55}}
.ns-statistics--narrow .ns-statistics__header{align-items:flex-start;padding:70px 14px 14px}.ns-statistics--narrow .ns-statistics__header p{font-size:10px}.ns-statistics--narrow .ns-statistics__body{padding:0 12px 38px}.ns-statistics--narrow .ns-statistics__summary{grid-template-columns:1fr}.ns-statistics--narrow .ns-statistics__primary-metric{min-height:124px;border-right:0;border-bottom:1px solid var(--s-border-soft)}.ns-statistics--narrow .ns-statistics__summary dl{grid-template-columns:1fr 1fr}.ns-statistics--narrow .ns-statistics__summary dl>div{min-height:98px;padding:15px}.ns-statistics--narrow .ns-statistics__summary dl>div:nth-child(2){border-right:0}.ns-statistics--narrow .ns-statistics__summary dl>div:last-child{grid-column:1/-1;border-top:1px solid var(--s-border-soft)}.ns-statistics--narrow .ns-statistics__summary dd{font-size:18px}.ns-statistics--narrow .ns-statistics__coverage{align-items:flex-start;flex-direction:column;gap:3px}.ns-statistics--narrow .ns-statistics__section>header{align-items:flex-start}.ns-statistics--narrow .ns-statistics__purpose{grid-template-columns:1fr auto;gap:8px 14px;padding:13px}.ns-statistics--narrow .ns-statistics__purpose-copy{grid-column:1}.ns-statistics--narrow .ns-statistics__purpose-numbers{grid-column:1}.ns-statistics--narrow .ns-statistics__purpose-output{grid-column:2;grid-row:1/3;align-self:center}.ns-statistics--narrow .ns-statistics__purpose-bar{grid-column:1/-1}.ns-statistics--narrow .ns-statistics__chapter-row{grid-template-columns:1fr 1fr;gap:12px 16px;min-height:0;padding:15px 13px}.ns-statistics--narrow .ns-statistics__chapter-name{grid-column:1/-1;padding-bottom:2px}.ns-statistics--narrow .ns-statistics__chapter-cell em{display:block;color:var(--s-faint);font-size:8px;font-style:normal}.ns-statistics--narrow .ns-statistics__chapter-cell strong{font-size:11px}.ns-statistics--narrow .ns-statistics__inline-error{margin-inline:12px}
@media(max-width:1100px){.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__body{padding-inline:20px}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__purpose{grid-template-columns:1fr auto;gap:8px 14px;padding:13px}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__purpose-copy,.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__purpose-numbers{grid-column:1}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__purpose-output{grid-column:2;grid-row:1/3;align-self:center}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__purpose-bar{grid-column:1/-1}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__chapter-head{display:none}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__chapter-row{grid-template-columns:1fr 1fr;gap:12px 16px;min-height:0;padding:15px 13px}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__chapter-name{grid-column:1/-1;padding-bottom:2px}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__chapter-cell em{display:block;color:var(--s-faint);font-size:8px;font-style:normal}.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__chapter-cell strong{font-size:11px}}
@media(max-width:760px){.ns-statistics:not(.ns-statistics--narrow) .ns-statistics__header{padding:70px 14px 14px}.ns-statistics__refresh{min-width:54px}.ns-statistics__body{padding-inline:12px}.ns-statistics__header{padding-inline:14px}.ns-statistics__inline-error{margin-inline:12px}}
@media(prefers-reduced-motion:reduce){.ns-statistics__skeleton{animation:none}}
`
