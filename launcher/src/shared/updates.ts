/** État des mises à jour du launcher, partagé entre le process principal et l'interface. */

export type UpdateStatus =
  /** Désactivées (développement, ou dépôt GitHub pas encore renseigné). */
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  /** Nouvelle version à télécharger à la main (macOS : sans certificat Apple, pas d'installation automatique). */
  | 'available'
  /** Une nouvelle version se télécharge en arrière-plan. */
  | 'downloading'
  /** Téléchargée : elle s'installera au prochain redémarrage (ou tout de suite si le joueur le demande). */
  | 'ready'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Version disponible (ex. 0.2.0). */
  version: string | null
  /** Avancement du téléchargement, de 0 à 1. */
  progress: number | null
  /** Message clair en cas de problème. */
  error: string | null
}
