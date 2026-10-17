/**
 * Mises à jour du launcher (electron-updater + GitHub Releases) : vérification au démarrage puis toutes les
 * 4 heures, téléchargement en arrière-plan, installation au redémarrage (ou tout de suite si le joueur le demande).
 *
 * La source des mises à jour (compte/dépôt GitHub) vient de app-config.json, embarqué à la compilation :
 * la config publique en ligne ne peut pas la changer.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { UpdateState } from '../shared/updates'
import type { Logger } from './log'

/** Ce dont on a besoin d'electron-updater (remplaçable dans les tests). */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableWebInstaller: boolean
  forceDevUpdateConfig: boolean
  updateConfigPath: string | null
  logger: unknown
  setFeedURL(options: { provider: 'github'; owner: string; repo: string } | { provider: 'generic'; url: string }): void
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: never[]) => void): unknown
}

export interface UpdateServiceDeps {
  updater: Updater
  /** Dépôt GitHub des releases (null tant qu'il n'est pas renseigné). */
  repository: { owner: string; repo: string } | null
  isPackaged: boolean
  /** Développement uniquement : flux de test (HSMP_DEV_UPDATE_FEED), ex. http://localhost:8765/. */
  devFeed?: string
  /** Dossier où écrire la configuration de test (développement). */
  userData: string
  /**
   * Mise à jour manuelle seulement : on signale la nouvelle version et le joueur la télécharge.
   * C'est le cas sur macOS tant que l'app n'est pas signée par un certificat Apple (Squirrel.Mac l'exige).
   */
  manualOnly?: boolean
  log: Logger
  intervalMs?: number
  /** Délai avant la première vérification (10 s par défaut, pour ne pas ralentir le démarrage). */
  firstCheckMs?: number
}

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60_000

export class UpdateService {
  private state: UpdateState = { status: 'idle', version: null, progress: null, error: null }
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: UpdateServiceDeps) {}

  getState(): UpdateState {
    return this.state
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  /** Prépare electron-updater. Faux si les mises à jour sont désactivées (développement, dépôt pas encore renseigné). */
  async start(): Promise<boolean> {
    const { updater, log } = this.deps
    const devFeed = !this.deps.isPackaged ? this.deps.devFeed : undefined
    if (!this.deps.isPackaged && !devFeed) {
      this.set({ status: 'disabled', error: 'Mises à jour désactivées en développement.' })
      return false
    }
    if (!devFeed && !this.deps.repository) {
      log.warn('Mises à jour : dépôt GitHub absent (app-config.json → updateRepository)')
      this.set({ status: 'disabled', error: 'Mises à jour pas encore configurées.' })
      return false
    }

    const manual = this.deps.manualOnly === true
    updater.autoDownload = !manual
    // Flux de test : le fichier téléchargé n'est pas un vrai installateur, il ne doit jamais être exécuté.
    updater.autoInstallOnAppQuit = !devFeed && !manual
    updater.disableWebInstaller = true
    updater.logger = {
      info: (m: unknown) => log.info(`Mises à jour : ${String(m)}`),
      warn: (m: unknown) => log.warn(`Mises à jour : ${String(m)}`),
      error: (m: unknown) => log.error(`Mises à jour : ${String(m)}`),
      debug: () => undefined
    }
    if (devFeed) {
      // Développement : electron-updater exige un fichier de configuration, on l'écrit nous-mêmes.
      const config = path.join(this.deps.userData, 'dev-app-update.yml')
      await fs.mkdir(this.deps.userData, { recursive: true })
      await fs.writeFile(config, `provider: generic\nurl: ${devFeed}\nupdaterCacheDirName: hardcore-smp-launcher-updater-dev\n`, 'utf8')
      updater.forceDevUpdateConfig = true
      updater.updateConfigPath = config
      updater.setFeedURL({ provider: 'generic', url: devFeed })
    } else if (this.deps.repository) {
      updater.setFeedURL({ provider: 'github', owner: this.deps.repository.owner, repo: this.deps.repository.repo })
    }

    updater.on('checking-for-update', () => this.set({ status: 'checking', error: null }))
    updater.on('update-not-available', () => this.set({ status: 'up-to-date', progress: null }))
    updater.on('update-available', (info: { version?: string }) =>
      this.set(manual ? { status: 'available', version: info.version ?? null, progress: null } : { status: 'downloading', version: info.version ?? null, progress: 0 })
    )
    updater.on('download-progress', (progress: { percent?: number }) =>
      this.set({ status: 'downloading', progress: Math.max(0, Math.min(1, (progress.percent ?? 0) / 100)) })
    )
    updater.on('update-downloaded', (info: { version?: string }) =>
      this.set({ status: 'ready', version: info.version ?? this.state.version, progress: 1 })
    )
    updater.on('error', (error: Error) => {
      log.warn(`Mises à jour : ${error.message}`)
      // Une mise à jour déjà prête reste installable même si une vérification suivante échoue.
      if (this.state.status !== 'ready') this.set({ status: 'error', error: 'Impossible de vérifier les mises à jour pour le moment.' })
    })
    return true
  }

  /** Vérifie maintenant (le téléchargement suit automatiquement). */
  async check(): Promise<UpdateState> {
    if (this.state.status === 'disabled' || this.state.status === 'ready' || this.state.status === 'downloading') return this.state
    try {
      await this.deps.updater.checkForUpdates()
    } catch (error) {
      this.deps.log.warn(`Mises à jour : ${error instanceof Error ? error.message : String(error)}`)
      // L'état a pu changer pendant la vérification (événements d'electron-updater).
      if (this.getState().status !== 'ready') this.set({ status: 'error', error: 'Impossible de vérifier les mises à jour pour le moment.' })
    }
    return this.state
  }

  /** Redémarre le launcher pour installer la mise à jour téléchargée. */
  install(): boolean {
    if (this.state.status !== 'ready') return false
    this.deps.log.info(`Mises à jour : installation de la version ${this.state.version ?? '?'}`)
    if (!this.deps.isPackaged) {
      this.deps.log.info('Mises à jour : développement, installation simulée (rien n’est exécuté)')
      return true
    }
    // Installation silencieuse (installateur « en un clic »), puis le launcher se relance tout seul.
    this.deps.updater.quitAndInstall(true, true)
    return true
  }

  /** Démarre puis vérifie après 10 secondes, et ensuite toutes les 4 heures. */
  async run(): Promise<void> {
    if (!(await this.start())) return
    setTimeout(() => void this.check(), this.deps.firstCheckMs ?? 10_000).unref()
    this.timer = setInterval(() => void this.check(), this.deps.intervalMs ?? UPDATE_CHECK_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
