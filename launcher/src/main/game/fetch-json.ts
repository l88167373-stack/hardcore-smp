import { createHash } from 'node:crypto'
import { GameError } from './errors'
import type { FetchLike } from './download'

/** Télécharge un JSON (avec vérification SHA-1 facultative). Erreur réseau → GameError('network'). */
export async function fetchJson<T>(
  fetchFn: FetchLike,
  url: string,
  userAgent: string,
  expectedSha1?: string
): Promise<{ data: T; text: string }> {
  let response: Response
  try {
    response = await fetchFn(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    throw new GameError('network', `${url} : ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new GameError('network', `${url} : HTTP ${response.status}`)
  const text = await response.text()
  if (expectedSha1 && createHash('sha1').update(text).digest('hex') !== expectedSha1.toLowerCase()) {
    throw new GameError('checksum', `${url} : empreinte SHA-1 différente`)
  }
  try {
    return { data: JSON.parse(text) as T, text }
  } catch {
    throw new GameError('network', `${url} : réponse illisible`)
  }
}

/** Envoie un JSON (POST) et lit la réponse JSON. Erreur réseau → GameError('network'). */
export async function postJson<T>(fetchFn: FetchLike, url: string, userAgent: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'User-Agent': userAgent, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    })
  } catch (error) {
    throw new GameError('network', `${url} : ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new GameError('network', `${url} : HTTP ${response.status}`)
  try {
    return (await response.json()) as T
  } catch {
    throw new GameError('network', `${url} : réponse illisible`)
  }
}
