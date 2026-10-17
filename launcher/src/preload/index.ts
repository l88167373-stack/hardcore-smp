/**
 * Pont entre l'interface et le process principal.
 * L'interface ne voit QUE `window.hsmp` : pas de Node.js, pas d'accès direct à ipcRenderer.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { GameState } from '../shared/game'
import { IpcChannels, type AccountSummary, type HsmpApi, type WindowState } from '../shared/ipc'
import type { ModsState } from '../shared/mods'
import type { ServerStatus } from '../shared/server-status'
import type { UpdateState } from '../shared/updates'

/** Abonnement à un message du process principal ; renvoie la fonction de désabonnement. */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: HsmpApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.appGetInfo)
  },
  window: {
    minimize: () => ipcRenderer.send(IpcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IpcChannels.windowToggleMaximize),
    close: () => ipcRenderer.send(IpcChannels.windowClose),
    getState: () => ipcRenderer.invoke(IpcChannels.windowGetState),
    onStateChange: (listener) => {
      const wrapped = (_event: IpcRendererEvent, state: WindowState): void => listener(state)
      ipcRenderer.on(IpcChannels.windowStateChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.windowStateChanged, wrapped)
      }
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.shellOpenExternal, url),
    openGameFolder: (folder) => ipcRenderer.invoke(IpcChannels.shellOpenGameFolder, folder)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IpcChannels.clipboardWriteText, text)
  },
  auth: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.authGetStatus)
  },
  accounts: {
    list: () => ipcRenderer.invoke(IpcChannels.accountsList),
    add: () => ipcRenderer.invoke(IpcChannels.accountsAdd),
    remove: (uuid) => ipcRenderer.invoke(IpcChannels.accountsRemove, uuid),
    setActive: (uuid) => ipcRenderer.invoke(IpcChannels.accountsSetActive, uuid),
    onChange: (listener) => {
      const wrapped = (_event: IpcRendererEvent, accounts: AccountSummary[]): void => listener(accounts)
      ipcRenderer.on(IpcChannels.accountsChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.accountsChanged, wrapped)
      }
    }
  },
  game: {
    getState: () => ipcRenderer.invoke(IpcChannels.gameGetState),
    install: (mode) => ipcRenderer.invoke(IpcChannels.gameInstall, mode),
    launch: () => ipcRenderer.invoke(IpcChannels.gameLaunch),
    testLaunchOffline: () => ipcRenderer.invoke(IpcChannels.gameTestLaunch),
    onStateChange: (listener) => {
      const wrapped = (_event: IpcRendererEvent, state: GameState): void => listener(state)
      ipcRenderer.on(IpcChannels.gameStateChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.gameStateChanged, wrapped)
      }
    }
  },
  mods: {
    getState: () => ipcRenderer.invoke(IpcChannels.modsGetState),
    onChange: (listener) => {
      const wrapped = (_event: IpcRendererEvent, state: ModsState): void => listener(state)
      ipcRenderer.on(IpcChannels.modsStateChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IpcChannels.modsStateChanged, wrapped)
      }
    },
    search: (query) => ipcRenderer.invoke(IpcChannels.modsSearch, query),
    recommended: () => ipcRenderer.invoke(IpcChannels.modsRecommended),
    details: (projectId) => ipcRenderer.invoke(IpcChannels.modsDetails, projectId),
    install: (projectId, kind) => ipcRenderer.invoke(IpcChannels.modsInstall, projectId, kind),
    uninstall: (projectId) => ipcRenderer.invoke(IpcChannels.modsUninstall, projectId),
    setEnabled: (projectId, enabled) => ipcRenderer.invoke(IpcChannels.modsSetEnabled, projectId, enabled),
    checkUpdates: () => ipcRenderer.invoke(IpcChannels.modsCheckUpdates),
    update: (projectId) => ipcRenderer.invoke(IpcChannels.modsUpdate, projectId)
  },
  config: {
    get: () => ipcRenderer.invoke(IpcChannels.configGet),
    onChange: (listener) => subscribe(IpcChannels.configChanged, listener)
  },
  server: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.serverGetStatus),
    refresh: () => ipcRenderer.invoke(IpcChannels.serverRefresh),
    onChange: (listener) => subscribe<ServerStatus>(IpcChannels.serverStatusChanged, listener)
  },
  updates: {
    getState: () => ipcRenderer.invoke(IpcChannels.updatesGetState),
    check: () => ipcRenderer.invoke(IpcChannels.updatesCheck),
    install: () => ipcRenderer.invoke(IpcChannels.updatesInstall),
    onChange: (listener) => subscribe<UpdateState>(IpcChannels.updatesChanged, listener)
  },
  support: {
    latestLog: () => ipcRenderer.invoke(IpcChannels.supportLatestLog),
    lastCrash: () => ipcRenderer.invoke(IpcChannels.supportLastCrash)
  }
}

contextBridge.exposeInMainWorld('hsmp', api)
