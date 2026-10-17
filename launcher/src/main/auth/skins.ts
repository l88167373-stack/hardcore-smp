/**
 * Cache local des skins (pour afficher la tête du joueur, même hors ligne).
 * Seules les textures officielles de Mojang sont téléchargées.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FetchLike } from './http'

const MAX_SKIN_BYTES = 256 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function isOfficialSkinUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    // Mojang renvoie parfois l'adresse en http:// ; on la force en https.
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname === 'textures.minecraft.net'
  } catch {
    return false
  }
}

export interface SkinCache {
  /** Télécharge et enregistre la skin. Ne lève jamais d'erreur (la skin est un bonus). */
  update(uuid: string, url: string | null): Promise<void>
  /** Skin en data URL PNG, ou null. */
  read(uuid: string): Promise<string | null>
  remove(uuid: string): Promise<void>
}

const safeName = (uuid: string): string => `${uuid.replace(/[^a-f0-9-]/gi, '')}.png`

export function fileSkinCache(dir: string, fetchFn: FetchLike): SkinCache {
  return {
    async update(uuid, raw) {
      try {
        if (!raw || !isOfficialSkinUrl(raw)) return
        const url = raw.replace(/^http:/, 'https:')
        const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) })
        if (!response.ok) return
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length > MAX_SKIN_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, safeName(uuid)), bytes)
      } catch {
        // Pas de skin : la tête par défaut sera affichée.
      }
    },
    async read(uuid) {
      try {
        const bytes = await fs.readFile(path.join(dir, safeName(uuid)))
        return `data:image/png;base64,${bytes.toString('base64')}`
      } catch {
        return null
      }
    },
    async remove(uuid) {
      await fs.rm(path.join(dir, safeName(uuid)), { force: true })
    }
  }
}
