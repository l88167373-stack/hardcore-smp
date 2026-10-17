import type { GameErrorCode } from '../../shared/game'

/** Erreur d'installation ou de lancement. `detail` (technique) va seulement dans les logs. */
export class GameError extends Error {
  constructor(
    readonly code: GameErrorCode,
    readonly detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'GameError'
  }
}

/** Traduit les erreurs système courantes (disque plein, accès refusé…) en erreur compréhensible. */
export function toGameError(error: unknown): GameError {
  if (error instanceof GameError) return error
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'ENOSPC') return new GameError('disk-full', message)
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return new GameError('permission', message)
  if (code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
    return new GameError('network', message)
  }
  return new GameError('unknown', message)
}
