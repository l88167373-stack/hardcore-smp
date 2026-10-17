/**
 * Contrat entre l'interface (renderer) et le process principal.
 * L'interface n'a accès à RIEN d'autre que cette API minimale, exposée par le preload.
 */
import type { AuthErrorInfo } from './auth-errors'
import type { CrashReport, GameActionResult, GameState } from './game'
import type { CatalogPage, CatalogProject, CatalogQuery, ContentKind, ModsActionResult, ModsState, ProjectDetails } from './mods'
import type { PublicConfig, PublicConfigOrigin } from './public-config'
import type { ServerStatus } from './server-status'
import type { UpdateState } from './updates'
import type { Settings, SettingsPatch } from './schemas'

export const IpcChannels = {
  appGetInfo: 'app:get-info',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowGetState: 'window:get-state',
  windowStateChanged: 'window:state-changed',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  shellOpenExternal: 'shell:open-external',
  shellOpenGameFolder: 'shell:open-game-folder',
  clipboardWriteText: 'clipboard:write-text',
  authGetStatus: 'auth:get-status',
  accountsList: 'accounts:list',
  accountsAdd: 'accounts:add',
  accountsRemove: 'accounts:remove',
  accountsSetActive: 'accounts:set-active',
  accountsChanged: 'accounts:changed',
  gameGetState: 'game:get-state',
  gameInstall: 'game:install',
  gameLaunch: 'game:launch',
  gameTestLaunch: 'game:test-launch',
  gameStateChanged: 'game:state-changed',
  modsGetState: 'mods:get-state',
  modsStateChanged: 'mods:state-changed',
  modsSearch: 'mods:search',
  modsRecommended: 'mods:recommended',
  modsDetails: 'mods:details',
  modsInstall: 'mods:install',
  modsUninstall: 'mods:uninstall',
  modsSetEnabled: 'mods:set-enabled',
  modsCheckUpdates: 'mods:check-updates',
  modsUpdate: 'mods:update',
  configGet: 'config:get',
  configChanged: 'config:changed',
  serverGetStatus: 'server:get-status',
  serverRefresh: 'server:refresh',
  serverStatusChanged: 'server:status-changed',
  updatesGetState: 'updates:get-state',
  updatesChanged: 'updates:changed',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  supportLatestLog: 'support:latest-log',
  supportLastCrash: 'support:last-crash'
} as const

export type Platform = 'win32' | 'darwin' | 'linux'

export interface AppInfo {
  version: string
  platform: Platform
  arch: string
  /** RAM totale du PC, en Mo. */
  totalMemoryMb: number
  /** Dossier du jeu isolé (jamais .minecraft). */
  gameDirectory: string
  isPackaged: boolean
}

export interface WindowState {
  maximized: boolean
  focused: boolean
}

/** Compte Microsoft tel que l'interface le voit : jamais de jeton, seulement l'identité. */
export interface AccountSummary {
  /** UUID Minecraft (avec tirets) : identifiant stable, même si le pseudo change. */
  uuid: string
  username: string
  /** Texture de la skin (PNG en data URL), ou null si elle n'a pas pu être récupérée. */
  skin: string | null
  active: boolean
  /** La connexion a expiré : il faut se reconnecter avant de jouer. */
  needsRelogin: boolean
}

export interface AuthStatus {
  /** Le Client ID Azure est renseigné dans app-config.json. */
  configured: boolean
  /** Les jetons peuvent être chiffrés par le système (sinon : session non mémorisée). */
  secureStorage: boolean
}

export type AddAccountResult = { ok: true; account: AccountSummary } | { ok: false; error: AuthErrorInfo }

/** Sous-dossiers du jeu que l'interface peut demander d'ouvrir. */
export type GameFolder = 'root' | 'logs' | 'crash-reports' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'quarantine'

/** Configuration publique utilisée et sa provenance (en ligne, cache, copie embarquée). */
export interface PublicConfigSnapshot {
  config: PublicConfig
  origin: PublicConfigOrigin
}

export interface HsmpApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    getState(): Promise<WindowState>
    /** Renvoie une fonction pour se désabonner. */
    onStateChange(listener: (state: WindowState) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
  }
  shell: {
    /** Ouvre un lien dans le navigateur, uniquement vers des sites autorisés. */
    openExternal(url: string): Promise<boolean>
    openGameFolder(folder: GameFolder): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
  }
  auth: {
    getStatus(): Promise<AuthStatus>
  }
  accounts: {
    list(): Promise<AccountSummary[]>
    /** Ouvre la fenêtre de connexion Microsoft et ajoute (ou reconnecte) le compte. */
    add(): Promise<AddAccountResult>
    /** Déconnecte le compte : ses jetons sont supprimés du PC. */
    remove(uuid: string): Promise<void>
    setActive(uuid: string): Promise<void>
    onChange(listener: (accounts: AccountSummary[]) => void): () => void
  }
  game: {
    getState(): Promise<GameState>
    /** Installe / met à jour le jeu (« repair » : revérifie chaque fichier). */
    install(mode: 'quick' | 'repair'): Promise<GameActionResult>
    /** Vérifie, met en quarantaine, puis lance le jeu connecté au serveur. */
    launch(): Promise<GameActionResult>
    /** Développement uniquement : lance le jeu sans compte, hors ligne. */
    testLaunchOffline(): Promise<GameActionResult>
    onStateChange(listener: (state: GameState) => void): () => void
  }
  mods: {
    getState(): Promise<ModsState>
    onChange(listener: (state: ModsState) => void): () => void
    /** Catalogue Modrinth filtré sur la version du serveur (20 résultats par page). */
    search(query: CatalogQuery): Promise<CatalogPage>
    recommended(): Promise<CatalogProject[]>
    details(projectId: string): Promise<ProjectDetails>
    /** Installe un projet autorisé et ses dépendances (empreinte SHA-512 vérifiée). */
    install(projectId: string, kind: ContentKind): Promise<ModsActionResult>
    uninstall(projectId: string): Promise<ModsActionResult>
    setEnabled(projectId: string, enabled: boolean): Promise<ModsActionResult>
    checkUpdates(): Promise<ModsActionResult>
    /** Met à jour un projet, ou tout ce qui a une mise à jour (null). */
    update(projectId: string | null): Promise<ModsActionResult>
  }
  config: {
    get(): Promise<PublicConfigSnapshot>
    onChange(listener: (snapshot: PublicConfigSnapshot) => void): () => void
  }
  server: {
    /** Dernier statut connu (null avant la première vérification). */
    getStatus(): Promise<ServerStatus | null>
    refresh(): Promise<ServerStatus>
    onChange(listener: (status: ServerStatus) => void): () => void
  }
  updates: {
    getState(): Promise<UpdateState>
    check(): Promise<UpdateState>
    /** Redémarre le launcher pour installer la mise à jour téléchargée. */
    install(): Promise<boolean>
    onChange(listener: (state: UpdateState) => void): () => void
  }
  support: {
    latestLog(): Promise<string>
    lastCrash(): Promise<CrashReport | null>
  }
}
