/**
 * Fenêtre de connexion Microsoft, isolée du reste du launcher :
 * - session à part, en mémoire seulement, vidée avant chaque connexion (aucun cookie Microsoft gardé) ;
 * - aucun accès au launcher (pas de preload, bac à sable, isolation) ;
 * - navigation limitée aux pages Microsoft / Xbox ; aucune permission web.
 * Elle se ferme dès que Microsoft renvoie vers l'adresse de retour, dont on extrait le code.
 */
import { app, BrowserWindow, session } from 'electron'
import { AuthError } from './errors'
import { cleanUserAgent, loginContents } from './login-policy'
import { isRedirectUrl } from './oauth'

/** Sans préfixe « persist: » : rien n'est écrit sur le disque. */
const LOGIN_PARTITION = 'hsmp-microsoft-login'

let current: BrowserWindow | null = null

export async function openMicrosoftLogin(parent: BrowserWindow | null, authorizeUrl: string): Promise<string> {
  if (current && !current.isDestroyed()) {
    current.focus()
    throw new AuthError('login-in-progress')
  }

  const loginSession = session.fromPartition(LOGIN_PARTITION)
  await loginSession.clearStorageData()
  loginSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  loginSession.setPermissionCheckHandler(() => false)

  const win = new BrowserWindow({
    parent: parent ?? undefined,
    modal: parent !== null,
    width: 520,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: 'Connexion Microsoft — HARDCORE SMP',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      partition: LOGIN_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  current = win
  loginContents.add(win.webContents)
  win.setMenu(null)
  win.webContents.setUserAgent(cleanUserAgent(win.webContents.getUserAgent()))

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (result: { url: string } | { error: AuthError }): void => {
      if (settled) return
      settled = true
      current = null
      if ('url' in result) resolve(result.url)
      else reject(result.error)
      if (!win.isDestroyed()) win.close()
    }

    // Fin du parcours : Microsoft redirige vers l'adresse de retour avec le code.
    win.webContents.on('will-redirect', (details) => {
      if (isRedirectUrl(details.url)) {
        details.preventDefault()
        finish({ url: details.url })
      }
    })
    win.webContents.on('will-navigate', (details) => {
      if (isRedirectUrl(details.url)) {
        details.preventDefault()
        finish({ url: details.url })
      }
    })
    win.webContents.on('did-navigate', (_event, url) => {
      if (isRedirectUrl(url)) finish({ url })
    })
    win.webContents.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) => {
      // -3 = navigation annulée (c'est nous qui l'arrêtons sur l'adresse de retour).
      if (isMainFrame && errorCode !== -3 && !isRedirectUrl(url)) {
        finish({ error: new AuthError('network', `${errorCode} ${description}`) })
      }
    })
    win.on('closed', () => finish({ error: new AuthError('cancelled') }))
    win.once('ready-to-show', () => win.show())

    win.loadURL(authorizeUrl).catch(() => {
      // Les erreurs de chargement sont déjà traitées par « did-fail-load ».
    })
  })
}
