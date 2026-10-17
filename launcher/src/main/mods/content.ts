/**
 * Registre du contenu installé par le launcher (hsmp/content.json) et règles associées :
 * ce qui est réellement présent dans le jeu, qui a besoin de quoi, ce que le serveur autorise.
 *
 * Un projet désactivé n'est pas supprimé : son fichier est rangé dans hsmp/disabled/, hors du jeu.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { GUARD_PROJECT_ID, KIND_FOLDER, type ContentKind, type ProjectAccess, type QuarantinedFile } from '../../shared/mods'
import type { Allowlist, LauncherConfig } from '../../shared/schemas'
import type { GameLayout } from '../game/layout'

export const SAFE_FILE_NAME = /^[a-zA-Z0-9._+\-() ]+$/

/** Fichier de contenu à mettre dans le jeu (utilisé par le plan d'installation). */
export interface ManagedFile {
  projectId: string
  versionId: string
  kind: ContentKind
  fileName: string
  url: string
  sha512: string
  size: number
  /** Obligatoire (Fabric API, HSMP Guard) : jamais retiré. */
  required: boolean
  source: 'modrinth' | 'guard'
}

/** Ce que le service du jeu demande au service des mods. */
export interface ContentProvider {
  /** Contenu à installer : prépare la première installation (obligatoires + recommandés) si besoin. */
  planContent(): Promise<ManagedFile[]>
  /** Avant le lancement : quarantaine des fichiers non autorisés, adoption des fichiers autorisés ajoutés à la main. */
  tidyFolders(expected: ManagedFile[]): Promise<{ quarantined: QuarantinedFile[]; adopted: string[] }>
  /** Une installation de mod est en cours. */
  isBusy(): boolean
}

const storedItemSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['mod', 'resourcepack', 'shader']),
  title: z.string(),
  author: z.string(),
  iconUrl: z.string().nullable(),
  versionId: z.string(),
  versionNumber: z.string(),
  fileName: z.string().regex(SAFE_FILE_NAME),
  url: z.string(),
  sha512: z.string().regex(/^[0-9a-f]{128}$/),
  size: z.number().int().nonnegative(),
  /** Projets dont celui-ci a besoin (dépendances obligatoires sur Modrinth). */
  dependencies: z.array(z.string()),
  /** Choix du joueur. */
  enabled: z.boolean(),
  /** Installé automatiquement comme dépendance (retiré dès que plus rien n'en a besoin). */
  auto: z.boolean()
})
export type StoredItem = z.infer<typeof storedItemSchema>

const contentFileSchema = z.object({
  schema: z.literal(1),
  /** Version de Minecraft pour laquelle les fichiers ont été choisis. */
  minecraftVersion: z.string(),
  items: z.array(storedItemSchema)
})
export type ContentFile = z.infer<typeof contentFileSchema>

export function contentFilePath(layout: GameLayout): string {
  return path.join(layout.hsmp, 'content.json')
}

/** Lit le registre ; null s'il n'existe pas encore (ou s'il est illisible : on repart de zéro). */
export async function loadContent(layout: GameLayout): Promise<ContentFile | null> {
  try {
    return contentFileSchema.parse(JSON.parse(await fs.readFile(contentFilePath(layout), 'utf8')))
  } catch {
    return null
  }
}

/** Écriture atomique : un plantage pendant l'écriture ne laisse jamais un registre à moitié écrit. */
export async function saveContent(layout: GameLayout, content: ContentFile): Promise<void> {
  const file = contentFilePath(layout)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(`${file}.tmp`, JSON.stringify(content, null, 2), 'utf8')
  await fs.rename(`${file}.tmp`, file)
}

/** Emplacement du fichier : dans le jeu s'il est actif, sinon dans hsmp/disabled/. */
export function contentPath(layout: GameLayout, item: Pick<StoredItem, 'kind' | 'fileName'>, active: boolean): string {
  const folder = KIND_FOLDER[item.kind]
  return active ? path.join(layout[folder], item.fileName) : path.join(layout.hsmp, 'disabled', folder, item.fileName)
}

/** Projets obligatoires : `requiredMods` de launcher.json + entrées « required » de l'allowlist. */
export function requiredIds(launcher: LauncherConfig, allowlist: Allowlist): Set<string> {
  const ids = new Set(launcher.requiredMods)
  for (const entry of [...allowlist.mods, ...allowlist.resourcepacks, ...allowlist.shaders]) if (entry.required) ids.add(entry.projectId)
  return ids
}

const ALLOWLIST_KEY: Record<ContentKind, keyof Allowlist> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaders' }

export function allowedIds(allowlist: Allowlist, kind: ContentKind): Set<string> {
  return new Set(allowlist[ALLOWLIST_KEY[kind]].map((e) => e.projectId))
}

/**
 * Projets réellement présents dans le jeu : les obligatoires, ceux que le joueur a activés,
 * et toutes leurs dépendances (même si elles ont été désactivées : un mod ne démarre pas sans elles).
 */
export function activeSet(items: StoredItem[], required: Set<string>): Set<string> {
  const byId = new Map(items.map((i) => [i.projectId, i]))
  const active = new Set<string>()
  const visit = (id: string): void => {
    if (active.has(id)) return
    const item = byId.get(id)
    if (!item) return
    active.add(id)
    for (const dependency of item.dependencies) visit(dependency)
  }
  for (const item of items) if (required.has(item.projectId) || (!item.auto && item.enabled)) visit(item.projectId)
  return active
}

/** Pour chaque projet : les titres des projets actifs qui en ont besoin. */
export function requiredByMap(items: StoredItem[], active: Set<string>): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const item of items) {
    if (!active.has(item.projectId)) continue
    for (const dependency of item.dependencies) map.set(dependency, [...(map.get(dependency) ?? []), item.title])
  }
  return map
}

/** Dépendances installées automatiquement dont plus aucun projet (actif ou non) n'a besoin. */
export function orphanAutos(items: StoredItem[], required: Set<string>): StoredItem[] {
  const byId = new Map(items.map((i) => [i.projectId, i]))
  const keep = new Set<string>()
  const visit = (id: string): void => {
    if (keep.has(id)) return
    const item = byId.get(id)
    if (!item) return
    keep.add(id)
    for (const dependency of item.dependencies) visit(dependency)
  }
  for (const item of items) if (!item.auto || required.has(item.projectId)) visit(item.projectId)
  return items.filter((i) => !keep.has(i.projectId))
}

/** Ce que le serveur pense d'un projet (même règle que le plugin HSMP Gatekeeper). */
export function accessOf(
  projectId: string,
  kind: ContentKind,
  allowlist: Allowlist,
  required: Set<string>,
  items: StoredItem[]
): ProjectAccess {
  if (projectId === GUARD_PROJECT_ID || required.has(projectId)) return 'required'
  if (allowedIds(allowlist, kind).has(projectId)) return 'allowed'
  // Le serveur accepte les dépendances obligatoires des projets autorisés présents.
  if (items.some((i) => i.projectId === projectId && i.auto)) return 'dependency'
  return 'forbidden'
}
