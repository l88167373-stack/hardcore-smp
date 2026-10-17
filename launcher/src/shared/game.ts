/**
 * Installation et lancement du jeu : types partagés entre le process principal et l'interface,
 * et messages d'erreur en français.
 */
import type { QuarantinedFile } from './mods'

/** Grandes étapes affichées pendant l'installation. */
export type InstallGroupId = 'java' | 'minecraft' | 'fabric' | 'guard' | 'mods'

export interface InstallGroupProgress {
  id: InstallGroupId
  label: string
  detail: string
  totalBytes: number
  doneBytes: number
  state: 'waiting' | 'active' | 'done' | 'skipped'
  /** Raison affichée quand l'étape est ignorée (ex. HSMP Guard pas encore publié). */
  note?: string
}

export interface InstallProgress {
  /** « Vérification des fichiers », « Téléchargement »… */
  step: string
  groups: InstallGroupProgress[]
  totalBytes: number
  doneBytes: number
}

export type GameErrorCode =
  | 'network'
  | 'disk-full'
  | 'permission'
  | 'checksum'
  | 'unsupported-platform'
  | 'java-failed'
  | 'memory'
  | 'game-crashed'
  | 'not-logged-in'
  | 'session-expired'
  | 'rules-not-accepted'
  | 'busy'
  | 'unknown'

export interface GameErrorInfo {
  code: GameErrorCode
  title: string
  message: string
}

const ERRORS: Record<GameErrorCode, Omit<GameErrorInfo, 'code'>> = {
  network: {
    title: 'Téléchargement impossible',
    message: 'Les serveurs de téléchargement ne répondent pas. Vérifie ta connexion Internet puis réessaie.'
  },
  'disk-full': {
    title: 'Disque plein',
    message: 'Il n’y a plus assez de place sur ton disque. Le jeu a besoin d’environ 1,5 Go : libère de l’espace puis réessaie.'
  },
  permission: {
    title: 'Accès refusé au dossier du jeu',
    message:
      'Le launcher ne peut pas écrire dans le dossier du jeu. Un antivirus le bloque peut-être : autorise le launcher, puis réessaie.'
  },
  checksum: {
    title: 'Fichier abîmé',
    message: 'Un fichier téléchargé est corrompu, même après plusieurs essais. Réessaie dans quelques minutes ; si ça continue, préviens le staff.'
  },
  'unsupported-platform': {
    title: 'Système non pris en charge',
    message: 'Mojang ne fournit pas Java 25 pour ton système. Le launcher fonctionne sur Windows, macOS et Linux (64 bits).'
  },
  'java-failed': {
    title: 'Java ne démarre pas',
    message: 'Java n’a pas pu démarrer. Lance « Vérifier et réparer les fichiers » dans Paramètres, puis réessaie.'
  },
  memory: {
    title: 'Pas assez de mémoire',
    message: 'Java n’a pas pu réserver la RAM demandée. Baisse la mémoire allouée dans Paramètres, ferme les programmes inutiles, puis réessaie.'
  },
  'game-crashed': {
    title: 'Le jeu s’est fermé',
    message: 'Minecraft s’est arrêté de façon inattendue. Le rapport de plantage est dans Support : envoie-le au staff si ça recommence.'
  },
  'not-logged-in': {
    title: 'Aucun compte connecté',
    message: 'Connecte ton compte Microsoft dans « Comptes » pour pouvoir jouer.'
  },
  'session-expired': {
    title: 'Connexion expirée',
    message: 'Ta connexion Microsoft a expiré. Reconnecte-toi dans « Comptes » pour pouvoir jouer.'
  },
  'rules-not-accepted': {
    title: 'Règlement à accepter',
    message: 'Le règlement a changé : lis-le et accepte-le avant de jouer.'
  },
  busy: {
    title: 'Déjà en cours',
    message: 'Une installation ou une partie est déjà en cours.'
  },
  unknown: {
    title: 'Erreur inattendue',
    message: 'Quelque chose s’est mal passé. Copie les logs depuis Support et envoie-les au staff sur le Discord.'
  }
}

export function gameError(code: GameErrorCode): GameErrorInfo {
  return { code, ...ERRORS[code] }
}

export type GamePhase = 'idle' | 'installing' | 'launching' | 'running'

export interface GameState {
  phase: GamePhase
  /** Le jeu est entièrement installé et vérifié (rapidement) pour la version actuelle. */
  installed: boolean
  progress: InstallProgress | null
  /** Dernière erreur à afficher (installation, lancement ou plantage). */
  error: GameErrorInfo | null
  /** Fichiers déplacés en quarantaine au dernier lancement, avec la raison. */
  quarantined: QuarantinedFile[]
  /** Fichiers ajoutés à la main, autorisés, et donc gardés au dernier lancement (titres). */
  adopted: string[]
}

export type GameActionResult = { ok: true } | { ok: false; error: GameErrorInfo }

export interface CrashReport {
  fileName: string
  /** Date du plantage (ISO). */
  date: string
  content: string
}
