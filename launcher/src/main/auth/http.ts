/**
 * Requêtes HTTP de la connexion.
 *
 * On utilise le `fetch` de Node.js (et pas celui de Chromium) : il n'ajoute pas d'en-tête `Origin`,
 * que Microsoft refuse pour une application de bureau lors de l'échange du code.
 * La fonction est injectable pour tester toute la chaîne avec des réponses simulées.
 */
import { AuthError } from './errors'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface HttpResponse {
  status: number
  /** Corps JSON si la réponse en contient, sinon null. */
  json: unknown
  text: string
}

export interface Http {
  request(url: string, init?: RequestInit): Promise<HttpResponse>
}

const DEFAULT_TIMEOUT_MS = 20_000

export function createHttp(fetchFn: FetchLike, userAgent: string, timeoutMs = DEFAULT_TIMEOUT_MS): Http {
  return {
    async request(url, init = {}) {
      let response: Response
      try {
        response = await fetchFn(url, {
          ...init,
          headers: { 'User-Agent': userAgent, Accept: 'application/json', ...(init.headers ?? {}) },
          signal: AbortSignal.timeout(timeoutMs)
        })
      } catch (error) {
        // DNS, pas d'Internet, pare-feu, délai dépassé…
        throw new AuthError('network', `${new URL(url).host} : ${error instanceof Error ? error.message : String(error)}`)
      }
      const text = await response.text()
      let json: unknown = null
      if (text.length > 0) {
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
      }
      if (response.status === 429) throw new AuthError('rate-limited', new URL(url).host)
      return { status: response.status, json, text }
    }
  }
}

/** Lecture sûre d'une propriété dans un JSON inconnu. */
export function field(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

export function stringField(value: unknown, ...path: (string | number)[]): string | undefined {
  const result = field(value, ...path)
  return typeof result === 'string' ? result : undefined
}
