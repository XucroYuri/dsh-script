import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('Codex plugin composition metadata', () => {
  it('declares the verified manifest, Skills, and MCP server surfaces', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, '.codex-plugin/plugin.json'), 'utf8')) as Record<string, unknown>
    const mcp = JSON.parse(await readFile(resolve(root, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, { command: string; args: string[]; cwd: string }> }
    expect(manifest).toMatchObject({ name: 'script-studio-codex', version: '0.1.0', skills: './skills/', mcpServers: './.mcp.json' })
    expect(mcp.mcpServers['script-studio']).toMatchObject({ command: 'node', args: ['./mcp/server.mjs', '--stdio'], cwd: '.', required: true })
    expect(await readFile(resolve(root, 'skills/script-studio/SKILL.md'), 'utf8')).toContain('script_studio_create_season')
  })
})
