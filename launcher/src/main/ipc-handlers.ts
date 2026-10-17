/**
 * Réponses du process principal aux demandes de l'interface.
 * Chaque demande vérifie qu'elle vient bien de l'interface du launcher et valide ses arguments.
 */
import { app, BrowserWindow, clipboard, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { z } from 'zod'
import { IpcChannels, type AppInfo, type Platform } from '../shared/ipc'
import type { AccountService } from './auth/account-service'
import type { GameService } from './game/game-service'
import type { ModsService } from './mods/mods-service'
import type { PublicConfigService } from './public-config'
import type { ServerStatusService } from './server-status'
import type { UpdateService } from './updates'
import { isAllowedExternalUrl } from './external-links'
import { gameSubfolder } from './game-paths'
import { isAppUrl } from './security'
import type { SettingsStore } from './settings-store'
import { windowState } from './window'

interface Context {
  devUrl: string | undefined
  gameDirectory: string
  settings: SettingsStore
  accounts: AccountService
  game: GameService
  mods: ModsService
  publicConfig: PublicConfigService
  serverStatus: ServerStatusService
  updates: UpdateService
}

const gameFolderSchema = z.enum(['root', 'logs', 'crash-reports', 'mods', 'resourcepacks', 'shaderpacks', 'quarantine'])
const projectIdSchema = z.string().regex(/^[A-Za-z0-9]{8}$/)
const kindSchema = z.enum(['mod', 'resourcepack', 'shader'])
const catalogQuerySchema = z.strictObject({
  kind: kindSchema,
  query: z.string().max(100),
  sort: z.enum(['relevance', 'downloads']),
  offset: z.number().int().min(0).max(10_000),
  onlyAllowed: z.boolean()
})
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const MAX_CLIPBOARD_LENGTH = 1_000_000

export function registerIpcHandlers(ctx: Context): void {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url
    return typeof url === 'string' && isAppUrl(url, ctx.devUrl)
  }

  const handle = <T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => T): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('Demande refusée : origine inconnue.')
      return fn(event, ...args)
    })
  }

  const onWindow = (channel: string, fn: (win: BrowserWindow) => void): void => {
    ipcMain.on(channel, (event) => {
      if (!trusted(event)) return
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) fn(win)
    })
  }

  handle(IpcChannels.appGetInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform as Platform,
    arch: process.arch,
    totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
    gameDirectory: ctx.gameDirectory,
    isPackaged: app.isPackaged
  }))

  onWindow(IpcChannels.windowMinimize, (win) => win.minimize())
  onWindow(IpcChannels.windowToggleMaximize, (win) => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  onWindow(IpcChannels.windowClose, (win) => win.close())
  handle(IpcChannels.windowGetState, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? windowState(win) : { maximized: false, focused: true }
  })

  handle(IpcChannels.settingsGet, () => ctx.settings.get())
  handle(IpcChannels.settingsUpdate, (_event, patch) => ctx.settings.update(patch))

  handle(IpcChannels.shellOpenExternal, async (_event, url) => {
    if (typeof url !== 'string' || !isAllowedExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })

  handle(IpcChannels.shellOpenGameFolder, async (_event, folder) => {
    const target = gameSubfolder(ctx.gameDirectory, gameFolderSchema.parse(folder))
    await fs.mkdir(target, { recursive: true })
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })

  handle(IpcChannels.clipboardWriteText, (_event, text) => {
    if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_LENGTH) throw new Error('Texte invalide.')
    clipboard.writeText(text)
  })

  // Comptes Microsoft : l'interface ne reçoit jamais de jeton.
  handle(IpcChannels.authGetStatus, () => ctx.accounts.status())
  handle(IpcChannels.accountsList, () => ctx.accounts.list())
  handle(IpcChannels.accountsAdd, () => ctx.accounts.add())
  handle(IpcChannels.accountsRemove, (_event, uuid) => ctx.accounts.remove(uuidSchema.parse(uuid)))
  handle(IpcChannels.accountsSetActive, (_event, uuid) => ctx.accounts.setActive(uuidSchema.parse(uuid)))

  // Jeu : installation, réparation, lancement.
  handle(IpcChannels.gameGetState, () => ctx.game.getState())
  handle(IpcChannels.gameInstall, (_event, mode) => ctx.game.install(z.enum(['quick', 'repair']).parse(mode)))
  handle(IpcChannels.gameLaunch, () => ctx.game.launch())
  handle(IpcChannels.gameTestLaunch, () => {
    if (app.isPackaged) throw new Error('Réservé au développement.')
    // HSMP_DEV_SERVER=localhost:25599 : se connecter directement à un serveur Paper de test (en mode hors ligne).
    const server = process.env.HSMP_DEV_SERVER
    return ctx.game.launch({ offlineTest: true, ...(server ? { server } : {}) })
  })
  // Mods, packs et shaders : identifiants et requêtes validés, aucun chemin de fichier venant de l'interface.
  handle(IpcChannels.modsGetState, () => ctx.mods.getState())
  handle(IpcChannels.modsSearch, (_event, query) => ctx.mods.search(catalogQuerySchema.parse(query)))
  handle(IpcChannels.modsRecommended, () => ctx.mods.recommended())
  handle(IpcChannels.modsDetails, (_event, projectId) => ctx.mods.details(projectIdSchema.parse(projectId)))
  handle(IpcChannels.modsInstall, (_event, projectId, kind) => ctx.mods.install(projectIdSchema.parse(projectId), kindSchema.parse(kind)))
  handle(IpcChannels.modsUninstall, (_event, projectId) => ctx.mods.uninstall(projectIdSchema.parse(projectId)))
  handle(IpcChannels.modsSetEnabled, (_event, projectId, enabled) =>
    ctx.mods.setEnabled(projectIdSchema.parse(projectId), z.boolean().parse(enabled))
  )
  handle(IpcChannels.modsCheckUpdates, () => ctx.mods.checkUpdates())
  handle(IpcChannels.modsUpdate, (_event, projectId) => ctx.mods.update(projectIdSchema.nullable().parse(projectId)))

  // Config publique, statut du serveur, mises à jour du launcher.
  handle(IpcChannels.configGet, () => ({ config: ctx.publicConfig.current(), origin: ctx.publicConfig.currentOrigin() }))
  handle(IpcChannels.serverGetStatus, () => ctx.serverStatus.current())
  handle(IpcChannels.serverRefresh, () => ctx.serverStatus.refresh())
  handle(IpcChannels.updatesGetState, () => ctx.updates.getState())
  handle(IpcChannels.updatesCheck, () => ctx.updates.check())
  handle(IpcChannels.updatesInstall, () => ctx.updates.install())

  handle(IpcChannels.supportLatestLog, () => ctx.game.latestLog())
  handle(IpcChannels.supportLastCrash, () => ctx.game.lastCrash())
}
