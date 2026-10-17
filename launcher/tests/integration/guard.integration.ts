/**
 * Test de bout en bout du HSMP Guard contre un VRAI serveur Paper local équipé de HSMP Gatekeeper.
 * Le jeu (déjà installé par install.integration.ts) est lancé hors ligne sous le pseudo « Testeur »,
 * puis on lit le journal du serveur pour savoir s'il a été accepté ou refusé, et pourquoi.
 *
 *   HSMP_TEST_GAME_DIR=C:\hsmp-test
 *   HSMP_E2E_SERVER=localhost:25599
 *   HSMP_E2E_SERVER_LOG=C:\hsmp-paper\logs\latest.log
 *   HSMP_GUARD_JAR=..\guard-mod\build\libs\hsmp-guard-1.0.0-protege.jar
 *   HSMP_E2E_EXTRA_MOD=C:\chemin\vers\un-mod-interdit.jar        (ex. Freecam pour 26.2)
 *   HSMP_E2E_EXTRA_PACK=C:\chemin\vers\un-pack-interdit.zip      (ex. Better Leaves pour 26.2)
 *   npx vitest run --config vitest.integration.mts guard
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/shared/defaults'
import type { GameState } from '../../src/shared/game'
import { GameService } from '../../src/main/game/game-service'
import { gameLayout } from '../../src/main/game/layout'
import { ModsService } from '../../src/main/mods/mods-service'
import { getPublicConfig } from '../../src/main/public-config'
import type { SettingsStore } from '../../src/main/settings-store'

const dir = process.env.HSMP_TEST_GAME_DIR
const server = process.env.HSMP_E2E_SERVER
const serverLog = process.env.HSMP_E2E_SERVER_LOG
const guardJar = process.env.HSMP_GUARD_JAR
const extraMod = process.env.HSMP_E2E_EXTRA_MOD
const extraPack = process.env.HSMP_E2E_EXTRA_PACK

const layout = gameLayout(dir ?? '')
const log = { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m), error: (m: string) => console.error(m) }
const mods = new ModsService({ layout, config: getPublicConfig, fetch, userAgent: 'hardcore-smp-launcher/0.1.0-test', log, isGameBusy: () => false })

interface Scenario {
  /** Avec HSMP Guard (sinon : comme un joueur qui passe par un autre launcher). */
  guard: boolean
  /** Version du règlement acceptée par le joueur. */
  rules: number
  /** Fichier ajouté à la main dans mods/ ou resourcepacks/. */
  extra?: { file: string; folder: 'mods' | 'resourcepacks' }
  /** Désactive la quarantaine du launcher (pour vérifier que le serveur refuse quand même). */
  skipQuarantine?: boolean
  /** Packs de ressources sélectionnés en jeu (options.txt) et shader activé (Iris). */
  resourcePacks?: string[]
  shader?: string | null
}

/** Ce que le joueur a choisi en jeu : packs de ressources (options.txt) et shader (config/iris.properties). */
function selectInGame(resourcePacks: string[], shader: string | null): void {
  const optionsFile = path.join(layout.root, 'options.txt')
  let options = existsSync(optionsFile) ? readFileSync(optionsFile, 'utf8') : ''
  const ids = resourcePacks.map((p) => `file/${p}`)
  // « incompatibleResourcePacks » : comme un joueur qui active quand même un pack prévu pour une autre version.
  for (const [key, value] of [['resourcePacks', ['vanilla', ...ids]], ['incompatibleResourcePacks', ids]] as const) {
    const line = `${key}:${JSON.stringify(value)}`
    const pattern = new RegExp(`^${key}:.*$`, 'm')
    options = pattern.test(options) ? options.replace(pattern, line) : `${options}\n${line}\n`
  }
  writeFileSync(optionsFile, options)
  mkdirSync(path.join(layout.root, 'config'), { recursive: true })
  writeFileSync(path.join(layout.root, 'config', 'iris.properties'), shader ? `enableShaders=true\nshaderPack=${shader}\n` : 'enableShaders=false\n')
}

