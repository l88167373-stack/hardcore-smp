/**
 * Client de l'API Modrinth v2 (https://docs.modrinth.com) : catalogue filtré sur la version de Minecraft,
 * fiches projet, dernière version compatible avec ses dépendances obligatoires, identification d'un fichier
 * par son empreinte SHA-512 et recherche des mises à jour.
 *
 * Toutes les requêtes à l'API passent par `modrinthGate`, qui respecte la limite de Modrinth
 * (300 requêtes par minute et par adresse IP) : 4 requêtes à la fois au plus, pause quand le quota est
 * presque épuisé, nouvel essai après une réponse 429.
 */
import type { CatalogSort, ContentKind } from '../../shared/mods'
import type { FetchLike } from './download'
import { GameError } from './errors'
import { fetchJson, postJson } from './fetch-json'

export const MODRINTH_API = 'https://api.modrinth.com/v2'
/** Seule origine acceptée pour les fichiers téléchargés depuis Modrinth. */
export const MODRINTH_CDN_HOST = 'cdn.modrinth.com'

/** « Chargeur » Modrinth de chaque type de contenu (les packs de ressources sont pour « minecraft »). */
export const KIND_LOADER: Record<ContentKind, string> = { mod: 'fabric', resourcepack: 'minecraft', shader: 'iris' }

const KIND_EXTENSION: Record<ContentKind, string> = { mod: '.jar', resourcepack: '.zip', shader: '.zip' }

export function kindOfProjectType(type: string): ContentKind | null {
  return type === 'mod' || type === 'resourcepack' || type === 'shader' ? type : null
}

export interface ModrinthFile {
  projectId: string
  kind: ContentKind
  versionId: string
  versionNumber: string
  fileName: string
  url: string
  sha512: string
  size: number
  /** Projets dont cette version a besoin (dépendances obligatoires). */
  dependencies: string[]
  /** Projets déclarés incompatibles avec cette version. */
  incompatible: string[]
}

export interface ApiVersion {
  id: string
  project_id: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions?: string[]
  loaders?: string[]
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha512: string; sha1: string } }[]
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded' }[]
}

export interface ApiProject {
  id: string
  slug: string
  title: string
  description: string
  body?: string
  project_type: string
  downloads: number
  icon_url: string | null
  gallery?: { url: string; raw_url?: string; title: string | null; featured: boolean }[]
}

export interface ApiSearchHit {
  project_id: string
  slug: string
  title: string
  author: string
  description: string
  downloads: number
  icon_url: string | null
  project_type: string
}

/** Nom d'hôte d'une adresse https (vide sinon). */
export function httpsHost(raw: string): string {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.hostname : ''
  } catch {
    return ''
  }
}

/** Choisit le fichier principal d'une version et vérifie qu'il est sûr (nom, extension, origine). */
export function toModrinthFile(version: ApiVersion, kind: ContentKind): ModrinthFile {
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  if (!file) throw new GameError('unknown', `Modrinth : aucun fichier pour ${version.project_id}`)
  const extension = KIND_EXTENSION[kind]
  if (!/^[a-zA-Z0-9._+\-() ]+$/.test(file.filename) || !file.filename.toLowerCase().endsWith(extension)) {
    throw new GameError('unknown', `Nom de fichier refusé : ${file.filename}`)
  }
  if (httpsHost(file.url) !== MODRINTH_CDN_HOST) throw new GameError('unknown', `Adresse de téléchargement refusée : ${file.url}`)
  if (!/^[0-9a-f]{128}$/i.test(file.hashes.sha512)) throw new GameError('unknown', `Empreinte SHA-512 absente pour ${file.filename}`)
  const ids = (type: string): string[] =>
    version.dependencies.filter((d) => d.dependency_type === type && d.project_id).map((d) => d.project_id ?? '')
  return {
    projectId: version.project_id,
    kind,
    versionId: version.id,
    versionNumber: version.version_number,
    fileName: file.filename,
    url: file.url,
    sha512: file.hashes.sha512.toLowerCase(),
    size: file.size,
    dependencies: ids('required'),
    incompatible: ids('incompatible')
  }
}

