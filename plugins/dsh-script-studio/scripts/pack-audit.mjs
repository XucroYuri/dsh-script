import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'npm pack --dry-run failed')
const start = result.stdout.indexOf('[\n')
if (start < 0) throw new Error(`npm pack did not return JSON: ${result.stdout}`)
const report = JSON.parse(result.stdout.slice(start))[0]
const paths = report.files.map(file => file.path).sort()
const expected = [
  'README.md',
  'cordis.patch.yml',
  'lib/adapter.d.ts', 'lib/adapter.js', 'lib/adapter.js.map',
  'lib/client.d.ts', 'lib/client.js', 'lib/client.js.map',
  'lib/index.d.ts', 'lib/index.js', 'lib/index.js.map',
  'package.json',
].sort()
if (JSON.stringify(paths) !== JSON.stringify(expected)) throw new Error(`Packed files differ. expected=${expected.join(', ')} actual=${paths.join(', ')}`)
if (report.name !== packageJson.name || report.version !== packageJson.version) throw new Error(`Packed identity ${report.id} does not match package.json`)
if (packageJson.types !== './lib/index.d.ts' || packageJson.exports?.['./client']?.types !== './lib/client.d.ts') throw new Error('Packed TypeScript entry points are incomplete')
if (!readFileSync(join(root, 'cordis.patch.yml'), 'utf8').includes(`name: '${packageJson.name}'`)) throw new Error('Bundle patch package name does not match package.json')
if (!readFileSync(join(root, 'lib', 'client.js'), 'utf8').includes(`id:${JSON.stringify(packageJson.name)}`)) throw new Error('Client module id does not match package.json')
if (!readFileSync(join(root, 'lib', 'index.js'), 'utf8').includes('script_studio_capabilities')) throw new Error('Host bundle does not contain the registered Script Studio tool')
console.log(JSON.stringify({ ok: true, package: report.id, files: paths, packedBytes: report.size, unpackedBytes: report.unpackedSize }, null, 2))
