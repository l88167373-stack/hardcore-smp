/**
 * Service des mods, packs de ressources et shaders :
 * catalogue Modrinth (filtré sur la version du serveur), installation avec dépendances et vérification SHA-512,
 * mises à jour, désinstallation, activation / désactivation, et quarantaine avant chaque lancement.
 *
 * Toutes les modifications passent par une file d'attente : jamais deux opérations en même temps sur le registre.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gameError } from '../../shared/game'
import {
  ALL_CONTENT,
  CONTENT_KINDS,
  type CatalogPage,
  type CatalogProject,
  type CatalogQuery,
  type ContentKind,
  type ContentOperation,
  type ModsActionResult,
  type ModsState,
  type ProjectDetails,
  type QuarantinedFile
} from '../../shared/mods'
import type { Allowlist } from '../../shared/schemas'
import { downloadFile, isFileValid, type FetchLike } from '../game/download'
import { GameError, toGameError } from '../game/errors'
import type { GameLayout } from '../game/layout'
import {
  KIND_LOADER,
  MODRINTH_CDN_HOST,
  ModrinthClient,
  httpsHost,
  kindOfProjectType,
  toModrinthFile,
  type ApiSearchHit,
  type ApiVersion,
  type ModrinthFile
} from '../game/modrinth'
import type { Logger } from '../log'
import type { MainPublicConfig } from '../public-config'
import {
  SAFE_FILE_NAME,
  accessOf,
  activeSet,
  allowedIds,
  contentPath,
  loadContent,
  orphanAutos,
  requiredByMap,
  requiredIds,
  saveContent,
  type ContentFile,
  type ContentProvider,
  type ManagedFile,
  type StoredItem
} from './content'
import { countQuarantined, findUnexpected, moveToQuarantine, type FolderEntry } from './quarantine'

/** Iris : nécessaire pour utiliser des shaders. */
export const IRIS_PROJECT_ID = 'YL57xq9U'

const PAGE_SIZE = 20
const CACHE_MS = 5 * 60_000

export interface ModsServiceDeps {
  layout: GameLayout
  config: () => MainPublicConfig
  fetch: FetchLike
  userAgent: string
  log: Logger
  /** Le jeu s'installe ou tourne : on ne touche pas à ses fichiers. */
  isGameBusy: () => boolean
}

/** Erreur dont le message est destiné tel quel au joueur. */
class ModsError extends Error {}

