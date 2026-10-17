/**
 * Tests de la phase 7 : config publique en ligne (avec cache), statut du serveur (faux serveur Minecraft local),
 * Discord Rich Presence et mises à jour du launcher (faux client Discord, faux electron-updater).
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import allowlistJson from '../../../config/allowlist.json'
import launcherJson from '../../../config/launcher.json'
import newsJson from '../../../config/news.json'
import rulesJson from '../../../config/rules.json'
import { PublicConfigError, parsePublicConfig } from '../shared/public-config'
import type { FetchLike } from './game/download'
import { silentLogger } from './log'
import { PublicConfigService, getPublicConfig } from './public-config'
import { activityFor, RichPresenceService, type Activity, type RpcClient } from './rich-presence'
import { ServerStatusService, pingServer, resolveTarget } from './server-status'
import { UpdateService, type Updater } from './updates'

const tmpDir = (): string => mkdtempSync(path.join(os.tmpdir(), 'hsmp-p7-'))
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------------------------------------------
describe('config publique en ligne', () => {
  const files = { launcher: launcherJson, news: newsJson, rules: rulesJson, allowlist: allowlistJson }

  it('la copie embarquée est valide et cohérente', () => {
    expect(getPublicConfig().launcher.rulesVersion).toBe(getPublicConfig().rules.version)
  })

  it('refuse un ensemble incohérent ou invalide, avec des messages en français', () => {
    const mismatch = { ...files, rules: { ...rulesJson, version: rulesJson.version + 1 } }
    expect(() => parsePublicConfig(mismatch)).toThrow(/rulesVersion/)
    try {
      parsePublicConfig({ ...files, news: [{ id: 'Pas Valide', title: '' }] })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(PublicConfigError)
      expect((error as PublicConfigError).problems.join('\n')).toMatch(/news\.json → 0\.id/)
    }
  })

  /** Faux GitHub : sert le dossier config/ (modifiable). */
  const fakeGithub = (served: Record<string, unknown>, status = 200): { fetch: FetchLike; requests: string[] } => {
    const requests: string[] = []
    return {
      requests,
      fetch: async (url) => {
        requests.push(url)
        const name = url.split('/').pop()?.replace('.json', '') ?? ''
        if (status !== 200 || !(name in served)) return new Response('introuvable', { status: status === 200 ? 404 : status })
        return new Response(typeof served[name] === 'string' ? (served[name] as string) : JSON.stringify(served[name]), { status: 200 })
      }
    }
  }
  const base = 'https://raw.githubusercontent.com/moi/hardcore-smp/main/config/'

  it('sans adresse : copie embarquée, aucune requête', async () => {
    const github = fakeGithub(files)
    const service = new PublicConfigService({ baseUrl: null, cacheDir: tmpDir(), fetch: github.fetch, userAgent: 't', log: silentLogger })
    await service.start()
    expect(service.currentOrigin().kind).toBe('bundled')
    expect(github.requests).toHaveLength(0)
  })

  it('en ligne : nouvelle actu prise en compte, copie gardée pour le mode hors ligne', async () => {
    const cacheDir = tmpDir()
    const news = [{ id: 'nouvelle', title: 'Nouvelle actu', date: '2026-12-01', tag: 'Info', body: 'Bonjour **tout le monde**' }, ...newsJson]
    const github = fakeGithub({ ...files, news })
    const service = new PublicConfigService({ baseUrl: base, cacheDir, fetch: github.fetch, userAgent: 't', log: silentLogger })
    const changes: string[] = []
    service.onChange((config, origin) => changes.push(`${origin.kind}:${config.news[0]?.id ?? ''}`))
    expect(await service.refresh()).toBe(true)
    expect(service.current().news[0]?.id).toBe('nouvelle')
    expect(changes).toEqual(['online:nouvelle'])
    expect(github.requests).toEqual(['launcher', 'news', 'rules', 'allowlist'].map((n) => `${base}${n}.json`))
    expect(JSON.parse(readFileSync(path.join(cacheDir, 'news.json'), 'utf8'))[0].id).toBe('nouvelle')

    // Redémarrage sans Internet : la dernière copie téléchargée est utilisée.
    const offline = new PublicConfigService({ baseUrl: base, cacheDir, fetch: fakeGithub(files, 503).fetch, userAgent: 't', log: silentLogger })
    await offline.loadCache()
    expect(offline.currentOrigin().kind).toBe('cache')
    expect(await offline.refresh()).toBe(false)
    expect(offline.current().news[0]?.id).toBe('nouvelle')
  })

  it('une version en ligne invalide est ignorée (la précédente reste utilisée, le cache n’est pas abîmé)', async () => {
    const cacheDir = tmpDir()
    const broken = fakeGithub({ ...files, allowlist: '{ pas du JSON' })
    const service = new PublicConfigService({ baseUrl: base, cacheDir, fetch: broken.fetch, userAgent: 't', log: silentLogger })
    expect(await service.refresh()).toBe(false)
    expect(service.currentOrigin().kind).toBe('bundled')
    expect(existsSync(path.join(cacheDir, 'launcher.json'))).toBe(false)
    const invalid = fakeGithub({ ...files, launcher: { ...launcherJson, minLauncherVersion: 'demain' } })
    const second = new PublicConfigService({ baseUrl: base, cacheDir, fetch: invalid.fetch, userAgent: 't', log: silentLogger })
    expect(await second.refresh()).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
/** Faux serveur Minecraft qui répond au Server List Ping. */
function fakeMinecraftServer(behaviour: { status?: unknown; pong?: boolean; silent?: boolean; raw?: Buffer }): Promise<{ port: number; close: () => void }> {
  const varint = (value: number): Buffer => {
    const bytes: number[] = []
    let n = value >>> 0
    do {
      let byte = n & 0x7f
      n >>>= 7
      if (n !== 0) byte |= 0x80
      bytes.push(byte)
    } while (n !== 0)
    return Buffer.from(bytes)
  }
  const packet = (id: number, data: Buffer): Buffer => {
    const body = Buffer.concat([varint(id), data])
    return Buffer.concat([varint(body.length), body])
  }
  const server = net.createServer((socket) => {
    let received = Buffer.alloc(0)
    let answered = false
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk])
      if (behaviour.silent) return
      if (!answered && received.length >= 2) {
        answered = true
        if (behaviour.raw) {
          socket.write(behaviour.raw)
          return
        }
        const json = Buffer.from(JSON.stringify(behaviour.status), 'utf8')
        socket.write(packet(0x00, Buffer.concat([varint(json.length), json])))
        if (behaviour.pong === false) setTimeout(() => socket.end(), 20)
        return
      }
      // Ping : on renvoie les 8 octets reçus.
      const ping = received.indexOf(0x01, received.length - 9)
      if (answered && behaviour.pong !== false && ping >= 0 && received.length - ping >= 9) socket.write(packet(0x01, received.subarray(ping + 1, ping + 9)))
    })
    socket.on('error', () => undefined)
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ port: typeof address === 'object' && address ? address.port : 0, close: () => server.close() })
    })
  )
}

