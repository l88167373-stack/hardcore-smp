/**
 * Service du jeu : installation, vérification/réparation, quarantaine, lancement direct sur le serveur,
 * suivi de la partie et des plantages.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gameError, type CrashReport, type GameActionResult, type GameState, type InstallProgress } from '../../shared/game'
import { quickPlayAddress } from '../../shared/server-address'
import type { AccountService, LaunchSession } from '../auth/account-service'
import { AuthError } from '../auth/errors'
import type { Logger } from '../log'
import type { ContentProvider } from '../mods/content'
import type { MainPublicConfig } from '../public-config'
import type { SettingsStore } from '../settings-store'
import { buildLaunchArguments, sanitizeUserJvmArgs } from './arguments'
import { isFileValid, type FetchLike } from './download'
import { GameError, toGameError } from './errors'
import { executePlan } from './installer'
import type { GameLayout } from './layout'
import { resolveInstallPlan, type InstallPlan } from './plan'
import { mavenPath, mojangArch, osName, rulesAllow, type RuleContext } from './version'

export interface GameServiceDeps {
  layout: GameLayout
  platform: NodeJS.Platform
  arch: string
  fetch: FetchLike
  userAgent: string
  launcherVersion: string
  isPackaged: boolean
  config: () => MainPublicConfig
  settings: SettingsStore
  accounts: Pick<AccountService, 'getLaunchSession'>
  /** Mods, packs et shaders choisis par le joueur (service des mods). */
  content: ContentProvider
  log: Logger
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  /** Appelé quand le joueur a choisi de fermer le launcher au lancement du jeu. */
  onQuitRequested?: () => void
  /** Développement uniquement : jar de HSMP Guard local (HSMP_GUARD_JAR). */
  devGuardJar?: string
  /** Développement uniquement : désactive la quarantaine pour tester la défense du serveur. */
  devSkipQuarantine?: boolean
}

/** Après ce délai sans plantage, on considère que le jeu a bien démarré. */
const STARTUP_GRACE_MS = 8_000

