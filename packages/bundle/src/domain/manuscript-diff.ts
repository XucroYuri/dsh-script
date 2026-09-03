export type ManuscriptDiffRowKind = 'equal' | 'added' | 'removed'

export interface ManuscriptDiffRow {
  kind: ManuscriptDiffRowKind
  text: string
  leftNumber: number | null
  rightNumber: number | null
}

export interface ManuscriptParagraphDiff {
  rows: ManuscriptDiffRow[]
  added: number
  removed: number
  unchanged: number
  coarse: boolean
}

export interface ManuscriptDiffOptions {
  maxLcsCells?: number
}

export const MAX_MANUSCRIPT_DIFF_LCS_CELLS = 48_000

export function manuscriptParagraphs(content: string): string[] {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
}

export function diffManuscriptParagraphs(leftContent: string, rightContent: string, options: ManuscriptDiffOptions = {}): ManuscriptParagraphDiff {
  const left = manuscriptParagraphs(leftContent)
  const right = manuscriptParagraphs(rightContent)
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  ) suffix += 1

  const leftMiddle = left.slice(prefix, left.length - suffix)
  const rightMiddle = right.slice(prefix, right.length - suffix)
  const maxLcsCells = Math.max(0, options.maxLcsCells ?? MAX_MANUSCRIPT_DIFF_LCS_CELLS)
  const coarse = leftMiddle.length * rightMiddle.length > maxLcsCells
  const rows: ManuscriptDiffRow[] = []

  for (let index = 0; index < prefix; index += 1) rows.push(equalRow(left[index]!, index, index))

  if (coarse) {
    leftMiddle.forEach((text, index) => rows.push({ kind: 'removed', text, leftNumber: prefix + index + 1, rightNumber: null }))
    rightMiddle.forEach((text, index) => rows.push({ kind: 'added', text, leftNumber: null, rightNumber: prefix + index + 1 }))
  } else {
    rows.push(...boundedLcsRows(leftMiddle, rightMiddle, prefix))
  }

  for (let index = 0; index < suffix; index += 1) {
    const leftIndex = left.length - suffix + index
    const rightIndex = right.length - suffix + index
    rows.push(equalRow(left[leftIndex]!, leftIndex, rightIndex))
  }

  return {
    rows,
    added: rows.filter(row => row.kind === 'added').length,
    removed: rows.filter(row => row.kind === 'removed').length,
    unchanged: rows.filter(row => row.kind === 'equal').length,
    coarse,
  }
}

function boundedLcsRows(left: string[], right: string[], offset: number): ManuscriptDiffRow[] {
  const width = right.length + 1
  const table = new Uint32Array((left.length + 1) * width)
  const at = (leftIndex: number, rightIndex: number) => leftIndex * width + rightIndex

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[at(leftIndex, rightIndex)] = left[leftIndex] === right[rightIndex]
        ? table[at(leftIndex + 1, rightIndex + 1)]! + 1
        : Math.max(table[at(leftIndex + 1, rightIndex)]!, table[at(leftIndex, rightIndex + 1)]!)
    }
  }

  const rows: ManuscriptDiffRow[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      rows.push(equalRow(left[leftIndex]!, offset + leftIndex, offset + rightIndex))
      leftIndex += 1
      rightIndex += 1
    } else if (table[at(leftIndex + 1, rightIndex)]! >= table[at(leftIndex, rightIndex + 1)]!) {
      rows.push({ kind: 'removed', text: left[leftIndex]!, leftNumber: offset + leftIndex + 1, rightNumber: null })
      leftIndex += 1
    } else {
      rows.push({ kind: 'added', text: right[rightIndex]!, leftNumber: null, rightNumber: offset + rightIndex + 1 })
      rightIndex += 1
    }
  }
  while (leftIndex < left.length) {
    rows.push({ kind: 'removed', text: left[leftIndex]!, leftNumber: offset + leftIndex + 1, rightNumber: null })
    leftIndex += 1
  }
  while (rightIndex < right.length) {
    rows.push({ kind: 'added', text: right[rightIndex]!, leftNumber: null, rightNumber: offset + rightIndex + 1 })
    rightIndex += 1
  }
  return rows
}

function equalRow(text: string, leftIndex: number, rightIndex: number): ManuscriptDiffRow {
  return { kind: 'equal', text, leftNumber: leftIndex + 1, rightNumber: rightIndex + 1 }
}
