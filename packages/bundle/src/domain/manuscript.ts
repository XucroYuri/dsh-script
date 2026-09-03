export function manuscriptWordCount(content: string): number {
  const chinese = content.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const nonChineseWords = content.replace(/[\u3400-\u9fff]/g, ' ').trim().split(/\s+/).filter(Boolean).length
  return chinese + nonChineseWords
}
