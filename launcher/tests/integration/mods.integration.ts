/**
 * Service des mods contre le VRAI Modrinth : contenu de départ, recherche, installation d'un shader (avec Iris)
 * et d'un pack de ressources, mises à jour, et quarantaine d'un mod interdit ajouté à la main.
 *
 *   HSMP_TEST_MODS_DIR=C:\hsmp-mods npx vitest run --config vitest.integration.mts mods
 */
import { existsSync, readdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gameLayout } from '../../src/main/game/layout'
import { ModsService } from '../../src/main/mods/mods-service'
import { getPublicConfig } from '../../src/main/public-config'

const dir = process.env.HSMP_TEST_MODS_DIR

describe.skipIf(!dir)('mods avec le vrai Modrinth', () => {
  const layout = gameLayout(dir ?? '')
  const log = { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m), error: (m: string) => console.error(m) }
  const service = new ModsService({ layout, config: getPublicConfig, fetch, userAgent: 'hardcore-smp-launcher/0.1.0-test', log, isGameBusy: () => false })
  const ls = (folder: string): string[] => (existsSync(folder) ? readdirSync(folder).sort() : [])

  it('contenu de départ : Fabric API + mods recommandés de l’allowlist', async () => {
    const content = await service.planContent()
    console.log(content.map((c) => `${c.fileName}${c.required ? ' (obligatoire)' : ''}`).join('\n'))
    expect(content.find((c) => c.projectId === 'P7dR8mSH')?.required).toBe(true)
    expect(content.map((c) => c.projectId)).toEqual(expect.arrayContaining(['AANobbMI', 'gvQqBUqZ', 'mOgUt4GM']))
  })

  it('recherche filtrée sur 26.2 : badges corrects', async () => {
    const page = await service.search({ kind: 'mod', query: 'freecam', sort: 'relevance', offset: 0, onlyAllowed: false })
    const freecam = page.hits.find((h) => h.projectId === 'XeEZ3fK2')
    expect(freecam?.access).toBe('forbidden')
    const allowed = await service.search({ kind: 'shader', query: '', sort: 'downloads', offset: 0, onlyAllowed: true })
    console.log(`Shaders autorisés trouvés : ${allowed.hits.map((h) => h.title).join(', ')}`)
    expect(allowed.hits.length).toBeGreaterThan(0)
    expect(allowed.hits.every((h) => h.access === 'allowed')).toBe(true)
  })

  it('installe un shader (Iris suit automatiquement) et un pack de ressources', async () => {
    const shader = await service.install('HVnmMxH1', 'shader')
    console.log(shader)
    expect(shader.ok).toBe(true)
    expect(ls(layout.shaderpacks).some((f) => f.toLowerCase().includes('complementary'))).toBe(true)
    expect(ls(layout.mods).some((f) => f.toLowerCase().includes('iris'))).toBe(true)
    const pack = await service.install('w0TnApzs', 'resourcepack')
    console.log(pack)
    expect(pack.ok).toBe(true)
    expect(ls(layout.resourcepacks)).toHaveLength(1)
  })

  it('vérifie les mises à jour (une requête par type de contenu)', async () => {
    const result = await service.checkUpdates()
    console.log(result)
    expect(result.ok).toBe(true)
  })

  it('Freecam ajouté à la main : mis en quarantaine avec la raison', async () => {
    const response = await fetch('https://api.modrinth.com/v2/project/XeEZ3fK2/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%2226.2%22%5D', {
      headers: { 'User-Agent': 'hardcore-smp-launcher/0.1.0-test' }
    })
    const [version] = (await response.json()) as { files: { url: string; filename: string }[] }[]
    const file = version?.files[0]
    if (!file) throw new Error('Freecam introuvable pour 26.2')
    await fs.writeFile(path.join(layout.mods, file.filename), Buffer.from(await (await fetch(file.url)).arrayBuffer()))
    const result = await service.tidyFolders(await service.planContent())
    console.log(result)
    expect(result.quarantined).toEqual([{ file: `mods/${file.filename}`, reason: '« Freecam » n’est pas autorisé sur le serveur' }])
    expect(ls(layout.mods)).not.toContain(file.filename)
  })
}, 10 * 60 * 1000)
