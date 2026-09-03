import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')
const versionReviewSource = clientSource.slice(clientSource.indexOf('function VersionReviewSurface'), clientSource.indexOf('function GenerationSourcesInspector'))
const approveWaitingSource = clientSource.slice(clientSource.indexOf('const approveWaitingDraft'), clientSource.indexOf('const continueEditingVersion'))

describe('Novel Studio author context inspector', () => {
  it('keeps the third column author-focused and responsive', () => {
    const inspectorSource = clientSource.slice(clientSource.indexOf('function AuthorContextInspector'), clientSource.indexOf('function SelectionRewriteAction'))
    expect(clientSource).toContain('function AuthorContextInspector')
    expect(clientSource).toContain('useNarrowViewport(1279)')
    expect(clientSource).toContain("'minmax(0,1fr) 350px'")
    expect(clientSource).toContain("role={drawer ? 'dialog' : 'complementary'}")
    expect(clientSource).toContain("{ id: 'versions', label: '版本' }")
    expect(clientSource).toContain("{ id: 'sources', label: '本章资料' }")
    expect(clientSource).toContain("{ id: 'memory', label: '记忆摘要' }")
    expect(inspectorSource).not.toContain('WorkflowRun')
    expect(inspectorSource).not.toContain('nodeLabel(')
    expect(inspectorSource).not.toContain('RunRow')
  })

  it('uses the main editor for approval and reserves review for a real two-version diff', () => {
    expect(clientSource).toContain('function VersionReviewSurface')
    expect(clientSource).toContain('diffManuscriptParagraphs')
    expect(clientSource).toContain('批准本章')
    expect(clientSource).toContain('版本差异')
    expect(clientSource).toContain('比较修改')
    expect(clientSource).not.toContain('无基线，仅阅读全文')
    expect(clientSource).not.toContain('在主区审阅')
    expect(versionReviewSource).not.toContain('版本全文审阅')
    expect(versionReviewSource).not.toContain('approvalTargetVersionId')
    expect(clientSource).toContain("activeRun.approval?.manuscriptVersionId ?? null")
    expect(approveWaitingSource).toContain('chapter.currentDraftVersionId !== waitingApprovalTargetId')
  })

  it('keeps waiting approval compact and editable without a duplicate decision surface', () => {
    expect(clientSource).toContain("const statusHeading = waitingApproval ? '等待批准'")
    expect(clientSource).toContain('可直接批准；也可在正文中选中片段改写')
    expect(clientSource).toContain('正文有修改，保存后即可批准')
    expect(clientSource).toContain("workflowCommand('approval', { decision: 'approved', note: '' })")
    expect(clientSource).toContain('approvalBlocked={activeRun?.status === \'waiting_approval\' && !waitingApprovalReady}')
    expect(clientSource).not.toContain('批准备注或返修意见')
  })

  it('refuses approval when the displayed draft has not become the workflow target', () => {
    expect(approveWaitingSource).toContain("activeRun?.status !== 'waiting_approval'")
    expect(approveWaitingSource).toContain('waitingApprovalTargetError || !waitingApprovalTargetId')
    expect(approveWaitingSource).toContain('chapter.currentDraftVersionId !== waitingApprovalTargetId')
    expect(approveWaitingSource).toContain('请先保存正文，再批准本章')
  })

  it('loads an older version into the editor without directly writing the database', () => {
    expect(clientSource).toContain('function VersionInspectorPanel')
    expect(clientSource).toContain("rememberLocalEdit(version.content); setEditorMode('write')")
    expect(clientSource).toContain('载入此版本编辑')
    expect(clientSource).not.toContain('只把该版本载入编辑器并标记为未保存')
  })

  it('keeps interrupted generation attempts visible without presenting them as versions', () => {
    expect(clientSource).toContain('function FailedDraftAttempts')
    expect(clientSource).toContain('中断生成历史')
    expect(clientSource).toContain('这些内容只用于找回和复制，不是正式草稿')
    expect(clientSource).toContain("run.status === 'failed' && Boolean(run.streamedText)")
  })

  it('uses existing generation traces and project knowledge rather than a run center', () => {
    expect(clientSource).toContain('/generation-sources')
    expect(clientSource).toContain('`/projects/${encodeURIComponent(chapter.projectId)}/knowledge`')
    expect(clientSource).toContain('这里显示项目当前的分层摘要，不展示完整 Prompt')
  })

  it('restores visible keyboard focus and dialog semantics', () => {
    expect(clientSource).toContain('aria-current={active ? \'page\' : undefined}')
    expect(clientSource).toContain(':focus-visible')
    expect(clientSource).not.toContain('outline: 0')
    expect(clientSource).toContain('role="dialog" aria-modal="true" aria-label="新建项目"')
    expect(clientSource).toContain("if (event.key === 'Escape') setCreatingProject(false)")
  })
})
