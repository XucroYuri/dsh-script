import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(here, '../../..')
const marketplace = workspace

function resolveCodexBin() {
  if (process.env.SCRIPT_STUDIO_CODEX_BIN) return resolve(process.env.SCRIPT_STUDIO_CODEX_BIN)
  try { return execFileSync('which', ['codex'], { encoding: 'utf8' }).trim() } catch {}
  throw new Error('Codex CLI not found. Set SCRIPT_STUDIO_CODEX_BIN to the codex executable.')
}

const codexBin = resolveCodexBin()
const isolatedHome = await mkdtemp(join(tmpdir(), 'script-studio-codex-'))
const env = { ...process.env, CODEX_HOME: isolatedHome }

async function run(args) {
  const result = await execFileAsync(codexBin, ['plugin', ...args], { cwd: workspace, env, maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(result.stdout)
}

async function mcpSmoke(serverPath) {
  const child = spawn(process.execPath, [serverPath, '--stdio'], { cwd: dirname(serverPath), stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const response = JSON.parse(line)
      const waiter = pending.get(response.id)
      if (waiter) { pending.delete(response.id); waiter(response) }
    }
  })
  const request = (id, method, params) => new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)) }, 10_000)
    pending.set(id, response => { clearTimeout(timer); resolvePromise(response) })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
  })
  try {
    const initialized = await request('initialize', 'initialize')
    if (!initialized.result?.capabilities?.tools) throw new Error(`MCP initialize did not negotiate tools: ${JSON.stringify(initialized)}`)
    const listed = await request('list', 'tools/list')
    const names = listed.result?.tools?.map(tool => tool.name)
    if (JSON.stringify(names) !== JSON.stringify(['script_studio_capabilities', 'script_studio_get_project_hierarchy', 'script_studio_create_season'])) throw new Error(`Unexpected MCP tools: ${JSON.stringify(names)}`)
    const hierarchy = await request('read', 'tools/call', { name: 'script_studio_get_project_hierarchy', arguments: { projectId: 'project-1' } })
    if (!hierarchy.result?.content?.[0]?.text) throw new Error(`MCP hierarchy smoke failed: ${JSON.stringify(hierarchy)}`)
  } finally {
    child.kill()
  }
}

try {
  const added = await run(['marketplace', 'add', marketplace, '--json'])
  if (added.marketplaceName !== 'script-studio') throw new Error(`Unexpected marketplace name: ${JSON.stringify(added)}`)
  const available = await run(['list', '--available', '--json'])
  if (!available.available.some(plugin => plugin.pluginId === 'script-studio-codex@script-studio')) throw new Error(`Codex marketplace did not expose Script Studio: ${JSON.stringify(available)}`)
  const installed = await run(['add', 'script-studio-codex', '--marketplace', 'script-studio', '--json'])
  const pluginRoot = installed.installedPath
  const listed = await run(['list', '--json'])
  if (!listed.installed.some(plugin => plugin.pluginId === 'script-studio-codex@script-studio')) throw new Error(`Codex plugin was not installed: ${JSON.stringify(listed)}`)
  const manifest = JSON.parse(await readFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'))
  if (manifest.name !== 'script-studio-codex' || manifest.mcpServers !== './.mcp.json') throw new Error(`Installed Codex manifest is incomplete: ${JSON.stringify(manifest)}`)
  await mcpSmoke(join(pluginRoot, 'mcp', 'server.mjs'))
  await run(['remove', 'script-studio-codex', '--marketplace', 'script-studio', '--json'])
  const removed = await run(['list', '--json'])
  if (removed.installed.length !== 0) throw new Error(`Codex plugin removal left installed plugins: ${JSON.stringify(removed)}`)
  console.log(JSON.stringify({ ok: true, codex: '0.150.1', marketplaceReady: true, pluginInstalled: true, mcpReady: true, pluginRemoved: true }, null, 2))
} finally {
  await rm(isolatedHome, { recursive: true, force: true })
}
