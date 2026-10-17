/**
 * Tests du catalogue Modrinth, du registre du contenu et de la quarantaine, avec un faux Modrinth.
 */
import { existsSync, mkdtempSync, promises as fs, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Allowlist } from '../../shared/schemas'
import { createFakeWorld, type FakeWorld } from '../game/fake-world'
import { gameLayout, type GameLayout } from '../game/layout'
import { MODRINTH_API, modrinthGate, toModrinthFile, type ApiVersion } from '../game/modrinth'
import { silentLogger } from '../log'
import { getPublicConfig, type MainPublicConfig } from '../public-config'
import { accessOf, activeSet, loadContent, orphanAutos, type StoredItem } from './content'
import { ModsService } from './mods-service'

const tmpDir = (): string => mkdtempSync(path.join(os.tmpdir(), 'hsmp-mods-'))

const ALLOWLIST: Allowlist = {
  mods: [
    { projectId: 'P7dR8mSH', name: 'Fabric API', required: true },
    { projectId: 'AANobbMI', name: 'Sodium', recommended: true },
    { projectId: 'YL57xq9U', name: 'Iris Shaders' }
  ],
  resourcepacks: [{ projectId: 'w0TnApzs', name: 'Faithful 32x' }],
  shaders: [{ projectId: 'HVnmMxH1', name: 'Complementary' }]
}

const item = (projectId: string, patch: Partial<StoredItem> = {}): StoredItem => ({
  projectId,
  kind: 'mod',
  title: projectId,
  author: '',
  iconUrl: null,
  versionId: 'v',
  versionNumber: '1',
  fileName: `${projectId}.jar`,
  url: 'https://cdn.modrinth.com/x',
  sha512: 'a'.repeat(128),
  size: 1,
  dependencies: [],
  enabled: true,
  auto: false,
  ...patch
})

describe('règles du registre', () => {
  it('un mod activé active ses dépendances, même désactivées à la main', () => {
    const items = [item('IRIS', { dependencies: ['SODIUM'] }), item('SODIUM', { enabled: false, dependencies: ['LIB'] }), item('LIB', { auto: true })]
    expect([...activeSet(items, new Set())].sort()).toEqual(['IRIS', 'LIB', 'SODIUM'])
    const withoutIris = items.map((i) => (i.projectId === 'IRIS' ? { ...i, enabled: false } : i))
    expect([...activeSet(withoutIris, new Set())]).toEqual([])
  })

  it('les dépendances devenues inutiles sont repérées', () => {
    const items = [item('A', { dependencies: ['LIB'] }), item('LIB', { auto: true }), item('OLD', { auto: true })]
    expect(orphanAutos(items, new Set()).map((i) => i.projectId)).toEqual(['OLD'])
  })

  it('même règle que le serveur : obligatoire, autorisé (bon type), dépendance, refusé', () => {
    const required = new Set(['P7dR8mSH'])
    const items = [item('LIBlib01', { auto: true })]
    expect(accessOf('hsmp-guard', 'mod', ALLOWLIST, required, items)).toBe('required')
    expect(accessOf('P7dR8mSH', 'mod', ALLOWLIST, required, items)).toBe('required')
    expect(accessOf('AANobbMI', 'mod', ALLOWLIST, required, items)).toBe('allowed')
    expect(accessOf('HVnmMxH1', 'shader', ALLOWLIST, required, items)).toBe('allowed')
    // Un shader autorisé n'est pas un mod autorisé.
    expect(accessOf('HVnmMxH1', 'mod', ALLOWLIST, required, items)).toBe('forbidden')
    expect(accessOf('LIBlib01', 'mod', ALLOWLIST, required, items)).toBe('dependency')
    expect(accessOf('XeEZ3fK2', 'mod', ALLOWLIST, required, items)).toBe('forbidden')
  })
})

