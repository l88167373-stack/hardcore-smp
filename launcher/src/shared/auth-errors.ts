/**
 * Erreurs de connexion Microsoft / Xbox / Minecraft, traduites en français clair.
 * Partagé entre la chaîne de connexion (process principal) et l'interface.
 */

export type AuthErrorCode =
  | 'no-xbox-account'
  | 'child-account'
  | 'xbox-banned'
  | 'xbox-unavailable-country'
  | 'adult-verification'
  | 'game-not-owned'
  | 'no-profile'
  | 'app-not-approved'
  | 'app-misconfigured'
  | 'not-configured'
  | 'session-expired'
  | 'consent-denied'
  | 'rate-limited'
  | 'login-in-progress'
  | 'network'
  | 'cancelled'
  | 'unknown'

export interface AuthErrorInfo {
  code: AuthErrorCode
  title: string
  message: string
  /** Lien utile pour régler le problème, s'il y en a un. */
  help?: { label: string; url: string }
}

const ERRORS: Record<AuthErrorCode, Omit<AuthErrorInfo, 'code'>> = {
  'no-xbox-account': {
    title: 'Pas de profil Xbox',
    message:
      "Ce compte Microsoft n'a pas encore de profil Xbox. Connecte-toi une fois sur xbox.com pour le créer (c'est gratuit), puis réessaie.",
    help: { label: 'Créer mon profil Xbox', url: 'https://www.xbox.com/live' }
  },
  'child-account': {
    title: 'Compte enfant',
    message:
      "Ce compte est un compte enfant. Un adulte doit l'ajouter à un groupe familial Microsoft et autoriser le jeu en ligne, puis tu pourras réessayer.",
    help: { label: 'Gérer la famille Microsoft', url: 'https://account.microsoft.com/family' }
  },
  'xbox-banned': {
    title: 'Compte Xbox suspendu',
    message: 'Ce compte est suspendu par Xbox. Il ne peut pas se connecter à Minecraft.'
  },
  'xbox-unavailable-country': {
    title: 'Xbox indisponible',
    message: "Xbox Live n'est pas disponible dans le pays de ce compte Microsoft."
  },
  'adult-verification': {
    title: "Vérification d'âge requise",
    message: 'Microsoft demande une vérification de ton âge pour ce compte. Fais-la sur xbox.com puis réessaie.',
    help: { label: 'Ouvrir xbox.com', url: 'https://www.xbox.com' }
  },
  'game-not-owned': {
    title: 'Minecraft Java non acheté',
    message:
      'Ce compte ne possède pas Minecraft : Java Edition. Achète le jeu sur minecraft.net ou connecte-toi avec le compte qui le possède.',
    help: { label: 'Acheter Minecraft', url: 'https://www.minecraft.net' }
  },
  'no-profile': {
    title: 'Pas encore de pseudo',
    message:
      "Ton compte possède le jeu mais n'a pas encore de pseudo Minecraft. Lance une fois le launcher officiel Minecraft pour en choisir un, puis réessaie."
  },
  'app-not-approved': {
    title: 'Connexion pas encore ouverte',
    message:
      "Le launcher attend encore l'autorisation de Mojang pour utiliser la connexion Microsoft. Réessaie plus tard et surveille les annonces sur le Discord."
  },
  'app-misconfigured': {
    title: 'Configuration Microsoft incorrecte',
    message:
      "Microsoft refuse la configuration du launcher (identifiant d'application ou réglages Azure). Préviens le staff sur le Discord : ce n'est pas un problème de ton compte."
  },
  'not-configured': {
    title: 'Connexion pas encore configurée',
    message:
      "Le launcher n'a pas encore son identifiant d'application Microsoft (Client ID Azure). Le staff doit le renseigner avant que la connexion fonctionne."
  },
  'session-expired': {
    title: 'Connexion expirée',
    message: 'Ta connexion Microsoft a expiré ou a été révoquée. Reconnecte-toi pour continuer à jouer.'
  },
  'consent-denied': {
    title: 'Autorisation refusée',
    message:
      "Tu as refusé l'accès au launcher. Il en a besoin pour lancer Minecraft avec ton compte : recommence et clique sur « Accepter »."
  },
  'rate-limited': {
    title: 'Trop de tentatives',
    message: 'Les serveurs Minecraft limitent les connexions. Attends une minute puis réessaie.'
  },
  'login-in-progress': {
    title: 'Connexion déjà en cours',
    message: 'Une fenêtre de connexion Microsoft est déjà ouverte. Termine-la ou ferme-la avant de recommencer.'
  },
  network: {
    title: 'Pas de connexion',
    message: 'Impossible de joindre les serveurs Microsoft. Vérifie ta connexion Internet puis réessaie.'
  },
  cancelled: {
    title: 'Connexion annulée',
    message: 'Tu as fermé la fenêtre de connexion. Clique sur « Se connecter avec Microsoft » pour recommencer.'
  },
  unknown: {
    title: 'Connexion impossible',
    message: "Une erreur inattendue s'est produite. Réessaie ; si ça continue, copie les logs depuis Support et envoie-les au staff."
  }
}

/** Codes « XErr » renvoyés par le service XSTS de Xbox. */
const XERR_TO_CODE: Record<string, AuthErrorCode> = {
  '2148916227': 'xbox-banned',
  '2148916233': 'no-xbox-account',
  '2148916235': 'xbox-unavailable-country',
  '2148916236': 'adult-verification',
  '2148916237': 'adult-verification',
  '2148916238': 'child-account'
}

export function authError(code: AuthErrorCode): AuthErrorInfo {
  return { code, ...ERRORS[code] }
}

/** Traduit un code XErr (nombre ou texte) renvoyé par XSTS. */
export function authErrorFromXErr(xerr: number | string): AuthErrorInfo {
  return authError(XERR_TO_CODE[String(xerr)] ?? 'unknown')
}
