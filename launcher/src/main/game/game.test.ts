/**
 * Tests de l'installation et du lancement du jeu, avec de faux serveurs Mojang / Fabric / Modrinth.
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../../shared/defaults'
import type { InstallProgress } from '../../shared/game'
import type { Settings } from '../../shared/schemas'
import { AuthError } from '../auth/errors'
import { silentLogger } from '../log'
import type { ManagedFile } from '../mods/content'
import { ModsService } from '../mods/mods-service'
import { getPublicConfig, type MainPublicConfig } from '../public-config'
import type { SettingsStore } from '../settings-store'
import { buildLaunchArguments, sanitizeUserJvmArgs, type LaunchValues } from './arguments'
import { downloadFile, isFileValid } from './download'
import { GameError } from './errors'
import { createFakeWorld, type FakeWorld } from './fake-world'
import { GameService, offlineUuid } from './game-service'
import { executePlan } from './installer'
import { gameLayout, type GameLayout } from './layout'
import { javaExecutablePath, javaPlatformKey, resolveInstallPlan, type PlanContext } from './plan'
import { mavenPath, mergeVersions, rulesAllow, type RuleContext, type VersionJson } from './version'

const LINUX: RuleContext = { os: 'linux', arch: 'x86_64', features: {} }

/** Config publique réelle, mais avec seulement les mods servis par le faux Modrinth. */
const testConfig = (): MainPublicConfig => ({
  ...getPublicConfig(),
  allowlist: {
    mods: [
      { projectId: 'P7dR8mSH', name: 'Fabric API', required: true },
      { projectId: 'AANobbMI', name: 'Sodium', recommended: true }
    ],
    resourcepacks: [],
    shaders: []
  }
})
const tmpDir = (): string => mkdtempSync(path.join(os.tmpdir(), 'hsmp-jeu-'))

describe('règles de Mojang', () => {
  it('sans règle : autorisé', () => {
    expect(rulesAllow(undefined, LINUX)).toBe(true)
  })

  it('bibliothèque réservée à un système', () => {
    const windowsOnly = [{ action: 'allow' as const, os: { name: 'windows' } }]
    expect(rulesAllow(windowsOnly, LINUX)).toBe(false)
    expect(rulesAllow(windowsOnly, { ...LINUX, os: 'windows' })).toBe(true)
  })

  it('« tout sauf macOS »', () => {
    const rules = [{ action: 'allow' as const }, { action: 'disallow' as const, os: { name: 'osx' } }]
    expect(rulesAllow(rules, LINUX)).toBe(true)
    expect(rulesAllow(rules, { ...LINUX, os: 'osx' })).toBe(false)
  })

  it('architecture 32 bits et fonctionnalités', () => {
    expect(rulesAllow([{ action: 'allow', os: { arch: 'x86' } }], LINUX)).toBe(false)
    expect(rulesAllow([{ action: 'allow', features: { is_quick_play_multiplayer: true } }], LINUX)).toBe(false)
    expect(rulesAllow([{ action: 'allow', features: { is_quick_play_multiplayer: true } }], { ...LINUX, features: { is_quick_play_multiplayer: true } })).toBe(true)
  })

  it('chemin Maven', () => {
    expect(mavenPath('org.ow2.asm:asm:9.10.1')).toBe('org/ow2/asm/asm/9.10.1/asm-9.10.1.jar')
    expect(mavenPath('com.mojang:jtracy:1.0.37:natives-windows')).toBe('com/mojang/jtracy/1.0.37/jtracy-1.0.37-natives-windows.jar')
  })
})

