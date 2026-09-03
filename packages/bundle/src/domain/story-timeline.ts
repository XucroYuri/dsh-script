export function extractStoryTimelineAnchors(content: string): string[] {
  const lines = content.split(/\r?\n/).map(line => line.trim())
  const start = lines.findIndex(line => /^关键时间锚点(?:汇总)?[：:]?$/.test(line))
  if (start < 0) return []
  const anchors: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^硬性边界[：:]?$/.test(line) || /^一、所有既定死亡锚点/.test(line)) break
    if (!line || anchors.includes(line)) continue
    anchors.push(line)
  }
  return anchors.slice(0, 60)
}
