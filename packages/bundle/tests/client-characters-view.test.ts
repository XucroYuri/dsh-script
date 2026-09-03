import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(new URL('../src/dsh-adapter/client.tsx', import.meta.url), 'utf8')

describe('Novel Studio characters view', () => {
  it('shows only character records and does not present the page as an entity browser', () => {
    expect(clientSource).toContain("entities: '人物事实'")
    expect(clientSource).toContain('visibleCharacters(knowledge.entities)')
    expect(clientSource).toContain("entities.filter(entity => entity.type === 'character')")
    expect(clientSource).toContain("candidate.name.includes(other.name)).length < 2")
    expect(clientSource).toContain('<CharacterList characters={characters} mobile={mobile} />')
    expect(clientSource).toContain('aria-label="人物卡片列表"')
    expect(clientSource).toContain('<CharacterPortrait size={mobile ? 64 : 82} />')
    expect(clientSource).toContain('function CharacterPortrait')
    expect(clientSource).toContain('批准人物体系或章节后，人物事实会在这里形成稳定记录。')
    expect(clientSource).not.toContain("entities: '人物与实体'")
    expect(clientSource).not.toContain('故事实体会在这里形成稳定记录')
    expect(clientSource).not.toContain('entityTypeLabel')
  })
})