describe('fusion Fabric + Minecraft', () => {
  const vanilla: VersionJson = {
    id: '26.2',
    mainClass: 'net.minecraft.client.main.Main',
    arguments: { game: ['--username'], jvm: ['-cp'] },
    libraries: [{ name: 'org.ow2.asm:asm:9.0' }, { name: 'com.example:core:1.0' }],
    assetIndex: { id: '32', url: 'x' }
  }
  const fabric: VersionJson = {
    id: 'fabric-loader-0.19.5-26.2',
    inheritsFrom: '26.2',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
    libraries: [{ name: 'org.ow2.asm:asm:9.10.1' }, { name: 'net.fabricmc:fabric-loader:0.19.5' }]
  }

  it('Fabric remplace la bibliothèque en double et ajoute ses arguments', () => {
    const merged = mergeVersions(fabric, vanilla)
    expect(merged.id).toBe('fabric-loader-0.19.5-26.2')
    expect(merged.mainClass).toBe('net.fabricmc.loader.impl.launch.knot.KnotClient')
    expect(merged.libraries.map((l) => l.name)).toEqual(['org.ow2.asm:asm:9.10.1', 'net.fabricmc:fabric-loader:0.19.5', 'com.example:core:1.0'])
    expect(merged.arguments?.jvm).toEqual(['-cp', '-DFabricMcEmu= net.minecraft.client.main.Main '])
    expect(merged.assetIndex?.id).toBe('32')
  })
})

describe('ligne de commande du jeu', () => {
  const version: VersionJson = {
    id: 'fabric-loader-0.19.5-26.2',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [],
    arguments: {
      jvm: [{ rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['-XstartOnFirstThread'] }, '-Djava.library.path=${natives_directory}/java', '-cp', '${classpath}'],
      game: [
        '--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}',
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
        { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }
      ]
    }
  }
  const base: LaunchValues = {
    gameDirectory: '/jeu',
    assetsDirectory: '/jeu/assets',
    librariesDirectory: '/jeu/libraries',
    nativesDirectory: '/jeu/natives/v',
    classpath: ['/jeu/a.jar', '/jeu/b.jar'],
    classpathSeparator: ':',
    versionName: 'fabric-loader-0.19.5-26.2',
    versionType: 'release',
    assetIndexName: '32',
    username: 'Steve',
    uuid: '069a79f444e94726a5befca90e38aaf5',
    accessToken: 'jeton',
    userType: 'msa',
    xuid: '0',
    clientId: 'client',
    launcherName: 'hardcore-smp-launcher',
    launcherVersion: '0.1.0',
    memoryMb: 4096,
    resolution: { width: 1600, height: 900 },
    fullscreen: false,
    quickPlayMultiplayer: 'hardcore-smp.mine.fun:25565',
    launcherJvmArgs: ['-Dhsmp.launchToken=t'],
    userJvmArgs: ['-XX:+UseZGC'],
    loggingArgument: '-Dlog4j.configurationFile=/jeu/assets/log_configs/client.xml'
  }

  it('remplace les variables, applique la RAM et se connecte directement au serveur', () => {
    const args = buildLaunchArguments(version, base, LINUX)
    expect(args.slice(0, 2)).toEqual(['-Xms1024M', '-Xmx4096M'])
    expect(args).toContain('-Dhsmp.launchToken=t')
    expect(args).toContain('-XX:+UseZGC')
    expect(args).toContain('-Djava.library.path=/jeu/natives/v/java')
    expect(args[args.indexOf('-cp') + 1]).toBe('/jeu/a.jar:/jeu/b.jar')
    expect(args).not.toContain('-XstartOnFirstThread')
    expect(args.indexOf('-Dlog4j.configurationFile=/jeu/assets/log_configs/client.xml')).toBeLessThan(args.indexOf(version.mainClass))
    expect(args).toContain('--quickPlayMultiplayer')
    expect(args[args.indexOf('--quickPlayMultiplayer') + 1]).toBe('hardcore-smp.mine.fun:25565')
    expect(args[args.indexOf('--width') + 1]).toBe('1600')
    expect(args).not.toContain('--demo')
    expect(args).not.toContain('--fullscreen')
  })

  it('plein écran : pas de taille de fenêtre ; sans serveur : pas de connexion directe', () => {
    const args = buildLaunchArguments(version, { ...base, fullscreen: true, quickPlayMultiplayer: null }, LINUX)
    expect(args).toContain('--fullscreen')
    expect(args).not.toContain('--width')
    expect(args).not.toContain('--quickPlayMultiplayer')
  })

  it('refuse les arguments JVM qui permettraient d’injecter du code', () => {
    const { args, rejected } = sanitizeUserJvmArgs('-XX:+UseZGC -javaagent:cheat.jar -Xmx32G -cp evil.jar "-Dfoo=a b" -Dhsmp.launchToken=x -agentlib:jdwp')
    expect(args).toEqual(['-XX:+UseZGC', '-Dfoo=a b'])
    expect(rejected).toEqual(['-javaagent:cheat.jar', '-Xmx32G', '-cp', 'evil.jar', '-Dhsmp.launchToken=x', '-agentlib:jdwp'])
  })
})