/** Lance le jeu, attend la décision du serveur (journal), ferme le jeu et renvoie les lignes du journal. */
async function play(scenario: Scenario): Promise<{ log: string; state: GameState }> {
  let game: ChildProcess | null = null
  const settings = { ...defaultSettings(16 * 1024), acceptedRulesVersion: scenario.rules, memoryMb: 3072 }
  const target = scenario.extra ? path.join(layout[scenario.extra.folder], path.basename(scenario.extra.file)) : null
  if (scenario.extra && target) copyFileSync(scenario.extra.file, target)
  selectInGame(scenario.resourcePacks ?? [], scenario.shader ?? null)
  const service = new GameService({
    layout,
    content: mods,
    platform: process.platform,
    arch: process.arch,
    fetch,
    userAgent: 'hardcore-smp-launcher/0.1.0-test',
    launcherVersion: '0.1.0',
    isPackaged: false,
    config: getPublicConfig,
    settings: { get: async () => settings } as unknown as SettingsStore,
    accounts: { getLaunchSession: async () => Promise.reject(new Error('pas de compte en test')) },
    log,
    spawn: (command, args, options) => {
      game = spawn(command, args, { ...options, stdio: 'ignore' })
      return game
    },
    ...(scenario.guard && guardJar ? { devGuardJar: path.resolve(guardJar) } : {}),
    ...(scenario.skipQuarantine ? { devSkipQuarantine: true } : {})
  })

  const offset = existsSync(serverLog ?? '') ? statSync(serverLog ?? '').size : 0
  const read = (): string => readFileSync(serverLog ?? '').subarray(offset).toString('utf8')
  try {
    expect(await service.launch({ offlineTest: true, server })).toEqual({ ok: true })
    // Accepté = « HSMP Guard OK » puis entrée dans le monde ; refusé = « Connexion refusée » puis déconnexion.
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      const lines = read()
      if (/Connexion refusée pour Testeur[\s\S]*lost connection/.test(lines)) break
      if (/HSMP Guard OK pour Testeur[\s\S]*Testeur joined the game/.test(lines)) break
      if ((game as ChildProcess | null)?.exitCode != null) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const lines = read()
      .split(/\r?\n/)
      .filter((line) => /Testeur|Guard|Modrinth/.test(line))
      .join('\n')
    return { log: lines, state: service.getState() }
  } finally {
    // Sous Windows, les jars restent verrouillés tant que le jeu n'est pas complètement fermé.
    const running = game as ChildProcess | null
    if (running && running.exitCode === null) {
      const exited = new Promise((resolve) => running.once('exit', resolve))
      running.kill()
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))])
    }
    if (target) rmSync(target, { force: true, maxRetries: 10, retryDelay: 500 })
    selectInGame([], null)
    // Laisse au serveur le temps de voir la déconnexion avant le scénario suivant.
    await new Promise((resolve) => setTimeout(resolve, 4000))
  }
}

describe.skipIf(!dir || !server || !serverLog || !guardJar)('HSMP Guard contre un vrai serveur', () => {
  it('sans HSMP Guard (autre launcher) : refusé, « utilise le launcher officiel »', async () => {
    const { log } = await play({ guard: false, rules: 1 })
    console.log(`--- sans Guard ---\n${log}`)
    expect(log).toMatch(/Connexion refusée pour Testeur .*client sans HSMP Guard/)
    expect(log).not.toMatch(/Testeur joined the game/)
  })

  it('launcher officiel + Guard + règlement à jour : accepté', async () => {
    const { log } = await play({ guard: true, rules: 1 })
    console.log(`--- officiel ---\n${log}`)
    expect(log).toMatch(/HSMP Guard OK pour Testeur/)
    expect(log).toMatch(/Testeur joined the game/)
  })

  it('règlement pas à jour : refusé', async () => {
    const { log } = await play({ guard: true, rules: 0 })
    console.log(`--- règlement ---\n${log}`)
    expect(log).toMatch(/Connexion refusée pour Testeur .*règlement/)
    expect(log).not.toMatch(/Testeur joined the game/)
  })

  it.skipIf(!extraMod)('mod interdit ajouté à la main : le launcher le met en quarantaine, le joueur entre', async () => {
    const { log, state } = await play({ guard: true, rules: 1, extra: { file: extraMod ?? '', folder: 'mods' } })
    console.log(`--- mod interdit, quarantaine ---\n${state.quarantined.map((q) => `${q.file} : ${q.reason}`).join('\n')}\n${log}`)
    expect(state.quarantined).toEqual([{ file: `mods/${path.basename(extraMod ?? '')}`, reason: '« Freecam » n’est pas autorisé sur le serveur' }])
    expect(log).toMatch(/Testeur joined the game/)
  })

  it.skipIf(!extraMod)('mod interdit qui passe quand même (quarantaine contournée) : refusé par le serveur', async () => {
    const { log } = await play({ guard: true, rules: 1, extra: { file: extraMod ?? '', folder: 'mods' }, skipQuarantine: true })
    console.log(`--- mod interdit, sans quarantaine ---\n${log}`)
    expect(log).toMatch(/Connexion refusée pour Testeur .*mod/)
    expect(log).not.toMatch(/Testeur joined the game/)
  })

  it('pack de ressources et shader autorisés, installés depuis l’onglet Mods et activés en jeu : accepté', async () => {
    expect(await mods.install('w0TnApzs', 'resourcepack')).toMatchObject({ ok: true })
    expect(await mods.install('HVnmMxH1', 'shader')).toMatchObject({ ok: true })
    const items = (await mods.getState()).items
    const pack = items.find((i) => i.projectId === 'w0TnApzs')?.fileName ?? ''
    const shader = items.find((i) => i.projectId === 'HVnmMxH1')?.fileName ?? ''
    const { log } = await play({ guard: true, rules: 1, resourcePacks: [pack], shader })
    console.log(`--- pack + shader autorisés ---\n${log}`)
    expect(log).toMatch(/HSMP Guard OK pour Testeur : \d+ mod\(s\), 1 pack\(s\), shader Complementary/)
    expect(log).toMatch(/Testeur joined the game/)
  })

  it.skipIf(!extraPack)('pack de ressources non autorisé activé en jeu (quarantaine contournée) : refusé par le serveur', async () => {
    const name = path.basename(extraPack ?? '')
    const { log } = await play({ guard: true, rules: 1, extra: { file: extraPack ?? '', folder: 'resourcepacks' }, skipQuarantine: true, resourcePacks: [name] })
    console.log(`--- pack interdit ---\n${log}`)
    expect(log).toMatch(/Connexion refusée pour Testeur .*pack/)
    expect(log).toMatch(/Pack de ressources non autorisé/)
  })
}, 30 * 60 * 1000)
