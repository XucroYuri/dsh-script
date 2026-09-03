import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)
const lib = new URL('lib/', root)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const packageId = packageJson.name
const dshExternals = ['@deepseek-ai/*', 'react', 'react/*']

await rm(lib, { recursive: true, force: true })
await mkdir(lib, { recursive: true })

await build({
  entryPoints: [fileURLToPath(new URL('src/index.ts', root))],
  outfile: fileURLToPath(new URL('index.js', lib)),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: dshExternals,
  sourcemap: true,
})

await build({
  entryPoints: [fileURLToPath(new URL('src/adapter.ts', root))],
  outfile: fileURLToPath(new URL('adapter.js', lib)),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  external: dshExternals,
  sourcemap: true,
})

await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', root))],
  outfile: fileURLToPath(new URL('client.js', lib)),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  external: dshExternals,
  sourcemap: true,
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(packageId)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
})

await Promise.all([
  writeFile(new URL('index.d.ts', lib), `import type { Context } from '@deepseek-ai/cordis'\nexport { DshScriptStudioAdapter } from './adapter.js'\nexport type { DshAdapterOptions } from './adapter.js'\nexport declare const name = "script-studio-host"\nexport declare const inject: string[]\nexport declare function apply(ctx: Context): void\n`, 'utf8'),
  writeFile(new URL('adapter.d.ts', lib), `import type { HostAdapterPort, HostIdentity, HostInvocation, HostResponseEnvelope, ScriptStudioHostApiPort } from '@script-studio/contracts/host'\nexport interface DshAdapterOptions { hostVersion: string; hostInstanceId: string; adapterVersion: string }\nexport declare class DshScriptStudioAdapter implements HostAdapterPort {\n  readonly identity: HostIdentity\n  constructor(api: ScriptStudioHostApiPort, options: DshAdapterOptions)\n  invoke(invocation: HostInvocation): Promise<HostResponseEnvelope>\n}\n`, 'utf8'),
  writeFile(new URL('client.d.ts', lib), `import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'\nexport declare const inject: string[]\nexport declare function apply(ctx: ClientContext): void\n`, 'utf8'),
])
