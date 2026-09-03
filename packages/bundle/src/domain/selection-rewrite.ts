export const MAX_SELECTION_REWRITE_CHARACTERS = 12_000
export const MAX_SELECTION_CONTEXT_CHARACTERS = 2_400
export const MAX_SELECTION_REWRITE_INSTRUCTION_CHARACTERS = 1_200

export interface SelectionRewriteInput {
  selectedText: string
  contextBefore: string
  contextAfter: string
  instruction: string
  baseRevision: number
}

export interface SelectionRewriteResult {
  replacementText: string
}

export interface ManuscriptSelectionSnapshot {
  content: string
  start: number
  end: number
  selectedText: string
}

export function createManuscriptSelectionSnapshot(content: string, start: number, end: number): ManuscriptSelectionSnapshot {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > content.length) {
    throw new Error('Selection range is invalid.')
  }
  return { content, start, end, selectedText: content.slice(start, end) }
}

export function applyManuscriptSelectionRewrite(currentContent: string, snapshot: ManuscriptSelectionSnapshot, replacementText: string): { content: string; selectionStart: number; selectionEnd: number } {
  if (currentContent !== snapshot.content || currentContent.slice(snapshot.start, snapshot.end) !== snapshot.selectedText) {
    throw new Error('正文在重写期间发生了变化，未应用模型结果。')
  }
  if (!replacementText.trim()) throw new Error('模型没有返回可用的重写内容。')
  return {
    content: `${currentContent.slice(0, snapshot.start)}${replacementText}${currentContent.slice(snapshot.end)}`,
    selectionStart: snapshot.start,
    selectionEnd: snapshot.start + replacementText.length,
  }
}