describe('statut du serveur (Server List Ping)', () => {
  const closers: (() => void)[] = []
  afterEach(() => closers.splice(0).forEach((close) => close()))

  const REAL_STATUS = {
    description: { text: '', extra: [{ text: 'HARDCORE SMP\n', color: 'gold' }, { text: 'Rejoins nous sans mourir !', color: 'dark_red', bold: true }] },
    players: { max: 20, online: 3 },
    version: { name: 'Paper 26.2', protocol: 776 },
    favicon: 'data:image/png;base64,iVBORw0KGgo='
  }

  it('lit joueurs, version, icône et MOTD en couleurs, et mesure le ping', async () => {
    const server = await fakeMinecraftServer({ status: REAL_STATUS })
    closers.push(server.close)
    const status = await pingServer('127.0.0.1', server.port)
    expect(status).toMatchObject({ online: true, players: 3, maxPlayers: 20, version: 'Paper 26.2', favicon: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(status.motd.map((s) => [s.text, s.color, s.bold])).toEqual([
      ['HARDCORE SMP\n', '#FFAA00', false],
      ['Rejoins nous sans mourir !', '#AA0000', true]
    ])
    expect(status.pingMs).toBeGreaterThanOrEqual(0)
  })

  it('serveur qui ne répond pas au ping : la réponse de statut suffit', async () => {
    const server = await fakeMinecraftServer({ status: { ...REAL_STATUS, favicon: 'javascript:alert(1)' }, pong: false })
    closers.push(server.close)
    const status = await pingServer('127.0.0.1', server.port)
    expect(status.online).toBe(true)
    expect(status.favicon).toBeNull()
  })

  it('serveur muet ou réponse invalide : erreur dans le délai, sans planter', async () => {
    const silent = await fakeMinecraftServer({ silent: true })
    closers.push(silent.close)
    const started = Date.now()
    await expect(pingServer('127.0.0.1', silent.port, { timeoutMs: 300 })).rejects.toThrow(/pas de réponse/)
    expect(Date.now() - started).toBeLessThan(2000)
    const garbage = await fakeMinecraftServer({ raw: Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) })
    closers.push(garbage.close)
    await expect(pingServer('127.0.0.1', garbage.port, { timeoutMs: 1000 })).rejects.toThrow()
  })

  it('suit l’enregistrement SRV seulement pour le port 25565', async () => {
    const resolveSrv = async (): Promise<{ name: string; port: number; priority: number; weight: number }[]> => [
      { name: 'secours.example', port: 1, priority: 10, weight: 1 },
      { name: '5011.mystrator.com', port: 24475, priority: 0, weight: 5 }
    ]
    expect(await resolveTarget('hardcore-smp.mine.fun', 25565, { resolveSrv })).toEqual({ host: '5011.mystrator.com', port: 24475 })
    expect(await resolveTarget('hardcore-smp.mine.fun', 25599, { resolveSrv })).toEqual({ host: 'hardcore-smp.mine.fun', port: 25599 })
    const noSrv = async (): Promise<never> => Promise.reject(new Error('ENOTFOUND'))
    expect(await resolveTarget('play.example', 25565, { resolveSrv: noSrv })).toEqual({ host: 'play.example', port: 25565 })
  })

  it('service : « hors ligne » quand le serveur ne répond pas, une seule vérification à la fois', async () => {
    let calls = 0
    const service = new ServerStatusService({
      server: () => ({ host: 'x', port: 1 }),
      log: silentLogger,
      ping: async () => {
        calls++
        await wait(30)
        throw new Error('ECONNREFUSED')
      }
    })
    const seen: boolean[] = []
    service.onChange((status) => seen.push(status.online))
    const [a, b] = await Promise.all([service.refresh(), service.refresh()])
    expect(a).toBe(b)
    expect(calls).toBe(1)
    expect(seen).toEqual([false])
    expect(service.current()?.online).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('Discord Rich Presence', () => {
  const links = { discordInvite: 'https://discord.gg/hardcore', download: 'TODO_GITHUB_RELEASES' }

  const fakeDiscord = (options: { failLogin?: number } = {}): { create: (id: string) => RpcClient; activities: (Activity | null)[]; ids: string[]; logins: number; disconnect: () => void } => {
    const state = { activities: [] as (Activity | null)[], ids: [] as string[], logins: 0, disconnect: (): void => undefined }
    let failures = options.failLogin ?? 0
    return Object.assign(state, {
      create: (id: string): RpcClient => {
        state.ids.push(id)
        return {
          login: async () => {
            state.logins++
            if (failures > 0) {
              failures--
              throw new Error('Could not connect')
            }
          },
          destroy: async () => undefined,
          setActivity: async (activity) => state.activities.push(activity),
          clearActivity: async () => state.activities.push(null),
          onDisconnected: (listener) => {
            state.disconnect = listener
          }
        }
      }
    })
  }

  it('états affichés : dans le launcher / en jeu, temps écoulé, logo, boutons (sans lien TODO)', () => {
    const launcher = activityFor({ kind: 'launcher' }, 1000, links)
    expect(launcher).toMatchObject({ details: 'Dans le launcher', state: 'HARDCORE SMP — Saison 2', startTimestamp: 1000, largeImageKey: 'logo' })
    expect(launcher.buttons).toEqual([{ label: 'Rejoindre le Discord', url: 'https://discord.gg/hardcore' }])
    const playing = activityFor({ kind: 'playing', since: 5000 }, 1000, links)
    expect(playing).toMatchObject({ details: 'En jeu sur HARDCORE SMP — Saison 2', startTimestamp: 5000 })
    expect(activityFor({ kind: 'launcher' }, 1, { discordInvite: 'TODO_DISCORD_INVITE', download: 'TODO_X' }).buttons).toBeUndefined()
  })

  it('sans identifiant d’application : rien n’est tenté', async () => {
    const discord = fakeDiscord()
    const presence = new RichPresenceService({ applicationId: null, links: () => links, log: silentLogger, createClient: discord.create })
    presence.setEnabled(true)
    await wait(10)
    expect(discord.ids).toEqual([])
  })

  it('Discord fermé : aucune erreur, nouvel essai plus tard ; puis statut envoyé et suivi du jeu', async () => {
    const discord = fakeDiscord({ failLogin: 1 })
    const presence = new RichPresenceService({
      applicationId: '123456789012345678',
      links: () => links,
      log: silentLogger,
      createClient: discord.create,
      retryMs: 20,
      now: () => 1000
    })
    presence.setEnabled(true)
    await wait(80)
    expect(discord.logins).toBe(2)
    expect(discord.activities.at(-1)?.details).toBe('Dans le launcher')

    presence.setPresence({ kind: 'playing', since: 4242 })
    presence.setPresence({ kind: 'playing', since: 4242 })
    await wait(10)
    expect(discord.activities.filter((a) => a?.details.startsWith('En jeu'))).toHaveLength(1)

    // Discord se ferme puis revient : reconnexion automatique, le statut « en jeu » est renvoyé.
    discord.disconnect()
    await wait(60)
    expect(discord.activities.at(-1)?.startTimestamp).toBe(4242)

    presence.setEnabled(false)
    await wait(10)
    expect(discord.activities.at(-1)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('mises à jour du launcher', () => {
  /** Faux electron-updater : mêmes réglages et mêmes événements. */
  class FakeUpdater extends EventEmitter {
    autoDownload = false
    autoInstallOnAppQuit = false
    disableWebInstaller = false
    forceDevUpdateConfig = false
    updateConfigPath: string | null = null
    logger: unknown = null
    feeds: unknown[] = []
    checks = 0
    installed: [boolean | undefined, boolean | undefined] | null = null
    setFeedURL(options: unknown): void {
      this.feeds.push(options)
    }
    async checkForUpdates(): Promise<unknown> {
      this.checks++
      return null
    }
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
      this.installed = [isSilent, isForceRunAfter]
    }
  }
  const asUpdater = (updater: FakeUpdater): Updater => updater as unknown as Updater

  it('désactivées en développement et tant que le dépôt GitHub n’est pas renseigné', async () => {
    const updater = new FakeUpdater()
    const dev = new UpdateService({ updater: asUpdater(updater), repository: { owner: 'moi', repo: 'hsmp' }, isPackaged: false, userData: tmpDir(), log: silentLogger })
    expect(await dev.start()).toBe(false)
    expect(dev.getState().status).toBe('disabled')
    const noRepo = new UpdateService({ updater: asUpdater(updater), repository: null, isPackaged: true, userData: tmpDir(), log: silentLogger })
    expect(await noRepo.start()).toBe(false)
    expect(updater.feeds).toEqual([])
  })

  it('GitHub Releases : téléchargement en arrière-plan, puis installation silencieuse et relance à la demande', async () => {
    const updater = new FakeUpdater()
    const service = new UpdateService({ updater: asUpdater(updater), repository: { owner: 'moi', repo: 'hardcore-smp' }, isPackaged: true, userData: tmpDir(), log: silentLogger })
    const states: string[] = []
    service.onChange((s) => states.push(s.status))
    expect(await service.start()).toBe(true)
    expect(updater.feeds).toEqual([{ provider: 'github', owner: 'moi', repo: 'hardcore-smp' }])
    expect(updater.autoDownload && updater.autoInstallOnAppQuit).toBe(true)

    expect(service.install()).toBe(false)
    await service.check()
    updater.emit('checking-for-update')
    updater.emit('update-available', { version: '0.2.0' })
    updater.emit('download-progress', { percent: 50 })
    expect(service.getState()).toMatchObject({ status: 'downloading', version: '0.2.0', progress: 0.5 })
    updater.emit('update-downloaded', { version: '0.2.0' })
    // Une erreur lors d'une vérification suivante ne fait pas perdre la mise à jour prête.
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(service.getState().status).toBe('ready')
    expect(states).toEqual(['checking', 'downloading', 'downloading', 'ready'])
    expect(service.install()).toBe(true)
    expect(updater.installed).toEqual([true, true])
  })

  it('macOS (sans certificat Apple) : nouvelle version signalée, rien n’est téléchargé ni installé', async () => {
    const updater = new FakeUpdater()
    const service = new UpdateService({ updater: asUpdater(updater), repository: { owner: 'moi', repo: 'h' }, isPackaged: true, manualOnly: true, userData: tmpDir(), log: silentLogger })
    await service.start()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    updater.emit('update-available', { version: '0.3.0' })
    expect(service.getState()).toMatchObject({ status: 'available', version: '0.3.0' })
    expect(service.install()).toBe(false)
  })

  it('erreur réseau : message clair, sans plantage', async () => {
    const updater = new FakeUpdater()
    updater.checkForUpdates = async (): Promise<unknown> => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'))
    const service = new UpdateService({ updater: asUpdater(updater), repository: { owner: 'moi', repo: 'h' }, isPackaged: true, userData: tmpDir(), log: silentLogger })
    await service.start()
    expect((await service.check()).error).toBe('Impossible de vérifier les mises à jour pour le moment.')
  })

  it('flux de test en développement : configuration écrite pour electron-updater', async () => {
    const updater = new FakeUpdater()
    const userData = tmpDir()
    const service = new UpdateService({ updater: asUpdater(updater), repository: null, isPackaged: false, devFeed: 'http://localhost:8765/', userData, log: silentLogger })
    expect(await service.start()).toBe(true)
    expect(updater.forceDevUpdateConfig).toBe(true)
    // Le fichier du flux de test ne doit jamais être exécuté, ni en quittant ni sur demande.
    expect(updater.autoInstallOnAppQuit).toBe(false)
    updater.emit('update-downloaded', { version: '0.2.0' })
    expect(service.install()).toBe(true)
    expect(updater.installed).toBeNull()
    expect(readFileSync(updater.updateConfigPath ?? '', 'utf8')).toContain('url: http://localhost:8765/')
    expect(updater.feeds).toEqual([{ provider: 'generic', url: 'http://localhost:8765/' }])
  })
})
