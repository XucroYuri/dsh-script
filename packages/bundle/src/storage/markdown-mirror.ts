import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export interface MarkdownMemoryFile {
  path: string
  content: string
  hash: string
}

export interface MemoryItemMarkdownFile extends MarkdownMemoryFile {
  relativePath: string
  body: string
}

export function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (value === undefined || value === null || !value.trim()) return null
  const raw = value.trim()
  if (!isAbsolute(raw)) throw new Error('Project workspace path must be absolute.')
  return resolve(raw)
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '').trim()
  return (normalized || fallback).slice(0, 120)
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, content, 'utf8')
  renameSync(temporary, path)
}

function safeMemoryRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!/^memory\/[a-zA-Z0-9._-]+\.md$/.test(normalized) || normalized.includes('..')) throw new Error('Memory Markdown path must stay inside the project memory directory.')
  return normalized
}

export function memoryItemMarkdownPath(itemId: string, origin: 'derived' | 'user'): string {
  return `memory/${origin}-${safeSegment(itemId, 'memory')}.md`
}

export function writeMemoryItemMarkdown(
  workspacePath: string | null | undefined,
  relativePath: string,
  input: { itemId: string; origin: 'derived' | 'user'; revision: number; category: string; content: string },
): MemoryItemMarkdownFile | null {
  const root = normalizeWorkspacePath(workspacePath)
  if (!root) return null
  const safePath = safeMemoryRelativePath(relativePath)
  const body = `---\nnovelStudioMemoryId: ${JSON.stringify(input.itemId)}\norigin: ${input.origin}\nrevision: ${Math.max(1, Math.trunc(input.revision))}\ncategory: ${JSON.stringify(input.category)}\n---\n\n${input.content.trim()}\n`
  const absolutePath = join(root, ...safePath.split('/'))
  atomicWrite(absolutePath, body)
  return { path: absolutePath, relativePath: safePath, content: body, body: input.content.trim(), hash: createHash('sha256').update(body).digest('hex') }
}

export function readMemoryItemMarkdown(workspacePath: string | null | undefined, relativePath: string): MemoryItemMarkdownFile | null {
  const root = normalizeWorkspacePath(workspacePath)
  if (!root) return null
  const safePath = safeMemoryRelativePath(relativePath)
  const absolutePath = join(root, ...safePath.split('/'))
  try {
    if (!lstatSync(absolutePath).isFile()) return null
    const content = readFileSync(absolutePath, 'utf8')
    const body = content.startsWith('---\n') ? content.replace(/^---\n[\s\S]*?\n---\n\n?/, '').trim() : content.trim()
    return { path: absolutePath, relativePath: safePath, content, body, hash: createHash('sha256').update(content).digest('hex') }
  } catch { return null }
}

const MEMORY_MANIFEST = '.novel-studio-memory.json'

function readManagedMemoryFiles(directory: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(join(directory, MEMORY_MANIFEST), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { files?: unknown }).files)) return new Set()
    return new Set((parsed as { files: unknown[] }).files.filter((value): value is string => typeof value === 'string' && /^[^/\\]+\.md$/.test(value)))
  } catch {
    return new Set()
  }
}

export function writeChapterMarkdown(workspacePath: string | null | undefined, chapterNumber: number, title: string, content: string, status: 'draft' | 'approved'): void {
  const root = normalizeWorkspacePath(workspacePath)
  if (!root) return
  const chapterDirectory = join(root, 'chapters')
  const filename = `${String(Math.max(0, chapterNumber)).padStart(3, '0')}-${safeSegment(title, 'untitled')}.md`
  const body = `---\nchapter: ${Math.max(0, chapterNumber)}\ntitle: ${JSON.stringify(title.trim() || '未命名章节')}\nstatus: ${status}\n---\n\n${content.trimEnd()}\n`
  atomicWrite(join(chapterDirectory, filename), body)
}

export function writeFoundationMarkdown(workspacePath: string | null | undefined, kind: string, title: string, content: string, status: 'draft' | 'approved'): void {
  const root = normalizeWorkspacePath(workspacePath)
  if (!root) return
  const body = `---\nkind: ${safeSegment(kind, 'foundation')}\ntitle: ${JSON.stringify(title.trim() || kind)}\nstatus: ${status}\n---\n\n${content.trimEnd()}\n`
  atomicWrite(join(root, 'foundation', `${safeSegment(kind, 'foundation')}.md`), body)
}

export function writeMemoryMarkdown(workspacePath: string | null | undefined, files: Array<{ name: string; title: string; content: string }>): string | null {
  const root = normalizeWorkspacePath(workspacePath)
  if (!root) return null
  const memoryDirectory = join(root, 'memory')
  mkdirSync(memoryDirectory, { recursive: true })
  const previous = readManagedMemoryFiles(memoryDirectory)
  const existing = new Set(readdirSync(memoryDirectory).filter(name => name.endsWith('.md')))
  const managed = new Set<string>()
  for (const file of files) {
    const base = `${safeSegment(file.name, 'memory')}.md`
    let filename = base
    let suffix = 2
    while (managed.has(filename) || (existing.has(filename) && !previous.has(filename))) filename = `${base.slice(0, -3)}-${suffix++}.md`
    managed.add(filename)
    const body = `# ${file.title.trim() || file.name}\n\n${file.content.trim()}\n`
    atomicWrite(join(memoryDirectory, filename), body)
  }
  for (const filename of previous) {
    if (managed.has(filename)) continue
    const path = join(memoryDirectory, filename)
    try { if (statSync(path).isFile()) unlinkSync(path) } catch { /* A user may have removed or replaced a managed file. */ }
  }
  atomicWrite(join(memoryDirectory, MEMORY_MANIFEST), `${JSON.stringify({ version: 1, files: [...managed].sort() }, null, 2)}\n`)
  return new Date().toISOString()
}

export function readMemoryMarkdown(workspacePath: string | null | undefined, maxCharacters = 24_000): MarkdownMemoryFile[] {
  const root = normalizeWorkspacePath(workspacePath)
  if (!root) return []
  const memoryDirectory = join(root, 'memory')
  if (!existsSync(memoryDirectory)) return []
  let entries: string[]
  try {
    // Only direct Markdown files are inputs. Do not follow user-controlled
    // manifest paths or read nested/symlinked files outside memory/.
    entries = readdirSync(memoryDirectory).filter(name => name.endsWith('.md')).filter(name => {
      try { return lstatSync(join(memoryDirectory, name)).isFile() } catch { return false }
    }).sort()
  } catch { return [] }
  const result: MarkdownMemoryFile[] = []
  let remaining = Math.max(0, maxCharacters)
  for (const name of entries) {
    if (remaining <= 0 || !name.endsWith('.md')) continue
    const path = join(memoryDirectory, name)
    try {
      const rawContent = readFileSync(path, 'utf8')
      const sampledContent = rawContent.slice(0, remaining)
      if (!sampledContent.trim()) continue
      // Raw memory/*.md files do not carry enough SQLite policy state to prove
      // prompt eligibility (active/auto/no-open-conflict). Keep only a hashable
      // discovery snapshot here; registered Memory items are read separately by
      // readMemoryItemMarkdown and enter prompts through the audited SQLite path.
      result.push({ path, content: '', hash: createHash('sha256').update(rawContent).digest('hex') })
      remaining -= sampledContent.length
    } catch { /* A concurrently removed file is simply omitted from this snapshot. */ }
  }
  return result
}
