import type { AuthErrorCode } from '../../shared/auth-errors'

/**
 * Erreur de la chaîne de connexion. `code` est traduit en français pour l'interface ;
 * `detail` (technique, sans jeton) va seulement dans les logs.
 */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'AuthError'
  }
}

export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error
  return new AuthError('unknown', error instanceof Error ? error.message : String(error))
}
