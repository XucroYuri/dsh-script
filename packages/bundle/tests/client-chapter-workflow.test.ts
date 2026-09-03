import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')
const workflowBarSource = clientSource.slice(clientSource.indexOf('function ChapterWorkflowBar'), clientSource.indexOf('function WorkflowPreparingSurface'))

describe('Novel Studio chapter workflow bar', () => {
  it('keeps the inline status compact without exposing internal node counts or stage hints', () => {
    expect(clientSource).toContain("const statusHeading = waitingApproval ? '等待批准' : `${statusText} · ${nodeLabel(run.currentNodeKey)}`")
    expect(clientSource).toContain('暂停')
    expect(clientSource).toContain('取消')
    expect(clientSource).toContain('本章生成暂未完成')
    expect(clientSource).toContain('重试本章')
    expect(clientSource).toContain('原正文和已完成的前置步骤不会丢失')
    expect(clientSource).not.toContain('重新生成本章初稿')
    expect(clientSource).not.toContain('从失败处重试')
    expect(clientSource).not.toContain('正在内部整理冲突与场景顺序，随后开始写正文')
    expect(clientSource).not.toContain('{completed}/{run.definition.nodes.length}')
    expect(clientSource).not.toContain('workflowStageHint(run)')
  })

  it('keeps waiting approval in the editable chapter surface', () => {
    expect(clientSource).toContain("padding: waitingApproval ? '6px 18px' : '9px 18px'")
    expect(clientSource).toContain('{workflowBarRun && <ChapterWorkflowBar')
    expect(workflowBarSource).toContain('批准本章')
    expect(workflowBarSource).toContain('可直接批准；也可在正文中选中片段改写')
    expect(workflowBarSource).not.toContain('返回审阅')
    expect(workflowBarSource).not.toContain('建立返修版本')
    expect(clientSource).toContain("run.status !== 'failed' && !waitingApproval")
  })

  it('uses advisory tones for revision drift, cancellation and salvaged output-limit drafts', () => {
    expect(clientSource).toContain("failure?.code === 'revision-conflict'")
    expect(clientSource).toContain('生成期间项目或章节内容已更新，旧结果没有覆盖最新内容')
    expect(clientSource).toContain("if (status === 'cancelled') return <span aria-label=\"已取消\"")
    expect(clientSource).toContain("item.nodeKey === 'generate_draft' && item.status === 'succeeded'")
    expect(clientSource).toContain('output.completionAdvisory')
    expect(clientSource).toContain('已保留可审阅正文；模型到达输出上限，结尾可能未完整')
    expect(clientSource).toContain('workflowCompletionAdvisory(run)')
  })

  it('shows rejected unsupported Canon candidates as a non-blocking warning after approval', () => {
    expect(clientSource).toContain("run.canonCandidates.filter(candidate => candidate.status === 'rejected').length")
    expect(clientSource).toContain("!['failed', 'cancel_requested', 'cancelled'].includes(run.status)")
    expect(clientSource).toContain('候选故事事实因缺少可核验的正文证据已安全跳过')
    expect(clientSource).toContain('不会因此中断章节批准、记忆更新或后续写作')
    expect(clientSource).toContain('showCanonSkipNotice && <div role="status"')
  })

  it('presents target drift as a saved-draft advisory instead of a workflow failure', () => {
    expect(clientSource).toContain("item.nodeKey === 'generate_draft' && item.status === 'succeeded'")
    expect(clientSource).toContain('实际 {formatNumber(lengthAdvisory.actualWords)} 字 · 建议 {formatNumber(lengthAdvisory.targetWords)} 字')
    expect(clientSource).toContain("lengthAdvisory && run.status !== 'failed' && !waitingApproval")
  })

  it('shows successful post-processing degradation as a visible non-blocking warning', () => {
    expect(clientSource).toContain("item.nodeKey === 'refresh_summaries_and_indexes' && item.status === 'succeeded'")
    expect(clientSource).toContain('postProcessingWarnings')
    expect(clientSource).toContain('memoryRefreshError')
    expect(clientSource).toContain('relationshipExtractionError')
    expect(clientSource).toContain("warning.stage === 'memory-summary' ? '长篇记忆摘要'")
    expect(clientSource).toContain("warning.stage === 'relationship-extraction' ? '实体关系候选提取'")
    expect(clientSource).toContain('本章正文、Canon 与基础知识索引均已保存')
    expect(clientSource).toContain('本次未完成长篇记忆摘要，已使用批准正文生成基础回退索引，可稍后重新生成摘要')
    expect(clientSource).toContain('本次未形成可提交的关系候选，正文与其他知识索引不受影响，可稍后重新提取')
    expect(clientSource).toContain("warnings.some(warning => warning.label === label)")
    expect(clientSource).toContain('这些属于可再生后处理，暂未完成不会把本章标为失败，也不影响后续写作')
    expect(clientSource).toContain("postProcessingWarnings.length > 0 && run.status === 'succeeded'")
  })

  it('keeps successful advisories reachable without treating the completed run as active work', () => {
    expect(clientSource).toContain("const completedNoticeRun = activeRun ? null : projectRuns.find(run => run.chapterId === chapter.id && run.status === 'succeeded' && workflowHasPersistentNotice(run)) ?? null")
    expect(clientSource).toContain('const workflowBarRun = activeRun ?? completedNoticeRun')
    expect(clientSource).toContain('{workflowBarRun && <ChapterWorkflowBar')
    expect(clientSource).toContain('error={activeRun ? waitingApprovalTargetError ?? workflowCommandError : null}')
    expect(clientSource).toContain("run.canonCandidates.some(candidate => candidate.status === 'rejected')")
    expect(clientSource).toContain('workflowPostProcessingWarnings(run).length > 0')
  })
})
