import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runNpm } from '../scripts/npm-cli.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = resolve(here, '..')
const temporaryRoot = process.env.NOVEL_STUDIO_TEST_TMP ? resolve(process.env.NOVEL_STUDIO_TEST_TMP) : tmpdir()
mkdirSync(temporaryRoot, { recursive: true })
const packageDir = mkdtempSync(join(temporaryRoot, 'novel-studio-package-'))

try {
  const npmArgs = ['pack', '--json', '--pack-destination', packageDir]
  const packed = runNpm(npmArgs, { cwd: bundle, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(packed.error?.message || packed.stderr || packed.stdout || 'npm pack failed')
  const report = JSON.parse(packed.stdout)[0]
  const tarball = join(packageDir, report.filename)

  const composition = spawnSync(process.execPath, [join(here, 'composition-smoke.mjs')], {
    cwd: bundle,
    env: { ...process.env, NOVEL_STUDIO_INSTALL_SPEC: tarball },
    encoding: 'utf8',
  })
  if (composition.stdout) process.stdout.write(composition.stdout)
  if (composition.stderr) process.stderr.write(composition.stderr)
  if (composition.status !== 0) throw new Error(`Tarball composition failed with exit code ${composition.status}`)

  console.log(JSON.stringify({
    ok: true,
    package: report.id,
    artifact: report.filename,
    packedBytes: report.size,
    exactTarballInstalled: true,
  }, null, 2))
} finally {
  rmSync(packageDir, { recursive: true, force: true })
}