describe('client Modrinth', () => {
  const version = (patch: Partial<ApiVersion['files'][number]>): ApiVersion => ({
    id: 'v1',
    project_id: 'AANobbMI',
    version_number: '1.0',
    version_type: 'release',
    files: [{ url: 'https://cdn.modrinth.com/data/a/sodium.jar', filename: 'sodium.jar', primary: true, size: 1, hashes: { sha512: 'b'.repeat(128), sha1: 'c' }, ...patch }],
    dependencies: []
  })

  it('refuse un fichier venant d’ailleurs que le CDN de Modrinth, ou au nom dangereux', () => {
    expect(toModrinthFile(version({}), 'mod').fileName).toBe('sodium.jar')
    expect(() => toModrinthFile(version({ url: 'https://evil.test/sodium.jar' }), 'mod')).toThrow(/Adresse/)
    expect(() => toModrinthFile(version({ url: 'http://cdn.modrinth.com/a.jar' }), 'mod')).toThrow(/Adresse/)
    expect(() => toModrinthFile(version({ filename: '../../evil.jar' }), 'mod')).toThrow(/Nom/)
    // Un pack de ressources doit être un .zip, un mod un .jar.
    expect(() => toModrinthFile(version({}), 'resourcepack')).toThrow(/Nom/)
  })

  it('respecte la limite de débit : 4 requêtes à la fois, pause quand le quota est épuisé, nouvel essai après 429', async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    const slept: number[] = []
    let clock = 0
    const gate = modrinthGate(
      async () => {
        active++
        maxActive = Math.max(maxActive, active)
        const call = ++calls
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        if (call === 1) return new Response('trop', { status: 429, headers: { 'retry-after': '2' } })
        return new Response('{}', { status: 200, headers: { 'x-ratelimit-remaining': call === 3 ? '1' : '200', 'x-ratelimit-reset': '7' } })
      },
      {
        now: () => clock,
        sleep: async (ms) => {
          slept.push(ms)
          clock += ms
        }
      }
    )
    const responses = await Promise.all(Array.from({ length: 10 }, () => gate(`${MODRINTH_API}/search`)))
    expect(responses.every((r) => r.status === 200)).toBe(true)
    expect(maxActive).toBeLessThanOrEqual(4)
    expect(calls).toBe(11)
    expect(slept).toContain(2000)
    expect(slept).toContain(7000)
  })
})

