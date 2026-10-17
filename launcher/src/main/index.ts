/**
 * Point d'entrée du process principal du launcher HARDCORE SMP.
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import os from 'node:os'
import path from 'node:path'
import { IpcChannels } from '../shared/ipc'
import { appConfig } from './app-config'
import { AccountService } from './auth/account-service'
import { fileAccountStore } from './auth/account-store'
import { createHttp } from './auth/http'
import { openMicrosoftLogin } from './auth/login-window'
import { fileSkinCache } from './auth/skins'
import { electronCipher } from './auth/vault'
import { GameService } from './game/game-service'
import { gameLayout } from './game/layout'
import { ModsService } from './mods/mods-service'
import { PublicConfigService } from './public-config'
import { RichPresenceService } from './rich-presence'
import { ServerStatusService } from './server-status'
import { UpdateService, type Updater } from './updates'
import { runScreenshotsIfRequested } from './dev-screenshots'
import { gameDirectory } from './game-paths'
import { registerIpcHandlers } from './ipc-handlers'
import { fileLogger } from './log'
import { handleAppScheme, registerAppScheme } from './protocol'
import { applySessionSecurity, hardenWebContents } from './security'
import { SettingsStore } from './settings-store'
import { createMainWindow } from './window'

/** Adresse du serveur Vite en développement (fournie par electron-vite). */
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined

/** Vérifie toutes les heures si la session du compte actif doit être renouvelée. */
const REFRESH_CHECK_MS = 60 * 60 * 1000

// Version installée : aucune option de débogage. Sinon, un autre programme pourrait lancer le launcher
// avec un port de débogage et piloter son interface.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'inspect', 'inspect-brk']
if (app.isPackaged && DEBUG_SWITCHES.some((name) => app.commandLine.hasSwitch(name))) {
  app.exit(1)
}

// Toutes les pages tournent dans un bac à sable, sans exception.
app.enableSandbox()
registerAppScheme()

let mainWindow: BrowserWindow | null = null

