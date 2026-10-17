/**
 * Installation réelle de Java 25 + Minecraft + Fabric + mods dans un dossier de test,
 * puis (facultatif) lancement hors ligne du jeu pour vérifier la ligne de commande.
 *
 *   HSMP_TEST_GAME_DIR=C:\hsmp-test [HSMP_TEST_LAUNCH=1] npx vitest run --config vitest.integration.mts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/shared/defaults'
import type { InstallProgress } from '../../src/shared/game'
import { GameService } from '../../src/main/game/game-service'
import { gameLayout } from '../../src/main/game/layout'
import { silentLogger } from '../../src/main/log'
import { ModsService } from '../../src/main/mods/mods-service'
import { getPublicConfig } from '../../src/main/public-config'
import type { SettingsStore } from '../../src/main/settings-store'

const dir = process.env.HSMP_TEST_GAME_DIR

describe.skipIf(!dir)('installation réelle', () => {
  const settings = { ...defaultSettings(16 * 1024), acceptedRulesVersion: 1, memoryMb: 3072 }
  const progress: InstallProgress[] = []
  let game: ChildProcess | null = null
  let gameOutput = ''
  const log = { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m), error: (m: string) => console.error(m) }
  const layout = gameLayout(dir ?? '')
  const userAgent = 'hardcore-smp-launcher/0.1.0-test'
  const service = new GameService({
    layout,
    content: new ModsService({ layout, config: getPublicConfig, fetch, userAgent, log, isGameBusy: () => false }),
    platform: process.platform,
    arch: process.arch,
    fetch,
    userAgent: 'hardcore-smp-launcher/0.1.0-test',
    launcherVersion: '0.1.0',
    isPackaged: false,
    config: getPublicConfig,
    settings: { get: async () => settings } as unknown as SettingsStore,
    accounts: { getLaunchSession: async () => Promise.reject(new Error('pas de compte en test')) },
    log: { info: (m) => console.log(m), warn: (m) => console.warn(m), error: (m) => console.error(m) },
    spawn: (command, args, options) => {
      console.log(`commande : ${command}\n${args.filter((a) => !a.includes('.jar' + (process.platform === 'win32' ? ';' : ':'))).join('\n')}`)
      game = spawn(command, args, options)
      game.stdout?.on('data', (chunk: Buffer) => {
        gameOutput += chunk.toString()
      })
      return game
    }
  })
  service.onState((state) => {
    if (state.progress) progress.push(state.progress)
  })

  it('installe tout (Java, Minecraft, Fabric, mods)', async () => {
    const started = Date.now()
    const result = await service.install('quick')
    expect(result).toEqual({ ok: true })
    const last = progress.at(-1)
    console.log(`Installé en ${Math.round((Date.now() - started) / 1000)} s — ${Math.round((last?.totalBytes ?? 0) / 1e6)} Mo`)
    for (const group of last?.groups ?? []) console.log(` - ${group.label} : ${group.state}${group.note ? ` (${group.note})` : ''}`)
    expect(last?.doneBytes).toBe(last?.totalBytes)
    expect(service.getState().installed).toBe(true)
  })

  it('vérification complète (réparation) : rien à retélécharger', async () => {
    progress.length = 0
    expect(await service.install('repair')).toEqual({ ok: true })
    expect(progress.some((p) => p.step === 'Téléchargement')).toBe(false)
  })

  it.skipIf(process.env.HSMP_TEST_LAUNCH !== '1')('lance le jeu (hors ligne) jusqu’à l’ouverture de la fenêtre', async () => {
    const result = await service.launch({ offlineTest: true })
    expect(result).toEqual({ ok: true })
    expect(service.getState().phase).toBe('running')
    expect(existsSync(`${dir}/hsmp/launch.json`)).toBe(true)
    // On attend que la fenêtre du jeu s'ouvre (moteur graphique et sons démarrés), puis on le ferme.
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && !/Sound engine started|Created: \d+x\d+/.test(gameOutput) && game?.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const lines = gameOutput.match(/Backend library[^<]*|Sound engine started|Created: \d+x\d+[^<]*|OpenGL[^<]{0,60}/g) ?? []
    console.log(['Jeu démarré :', ...new Set(lines)].join('\n'))
    expect(game?.exitCode).toBeNull()
    expect(gameOutput).toMatch(/Sound engine started|Created: \d+x\d+/)
    game?.kill()
  })
}, 30 * 60 * 1000)

silentLogger.info('')
