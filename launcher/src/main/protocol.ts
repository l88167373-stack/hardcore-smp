/**
 * Protocole interne `app://launcher/…` qui sert l'interface empaquetée.
 * Plus sûr que `file://` : origine dédiée, en-tête CSP sur chaque réponse, aucun accès hors du dossier de l'interface.
 */
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveInside } from './protocol-path'
import { PRODUCTION_CSP } from './security'

export const APP_SCHEME = 'app'

/** À appeler AVANT que l'application soit prête. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

export function handleAppScheme(rendererDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const file = url.host === 'launcher' ? resolveInside(rendererDir, url.pathname) : null
    if (!file) return new Response('Introuvable', { status: 404 })

    const upstream = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(upstream.headers)
    headers.set('Content-Security-Policy', PRODUCTION_CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(upstream.body, { status: upstream.status, headers })
  })
}
