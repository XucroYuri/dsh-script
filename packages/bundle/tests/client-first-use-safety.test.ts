import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const client = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')
const batches = readFileSync(new URL('../src/dsh-adapter/client-batches.tsx', import.meta.url), 'utf8')
const memory = readFileSync(new URL('../src/dsh-adapter/client-memory.tsx', import.meta.url), 'utf8')
const relationships = readFileSync(new URL('../src/dsh-adapter/client-relationships.tsx', import.meta.url), 'utf8')

describe('Novel Studio first-use and author-safety client', () => {
  it('keeps a synchronous browser recovery copy until the matching server save succeeds', () => {
    expect(client).toContain("CHAPTER_RECOVERY_STORAGE_PREFIX = 'novel-studio:chapter-recovery:v1:'")
    expect(client).toContain('window.localStorage.setItem(chapterRecoveryStorageKey(chapterId)')
    expect(client).toContain('clearChapterRecoveryDraft(chapter.id, value)')
    expect(client).toContain('发现浏览器恢复草稿')
    expect(client).toContain('恢复本地草稿')
    expect(client).toContain('onClick={discardRecoveryDraft}>丢弃')
    expect(client).toContain("window.addEventListener('beforeunload', warnBeforeUnload)")
    expect(client).toContain("window.removeEventListener('beforeunload', warnBeforeUnload)")
    expect(client).toContain("cause.code === 'revision-conflict'")
    expect(client).toContain('latestVersion?.content === value')
    expect(client).toContain('本地恢复草稿仍保留，请核对后再次保存')
  })

  it('refreshes a succeeded foundation run before React state scheduling can hide the transition', () => {
    expect(client).toContain("const refreshWorkspace = updates.some(update => update?.status === 'succeeded')")
    expect(client).toContain('if (refreshWorkspace) await load()')
    expect(client).toContain('创建第一章')
    expect(client).toContain('`生成${title}初稿`')
  })

  it('uses task-oriented navigation and keeps archived chapters and sources readable', () => {
    for (const label of ['创作准备', '人物事实', 'Canon 事实', '时间线看板']) expect(client).toContain(`label="${label}"`)
    expect(client).not.toContain('label="大纲"')
    expect(client).toContain('readOnly={readOnly || saving || rewriteBusy}')
    expect(client).toContain('正文、版本和本章资料可查看')
    expect(client).toContain('label="故事资料" active={section === \'sources\'} onClick=')
  })

  it('keeps preparation advisory-only while still requiring an anchor chapter', () => {
    expect(batches).toContain('ns-batches__preparation-note')
    expect(batches).toContain('可继续生成，完成准备后会更稳')
    expect(batches).toContain('完善创作准备')
    expect(batches).not.toContain("if (!archived && (foundationLoading || !foundation?.readyForChapterGeneration))")
    expect(batches).toContain('先创建第一章')
    expect(batches).toContain('onCreateChapter')
    expect(client).toContain('foundationAdvisory')
    expect(client).toContain('仍可继续生成，完成准备后会更稳')
    expect(client).not.toContain('disabled={!foundationReady || dirty')
    expect(batches.match(/新建批次/g)).toHaveLength(1)
    expect(batches).toContain("activeBatchStatuses.has(batch.status)")
    expect(batches).toContain("setSelectedBatchId(batch.id)")
  })

  it('distinguishes true empty memory and Canon states from filtered results', () => {
    expect(client).toContain('compactKnowledgeChildren(children)')
    expect(memory).toContain("filtered ? '没有匹配记忆' : '还没有记忆'")
    expect(memory).toContain("trulyEmpty ? '这里还没有记忆'")
  })

  it('does not misrepresent placeholder review or a newly created repair version', () => {
    for (const label of ['剧情检查（流程占位）', '人物检查（流程占位）', '时间线检查（流程占位）', '文风检查（流程占位）']) {
      expect(client).toContain(label)
      expect(batches).toContain(label)
    }
    expect(client).toContain('不等于 AI 已完成质量审校')
    expect(client).toContain('建立返修版本')
    expect(client).not.toContain('退回返修')
  })

  it('keeps paginated-only relationship edges available to the evidence dialog', () => {
    expect(relationships).toContain('new Map([...(listRelationships ?? []), ...relationships]')
    expect(relationships).toContain('relationshipById.get(selectedRelationshipId)')
  })

  it('rejects stale async selections across project, batch, memory, relationship and evidence views', () => {
    expect(client).toContain('workspaceRequestRef')
    expect(client).toContain('if (requestId !== workspaceRequestRef.current) return false')
    expect(batches).toContain('detailRequestRef')
    expect(memory).toContain('detailRequestRef')
    expect(relationships).toContain('evidenceRequestRef')
  })
})