describe('Java officiel de Mojang', () => {
  it('choisit le bon paquet selon le système', () => {
    expect(javaPlatformKey('win32', 'x64')).toBe('windows-x64')
    expect(javaPlatformKey('darwin', 'arm64')).toBe('mac-os-arm64')
    expect(javaPlatformKey('darwin', 'x64')).toBe('mac-os')
    expect(javaPlatformKey('linux', 'x64')).toBe('linux')
    expect(javaPlatformKey('linux', 'arm64')).toBeNull()
  })

  it('utilise javaw.exe sous Windows (pas de console noire)', () => {
    expect(javaExecutablePath('/r', 'win32')).toBe(path.join('/r', 'bin', 'javaw.exe'))
    expect(javaExecutablePath('/r', 'darwin')).toBe(path.join('/r', 'jre.bundle', 'Contents', 'Home', 'bin', 'java'))
  })

  it('UUID hors ligne identique à celui de Minecraft', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f')
  })
})

describe('téléchargements vérifiés', () => {
  let world: FakeWorld
  beforeEach(() => {
    world = createFakeWorld()
  })

  it('télécharge, vérifie l’empreinte et compte la progression', async () => {
    const dir = tmpDir()
    let bytes = 0
    const item = { url: 'https://piston-data.test/client.jar', path: path.join(dir, 'client.jar'), size: 10, sha1: '', group: 'minecraft' as const }
    item.sha1 = (await import('node:crypto')).createHash('sha1').update('CLIENT-JAR').digest('hex')
    await downloadFile(item, { fetch: world.fetch, userAgent: 't', onBytes: (_g, d) => (bytes += d) })
    expect(readFileSync(item.path, 'utf8')).toBe('CLIENT-JAR')
    expect(bytes).toBe(10)
    expect(await isFileValid(item, 'hash')).toBe(true)
  })

  it('fichier corrompu : 3 essais puis erreur claire, aucun fichier laissé', async () => {
    const dir = tmpDir()
    let bytes = 0
    const item = { url: 'https://piston-data.test/client.jar', path: path.join(dir, 'client.jar'), sha1: 'f'.repeat(40), group: 'minecraft' as const }
    await expect(downloadFile(item, { fetch: world.fetch, userAgent: 't', onBytes: (_g, d) => (bytes += d) })).rejects.toMatchObject({ code: 'checksum' })
    expect(world.requests.filter((r) => r === item.url)).toHaveLength(3)
    expect(existsSync(item.path)).toBe(false)
    expect(existsSync(`${item.path}.part`)).toBe(false)
    expect(bytes).toBe(0)
  })

  it('pas d’Internet → erreur réseau', async () => {
    world.offline = true
    const item = { url: 'https://piston-data.test/client.jar', path: path.join(tmpDir(), 'c.jar'), group: 'minecraft' as const }
    await expect(downloadFile(item, { fetch: world.fetch, userAgent: 't', retries: 1 })).rejects.toMatchObject({ code: 'network' })
  })
})

