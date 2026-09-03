import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { delimiter, dirname, join, resolve } from 'node:path'

function resolveNpmCli() {
  if (process.env.NOVEL_STUDIO_NPM_CLI) {
    const explicit = resolve(process.env.NOVEL_STUDIO_NPM_CLI)
    if (!existsSync(explicit)) throw new Error(`npm CLI not found at ${explicit}`)
    return explicit
  }

  const candidates = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  if (process.platform === 'win32') {
    const pathValue = process.env.PATH || process.env.Path || ''
    for (const entry of pathValue.split(delimiter)) {
      const directory = entry.trim().replace(/^"|"$/g, '')
      if (directory) candidates.push(join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    }
  }

  return [...new Set(candidates)].find(candidate => existsSync(candidate)) || null
}

export function runNpm(args, options = {}) {
  const npmCli = resolveNpmCli()
  if (npmCli) return spawnSync(process.execPath, [npmCli, ...args], options)
  if (process.platform === 'win32') {
    return {
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('npm CLI not found beside Node or on PATH; set NOVEL_STUDIO_NPM_CLI'),
    }
  }
  return spawnSync('npm', args, options)
}
