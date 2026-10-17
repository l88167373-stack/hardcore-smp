/**
 * Outils de démonstration et de développement : afficher chaque message d'erreur de connexion Microsoft
 * sans compte réel, rejouer la première ouverture, tester le lancement hors ligne.
 * Le statut du serveur et les mises à jour sont réels depuis la phase 7.
 */
import type { AuthErrorCode } from '@shared/auth-errors'

export const DEMO_MODE = true

export interface DemoFlags {
  /** Erreur renvoyée par la prochaine tentative de connexion Microsoft. */
  loginError: AuthErrorCode | null
}

export const DEFAULT_DEMO: DemoFlags = {
  loginError: null
}