/** UUID « hors ligne » (comme le serveur vanilla) : uniquement pour le test de lancement en développement. */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x30
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class GameService {
  private state: GameState = { phase: 'idle', installed: false, progress: null, error: null, quarantined: [], adopted: [] }
  private readonly listeners = new Set<(state: GameState) => void>()
  private readonly spawnFn: NonNullable<GameServiceDeps['spawn']>
  private readonly ruleContext: RuleContext

  constructor(private readonly deps: GameServiceDeps) {
    this.spawnFn = deps.spawn ?? nodeSpawn
    this.ruleContext = { os: osName(deps.platform), arch: mojangArch(deps.arch), features: {} }
  }

  private get planFile(): string {
    return path.join(this.deps.layout.hsmp, 'install-plan.json')
  }

  getState(): GameState {
    return this.state
  }

  onState(listener: (state: GameState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  /** Au démarrage : le jeu est-il déjà installé (vérification rapide, sans Internet) ? */
  async init(): Promise<void> {
    const plan = await this.loadCachedPlan()
    if (!plan) return
    const javaOk = await fs
      .stat(plan.javaExecutable)
      .then((stat) => stat.isFile())
      .catch(() => false)
    const checks = await Promise.all(plan.files.map((file) => isFileValid(file, 'size')))
    this.setState({ installed: javaOk && checks.every(Boolean) })
  }

  /** Installe ou met à jour le jeu. `repair` revérifie l'empreinte de chaque fichier. */
  async install(mode: 'quick' | 'repair' = 'quick'): Promise<GameActionResult> {
    if (this.state.phase !== 'idle' || this.deps.content.isBusy()) return { ok: false, error: gameError('busy') }
    this.setState({ phase: 'installing', error: null, progress: null })
    try {
      await this.runPlan(await this.resolvePlan(), mode)
      // On garde la dernière progression (100 %) pour que l'interface l'affiche.
      this.setState({ phase: 'idle' })
      return { ok: true }
    } catch (error) {
      return this.fail(error)
    }
  }

  /**
   * Lance le jeu, connecté directement au serveur.
   * Développement uniquement : `offlineTest` (sans compte) et `server` (« hôte:port » d'un serveur de test).
   */
  async launch(options: { offlineTest?: boolean; server?: string } = {}): Promise<GameActionResult> {
    if (this.state.phase !== 'idle' || this.deps.content.isBusy()) return { ok: false, error: gameError('busy') }
    const offlineTest = options.offlineTest === true && !this.deps.isPackaged
    const serverOverride = this.deps.isPackaged ? undefined : options.server
    this.setState({ phase: 'launching', error: null, progress: null, quarantined: [], adopted: [] })
    try {
      const { launcher, rules } = this.deps.config()
      const settings = await this.deps.settings.get()
      if (!offlineTest && settings.acceptedRulesVersion < rules.version) throw new GameError('rules-not-accepted')

      const session = offlineTest ? this.offlineSession() : await this.session()
      let plan = await this.resolvePlan()

      // Anti-triche : les dossiers mods/, resourcepacks/ et shaderpacks/ ne gardent que le contenu autorisé.
      if (!(this.deps.devSkipQuarantine && !this.deps.isPackaged)) {
        const tidy = await this.deps.content.tidyFolders(plan.content)
        this.setState({ quarantined: tidy.quarantined, adopted: tidy.adopted })
        // Un fichier adopté peut avoir besoin de dépendances : on refait le plan pour les télécharger.
        if (tidy.adopted.length > 0) plan = await this.resolvePlan()
      }
      // Retélécharge ce qui manque (dont les fichiers modifiés qui viennent d'être mis de côté).
      await this.runPlan(plan, 'quick')
      this.setState({ phase: 'launching', progress: null })

      const token = await this.writeLaunchMarker(settings.acceptedRulesVersion)
      const args = await this.buildArgs(plan, session, launcher.server, settings, token, offlineTest, serverOverride)
      await this.start(plan, args, settings.closeOnLaunch)
      return { ok: true }
    } catch (error) {
      return this.fail(error)
    }
  }

  async latestLog(maxLines = 400): Promise<string> {
    const text = await fs.readFile(path.join(this.deps.layout.logs, 'latest.log'), 'utf8').catch(() => '')
    return text.split(/\r?\n/).slice(-maxLines).join('\n')
  }

  async lastCrash(): Promise<CrashReport | null> {
    const dir = this.deps.layout.crashReports
    const names = await fs.readdir(dir).catch(() => [] as string[])
    let newest: { name: string; mtime: Date } | null = null
    for (const name of names.filter((n) => n.endsWith('.txt'))) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null)
      if (stat && (!newest || stat.mtime > newest.mtime)) newest = { name, mtime: stat.mtime }
    }
    if (!newest) return null
    const content = await fs.readFile(path.join(dir, newest.name), 'utf8')
    return { fileName: newest.name, date: newest.mtime.toISOString(), content: content.slice(0, 300_000) }
  }

  // --- interne ---------------------------------------------------------------

  private fail(error: unknown): GameActionResult {
    const failure = error instanceof AuthError ? this.fromAuth(error) : toGameError(error)
    this.deps.log.error(`Jeu : ${failure.message}`)
    const info = gameError(failure.code)
    this.setState({ phase: 'idle', progress: null, error: info })
    return { ok: false, error: info }
  }

  private fromAuth(error: AuthError): GameError {
    if (error.code === 'session-expired') return new GameError('session-expired', error.detail)
    if (error.code === 'network') return new GameError('network', error.detail)
    if (error.code === 'unknown' && error.detail?.includes('aucun compte')) return new GameError('not-logged-in')
    return new GameError('unknown', error.message)
  }

  private async session(): Promise<LaunchSession> {
    return this.deps.accounts.getLaunchSession()
  }

  private offlineSession(): LaunchSession {
    const username = 'Testeur'
    return { uuid: offlineUuid(username), username, accessToken: '0' }
  }

  private async loadCachedPlan(): Promise<InstallPlan | null> {
    try {
      const plan = JSON.parse(await fs.readFile(this.planFile, 'utf8')) as InstallPlan
      const { launcher } = this.deps.config()
      if (plan.schema !== 2 || plan.minecraftVersion !== launcher.minecraftVersion || plan.fabricLoaderVersion !== launcher.fabricLoaderVersion) {
        return null
      }
      return plan
    } catch {
      return null
    }
  }

  private async resolvePlan(): Promise<InstallPlan> {
    const config = this.deps.config()
    const cached = await this.loadCachedPlan()
    try {
      return await resolveInstallPlan({
        layout: this.deps.layout,
        config: config.launcher,
        content: await this.deps.content.planContent(),
        platform: this.deps.platform,
        arch: this.deps.arch,
        ruleContext: this.ruleContext,
        fetch: this.deps.fetch,
        userAgent: this.deps.userAgent,
        ...(this.deps.devGuardJar && !this.deps.isPackaged ? { devGuardJar: this.deps.devGuardJar } : {})
      })
    } catch (error) {
      // Hors ligne : on joue avec la dernière installation connue si elle correspond à la version demandée.
      if (cached && toGameError(error).code === 'network') {
        this.deps.log.warn('Hors ligne : utilisation de la dernière installation connue')
        return cached
      }
      throw error
    }
  }

  /** Télécharge ce qui manque ou est abîmé, puis enregistre le plan (pour démarrer sans Internet). */
  private async runPlan(plan: InstallPlan, mode: 'quick' | 'repair'): Promise<InstallPlan> {
    await executePlan(plan, {
      layout: this.deps.layout,
      mode: mode === 'repair' ? 'hash' : 'size',
      fetch: this.deps.fetch,
      userAgent: this.deps.userAgent,
      onProgress: (progress: InstallProgress) => this.setState({ progress })
    })
    await fs.mkdir(this.deps.layout.hsmp, { recursive: true })
    await fs.writeFile(this.planFile, JSON.stringify(plan), 'utf8')
    this.setState({ installed: true })
    this.deps.log.info(`Jeu installé et vérifié (${mode === 'repair' ? 'complète' : 'rapide'}) : ${plan.versionId}`)
    return plan
  }

  /** Marqueur pour HSMP Guard : « lancé par le launcher officiel » + version du règlement acceptée. */
  private async writeLaunchMarker(acceptedRulesVersion: number): Promise<string> {
    const token = randomBytes(24).toString('base64url')
    await fs.mkdir(this.deps.layout.hsmp, { recursive: true })
    await fs.writeFile(
      path.join(this.deps.layout.hsmp, 'launch.json'),
      JSON.stringify(
        {
          launcher: 'hardcore-smp-launcher',
          launcherVersion: this.deps.launcherVersion,
          acceptedRulesVersion,
          token,
          launchedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )
    return token
  }

  private async clientId(): Promise<string> {
    const file = path.join(this.deps.layout.hsmp, 'client-id')
    const existing = (await fs.readFile(file, 'utf8').catch(() => '')).trim()
    if (existing) return existing
    const id = randomUUID()
    await fs.writeFile(file, id, 'utf8')
    return id
  }

  private async buildArgs(
    plan: InstallPlan,
    session: LaunchSession,
    server: { host: string; port: number },
    settings: Awaited<ReturnType<SettingsStore['get']>>,
    token: string,
    offlineTest: boolean,
    serverOverride?: string
  ): Promise<string[]> {
    const { layout } = this.deps
    const nativesDirectory = path.join(layout.natives, plan.versionId)
    for (const sub of ['java', 'jna', 'lwjgl', 'netty']) await fs.mkdir(path.join(nativesDirectory, sub), { recursive: true })

    const classpath: string[] = []
    const seen = new Set<string>()
    for (const library of plan.version.libraries) {
      if (!rulesAllow(library.rules, this.ruleContext)) continue
      const relative = library.downloads?.artifact?.path ?? (library.url ? mavenPath(library.name) : null)
      if (!relative) continue
      const full = path.join(layout.libraries, relative)
      if (!seen.has(full)) {
        seen.add(full)
        classpath.push(full)
      }
    }
    classpath.push(path.join(layout.versions, plan.minecraftVersion, `${plan.minecraftVersion}.jar`))

    const user = sanitizeUserJvmArgs(settings.jvmArgs)
    if (user.rejected.length > 0) this.deps.log.warn(`Arguments JVM ignorés : ${user.rejected.join(' ')}`)

    return buildLaunchArguments(
      plan.version,
      {
        gameDirectory: layout.root,
        assetsDirectory: layout.assets,
        librariesDirectory: layout.libraries,
        nativesDirectory,
        classpath,
        classpathSeparator: path.delimiter,
        versionName: plan.versionId,
        versionType: 'release',
        assetIndexName: plan.assetIndexId,
        username: session.username,
        uuid: session.uuid.replace(/-/g, ''),
        accessToken: session.accessToken,
        userType: offlineTest ? 'legacy' : 'msa',
        xuid: '0',
        clientId: await this.clientId(),
        launcherName: 'hardcore-smp-launcher',
        launcherVersion: this.deps.launcherVersion,
        memoryMb: settings.memoryMb,
        resolution: settings.resolution.fullscreen ? null : { width: settings.resolution.width, height: settings.resolution.height },
        fullscreen: settings.resolution.fullscreen,
        quickPlayMultiplayer: serverOverride ?? (offlineTest ? null : quickPlayAddress(server.host, server.port)),
        launcherJvmArgs: [`-Dhsmp.launchToken=${token}`, `-Dhsmp.launcherVersion=${this.deps.launcherVersion}`],
        userJvmArgs: user.args,
        loggingArgument: plan.loggingArgument
      },
      this.ruleContext
    )
  }

  private start(plan: InstallPlan, args: string[], closeOnLaunch: boolean): Promise<void> {
    const startedAt = Date.now()
    const output: string[] = []
    this.deps.log.info(`Lancement de ${plan.versionId} (${args.length} arguments)`)

    return new Promise<void>((resolve, reject) => {
      let started = false
      const child = this.spawnFn(plan.javaExecutable, args, {
        cwd: this.deps.layout.root,
        detached: closeOnLaunch,
        stdio: closeOnLaunch ? 'ignore' : ['ignore', 'pipe', 'pipe'],
        windowsHide: false
      })

      const markStarted = (): void => {
        if (started) return
        started = true
        this.setState({ phase: 'running' })
        resolve()
        if (closeOnLaunch) {
          child.unref()
          this.deps.onQuitRequested?.()
        }
      }

      const collect = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        output.push(...text.split(/\r?\n/).filter(Boolean))
        if (output.length > 300) output.splice(0, output.length - 300)
        // Le jeu affiche ces lignes quand sa fenêtre s'ouvre.
        if (/Backend library|Setting user|Loading Minecraft/i.test(text)) markStarted()
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      const timer = setTimeout(markStarted, STARTUP_GRACE_MS)

      child.once('error', (error) => {
        clearTimeout(timer)
        reject(new GameError('java-failed', error.message))
      })

      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        const tail = output.slice(-15).join('\n')
        if (code === 0 || signal === 'SIGTERM') {
          this.deps.log.info('Partie terminée')
          this.setState({ phase: 'idle' })
          if (!started) resolve()
          return
        }
        this.deps.log.error(`Le jeu s'est arrêté (code ${String(code)}) :\n${tail}`)
        const memory = /Could not reserve enough space|Invalid maximum heap size|Insufficient memory/i.test(tail)
        const failure = memory ? 'memory' : !started || Date.now() - startedAt < STARTUP_GRACE_MS ? 'java-failed' : 'game-crashed'
        if (!started) {
          reject(new GameError(failure, tail))
        } else {
          this.setState({ phase: 'idle', error: gameError(failure) })
        }
      })
    })
  }
}