const ALLOWLIST_KEY: Record<ContentKind, keyof Allowlist> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaders' }

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`
}

async function exists(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

/** Message clair pour une erreur technique (réseau, disque…). */
function friendly(error: unknown): string {
  if (error instanceof ModsError) return error.message
  const failure = error instanceof GameError ? error : toGameError(error)
  if (failure.code === 'network') return 'Modrinth ne répond pas. Vérifie ta connexion Internet puis réessaie.'
  const missing = /n'existe pas pour Minecraft (\S+)/.exec(failure.detail ?? '')
  if (missing) return `Ce projet (ou une de ses dépendances) n’a pas encore de version pour Minecraft ${missing[1] ?? ''}.`
  if (failure.code === 'unknown') return `Opération impossible : ${failure.detail ?? failure.message}`
  return gameError(failure.code).message
}

export class ModsService implements ContentProvider {
  private readonly client: ModrinthClient
  /** undefined = pas encore lu ; null = aucun contenu installé. */
  private content: ContentFile | null | undefined
  private readonly busy = new Map<string, ContentOperation>()
  private readonly updates = new Map<string, ModrinthFile>()
  private updatesCheckedAt: string | null = null
  private readonly listeners = new Set<(state: ModsState) => void>()
  private readonly cache = new Map<string, { at: number; value: unknown }>()
  private queue: Promise<unknown> = Promise.resolve()
  private running = 0

  constructor(private readonly deps: ModsServiceDeps) {
    this.client = new ModrinthClient(deps.fetch, deps.userAgent)
  }

  isBusy(): boolean {
    return this.running > 0
  }

  onChange(listener: (state: ModsState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async getState(): Promise<ModsState> {
    const { launcher, allowlist } = this.deps.config()
    const required = requiredIds(launcher, allowlist)
    const items = (await this.load())?.items ?? []
    const active = activeSet(items, required)
    const requiredBy = requiredByMap(items, active)
    return {
      items: items.map((item) => {
        const update = this.updates.get(item.projectId)
        return {
          projectId: item.projectId,
          kind: item.kind,
          title: item.title,
          author: item.author,
          iconUrl: item.iconUrl,
          versionNumber: item.versionNumber,
          fileName: item.fileName,
          enabled: item.enabled,
          active: active.has(item.projectId),
          required: required.has(item.projectId),
          auto: item.auto,
          requiredBy: requiredBy.get(item.projectId) ?? [],
          update: update ? { versionNumber: update.versionNumber } : null
        }
      }),
      busy: Object.fromEntries(this.busy),
      updatesCheckedAt: this.updatesCheckedAt,
      quarantineCount: await countQuarantined(this.deps.layout)
    }
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) return
    const state = await this.getState()
    for (const listener of this.listeners) listener(state)
  }

  /** Une seule opération à la fois sur le registre et les fichiers. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      this.running++
      try {
        return await task()
      } finally {
        this.running--
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<ContentFile | null> {
    if (this.content === undefined) this.content = await loadContent(this.deps.layout)
    return this.content
  }

  private async save(content: ContentFile): Promise<void> {
    await saveContent(this.deps.layout, content)
    this.content = content
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value as T)
    return load().then((value) => {
      this.cache.set(key, { at: Date.now(), value })
      return value
    })
  }

  // --- Catalogue ------------------------------------------------------------------

  private toCatalog(hit: ApiSearchHit, fallbackKind: ContentKind, items: StoredItem[]): CatalogProject {
    const { launcher, allowlist } = this.deps.config()
    const kind = kindOfProjectType(hit.project_type) ?? fallbackKind
    return {
      projectId: hit.project_id,
      slug: hit.slug,
      kind,
      title: hit.title,
      author: hit.author,
      summary: hit.description,
      downloads: hit.downloads,
      iconUrl: hit.icon_url,
      access: accessOf(hit.project_id, kind, allowlist, requiredIds(launcher, allowlist), items)
    }
  }

  /** Recherche Modrinth filtrée sur la version de Minecraft du serveur (+ Fabric pour les mods, Iris pour les shaders). */
  async search(query: CatalogQuery): Promise<CatalogPage> {
    const { launcher, allowlist } = this.deps.config()
    const projectIds = query.onlyAllowed ? [...allowedIds(allowlist, query.kind)] : undefined
    const result = await this.cached(`search:${JSON.stringify(query)}`, () =>
      this.client.search({ ...query, limit: PAGE_SIZE, minecraftVersion: launcher.minecraftVersion, ...(projectIds ? { projectIds } : {}) })
    )
    const items = (await this.load())?.items ?? []
    return { hits: result.hits.map((hit) => this.toCatalog(hit, query.kind, items)), total: result.total, offset: query.offset }
  }

  /** Onglet « Recommandés » : les projets obligatoires et recommandés de l'allowlist, dans son ordre. */
  async recommended(): Promise<CatalogProject[]> {
    const { launcher, allowlist } = this.deps.config()
    const required = requiredIds(launcher, allowlist)
    const order: { projectId: string; kind: ContentKind }[] = []
    for (const kind of CONTENT_KINDS) {
      for (const entry of allowlist[ALLOWLIST_KEY[kind]]) {
        if (entry.recommended || required.has(entry.projectId)) order.push({ projectId: entry.projectId, kind })
      }
    }
    const hits = await this.cached(`recommended:${order.map((o) => o.projectId).join(',')}`, () =>
      this.client.searchByIds(order.map((o) => o.projectId))
    )
    const items = (await this.load())?.items ?? []
    const byId = new Map(hits.map((h) => [h.project_id, h]))
    const projects = order.flatMap((o) => {
      const hit = byId.get(o.projectId)
      return hit ? [this.toCatalog(hit, o.kind, items)] : []
    })
    return [...projects.filter((p) => p.access === 'required'), ...projects.filter((p) => p.access !== 'required')]
  }

  /** Fiche complète : description et galerie (images du CDN de Modrinth uniquement). */
  async details(projectId: string): Promise<ProjectDetails> {
    const project = await this.cached(`project:${projectId}`, () => this.client.project(projectId))
    const gallery = [...(project.gallery ?? [])]
      .sort((a, b) => Number(b.featured) - Number(a.featured))
      .filter((image) => httpsHost(image.url) === MODRINTH_CDN_HOST)
      .slice(0, 8)
      .map((image) => ({ url: image.url, title: image.title }))
    return { projectId: project.id, body: (project.body ?? project.description).slice(0, 20_000), gallery }
  }

  // --- Actions du joueur ------------------------------------------------------------

  install(projectId: string, kind: ContentKind): Promise<ModsActionResult> {
    return this.action(projectId, 'install', () => this.doInstall(projectId, kind))
  }

  uninstall(projectId: string): Promise<ModsActionResult> {
    return this.action(projectId, 'remove', () => this.doUninstall(projectId))
  }

  setEnabled(projectId: string, enabled: boolean): Promise<ModsActionResult> {
    return this.action(projectId, 'toggle', () => this.doSetEnabled(projectId, enabled))
  }

  checkUpdates(): Promise<ModsActionResult> {
    return this.action(ALL_CONTENT, 'check', () => this.doCheckUpdates(), false)
  }

  /** Met à jour un projet, ou tous ceux qui ont une mise à jour (`projectId` null). */
  update(projectId: string | null): Promise<ModsActionResult> {
    return this.action(projectId ?? ALL_CONTENT, 'update', () => this.doUpdate(projectId))
  }

  private async action(key: string, operation: ContentOperation, task: () => Promise<string>, touchesFiles = true): Promise<ModsActionResult> {
    if (touchesFiles && this.deps.isGameBusy()) {
      return { ok: false, error: 'Ferme le jeu (ou attends la fin de l’installation) avant de modifier tes mods.' }
    }
    if (this.busy.has(key)) return { ok: false, error: 'Une opération est déjà en cours pour ce projet.' }
    this.busy.set(key, operation)
    void this.emit()
    try {
      const message = await this.exclusive(task)
      this.deps.log.info(`Mods : ${message}`)
      return { ok: true, message }
    } catch (error) {
      const message = friendly(error)
      this.deps.log.warn(`Mods (${operation} ${key}) : ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, error: message }
    } finally {
      this.busy.delete(key)
      void this.emit()
    }
  }

  private async doInstall(projectId: string, kind: ContentKind): Promise<string> {
    const { launcher, allowlist } = this.deps.config()
    const required = requiredIds(launcher, allowlist)
    const content = await this.ensureReady()
    if (accessOf(projectId, kind, allowlist, required, content.items) === 'forbidden') {
      throw new ModsError('Ce projet n’est pas autorisé sur le serveur. Propose-le au staff sur le Discord.')
    }

    const existing = content.items.find((i) => i.projectId === projectId)
    if (existing) {
      if (!existing.auto && existing.enabled) return `${existing.title} est déjà installé.`
      const next = this.withItems(content, (items) => items.map((i) => (i === existing ? { ...i, auto: false, enabled: true } : i)))
      await this.applyFiles(next)
      await this.save(next)
      return `${existing.title} est installé et activé.`
    }

    const roots: { projectId: string; kind: ContentKind }[] = [{ projectId, kind }]
    let note = ''
    let items = content.items
    if (kind === 'shader') {
      // Les shaders ne fonctionnent qu'avec Iris (qui n'est pas une « dépendance » déclarée sur Modrinth).
      const iris = items.find((i) => i.projectId === IRIS_PROJECT_ID)
      if (!iris) {
        if (accessOf(IRIS_PROJECT_ID, 'mod', allowlist, required, items) === 'forbidden') {
          throw new ModsError('Les shaders ont besoin du mod Iris, qui n’est pas autorisé sur le serveur.')
        }
        roots.push({ projectId: IRIS_PROJECT_ID, kind: 'mod' })
        note = ' Iris a aussi été installé : il est nécessaire pour les shaders.'
      } else if (iris.auto || !iris.enabled) {
        items = items.map((i) => (i === iris ? { ...i, auto: false, enabled: true } : i))
        note = ' Iris a été activé : il est nécessaire pour les shaders.'
      }
    }

    const have = new Set(items.map((i) => i.projectId))
    const files = await this.client.resolveWithDependencies(roots, launcher.minecraftVersion, have)
    const clash = files.flatMap((f) => f.incompatible).filter((id) => have.has(id))
    if (clash.length > 0) {
      const titles = items.filter((i) => clash.includes(i.projectId)).map((i) => i.title)
      throw new ModsError(`Incompatible avec ${titles.join(', ')} : désinstalle-le d’abord.`)
    }
    const added = await this.toItems(files, new Set(roots.map((r) => r.projectId)))
    const next: ContentFile = { ...content, items: [...items, ...added] }
    try {
      await this.applyFiles(next)
    } catch (error) {
      for (const item of added) await fs.rm(contentPath(this.deps.layout, item, true), { force: true }).catch(() => undefined)
      throw error
    }
    await this.save(next)
    this.cache.clear()
    const title = added.find((i) => i.projectId === projectId)?.title ?? projectId
    const dependencies = added.length - roots.length
    return `${title} installé${dependencies > 0 ? ` (avec ${plural(dependencies, 'dépendance')})` : ''}.${note}`
  }

  private async doUninstall(projectId: string): Promise<string> {
    const { launcher, allowlist } = this.deps.config()
    const required = requiredIds(launcher, allowlist)
    const content = await this.ensureReady()
    const item = content.items.find((i) => i.projectId === projectId)
    if (!item) throw new ModsError('Ce projet n’est pas installé.')
    if (required.has(projectId)) throw new ModsError(`${item.title} est obligatoire pour jouer sur le serveur.`)
    const dependents = content.items.filter((i) => i.projectId !== projectId && i.dependencies.includes(projectId))
    if (item.auto) {
      throw new ModsError(`${item.title} est nécessaire à ${dependents.map((d) => d.title).join(', ')} : il partira avec eux.`)
    }
    if (dependents.length > 0) {
      const next = this.withItems(content, (items) => items.map((i) => (i === item ? { ...i, auto: true } : i)))
      await this.applyFiles(next)
      await this.save(next)
      return `${item.title} reste installé : ${dependents.map((d) => d.title).join(', ')} en a besoin.`
    }

    let items = content.items.filter((i) => i !== item)
    const orphans = orphanAutos(items, required)
    items = items.filter((i) => !orphans.includes(i))
    for (const removed of [item, ...orphans]) {
      await fs.rm(contentPath(this.deps.layout, removed, true), { force: true })
      await fs.rm(contentPath(this.deps.layout, removed, false), { force: true })
      this.updates.delete(removed.projectId)
    }
    const next = { ...content, items }
    await this.applyFiles(next)
    await this.save(next)
    this.cache.clear()
    return `${item.title} désinstallé${orphans.length > 0 ? ` (et ${plural(orphans.length, 'dépendance')} devenue${orphans.length > 1 ? 's' : ''} inutile${orphans.length > 1 ? 's' : ''})` : ''}.`
  }

  private async doSetEnabled(projectId: string, enabled: boolean): Promise<string> {
    const { launcher, allowlist } = this.deps.config()
    const required = requiredIds(launcher, allowlist)
    const content = await this.ensureReady()
    const item = content.items.find((i) => i.projectId === projectId)
    if (!item) throw new ModsError('Ce projet n’est pas installé.')
    if (required.has(projectId)) throw new ModsError(`${item.title} est obligatoire : il ne peut pas être désactivé.`)
    if (item.auto) throw new ModsError(`${item.title} est activé automatiquement quand un mod en a besoin.`)
    if (!enabled) {
      const active = activeSet(content.items, required)
      const dependents = content.items.filter((i) => i !== item && active.has(i.projectId) && i.dependencies.includes(projectId))
      if (dependents.length > 0) {
        const names = dependents.map((d) => d.title).join(', ')
        throw new ModsError(`${names} a besoin de ${item.title} : désactive d’abord ${names}.`)
      }
    }
    const next = this.withItems(content, (items) => items.map((i) => (i === item ? { ...i, enabled } : i)))
    await this.applyFiles(next)
    await this.save(next)
    return `${item.title} ${enabled ? 'activé' : 'désactivé'}.`
  }

  private async doCheckUpdates(): Promise<string> {
    const { launcher } = this.deps.config()
    const content = await this.load()
    if (!content || content.items.length === 0) return 'Rien à vérifier : aucun mod installé.'
    this.updates.clear()
    for (const kind of CONTENT_KINDS) {
      const items = content.items.filter((i) => i.kind === kind)
      if (items.length === 0) continue
      const latest = await this.client.latestForHashes(
        items.map((i) => i.sha512),
        kind,
        launcher.minecraftVersion
      )
      for (const item of items) {
        const version = latest[item.sha512]
        if (!version || version.id === item.versionId || version.project_id !== item.projectId) continue
        try {
          this.updates.set(item.projectId, toModrinthFile(version, kind))
        } catch (error) {
          this.deps.log.warn(`Mise à jour ignorée pour ${item.title} : ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    this.updatesCheckedAt = new Date().toISOString()
    const count = this.updates.size
    return count === 0 ? 'Tout est à jour.' : `${plural(count, 'mise')} à jour disponible${count > 1 ? 's' : ''}.`
  }

  private async doUpdate(projectId: string | null): Promise<string> {
    const { launcher, allowlist } = this.deps.config()
    const required = requiredIds(launcher, allowlist)
    const content = await this.ensureReady()
    const targets = projectId ? [projectId] : [...this.updates.keys()]
    if (targets.length === 0) return 'Tout est à jour.'
    let items = content.items
    const done: string[] = []
    for (const id of targets) {
      const file = this.updates.get(id)
      const item = items.find((i) => i.projectId === id)
      if (!file || !item) continue
      const updated: StoredItem = {
        ...item,
        versionId: file.versionId,
        versionNumber: file.versionNumber,
        fileName: file.fileName,
        url: file.url,
        sha512: file.sha512,
        size: file.size,
        dependencies: file.dependencies
      }
      const isActive = activeSet(items, required).has(id)
      await downloadFile(
        { url: updated.url, path: contentPath(this.deps.layout, updated, isActive), sha512: updated.sha512, size: updated.size, group: 'mods' },
        { fetch: this.deps.fetch, userAgent: this.deps.userAgent }
      )
      if (item.fileName !== updated.fileName) await fs.rm(contentPath(this.deps.layout, item, isActive), { force: true })
      // Nouvelles dépendances de la nouvelle version.
      const have = new Set(items.map((i) => i.projectId))
      const missing = updated.dependencies.filter((d) => !have.has(d)).map((d) => ({ projectId: d, kind: null }))
      const dependencies = missing.length > 0 ? await this.toItems(await this.client.resolveWithDependencies(missing, launcher.minecraftVersion, have), new Set()) : []
      items = [...items.map((i) => (i === item ? updated : i)), ...dependencies]
      this.updates.delete(id)
      done.push(`${updated.title} ${updated.versionNumber}`)
    }
    const orphans = orphanAutos(items, required)
    for (const removed of orphans) {
      await fs.rm(contentPath(this.deps.layout, removed, true), { force: true })
      await fs.rm(contentPath(this.deps.layout, removed, false), { force: true })
    }
    const next = { ...content, items: items.filter((i) => !orphans.includes(i)) }
    await this.applyFiles(next)
    await this.save(next)
    return done.length === 1 ? `${done[0] ?? ''} installé.` : `${plural(done.length, 'projet')} mis à jour.`
  }

  // --- Pour le service du jeu ---------------------------------------------------------

  /** Contenu actif à installer dans le jeu (prépare la première installation si besoin). */
  planContent(): Promise<ManagedFile[]> {
    return this.exclusive(async () => {
      const { launcher, allowlist } = this.deps.config()
      const required = requiredIds(launcher, allowlist)
      const content = await this.ensureReady()
      await this.placeFiles(content)
      const active = activeSet(content.items, required)
      void this.emit()
      return content.items
        .filter((i) => active.has(i.projectId))
        .map((i) => ({
          projectId: i.projectId,
          versionId: i.versionId,
          kind: i.kind,
          fileName: i.fileName,
          url: i.url,
          sha512: i.sha512,
          size: i.size,
          required: required.has(i.projectId),
          source: 'modrinth' as const
        }))
    })
  }

  /**
   * Avant le lancement : tout fichier des dossiers du jeu qui n'est pas attendu est identifié sur Modrinth.
   * Projet autorisé et compatible → adopté (il apparaît dans l'onglet Mods). Sinon → quarantaine, avec la raison.
   */
  tidyFolders(expected: ManagedFile[]): Promise<{ quarantined: QuarantinedFile[]; adopted: string[] }> {
    return this.exclusive(async () => {
      const { launcher, allowlist } = this.deps.config()
      const mc = launcher.minecraftVersion
      const required = requiredIds(launcher, allowlist)
      const unexpected = await findUnexpected(this.deps.layout, expected)
      if (unexpected.length === 0) return { quarantined: [], adopted: [] }

      const rejected: { entry: FolderEntry; reason: string }[] = []
      const unknown: FolderEntry[] = []
      for (const entry of unexpected) {
        if (entry.directory) rejected.push({ entry, reason: 'dossier : seuls les fichiers installés depuis le launcher sont acceptés' })
        else if (entry.modified) rejected.push({ entry, reason: 'fichier modifié : le launcher retélécharge l’original' })
        else unknown.push(entry)
      }

      let identified: Record<string, ApiVersion> = {}
      let offline = false
      try {
        identified = await this.client.identify(unknown.map((e) => e.sha512 ?? ''))
      } catch {
        offline = true
      }
      const titles = new Map<string, string>()
      const projectIds = [...new Set(Object.values(identified).map((v) => v.project_id))]
      try {
        for (const project of await this.client.projects(projectIds)) titles.set(project.id, project.title)
      } catch {
        // Les titres ne sont qu'un confort d'affichage.
      }

      let content = (await this.load()) ?? { schema: 1 as const, minecraftVersion: mc, items: [] }
      const adopted: { entry: FolderEntry; item: StoredItem }[] = []
      for (const entry of unknown) {
        const version = identified[entry.sha512 ?? '']
        if (!version) {
          rejected.push({
            entry,
            reason: offline
              ? 'impossible à vérifier pour l’instant (Modrinth ne répond pas)'
              : 'inconnu de Modrinth (fichier modifié, ou projet absent de Modrinth)'
          })
          continue
        }
        const title = titles.get(version.project_id) ?? version.project_id
        const access = accessOf(version.project_id, entry.kind, allowlist, required, content.items)
        const compatible = (version.game_versions ?? []).includes(mc) && (version.loaders ?? []).includes(KIND_LOADER[entry.kind])
        const file = version.files.find((f) => f.hashes.sha512.toLowerCase() === entry.sha512)
        let reason: string | null = null
        if (content.items.some((i) => i.projectId === version.project_id) || adopted.some((a) => a.item.projectId === version.project_id)) {
          reason = `« ${title} » est déjà installé par le launcher (autre version)`
        } else if (access !== 'allowed' && access !== 'required') {
          reason = `« ${title} » n’est pas autorisé sur le serveur`
        } else if (!compatible) {
          reason = `cette version de « ${title} » n’est pas faite pour Minecraft ${mc} : installe-le depuis l’onglet Mods`
        } else if (!SAFE_FILE_NAME.test(entry.name) || !file) {
          reason = `nom de fichier non pris en charge : installe « ${title} » depuis l’onglet Mods`
        }
        if (reason) {
          rejected.push({ entry, reason })
          continue
        }
        const stat = await fs.stat(entry.full)
        adopted.push({
          entry,
          item: {
            projectId: version.project_id,
            kind: entry.kind,
            title,
            author: '',
            iconUrl: null,
            versionId: version.id,
            versionNumber: version.version_number,
            fileName: entry.name,
            url: file?.url ?? '',
            sha512: entry.sha512 ?? '',
            size: stat.size,
            dependencies: version.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id ?? ''),
            enabled: true,
            auto: false
          }
        })
      }

      // Les fichiers adoptés peuvent avoir besoin de dépendances : elles sont ajoutées au registre
      // (le service du jeu les télécharge juste après).
      if (adopted.length > 0) {
        try {
          const items = [...content.items, ...adopted.map((a) => a.item)]
          const have = new Set(items.map((i) => i.projectId))
          const missing = [...new Set(adopted.flatMap((a) => a.item.dependencies))].filter((d) => !have.has(d)).map((d) => ({ projectId: d, kind: null }))
          const dependencies = missing.length > 0 ? await this.toItems(await this.client.resolveWithDependencies(missing, mc, have), new Set()) : []
          content = { ...content, items: [...(await this.withMetadata(items)), ...dependencies] }
          await this.save(content)
        } catch (error) {
          this.deps.log.warn(`Adoption impossible : ${error instanceof Error ? error.message : String(error)}`)
          for (const { entry, item } of adopted) rejected.push({ entry, reason: `« ${item.title} » : ses dépendances n’ont pas pu être installées` })
          adopted.length = 0
        }
      }

      const quarantined = await moveToQuarantine(this.deps.layout, rejected)
      if (quarantined.length > 0) this.deps.log.warn(`Quarantaine : ${quarantined.map((q) => `${q.file} (${q.reason})`).join(', ')}`)
      if (adopted.length > 0) this.deps.log.info(`Ajoutés à la main et autorisés : ${adopted.map((a) => a.item.title).join(', ')}`)
      void this.emit()
      return { quarantined, adopted: adopted.map((a) => a.item.title) }
    })
  }

  // --- Interne ---------------------------------------------------------------------------

  private withItems(content: ContentFile, change: (items: StoredItem[]) => StoredItem[]): ContentFile {
    return { ...content, items: change(content.items) }
  }

  /** Complète titre, auteur et icône depuis Modrinth (sans bloquer si Modrinth ne répond pas). */
  private async withMetadata(items: StoredItem[]): Promise<StoredItem[]> {
    const missing = items.filter((i) => !i.author || !i.iconUrl).map((i) => i.projectId)
    if (missing.length === 0) return items
    try {
      const hits = new Map((await this.client.searchByIds(missing)).map((h) => [h.project_id, h]))
      return items.map((i) => {
        const hit = hits.get(i.projectId)
        return hit ? { ...i, title: hit.title, author: hit.author, iconUrl: hit.icon_url } : i
      })
    } catch {
      return items
    }
  }

  private async toItems(files: ModrinthFile[], roots: Set<string>): Promise<StoredItem[]> {
    const { allowlist } = this.deps.config()
    const names = new Map([...allowlist.mods, ...allowlist.resourcepacks, ...allowlist.shaders].map((e) => [e.projectId, e.name]))
    return this.withMetadata(
      files.map((file) => ({
        projectId: file.projectId,
        kind: file.kind,
        title: names.get(file.projectId) ?? file.fileName,
        author: '',
        iconUrl: null,
        versionId: file.versionId,
        versionNumber: file.versionNumber,
        fileName: file.fileName,
        url: file.url,
        sha512: file.sha512,
        size: file.size,
        dependencies: file.dependencies,
        enabled: true,
        auto: !roots.has(file.projectId)
      }))
    )
  }

  /**
   * Registre prêt à l'emploi : contenu de départ (obligatoires + recommandés) à la première utilisation,
   * nouvelle version de Minecraft, nouveaux projets obligatoires, projets retirés de la liste autorisée.
   */
  private async ensureReady(): Promise<ContentFile> {
    const { launcher, allowlist } = this.deps.config()
    const mc = launcher.minecraftVersion
    const required = requiredIds(launcher, allowlist)
    const kindOf = (id: string): ContentKind => CONTENT_KINDS.find((k) => allowedIds(allowlist, k).has(id)) ?? 'mod'
    let content = await this.load()

    if (!content) {
      const roots = new Map<string, ContentKind>()
      for (const id of required) roots.set(id, kindOf(id))
      for (const kind of CONTENT_KINDS) for (const entry of allowlist[ALLOWLIST_KEY[kind]]) if (entry.recommended) roots.set(entry.projectId, kind)
      const files = await this.client.resolveWithDependencies([...roots].map(([projectId, kind]) => ({ projectId, kind })), mc)
      content = { schema: 1, minecraftVersion: mc, items: await this.toItems(files, new Set(roots.keys())) }
      await this.save(content)
      this.deps.log.info(`Contenu de départ : ${content.items.map((i) => i.title).join(', ')}`)
    } else if (content.minecraftVersion !== mc) {
      content = await this.migrate(content, mc)
    }

    const present = new Set(content.items.map((i) => i.projectId))
    const missing = [...required].filter((id) => !present.has(id))
    if (missing.length > 0) {
      const have = new Set(content.items.map((i) => i.projectId))
      const files = await this.client.resolveWithDependencies(missing.map((id) => ({ projectId: id, kind: kindOf(id) })), mc, have)
      content = { ...content, items: [...content.items, ...(await this.toItems(files, new Set(missing)))] }
      await this.save(content)
    }

    // La liste autorisée a changé : les projets retirés quittent le registre. Leurs fichiers encore dans le jeu
    // seront mis en quarantaine au prochain lancement, avec la raison.
    const allowedNow = (i: StoredItem): boolean => i.auto || required.has(i.projectId) || allowedIds(allowlist, i.kind).has(i.projectId)
    const kept = content.items.filter(allowedNow)
    const orphans = orphanAutos(kept, required)
    const dropped = content.items.filter((i) => !kept.includes(i) || orphans.includes(i))
    if (dropped.length > 0) {
      for (const item of dropped) await fs.rm(contentPath(this.deps.layout, item, false), { force: true })
      content = { ...content, items: content.items.filter((i) => !dropped.includes(i)) }
      await this.save(content)
      this.deps.log.warn(`Plus autorisés par le serveur : ${dropped.map((i) => i.title).join(', ')}`)
    }
    return content
  }

  /** Nouvelle version de Minecraft : chaque projet est remplacé par sa version compatible (s'il en existe une). */
  private async migrate(content: ContentFile, mc: string): Promise<ContentFile> {
    const have = new Set<string>()
    const files: ModrinthFile[] = []
    const unavailable: string[] = []
    const roots = content.items.filter((i) => !i.auto)
    for (const root of roots) {
      try {
        const resolved = await this.client.resolveWithDependencies([{ projectId: root.projectId, kind: root.kind }], mc, have)
        for (const file of resolved) have.add(file.projectId)
        files.push(...resolved)
      } catch (error) {
        if (toGameError(error).code === 'network') throw error
        unavailable.push(root.title)
      }
    }
    const previous = new Map(content.items.map((i) => [i.projectId, i]))
    const items = (await this.toItems(files, new Set(roots.map((r) => r.projectId)))).map((item) => {
      const old = previous.get(item.projectId)
      return old && !old.auto ? { ...item, enabled: old.enabled } : item
    })
    for (const old of content.items) {
      const replaced = items.find((i) => i.projectId === old.projectId)
      if (replaced?.fileName === old.fileName) continue
      await fs.rm(contentPath(this.deps.layout, old, true), { force: true })
      await fs.rm(contentPath(this.deps.layout, old, false), { force: true })
    }
    if (unavailable.length > 0) this.deps.log.warn(`Pas encore disponibles pour Minecraft ${mc} : ${unavailable.join(', ')}`)
    const next: ContentFile = { schema: 1, minecraftVersion: mc, items }
    await this.save(next)
    return next
  }

  /** Range chaque fichier : dans le jeu s'il est actif, dans hsmp/disabled/ sinon. */
  private async placeFiles(content: ContentFile): Promise<void> {
    const { launcher, allowlist } = this.deps.config()
    const active = activeSet(content.items, requiredIds(launcher, allowlist))
    for (const item of content.items) {
      const isActive = active.has(item.projectId)
      const wanted = contentPath(this.deps.layout, item, isActive)
      const other = contentPath(this.deps.layout, item, !isActive)
      if (!(await exists(other))) continue
      if (await exists(wanted)) {
        await fs.rm(other, { force: true })
      } else {
        await fs.mkdir(path.dirname(wanted), { recursive: true })
        await fs.rename(other, wanted)
      }
    }
  }

  /** Range les fichiers puis télécharge (avec vérification SHA-512) ceux qui manquent dans le jeu. */
  private async applyFiles(content: ContentFile): Promise<void> {
    await this.placeFiles(content)
    const { launcher, allowlist } = this.deps.config()
    const active = activeSet(content.items, requiredIds(launcher, allowlist))
    for (const item of content.items) {
      if (!active.has(item.projectId)) continue
      const file = { url: item.url, path: contentPath(this.deps.layout, item, true), sha512: item.sha512, size: item.size, group: 'mods' as const }
      if (await isFileValid(file, 'size')) continue
      await downloadFile(file, { fetch: this.deps.fetch, userAgent: this.deps.userAgent })
    }
  }
}
