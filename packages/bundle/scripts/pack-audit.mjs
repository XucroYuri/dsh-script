import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNpm } from './npm-cli.mjs'

const bundle = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8'))

const result = runNpm(['pack', '--dry-run', '--json'], { cwd: bundle, encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || 'npm pack --dry-run failed')

const report = JSON.parse(result.stdout)[0]
const paths = report.files.map(file => file.path)
const expected = [
  'LICENSE',
  'README.md',
  'cordis.patch.yml',
  'lib/client.d.ts',
  'lib/client.js',
  'lib/client.js.map',
  'lib/index.d.ts',
  'lib/index.js',
  'lib/index.js.map',
  'package.json',
]
const unexpected = paths.filter(path => !expected.includes(path))
if (unexpected.length) throw new Error(`Unexpected package files: ${unexpected.join(', ')}`)

const missing = expected.filter(path => !paths.includes(path))
if (missing.length) throw new Error(`Missing package files: ${missing.join(', ')}`)
if (report.name !== packageJson.name || report.version !== packageJson.version) throw new Error(`Packed identity ${report.id} does not match package.json`)
if (packageJson.types !== './lib/index.d.ts' || packageJson.exports?.['.']?.types !== './lib/index.d.ts' || packageJson.exports?.['./client']?.types !== './lib/client.d.ts') {
  throw new Error('Published TypeScript entry points do not target the packed declarations')
}
const patch = readFileSync(join(bundle, 'cordis.patch.yml'), 'utf8')
if (!patch.includes(`name: '${packageJson.name}'`)) throw new Error('Bundle patch package name does not match package.json')
const clientBundle = readFileSync(join(bundle, 'lib', 'client.js'), 'utf8')
if (!clientBundle.includes(`id:${JSON.stringify(packageJson.name)}`)) throw new Error('Client module id does not match package.json')
const hostBundle = readFileSync(join(bundle, 'lib', 'index.js'), 'utf8')
if (!hostBundle.includes(`NOVEL_STUDIO_VERSION = ${JSON.stringify(packageJson.version)}`)) throw new Error('Doctor Bundle version does not match package.json')

const forbiddenPath = /(^|\/)(data|artifacts|exports|backups|logs|node_modules|tests|src)(\/|$)|\.db(?:-wal|-shm)?$|\.env(?:\.|$)/
const forbiddenFiles = paths.filter(path => forbiddenPath.test(path))
if (forbiddenFiles.length) throw new Error(`Private or development files would be packed: ${forbiddenFiles.join(', ')}`)

const sensitiveContent = [
  { label: 'absolute macOS user path', pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: 'absolute Linux user path', pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { label: 'absolute Windows workspace path', pattern: /[A-Za-z]:[\\/](?:Users|Projects|DevCache)[\\/]/i },
  { label: 'temporary runtime path', pattern: /\/tmp\/novel-studio-[A-Za-z0-9._-]+/ },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'common secret assignment', pattern: /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']{12,}["']/i },
]

for (const path of paths.filter(path => path === 'LICENSE' || /\.(?:d\.ts|js|map|json|md|yml)$/.test(path))) {
  const content = readFileSync(join(bundle, path), 'utf8')
  for (const check of sensitiveContent) if (check.pattern.test(content)) throw new Error(`${check.label} found in ${path}`)
}

console.log(JSON.stringify({
  ok: true,
  package: report.id,
  files: paths,
  packedBytes: report.size,
  unpackedBytes: report.unpackedSize,
}, null, 2))
