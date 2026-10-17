/**
 * Fenêtre principale : sans cadre (barre de titre dessinée par l'interface), ~1280×760, redimensionnable.
 */
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import path from 'node:path'
import { IpcChannels, type WindowState } from '../shared/ipc'
import { APP_ORIGIN } from './security'

export const WINDOW_SIZE = { width: 1280, height: 760, minWidth: 1024, minHeight: 640 }

export function windowState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), focused: win.isFocused() }
}

export function createMainWindow(devUrl: string | undefined): BrowserWindow {
  const isMac = process.platform === 'darwin'

  // macOS garde ses boutons natifs (feux tricolores) ; Windows/Linux utilisent nos boutons.
  const chrome: BrowserWindowConstructorOptions = isMac
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 13 } }
    : { frame: false }

  const win = new BrowserWindow({
    ...WINDOW_SIZE,
    ...chrome,
    show: false,
    title: 'HARDCORE SMP',
    backgroundColor: '#0A0A0A',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      // Captures d'écran de développement : la fenêtre cachée doit continuer à se dessiner.
      backgroundThrottling: !process.env.HSMP_SCREENSHOTS
    }
  })

  const sendState = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.windowStateChanged, windowState(win))
  }
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)
  win.on('focus', sendState)
  win.on('blur', sendState)

  win.once('ready-to-show', () => {
    if (!process.env.HSMP_SCREENSHOTS) win.show()
  })

  if (devUrl && !app.isPackaged) void win.loadURL(devUrl)
  else void win.loadURL(`${APP_ORIGIN}/index.html`)

  return win
}
