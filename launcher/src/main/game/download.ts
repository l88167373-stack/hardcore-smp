/**
 * Téléchargements vérifiés : chaque fichier est contrôlé (taille + empreinte SHA-1 ou SHA-512),
 * écrit dans un fichier temporaire puis renommé, et retéléchargé jusqu'à 3 fois en cas d'erreur.
 */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InstallGroupId } from '../../shared/game'
import { GameError, toGameError } from './errors'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface FileItem {
  url: string
  /** Chemin absolu de destination. */
  path: string
  size?: number
  sha1?: string
  sha512?: string
  group: InstallGroupId
  /** Fichier exécutable (Java sous macOS/Linux). */
  executable?: boolean
}

export type VerifyMode = 'size' | 'hash'

export async function hashFile(file: string, algorithm: 'sha1' | 'sha512'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Vrai si le fichier existe et correspond (taille seule pour une vérification rapide, empreinte pour une réparation). */
export async function isFileValid(item: FileItem, mode: VerifyMode): Promise<boolean> {
  const stat = await fs.stat(item.path).catch(() => null)
  if (!stat?.isFile()) return false
  if (item.size !== undefined && stat.size !== item.size) return false
  if (mode === 'size' && item.size !== undefined) return true
  if (item.sha512) return (await hashFile(item.path, 'sha512')) === item.sha512.toLowerCase()
  if (item.sha1) return (await hashFile(item.path, 'sha1')) === item.sha1.toLowerCase()
  return true
}

export interface DownloadOptions {
  fetch: FetchLike
  userAgent: string
  concurrency?: number
  retries?: number
  /** Appelé à chaque morceau reçu (peut être négatif si un essai échoue et repart de zéro). */
  onBytes?: (group: InstallGroupId, delta: number) => void
  signal?: AbortSignal
}

const STALL_TIMEOUT_MS = 60_000

/** Développement uniquement : fichier local (ex. HSMP Guard compilé sur ce PC), copié puis vérifié. */
async function copyLocal(item: FileItem, options: DownloadOptions): Promise<void> {
  await fs.mkdir(path.dirname(item.path), { recursive: true })
  const partial = `${item.path}.part`
  await fs.copyFile(fileURLToPath(item.url), partial)
  const ok = item.sha512 ? (await hashFile(partial, 'sha512')) === item.sha512.toLowerCase() : true
  if (!ok) {
    await fs.rm(partial, { force: true })
    throw new GameError('checksum', `${path.basename(item.path)} : contenu différent de celui attendu`)
  }
  await fs.rename(partial, item.path)
  options.onBytes?.(item.group, item.size ?? 0)
}

async function downloadOnce(item: FileItem, options: DownloadOptions, counted: { bytes: number }): Promise<void> {
  if (item.url.startsWith('file:')) return copyLocal(item, options)
  const response = await options.fetch(item.url, {
    headers: { 'User-Agent': options.userAgent },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(STALL_TIMEOUT_MS * 5)]) : AbortSignal.timeout(STALL_TIMEOUT_MS * 5)
  })
  if (!response.ok || !response.body) throw new GameError('network', `${item.url} : HTTP ${response.status}`)

  await fs.mkdir(path.dirname(item.path), { recursive: true })
  const partial = `${item.path}.part`
  const handle = await fs.open(partial, 'w')
  const sha1 = createHash('sha1')
  const sha512 = item.sha512 ? createHash('sha512') : null
  let size = 0
  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await handle.write(value)
      sha1.update(value)
      sha512?.update(value)
      size += value.byteLength
      counted.bytes += value.byteLength
      options.onBytes?.(item.group, value.byteLength)
    }
  } finally {
    await handle.close()
  }

  const badSize = item.size !== undefined && size !== item.size
  const badHash =
    (item.sha512 && sha512?.digest('hex') !== item.sha512.toLowerCase()) ||
    (!item.sha512 && item.sha1 && sha1.digest('hex') !== item.sha1.toLowerCase())
  if (badSize || badHash) {
    await fs.rm(partial, { force: true })
    throw new GameError('checksum', `${path.basename(item.path)} : contenu différent de celui attendu`)
  }
  await fs.rename(partial, item.path)
  if (item.executable && process.platform !== 'win32') await fs.chmod(item.path, 0o755)
}

export async function downloadFile(item: FileItem, options: DownloadOptions): Promise<void> {
  const retries = options.retries ?? 3
  let lastError: GameError | null = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    const counted = { bytes: 0 }
    try {
      await downloadOnce(item, options, counted)
      return
    } catch (error) {
      // On retire de la progression ce qui avait été compté pour cet essai raté.
      if (counted.bytes > 0) options.onBytes?.(item.group, -counted.bytes)
      lastError = error instanceof GameError ? error : toGameError(error)
      if (lastError.code === 'unknown') lastError = new GameError('network', lastError.detail)
      if (options.signal?.aborted || lastError.code === 'disk-full' || lastError.code === 'permission') break
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
  throw lastError ?? new GameError('network', item.url)
}

/** Télécharge une liste de fichiers en parallèle (12 à la fois par défaut). */
export async function downloadAll(items: FileItem[], options: DownloadOptions): Promise<void> {
  const queue = [...items]
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 12, queue.length))
  let failure: unknown = null
  const worker = async (): Promise<void> => {
    while (queue.length > 0 && failure === null) {
      const item = queue.shift()
      if (!item) return
      try {
        await downloadFile(item, options)
      } catch (error) {
        failure = error
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  if (failure) throw failure
}
