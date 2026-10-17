/**
 * Catalogue Modrinth et contenu installé (mods, packs de ressources, shaders) :
 * types partagés entre le process principal et l'interface.
 */

export type ContentKind = 'mod' | 'resourcepack' | 'shader'

export const CONTENT_KINDS: ContentKind[] = ['mod', 'resourcepack', 'shader']

/** Dossier du jeu de chaque type de contenu. */
export const KIND_FOLDER: Record<ContentKind, 'mods' | 'resourcepacks' | 'shaderpacks'> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks'
}

export const KIND_LABEL: Record<ContentKind, string> = {
  mod: 'Mod',
  resourcepack: 'Pack de ressources',
  shader: 'Shader'
}

export type CatalogSort = 'relevance' | 'downloads'

/**
 * Ce que le serveur autorise pour un projet :
 * - required : toujours installé (Fabric API, HSMP Guard) ;
 * - allowed : dans la liste autorisée (config/allowlist.json) ;
 * - dependency : pas dans la liste, mais accepté comme dépendance obligatoire d'un projet installé ;
 * - forbidden : refusé par le serveur.
 */
export type ProjectAccess = 'required' | 'allowed' | 'dependency' | 'forbidden'

export interface CatalogProject {
  projectId: string
  slug: string
  kind: ContentKind
  title: string
  author: string
  summary: string
  downloads: number
  iconUrl: string | null
  access: ProjectAccess
}

export interface CatalogPage {
  hits: CatalogProject[]
  total: number
  offset: number
}

export interface CatalogQuery {
  kind: ContentKind
  query: string
  sort: CatalogSort
  offset: number
  /** Ne montrer que les projets autorisés par le serveur. */
  onlyAllowed: boolean
}

export interface ProjectDetails {
  projectId: string
  /** Description complète (Markdown de Modrinth, affiché sans HTML). */
  body: string
  gallery: { url: string; title: string | null }[]
}

export interface InstalledContent {
  projectId: string
  kind: ContentKind
  title: string
  author: string
  iconUrl: string | null
  versionNumber: string
  fileName: string
  /** Choix du joueur (activé / désactivé). */
  enabled: boolean
  /** Réellement présent dans le jeu (un mod désactivé désactive aussi ses dépendances). */
  active: boolean
  /** Fabric API, HSMP Guard : impossible à retirer ou désactiver. */
  required: boolean
  /** Installé automatiquement comme dépendance d'un autre projet. */
  auto: boolean
  /** Titres des projets installés qui en ont besoin. */
  requiredBy: string[]
  /** Nouvelle version disponible (après une vérification des mises à jour). */
  update: { versionNumber: string } | null
}

export type ContentOperation = 'install' | 'update' | 'remove' | 'toggle' | 'check'

/** Clé de `ModsState.busy` pour les opérations qui touchent tout le contenu (vérifier / tout mettre à jour). */
export const ALL_CONTENT = '*'

export interface ModsState {
  items: InstalledContent[]
  /** Opérations en cours, par projet. */
  busy: Record<string, ContentOperation>
  /** Date (ISO) de la dernière vérification des mises à jour. */
  updatesCheckedAt: string | null
  /** Nombre de fichiers dans le dossier quarantaine. */
  quarantineCount: number
}

export type ModsActionResult = { ok: true; message?: string } | { ok: false; error: string }

/** Fichier mis de côté avant un lancement, avec la raison affichée au joueur. */
export interface QuarantinedFile {
  /** Ex. « mods/freecam.jar ». */
  file: string
  reason: string
}

/** Le mod du serveur, toujours installé (il n'est pas sur Modrinth). */
export const GUARD_PROJECT_ID = 'hsmp-guard'
