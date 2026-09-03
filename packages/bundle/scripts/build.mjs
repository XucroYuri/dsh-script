import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundleUrl = new URL('../', import.meta.url)
const libUrl = new URL('lib/', bundleUrl)
const packageJson = JSON.parse(await readFile(new URL('package.json', bundleUrl), 'utf8'))
const packageId = packageJson.name
const shared = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis']
const clientExternals = [
  ...shared,
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-runtime/client',
]

await rm(libUrl, { recursive: true, force: true })
await mkdir(libUrl, { recursive: true })

await build({
  entryPoints: [fileURLToPath(new URL('src/index.ts', bundleUrl))],
  outfile: fileURLToPath(new URL('index.js', libUrl)),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
})

await build({
  entryPoints: [fileURLToPath(new URL('src/client.ts', bundleUrl))],
  outfile: fileURLToPath(new URL('client.js', libUrl)),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  external: clientExternals,
  sourcemap: true,
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(packageId)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: `return module.exports;}});` },
})

await Promise.all([
  writeFile(new URL('index.d.ts', libUrl), `import type { Context } from '@deepseek-ai/cordis'\n\nexport declare const name = "novel-studio-host"\nexport declare const inject: string[]\nexport declare function apply(ctx: Context): void\n`, 'utf8'),
  writeFile(new URL('client.d.ts', libUrl), `import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'\n\nexport declare const inject: string[]\nexport declare function apply(ctx: ClientContext): void\n`, 'utf8'),
])
