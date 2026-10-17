/**
 * Durcissement d'Electron (voir https://www.electronjs.org/docs/latest/tutorial/security) :
 * CSP stricte, aucune navigation hors de l'application, aucune nouvelle fenêtre,
 * aucune permission (caméra, micro, notifications…), pas de <webview>.
 * Seule exception : la fenêtre de connexion Microsoft (isolée), limitée aux pages Microsoft.
 */
import { app, session, shell, type WebContents } from 'electron'
import { isMicrosoftLoginUrl, loginContents } from './auth/login-policy'
import { isAllowedExternalUrl } from './external-links'

/** Origine de l'interface empaquetée (protocole interne, voir protocol.ts). */
export const APP_ORIGIN = 'app://launcher'

/** Sites dont le launcher peut afficher des images (actus, icônes Modrinth, skins). */
const IMAGE_SOURCES = ['https://cdn.modrinth.com', 'https://raw.githubusercontent.com', 'https://textures.minecraft.net']

export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // Les attributs style="" de React (largeur des barres de progression…) restent autorisés.
  "style-src-attr 'unsafe-inline'",
  `img-src 'self' data: ${IMAGE_SOURCES.join(' ')}`,
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ')

/** En développement, Vite a besoin de scripts inline (rechargement à chaud) et d'un websocket. */
function developmentCsp(devUrl: string): string {
  const origin = new URL(devUrl).origin
  const ws = origin.replace(/^http/, 'ws')
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `img-src 'self' data: ${origin} ${IMAGE_SOURCES.join(' ')}`,
    `font-src 'self' ${origin}`,
    `connect-src 'self' ${origin} ${ws}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'"
  ].join('; ')
}

/** Vrai si l'URL appartient à l'interface du launcher (et pas à une page externe). */
export function isAppUrl(url: string, devUrl: string | undefined): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true
  if (devUrl && !app.isPackaged) {
    try {
      return new URL(url).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return false
}

export function applySessionSecurity(devUrl: string | undefined): void {
  const ses = session.defaultSession

  // Aucune permission web : le launcher n'en a pas besoin.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  if (devUrl && !app.isPackaged) {
    const csp = developmentCsp(devUrl)
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
    })
  }
}

/** Règles appliquées à chaque contenu web créé par l'application. */
export function hardenWebContents(contents: WebContents, devUrl: string | undefined): void {
  // Jamais de nouvelle fenêtre : les liens autorisés s'ouvrent dans le navigateur du joueur.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // L'interface ne quitte jamais l'application ; la fenêtre de connexion reste sur les pages Microsoft.
  const allowed = (url: string): boolean =>
    loginContents.has(contents) ? isMicrosoftLoginUrl(url) : isAppUrl(url, devUrl)

  contents.on('will-navigate', (details) => {
    if (!allowed(details.url)) details.preventDefault()
  })
  contents.on('will-redirect', (details) => {
    if (details.isMainFrame && !allowed(details.url)) details.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}
