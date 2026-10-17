/** Statut du serveur Minecraft (Server List Ping), partagé entre le process principal et l'interface. */
import type { MotdSegment } from './motd'

export interface ServerStatus {
  online: boolean
  players: number
  maxPlayers: number
  /** Temps de réponse en millisecondes. */
  pingMs: number
  /** Ex. « Paper 26.2 ». */
  version: string
  motd: MotdSegment[]
  /** Icône du serveur (PNG 64×64 en data URL), ou null. */
  favicon: string | null
  /** Date (ISO) de la vérification. */
  checkedAt: string
}

/** Rafraîchi toutes les 30 secondes. */
export const SERVER_STATUS_REFRESH_MS = 30_000