function start(): void {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, devUrl))

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('fun.hardcoresmp.launcher')

    applySessionSecurity(devUrl)
    if (!devUrl) handleAppScheme(path.join(__dirname, '../renderer'))

    const userData = app.getPath('userData')
    const log = fileLogger(path.join(userData, 'logs', 'launcher.log'))
    log.info(`Démarrage du launcher ${app.getVersion()} (${process.platform} ${process.arch})`)

    const totalMemoryMb = Math.floor(os.totalmem() / 1024 / 1024)
    const settings = new SettingsStore(path.join(userData, 'settings.json'), totalMemoryMb)

    const accounts = new AccountService({
      http: createHttp(fetch, `hardcore-smp-launcher/${app.getVersion()}`),
      clientId: appConfig.azureClientId,
      cipher: electronCipher(),
      store: fileAccountStore(path.join(userData, 'accounts.json')),
      skins: fileSkinCache(path.join(userData, 'skins'), fetch),
      openLoginWindow: (url) => openMicrosoftLogin(mainWindow, url),
      log
    })
    if (!appConfig.azureClientId) log.warn('Client ID Azure absent (app-config.json) : connexion Microsoft désactivée')
    if (!accounts.status().secureStorage) log.warn('Aucun trousseau sécurisé : les sessions ne seront pas mémorisées')

    // En développement, HSMP_GAME_DIR permet d'utiliser un dossier de jeu de test.
    const gameDir =
      (!app.isPackaged && process.env.HSMP_GAME_DIR) || gameDirectory(process.platform, process.env, os.homedir())
    const layout = gameLayout(gameDir)
    const userAgent = `hardcore-smp-launcher/${app.getVersion()}`

    // Configuration publique : en ligne (GitHub) → dernière copie téléchargée → copie embarquée.
    const publicConfig = new PublicConfigService({
      // Développement : HSMP_DEV_CONFIG_URL permet de tester avec un dossier config/ servi en local.
      baseUrl: (!app.isPackaged && process.env.HSMP_DEV_CONFIG_URL) || appConfig.publicConfigUrl,
      cacheDir: path.join(userData, 'public-config'),
      fetch,
      userAgent,
      log
    })
    await publicConfig.loadCache()
    void publicConfig.start()
    const getPublicConfig = (): ReturnType<PublicConfigService['current']> => publicConfig.current()
    // Les deux services se connaissent : le service des mods demande si le jeu tourne.
    const gameRef: { current: GameService | null } = { current: null }
    const mods = new ModsService({
      layout,
      config: getPublicConfig,
      fetch,
      userAgent,
      log,
      isGameBusy: () => gameRef.current !== null && gameRef.current.getState().phase !== 'idle'
    })
    const game = new GameService({
      layout,
      platform: process.platform,
      arch: process.arch,
      fetch,
      userAgent,
      launcherVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      config: getPublicConfig,
      settings,
      accounts,
      content: mods,
      log,
      // « Fermer le launcher quand le jeu démarre » : le jeu continue sans lui.
      onQuitRequested: () => app.quit(),
      // Développement : HSMP Guard compilé localement tant qu'il n'est pas publié sur GitHub.
      ...(!app.isPackaged && process.env.HSMP_GUARD_JAR ? { devGuardJar: process.env.HSMP_GUARD_JAR } : {}),
      // Développement : laisser un mod interdit dans mods/ pour vérifier que le serveur le refuse bien.
      ...(!app.isPackaged && process.env.HSMP_DEV_SKIP_QUARANTINE === '1' ? { devSkipQuarantine: true } : {})
    })
    gameRef.current = game
    void game.init()

    // Statut du serveur (Server List Ping toutes les 30 s).
    const serverStatus = new ServerStatusService({ server: () => publicConfig.current().launcher.server, log })
    serverStatus.start()

    // Discord Rich Presence : « Dans le launcher » / « En jeu sur HARDCORE SMP — Saison 2 ».
    const presence = new RichPresenceService({
      applicationId: appConfig.discordApplicationId,
      links: () => ({ discordInvite: publicConfig.current().launcher.discordInvite, download: publicConfig.current().launcher.links.download }),
      log
    })
    void settings.get().then((current) => presence.setEnabled(current.discordRichPresence))
    settings.onChange((current) => presence.setEnabled(current.discordRichPresence))
    let playingSince: number | null = null
    game.onState((state) => {
      if (state.phase === 'running') {
        playingSince ??= Date.now()
        presence.setPresence({ kind: 'playing', since: playingSince })
      } else {
        playingSince = null
        presence.setPresence({ kind: 'launcher' })
      }
    })
    app.on('before-quit', () => void presence.stop())

    // Mises à jour du launcher (GitHub Releases). HSMP_DEV_UPDATE_FEED : flux de test en développement.
    const updates = new UpdateService({
      updater: autoUpdater as unknown as Updater,
      repository: appConfig.updateRepository,
      isPackaged: app.isPackaged,
      // macOS : app non signée par Apple → le joueur télécharge la nouvelle version lui-même.
      manualOnly: process.platform === 'darwin',
      ...(!app.isPackaged && process.env.HSMP_DEV_UPDATE_FEED ? { devFeed: process.env.HSMP_DEV_UPDATE_FEED, firstCheckMs: 1000 } : {}),
      userData,
      log
    })
    void updates.run()

    registerIpcHandlers({ devUrl, gameDirectory: gameDir, settings, accounts, game, mods, publicConfig, serverStatus, updates })

    mainWindow = createMainWindow(devUrl)
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    accounts.onChange((list) => mainWindow?.webContents.send(IpcChannels.accountsChanged, list))
    game.onState((state) => mainWindow?.webContents.send(IpcChannels.gameStateChanged, state))
    mods.onChange((state) => mainWindow?.webContents.send(IpcChannels.modsStateChanged, state))
    publicConfig.onChange((config, origin) => mainWindow?.webContents.send(IpcChannels.configChanged, { config, origin }))
    serverStatus.onChange((status) => mainWindow?.webContents.send(IpcChannels.serverStatusChanged, status))
    updates.onChange((state) => mainWindow?.webContents.send(IpcChannels.updatesChanged, state))
    runScreenshotsIfRequested(mainWindow)

    // Renouvellement des jetons au démarrage puis régulièrement (sans bloquer l'interface).
    void accounts.refreshActiveInBackground()
    setInterval(() => void accounts.refreshActiveInBackground(), REFRESH_CHECK_MS).unref()
  })
}

if (process.env.HSMP_SCREENSHOTS && !app.isPackaged) {
  // Dossier de données séparé pour que les captures ne touchent pas à tes vrais paramètres.
  app.setPath('userData', path.join(process.env.HSMP_SCREENSHOTS, '.userdata'))
  start()
} else if (app.requestSingleInstanceLock()) {
  start()
} else {
  // Un launcher est déjà ouvert : on lui laisse la main.
  app.quit()
}