describe('plan et installation complète', () => {
  let world: FakeWorld
  let layout: GameLayout
  const config = (): MainPublicConfig => getPublicConfig()
  /** Fichier publié sur le faux Modrinth, tel que le service des mods le fournit au plan. */
  const managed = (projectId: string, kind: ManagedFile['kind'] = 'mod'): ManagedFile => {
    const version = world.modrinth.get(projectId)?.versions[0]
    const file = version?.files[0]
    if (!version || !file) throw new Error(projectId)
    return {
      projectId,
      versionId: version.id,
      kind,
      fileName: file.filename,
      url: file.url,
      sha512: file.hashes.sha512,
      size: file.size,
      required: projectId === 'P7dR8mSH',
      source: 'modrinth'
    }
  }
  const context = (): PlanContext => ({
    layout,
    config: config().launcher,
    content: [managed('P7dR8mSH'), managed('AANobbMI'), managed('LIBlib01'), managed('w0TnApzs', 'resourcepack')],
    platform: 'linux',
    arch: 'x64',
    ruleContext: LINUX,
    fetch: world.fetch,
    userAgent: 'test'
  })

  beforeEach(() => {
    world = createFakeWorld()
    layout = gameLayout(tmpDir())
  })

  it('liste tout ce qu’il faut, sans fichier d’un autre système ni doublon', async () => {
    const plan = await resolveInstallPlan(context())
    const urls = plan.files.map((f) => f.url)
    expect(plan.versionId).toBe('fabric-loader-0.19.5-26.2')
    expect(urls).toContain('https://piston-data.test/client.jar')
    expect(urls).not.toContain('https://libraries.test/native-1.0-natives-windows.jar')
    // asm 9.0 (Minecraft) remplacé par asm 9.10.1 (Fabric)
    expect(urls).not.toContain('https://libraries.test/asm-9.0.jar')
    expect(urls).toContain('https://maven.fabric.test/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar')
    expect(plan.files.filter((f) => f.url.startsWith('https://resources.download.minecraft.net'))).toHaveLength(2)
    expect(plan.javaExecutable).toBe(path.join(layout.runtime, 'java-runtime-epsilon', 'bin', 'java'))
    expect(plan.loggingArgument).toBe(`-Dlog4j.configurationFile=${path.join(layout.assets, 'log_configs', 'client.xml')}`)
    // Le contenu choisi dans l'onglet Mods, chacun dans son dossier, avec son empreinte SHA-512.
    expect(plan.content.map((m) => [m.fileName, m.required])).toEqual([
      ['fabric-api-0.161.0.jar', true],
      ['sodium-0.9.2.jar', false],
      ['lib-1.0.jar', false],
      ['Faithful-32x.zip', false]
    ])
    const pack = plan.files.find((f) => f.url.endsWith('Faithful-32x.zip'))
    expect(pack?.path).toBe(path.join(layout.resourcepacks, 'Faithful-32x.zip'))
    expect(pack?.sha512).toMatch(/^[0-9a-f]{128}$/)
    // HSMP Guard pas encore publié (TODO dans launcher.json)
    expect(plan.skipped).toEqual([{ group: 'guard', note: 'Pas encore publié sur GitHub' }])
  })

  it('installe, puis une vérification rapide ne retélécharge rien, et une réparation remplace un fichier abîmé', async () => {
    const plan = await resolveInstallPlan(context())
    const steps: InstallProgress[] = []
    await executePlan(plan, { layout, mode: 'size', fetch: world.fetch, userAgent: 't', onProgress: (p) => steps.push(p) })
    const last = steps.at(-1)
    expect(last?.step).toBe('Installation terminée')
    expect(last?.doneBytes).toBe(last?.totalBytes)
    expect(last?.groups.find((g) => g.id === 'guard')?.state).toBe('skipped')
    expect(readFileSync(path.join(layout.mods, 'fabric-api-0.161.0.jar'), 'utf8')).toBe('FABRIC-API')

    world.requests.length = 0
    await executePlan(plan, { layout, mode: 'size', fetch: world.fetch, userAgent: 't', onProgress: () => undefined })
    expect(world.requests).toHaveLength(0)

    // Fichier modifié à la main, même taille : seule la réparation (empreintes) le détecte.
    await fs.writeFile(path.join(layout.versions, '26.2', '26.2.jar'), 'CLIENT-XXX')
    await executePlan(plan, { layout, mode: 'size', fetch: world.fetch, userAgent: 't', onProgress: () => undefined })
    expect(world.requests).toHaveLength(0)
    await executePlan(plan, { layout, mode: 'hash', fetch: world.fetch, userAgent: 't', onProgress: () => undefined })
    expect(world.requests).toEqual(['https://piston-data.test/client.jar'])
    expect(readFileSync(path.join(layout.versions, '26.2', '26.2.jar'), 'utf8')).toBe('CLIENT-JAR')
  })

  it('refuse un fichier distant qui voudrait s’écrire hors du dossier du jeu', async () => {
    const url = 'https://piston-meta.test/java-manifest.json'
    world.content.set(url, JSON.stringify({ files: { '../../evil.exe': { type: 'file', downloads: { raw: { url: 'https://x.test/e', sha1: 'a', size: 1 } } } } }))
    // Le manifeste Java est vérifié par SHA-1 : on remplace aussi son empreinte dans all.json.
    const crypto = await import('node:crypto')
    const sha1 = crypto.createHash('sha1').update(world.content.get(url) ?? '').digest('hex')
    const all = JSON.parse(world.content.get('https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json') ?? '{}') as Record<string, Record<string, { manifest: { sha1: string } }[]>>
    for (const runtimes of Object.values(all)) for (const entry of runtimes['java-runtime-epsilon'] ?? []) entry.manifest.sha1 = sha1
    world.content.set('https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json', JSON.stringify(all))
    await expect(resolveInstallPlan(context())).rejects.toBeInstanceOf(GameError)
  })
})

