function decodeEscape(character: string): string | null {
  return ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' } as Record<string, string>)[character] ?? null
}

/**
 * Extracts a possibly incomplete JSON string field without requiring the full
 * model response to be valid JSON yet. An incomplete trailing escape sequence
 * is withheld until the next stream chunk arrives.
 */
export function extractStreamingJsonString(raw: string, field: string): string {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`"${escapedField}"\\s*:\\s*"`).exec(raw)
  if (!match) return ''
  let output = ''
  let index = match.index + match[0].length
  while (index < raw.length) {
    const character = raw[index]!
    if (character === '"') break
    if (character !== '\\') {
      output += character
      index += 1
      continue
    }
    if (index + 1 >= raw.length) break
    const escaped = raw[index + 1]!
    if (escaped === 'u') {
      const code = raw.slice(index + 2, index + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(code)) break
      output += String.fromCharCode(Number.parseInt(code, 16))
      index += 6
      continue
    }
    const decoded = decodeEscape(escaped)
    if (decoded === null) break
    output += decoded
    index += 2
  }
  return output
}

export interface ThrottledStreamWriter {
  push(text: string): void
  flush(): void
}

export function createThrottledStreamWriter(write: (text: string) => void, intervalMs = 160, characterStep = 96): ThrottledStreamWriter {
  let pending = ''
  let persisted = ''
  let lastWriteAt = 0
  const flush = () => {
    if (pending.length < persisted.length || pending === persisted) return
    write(pending)
    persisted = pending
    lastWriteAt = Date.now()
  }
  return {
    push(text) {
      if (text.length < pending.length) return
      pending = text
      if (pending.length - persisted.length >= characterStep || Date.now() - lastWriteAt >= intervalMs) flush()
    },
    flush,
  }
}
