import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = resolve(here, '..')
const workspace = resolve(plugin, '../..')

function resolveDshBin() {
  if (process.env.SCRIPT_STUDIO_DSH_BIN) return resolve(process.env.SCRIPT_STUDIO_DSH_BIN)
  try { return execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim() } catch {}
  throw new Error('DeepSeek Harness CLI not found. Set SCRIPT_STUDIO_DSH_BIN to the dsh executable.')
}

const dshBin = resolveDshBin()
await access(dshBin)
const isolatedHome = await mkdtemp(join(tmpdir(), 'script-studio-dsh-'))
const profileDir = join(isolatedHome, 'profiles', 'web')
const env = { ...process.env, DSH_HOME: isolatedHome, DSH_TELEMETRY_MODE: 'DISABLED' }

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [dshBin, ...args], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`dsh ${args.join(' ')} failed (${code})\n${stdout}\n${stderr}`)))
  })
}

function waitForUrl(child) {
  return new Promise((resolvePromise, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Harness web URL\n${output}`)), 30_000)
    const inspect = chunk => {
      output += chunk.toString()
      const match = output.match(/(http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { clearTimeout(timer); resolvePromise(match[1]) }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Harness web exited before startup (${code})\n${output}`)) })
  })
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise(resolvePromise => child.once('exit', resolvePromise))
}

async function main() {
  let server
  try {
    await run(['plugin', '--profile', 'web', 'add', plugin])
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    if (!profile.dsh.profile.bundles.includes('@script-studio/dsh-adapter')) throw new Error('DSH Bundle was installed but not activated in the profile manifest')

    const dump = await run(['--profile', 'web', '--dump-config'])
    if (!dump.stdout.includes("name: '@script-studio/dsh-adapter'")) {
      throw new Error(`Composed config does not contain Script Studio Host Contract composition\n${dump.stdout}`)
    }

    server = spawn(process.execPath, [dshBin, '--profile', 'web', '--port', '0'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const url = await waitForUrl(server)
    const home = await fetch(url)
    const html = await home.text()
    if (!home.ok || !html.includes('script-studio')) throw new Error('Harness web surface did not include the Script Studio client composition')

    const request = invocation => fetch(`${url}/api/script-studio/v1/host`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      contractVersion: '1.0.0',
      host: { kind: 'dsh', name: 'DeepSeek Harness', hostVersion: '0.1.0-rc.7', hostInstanceId: 'composition', adapterVersion: '0.1.0' },
      invocation,
    }) }).then(async response => ({ response, body: await response.json() }))
    const capabilities = await request({ requestId: 'composition-capabilities', operation: 'capabilities' })
    if (!capabilities.response.ok || !capabilities.body.ok || capabilities.body.result.operation !== 'capabilities') throw new Error(`Capabilities route failed: ${JSON.stringify(capabilities.body)}`)
    const hierarchy = await request({ requestId: 'composition-hierarchy', operation: 'get-project-hierarchy', actor: { teamId: 'team-1', memberId: 'member-writer', role: 'writer' }, payload: { projectId: 'project-1' } })
    if (!hierarchy.response.ok || !hierarchy.body.ok || hierarchy.body.result.hierarchy.seasons.length !== 1) throw new Error(`Hierarchy route failed: ${JSON.stringify(hierarchy.body)}`)
    const toolSmoke = await fetch(`${url}/api/script-studio/v1/tool-smoke`).then(async response => ({ response, body: await response.json() }))
    if (!toolSmoke.response.ok || !toolSmoke.body.ok || toolSmoke.body.toolName !== 'script_studio_capabilities') throw new Error(`Tool smoke failed: ${JSON.stringify(toolSmoke.body)}`)

    await stop(server)
    server = undefined
    await run(['plugin', '--profile', 'web', 'remove', '@script-studio/dsh-adapter'])
    const removed = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    if (removed.dsh.profile.bundles.includes('@script-studio/dsh-adapter')) throw new Error('DSH Bundle removal did not update the profile manifest')
    console.log(JSON.stringify({ ok: true, harness: '0.1.0-rc.7', bundleInstalled: true, clientCompositionReady: true, hostRouteReady: true, toolRegistryReady: true, uninstallPreservedProfile: true }, null, 2))
  } finally {
    await stop(server)
    await rm(isolatedHome, { recursive: true, force: true })
  }
}

await main()
