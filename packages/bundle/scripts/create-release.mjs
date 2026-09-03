import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNpm } from './npm-cli.mjs'

const bundle = dirname(dirname(fileURLToPath(import.meta.url)))
const workspace = resolve(bundle, '../..')
const releaseDir = process.env.NOVEL_STUDIO_RELEASE_DIR
  ? resolve(process.env.NOVEL_STUDIO_RELEASE_DIR)
  : join(workspace, 'dist')
const packageJson = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'))
const migrationSource = await readFile(join(bundle, 'src', 'storage-sqlite', 'migrations.ts'), 'utf8')
const schemaMatch = migrationSource.match(/EXPECTED_SCHEMA_VERSION\s*=\s*(\d+)/)
if (!schemaMatch) throw new Error('Unable to read EXPECTED_SCHEMA_VERSION for the release manifest')

await mkdir(releaseDir, { recursive: true })
const npmArgs = ['pack', '--json', '--pack-destination', releaseDir]
const packed = runNpm(npmArgs, { cwd: bundle, encoding: 'utf8' })
if (packed.status !== 0) throw new Error(packed.error?.message || packed.stderr || packed.stdout || 'npm pack failed')
const report = JSON.parse(packed.stdout)[0]
if (report.name !== packageJson.name || report.version !== packageJson.version) {
  throw new Error(`Packed identity ${report.id} does not match package.json`)
}

const artifactPath = join(releaseDir, report.filename)
const artifact = await readFile(artifactPath)
const sha256 = createHash('sha256').update(artifact).digest('hex')
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' })
if (git.status !== 0) throw new Error(git.stderr || 'git rev-parse HEAD failed')
const gitCommit = (process.env.GITHUB_SHA || git.stdout).trim()
const gitStatus = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspace, encoding: 'utf8' })
if (gitStatus.status !== 0) throw new Error(gitStatus.stderr || 'git status --porcelain failed')
const workingTreeDirty = gitStatus.stdout.trim().length > 0
const harnessVersion = packageJson.peerDependencies['@deepseek-ai/dsh-agent']
const schemaVersion = Number(schemaMatch[1])
const manifest = {
  channel: 'github-release',
  name: packageJson.name,
  version: packageJson.version,
  tag: `v${packageJson.version}`,
  gitCommit,
  workingTreeDirty,
  artifact: report.filename,
  sha256,
  npmIntegrity: report.integrity,
  packedBytes: report.size,
  unpackedBytes: report.unpackedSize,
  compatibility: {
    deepSeekHarness: harnessVersion,
    node: packageJson.engines.node,
    sqliteSchema: schemaVersion,
    profile: 'web',
  },
}

await Promise.all([
  writeFile(join(releaseDir, 'SHA256SUMS'), `${sha256}  ${report.filename}\n`, 'utf8'),
  writeFile(join(releaseDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
])

console.log(JSON.stringify({ ok: true, releaseDir, ...manifest }, null, 2))