/** Limite le débit vers l'API Modrinth (les téléchargements sur le CDN ne sont pas concernés). */
export function modrinthGate(
  fetchFn: FetchLike,
  options: { maxConcurrent?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
): FetchLike {
  const maxConcurrent = options.maxConcurrent ?? 4
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let active = 0
  const waiting: (() => void)[] = []
  let pausedUntil = 0

  const acquire = async (): Promise<void> => {
    if (active < maxConcurrent) {
      active++
      return
    }
    // La place est transmise directement par `release`.
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
  const seconds = (value: string | null): number | null => {
    if (value === null) return null
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  return async (url, init) => {
    if (!url.startsWith(MODRINTH_API)) return fetchFn(url, init)
    await acquire()
    try {
      for (let attempt = 0; ; attempt++) {
        const wait = pausedUntil - now()
        if (wait > 0) await sleep(wait)
        const response = await fetchFn(url, init)
        const remaining = seconds(response.headers.get('x-ratelimit-remaining'))
        const reset = seconds(response.headers.get('x-ratelimit-reset'))
        if (remaining !== null && remaining <= 5) pausedUntil = now() + (reset ?? 10) * 1000
        if (response.status === 429 && attempt < 2) {
          const retry = seconds(response.headers.get('retry-after')) ?? reset ?? 5
          pausedUntil = now() + Math.min(60, Math.max(1, retry)) * 1000
          continue
        }
        return response
      }
    } finally {
      release()
    }
  }
}

export class ModrinthClient {
  private readonly fetchFn: FetchLike

  constructor(
    fetchFn: FetchLike,
    private readonly userAgent: string
  ) {
    this.fetchFn = modrinthGate(fetchFn)
  }

  private async get<T>(path: string): Promise<T> {
    return (await fetchJson<T>(this.fetchFn, `${MODRINTH_API}${path}`, this.userAgent)).data
  }

  /** Versions compatibles (Minecraft + chargeur), la plus récente d'abord ; on préfère une « release » à une bêta. */
  async latestCompatible(projectId: string, minecraftVersion: string, kind: ContentKind = 'mod'): Promise<ApiVersion> {
    const query = new URLSearchParams({ loaders: JSON.stringify([KIND_LOADER[kind]]), game_versions: JSON.stringify([minecraftVersion]) })
    const data = await this.get<ApiVersion[]>(`/project/${encodeURIComponent(projectId)}/version?${query.toString()}`)
    const chosen = data.find((v) => v.version_type === 'release') ?? data[0]
    if (!chosen) throw new GameError('unknown', `Modrinth : ${projectId} n'existe pas pour Minecraft ${minecraftVersion}`)
    return chosen
  }

  async version(versionId: string): Promise<ApiVersion> {
    return this.get<ApiVersion>(`/version/${encodeURIComponent(versionId)}`)
  }

  async project(idOrSlug: string): Promise<ApiProject> {
    return this.get<ApiProject>(`/project/${encodeURIComponent(idOrSlug)}`)
  }

  /** Plusieurs projets en une requête (par paquets de 100). */
  async projects(ids: string[]): Promise<ApiProject[]> {
    const result: ApiProject[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      if (chunk.length === 0) continue
      result.push(...(await this.get<ApiProject[]>(`/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`)))
    }
    return result
  }

  /** Recherche dans le catalogue, filtrée sur la version de Minecraft (et Fabric / Iris selon le type). */
  async search(options: {
    kind: ContentKind
    query: string
    sort: CatalogSort
    offset: number
    limit: number
    minecraftVersion: string
    /** Limiter la recherche à ces projets (ex. « autorisés uniquement »). */
    projectIds?: string[]
  }): Promise<{ hits: ApiSearchHit[]; total: number }> {
    if (options.projectIds?.length === 0) return { hits: [], total: 0 }
    const facets: string[][] = [[`project_type:${options.kind}`], [`versions:${options.minecraftVersion}`]]
    if (options.kind !== 'resourcepack') facets.push([`categories:${KIND_LOADER[options.kind]}`])
    if (options.projectIds) facets.push(options.projectIds.map((id) => `project_id:${id}`))
    const params = new URLSearchParams({
      query: options.query,
      facets: JSON.stringify(facets),
      index: options.sort,
      offset: String(options.offset),
      limit: String(options.limit)
    })
    const data = await this.get<{ hits: ApiSearchHit[]; total_hits: number }>(`/search?${params.toString()}`)
    return { hits: data.hits, total: data.total_hits }
  }

  /** Fiches courtes (avec l'auteur) d'une liste de projets précis. */
  async searchByIds(ids: string[]): Promise<ApiSearchHit[]> {
    const result: ApiSearchHit[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      if (chunk.length === 0) continue
      const params = new URLSearchParams({ facets: JSON.stringify([chunk.map((id) => `project_id:${id}`)]), limit: '100' })
      result.push(...(await this.get<{ hits: ApiSearchHit[] }>(`/search?${params.toString()}`)).hits)
    }
    return result
  }

  /** Identifie des fichiers par leur SHA-512 : empreinte → version Modrinth (absente si inconnue). */
  async identify(hashes: string[]): Promise<Record<string, ApiVersion>> {
    if (hashes.length === 0) return {}
    return postJson<Record<string, ApiVersion>>(this.fetchFn, `${MODRINTH_API}/version_files`, this.userAgent, {
      hashes,
      algorithm: 'sha512'
    })
  }

  /** Dernière version compatible pour chaque fichier installé : empreinte → version (mise à jour si l'id diffère). */
  async latestForHashes(hashes: string[], kind: ContentKind, minecraftVersion: string): Promise<Record<string, ApiVersion>> {
    if (hashes.length === 0) return {}
    return postJson<Record<string, ApiVersion>>(this.fetchFn, `${MODRINTH_API}/version_files/update`, this.userAgent, {
      hashes,
      algorithm: 'sha512',
      loaders: [KIND_LOADER[kind]],
      game_versions: [minecraftVersion]
    })
  }

  /**
   * Résout des projets et toutes leurs dépendances obligatoires (sans doublon), chacun dans sa dernière version
   * compatible. Les projets de `have` sont considérés comme déjà installés.
   * Un type inconnu (`kind: null`, cas des dépendances) est lu sur la fiche du projet.
   */
  async resolveWithDependencies(
    roots: { projectId: string; kind: ContentKind | null }[],
    minecraftVersion: string,
    have: Set<string> = new Set()
  ): Promise<ModrinthFile[]> {
    const result: ModrinthFile[] = []
    const seen = new Set(have)
    const queue: { projectId: string; kind: ContentKind | null }[] = roots.map((r) => ({ ...r }))
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next || seen.has(next.projectId)) continue
      let kind = next.kind
      if (!kind) {
        const project = await this.project(next.projectId)
        kind = kindOfProjectType(project.project_type)
        if (!kind) throw new GameError('unknown', `Dépendance non prise en charge : ${project.title} (${project.project_type})`)
      }
      const file = toModrinthFile(await this.latestCompatible(next.projectId, minecraftVersion, kind), kind)
      seen.add(file.projectId)
      result.push(file)
      for (const dependency of file.dependencies) {
        if (!seen.has(dependency)) queue.push({ projectId: dependency, kind: null })
      }
    }
    return result
  }
}