describe('service des mods', () => {
  let world: FakeWorld
  let layout: GameLayout
  let allowlist: Allowlist
  let gameBusy: boolean
  let service: ModsService

  const config = (): MainPublicConfig => ({ ...getPublicConfig(), allowlist })
  const create = (): ModsService =>
    new ModsService({ layout, config, fetch: world.fetch, userAgent: 'test', log: silentLogger, isGameBusy: () => gameBusy })
  const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : [])

  beforeEach(() => {
    world = createFakeWorld()
    layout = gameLayout(tmpDir())
    allowlist = structuredClone(ALLOWLIST)
    gameBusy = false
    service = create()
  })

  it('première utilisation : obligatoires + recommandés + leurs dépendances', async () => {
    const content = await service.planContent()
    expect(content.map((c) => [c.fileName, c.required])).toEqual([
      ['fabric-api-0.161.0.jar', true],
      ['sodium-0.9.2.jar', false],
      ['lib-1.0.jar', false]
    ])
    const stored = await loadContent(layout)
    expect(stored?.items.map((i) => [i.title, i.auto, i.author])).toEqual([
      ['Fabric API', false, 'auteur-fabric-api'],
      ['Sodium', false, 'auteur-sodium'],
      ['Bibliothèque', true, 'auteur-lib']
    ])
    // Une fois le registre créé, plus aucun appel à Modrinth pour préparer le plan (jeu jouable hors ligne).
    world.requests.length = 0
    await create().planContent()
    expect(world.requests).toHaveLength(0)
  })

  it('installe un shader : Iris et ses dépendances suivent, chaque fichier dans son dossier, empreintes vérifiées', async () => {
    const result = await service.install('HVnmMxH1', 'shader')
    // Sodium (dont Iris a besoin) était déjà là : seul Iris est ajouté en plus du shader.
    expect(result).toEqual({ ok: true, message: 'Complementary installé. Iris a aussi été installé : il est nécessaire pour les shaders.' })
    expect(files(layout.shaderpacks)).toEqual(['Complementary_r5.9.3.zip'])
    expect(files(layout.mods)).toEqual(['fabric-api-0.161.0.jar', 'iris-1.11.4.jar', 'lib-1.0.jar', 'sodium-0.9.2.jar'])
    const state = await service.getState()
    expect(state.items.find((i) => i.projectId === 'YL57xq9U')).toMatchObject({ active: true, auto: false })
    expect(state.items.find((i) => i.projectId === 'AANobbMI')?.requiredBy).toEqual(['Iris Shaders'])
  })

  it('refuse un projet non autorisé, et toute modification pendant que le jeu tourne', async () => {
    expect(await service.install('XeEZ3fK2', 'mod')).toEqual({ ok: false, error: expect.stringContaining('pas autorisé') })
    gameBusy = true
    expect(await service.install('w0TnApzs', 'resourcepack')).toEqual({ ok: false, error: expect.stringContaining('Ferme le jeu') })
  })

  it('fichier abîmé pendant l’installation : erreur claire, rien n’est gardé', async () => {
    await service.planContent()
    const url = world.modrinth.get('w0TnApzs')?.versions[0]?.files[0]?.url ?? ''
    world.content.set(url, 'PACK-CORROMPU')
    const result = await service.install('w0TnApzs', 'resourcepack')
    expect(result.ok).toBe(false)
    expect(files(layout.resourcepacks)).toEqual([])
    expect((await loadContent(layout))?.items.some((i) => i.projectId === 'w0TnApzs')).toBe(false)
  })

  it('désactiver range le fichier hors du jeu ; impossible de désactiver ce dont un mod actif a besoin', async () => {
    await service.install('YL57xq9U', 'mod')
    expect(await service.setEnabled('AANobbMI', false)).toEqual({ ok: false, error: 'Iris Shaders a besoin de Sodium : désactive d’abord Iris Shaders.' })
    expect(await service.setEnabled('P7dR8mSH', false)).toMatchObject({ ok: false })
    expect(await service.setEnabled('LIBlib01', false)).toMatchObject({ ok: false })

    expect(await service.setEnabled('YL57xq9U', false)).toEqual({ ok: true, message: 'Iris Shaders désactivé.' })
    expect(await service.setEnabled('AANobbMI', false)).toEqual({ ok: true, message: 'Sodium désactivé.' })
    expect(files(layout.mods)).toEqual(['fabric-api-0.161.0.jar'])
    expect(files(path.join(layout.hsmp, 'disabled', 'mods'))).toEqual(['iris-1.11.4.jar', 'lib-1.0.jar', 'sodium-0.9.2.jar'])
    expect((await service.planContent()).map((c) => c.projectId)).toEqual(['P7dR8mSH'])

    expect(await service.setEnabled('YL57xq9U', true)).toMatchObject({ ok: true })
    expect(files(layout.mods)).toEqual(['fabric-api-0.161.0.jar', 'iris-1.11.4.jar', 'lib-1.0.jar', 'sodium-0.9.2.jar'])
  })

  it('désinstaller retire aussi les dépendances devenues inutiles ; ce dont un autre a besoin reste', async () => {
    await service.install('YL57xq9U', 'mod')
    expect(await service.uninstall('P7dR8mSH')).toMatchObject({ ok: false, error: expect.stringContaining('obligatoire') })
    expect(await service.uninstall('LIBlib01')).toMatchObject({ ok: false })
    expect(await service.uninstall('AANobbMI')).toEqual({ ok: true, message: 'Sodium reste installé : Iris Shaders en a besoin.' })
    expect(await service.uninstall('YL57xq9U')).toEqual({ ok: true, message: 'Iris Shaders désinstallé (et 2 dépendances devenues inutiles).' })
    expect(files(layout.mods)).toEqual(['fabric-api-0.161.0.jar'])
  })

  it('mises à jour : une seule requête pour tout vérifier, puis remplacement du fichier', async () => {
    await service.planContent()
    world.requests.length = 0
    expect(await service.checkUpdates()).toEqual({ ok: true, message: 'Tout est à jour.' })
    expect(world.requests.filter((r) => r.includes('/version_files/update'))).toHaveLength(1)

    world.publish('AANobbMI', '0.9.3', 'sodium-0.9.3.jar', 'SODIUM-NEUF', ['LIBlib01'])
    expect(await service.checkUpdates()).toEqual({ ok: true, message: '1 mise à jour disponible.' })
    expect((await service.getState()).items.find((i) => i.projectId === 'AANobbMI')?.update).toEqual({ versionNumber: '0.9.3' })
    expect(await service.update(null)).toEqual({ ok: true, message: 'Sodium 0.9.3 installé.' })
    expect(files(layout.mods)).toEqual(['fabric-api-0.161.0.jar', 'lib-1.0.jar', 'sodium-0.9.3.jar'])
    expect(readFileSync(path.join(layout.mods, 'sodium-0.9.3.jar'), 'utf8')).toBe('SODIUM-NEUF')
  })

  it('un projet retiré de la liste autorisée quitte le registre (et sera mis en quarantaine)', async () => {
    await service.install('YL57xq9U', 'mod')
    allowlist.mods = allowlist.mods.filter((m) => m.projectId !== 'YL57xq9U')
    const content = await create().planContent()
    expect(content.map((c) => c.projectId)).toEqual(['P7dR8mSH', 'AANobbMI', 'LIBlib01'])
  })

  it('avant le lancement : fichiers interdits, inconnus, modifiés ou en dossier → quarantaine ; projet autorisé ajouté à la main → gardé', async () => {
    const expected = await service.planContent()
    await fs.mkdir(layout.mods, { recursive: true })
    await fs.mkdir(path.join(layout.resourcepacks, 'pack-en-dossier'), { recursive: true })
    await fs.writeFile(path.join(layout.mods, 'freecam-1.5.0.jar'), 'FREECAM')
    await fs.writeFile(path.join(layout.mods, 'xray.jar'), 'TRICHE')
    await fs.writeFile(path.join(layout.mods, 'sodium-0.9.2.jar'), 'SODIUM-MODIFIE')
    await fs.writeFile(path.join(layout.resourcepacks, 'Faithful-32x.zip'), 'PACK')

    const result = await service.tidyFolders(expected)
    expect(result.adopted).toEqual(['Faithful 32x'])
    expect(result.quarantined.sort((a, b) => a.file.localeCompare(b.file))).toEqual([
      { file: 'mods/freecam-1.5.0.jar', reason: '« Freecam » n’est pas autorisé sur le serveur' },
      { file: 'mods/sodium-0.9.2.jar', reason: 'fichier modifié : le launcher retélécharge l’original' },
      { file: 'mods/xray.jar', reason: 'inconnu de Modrinth (fichier modifié, ou projet absent de Modrinth)' },
      { file: 'resourcepacks/pack-en-dossier', reason: 'dossier : seuls les fichiers installés depuis le launcher sont acceptés' }
    ])
    expect(files(layout.resourcepacks)).toEqual(['Faithful-32x.zip'])
    const quarantine = readdirSync(layout.quarantine)
    expect(quarantine).toHaveLength(1)
    const why = readFileSync(path.join(layout.quarantine, quarantine[0] ?? '', 'POURQUOI.txt'), 'utf8')
    expect(why).toContain('- mods/freecam-1.5.0.jar : « Freecam » n’est pas autorisé sur le serveur')
    expect((await service.getState()).quarantineCount).toBe(4)
    // Le pack adopté fait maintenant partie du contenu géré.
    expect((await service.planContent()).map((c) => c.projectId)).toContain('w0TnApzs')
  })

  it('Modrinth injoignable avant le lancement : les fichiers inconnus sont mis de côté (prudence)', async () => {
    const expected = await service.planContent()
    await fs.mkdir(layout.mods, { recursive: true })
    await fs.writeFile(path.join(layout.mods, 'inconnu.jar'), 'X')
    world.offline = true
    const result = await service.tidyFolders(expected)
    expect(result.quarantined).toEqual([{ file: 'mods/inconnu.jar', reason: 'impossible à vérifier pour l’instant (Modrinth ne répond pas)' }])
  })

  it('catalogue : badges calculés comme sur le serveur, filtre « autorisés uniquement », onglet Recommandés', async () => {
    await service.planContent()
    const all = await service.search({ kind: 'mod', query: '', sort: 'relevance', offset: 0, onlyAllowed: false })
    const access = Object.fromEntries(all.hits.map((h) => [h.title, h.access]))
    expect(access).toEqual({
      'Fabric API': 'required',
      Sodium: 'allowed',
      Bibliothèque: 'dependency',
      'Iris Shaders': 'allowed',
      Freecam: 'forbidden'
    })
    const allowed = await service.search({ kind: 'mod', query: '', sort: 'relevance', offset: 0, onlyAllowed: true })
    expect(allowed.hits.map((h) => h.title).sort()).toEqual(['Fabric API', 'Iris Shaders', 'Sodium'])
    expect((await service.recommended()).map((p) => p.title)).toEqual(['Fabric API', 'Sodium'])
  })
})