describe('service du jeu (lancement)', () => {
  let world: FakeWorld
  let layout: GameLayout
  let settings: Settings
  let spawned: { command: string; args: string[] } | null
  let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; unref: () => void }

  const makeService = (accountError?: Error): GameService =>
    new GameService({
      content: new ModsService({ layout, config: testConfig, fetch: world.fetch, userAgent: 'test', log: silentLogger, isGameBusy: () => false }),
      layout,
      platform: 'linux',
      arch: 'x64',
      fetch: world.fetch,
      userAgent: 'test',
      launcherVersion: '0.1.0',
      isPackaged: false,
      config: testConfig,
      settings: { get: async () => settings } as unknown as SettingsStore,
      accounts: {
        getLaunchSession: async () => {
          if (accountError) throw accountError
          return { uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', username: 'Steve', accessToken: 'jeton-mc' }
        }
      },
      log: silentLogger,
      spawn: (command, args) => {
        spawned = { command, args }
        child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), unref: () => undefined })
        return child as unknown as ChildProcess
      }
    })

  beforeEach(() => {
    world = createFakeWorld()
    layout = gameLayout(tmpDir())
    settings = { ...defaultSettings(16 * 1024), acceptedRulesVersion: 1 }
    spawned = null
  })

  it('installe, met en quarantaine, écrit le marqueur du Guard, puis lance connecté au serveur', async () => {
    const service = makeService()
    await fs.mkdir(layout.mods, { recursive: true })
    await fs.writeFile(path.join(layout.mods, 'cheat.jar'), 'X')
    const launching = service.launch()
    await new Promise((resolve) => setTimeout(resolve, 50))
    for (let i = 0; i < 50 && !spawned; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    child.stdout.write('[Render thread/INFO]: Backend library: LWJGL version 3.4.1\n')
    expect(await launching).toEqual({ ok: true })
    expect(service.getState().phase).toBe('running')
    expect(service.getState().quarantined).toEqual([{ file: 'mods/cheat.jar', reason: expect.stringContaining('inconnu de Modrinth') }])
    // Contenu de départ : Fabric API (obligatoire) + Sodium (recommandé) + sa dépendance.
    expect(readFileSync(path.join(layout.mods, 'sodium-0.9.2.jar'), 'utf8')).toBe('SODIUM')
    expect(existsSync(path.join(layout.mods, 'lib-1.0.jar'))).toBe(true)
    expect(existsSync(path.join(layout.mods, 'cheat.jar'))).toBe(false)

    expect(spawned?.command).toBe(path.join(layout.runtime, 'java-runtime-epsilon', 'bin', 'java'))
    const args = spawned?.args ?? []
    expect(args[args.indexOf('--quickPlayMultiplayer') + 1]).toBe('hardcore-smp.mine.fun:25565')
    expect(args[args.indexOf('--accessToken') + 1]).toBe('jeton-mc')
    expect(args[args.indexOf('--uuid') + 1]).toBe('069a79f444e94726a5befca90e38aaf5')
    expect(args).toContain(`-Xmx${settings.memoryMb}M`)

    const marker = JSON.parse(readFileSync(path.join(layout.hsmp, 'launch.json'), 'utf8')) as { token: string; acceptedRulesVersion: number }
    expect(marker.acceptedRulesVersion).toBe(1)
    expect(args).toContain(`-Dhsmp.launchToken=${marker.token}`)

    child.emit('exit', 0, null)
    expect(service.getState().phase).toBe('idle')
    expect(service.getState().error).toBeNull()
  })

  it('règlement pas accepté → refus avant tout téléchargement', async () => {
    settings.acceptedRulesVersion = 0
    const result = await makeService().launch()
    expect(result).toMatchObject({ ok: false, error: { code: 'rules-not-accepted' } })
    expect(world.requests).toHaveLength(0)
  })

  it('connexion expirée → message « reconnecte-toi »', async () => {
    const result = await makeService(new AuthError('session-expired')).launch()
    expect(result).toMatchObject({ ok: false, error: { code: 'session-expired' } })
  })

  it('Java refuse la RAM demandée → message « pas assez de mémoire »', async () => {
    const service = makeService()
    const launching = service.launch()
    for (let i = 0; i < 100 && !spawned; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    child.stderr.write('Error occurred during initialization of VM\nCould not reserve enough space for object heap\n')
    child.emit('exit', 1, null)
    expect(await launching).toMatchObject({ ok: false, error: { code: 'memory' } })
  })

  it('le jeu plante après le démarrage → état « plantage » affiché', async () => {
    const service = makeService()
    const launching = service.launch()
    for (let i = 0; i < 100 && !spawned; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    child.stdout.write('Setting user: Steve\n')
    await launching
    child.emit('exit', 255, null)
    // Plantage tôt (< 8 s) : traité comme un échec de démarrage de Java.
    expect(service.getState().error?.code).toBe('java-failed')
  })

  it('hors ligne avec une installation existante : on peut quand même lancer', async () => {
    const service = makeService()
    expect(await service.install('quick')).toEqual({ ok: true })
    world.offline = true
    const launching = service.launch()
    for (let i = 0; i < 100 && !spawned; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    child.stdout.write('Backend library\n')
    expect(await launching).toEqual({ ok: true })
  })

  it('au redémarrage du launcher, le jeu est reconnu comme installé sans Internet', async () => {
    await makeService().install('quick')
    world.offline = true
    const restarted = makeService()
    await restarted.init()
    expect(restarted.getState().installed).toBe(true)
  })
})
