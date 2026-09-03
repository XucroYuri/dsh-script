import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const packageDir = await mkdtemp(join(tmpdir(), 'script-studio-package-'))
const npmResult = spawnSync('npm', ['pack', '--json', '--pack-destination', packageDir], { cwd: root, encoding: 'utf8' })
if (npmResult.status !== 0) throw new Error(npmResult.stderr || npmResult.stdout || 'npm pack failed')
const start = npmResult.stdout.indexOf('[\n')
if (start < 0) throw new Error(`npm pack did not return JSON: ${npmResult.stdout}`)
const report = JSON.parse(npmResult.stdout.slice(start))[0]
const tarball = join(packageDir, report.filename)

try {
  const composition = spawnSync(process.execPath, [join(root, 'tests/composition-smoke.mjs')], {
    cwd: root,
    env: { ...process.env, SCRIPT_STUDIO_INSTALL_SPEC: tarball },
    encoding: 'utf8',
  })
  if (composition.stdout) process.stdout.write(composition.stdout)
  if (composition.stderr) process.stderr.write(composition.stderr)
  if (composition.status !== 0) throw new Error(`Exact tarball composition failed with exit code ${composition.status}`)
  console.log(JSON.stringify({ ok: true, package: report.id, artifact: report.filename, packedBytes: report.size, exactTarballInstalled: true }, null, 2))
} finally {
  await rm(packageDir, { recursive: true, force: true })
}
