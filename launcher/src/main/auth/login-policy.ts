/**
 * Règles de navigation de la fenêtre de connexion Microsoft :
 * elle ne peut afficher que des pages Microsoft / Xbox, rien d'autre.
 */
import type { WebContents } from 'electron'
import { isRedirectUrl } from './oauth'

const MICROSOFT_DOMAINS = [
  'live.com',
  'microsoft.com',
  'microsoftonline.com',
  'microsoftonline-p.com',
  'xbox.com',
  'xboxlive.com',
  'msauth.net',
  'msftauth.net',
  'live.net'
]

/** Contenus web des fenêtres de connexion (la seule exception à « jamais de page distante »). */
export const loginContents = new WeakSet<WebContents>()

export function isMicrosoftLoginUrl(raw: string): boolean {
  if (isRedirectUrl(raw)) return true
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return MICROSOFT_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** User-Agent sans « Electron » ni nom d'application : certaines pages Microsoft refusent les navigateurs intégrés inconnus. */
export function cleanUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s?Electron\/\S+/g, '')
    .replace(/\s?hardcore-smp-launcher\/\S+/gi, '')
    .replace(/\s?HARDCORE SMP\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
