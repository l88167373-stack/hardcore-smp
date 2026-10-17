/**
 * Configuration publique (config/*.json) côté process principal.
 *
 * Ordre de priorité : version en ligne (GitHub, relue toutes les 10 minutes) → dernière copie téléchargée
 * (cache, pour jouer hors ligne) → copie embarquée dans le launcher. Une version en ligne invalide ou
 * incohérente est ignorée : on garde la précédente.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import allowlistJson from '../../../config/allowlist.json'
import launcherJson from '../../../config/launcher.json'
import newsJson from '../../../config/news.json'
import rulesJson from '../../../config/rules.json'
import {
  PUBLIC_CONFIG_FILES,
  parsePublicConfig,
  type PublicConfig,
  type PublicConfigFile,
  type PublicConfigOrigin
} from '../shared/public-config'
import type { FetchLike } from './game/download'
import type { Logger } from './log'

export type MainPublicConfig = PublicConfig

const bundled: MainPublicConfig = parsePublicConfig({ launcher: launcherJson, news: newsJson, rules: rulesJson, allowlist: allowlistJson })

/** Copie embarquée (validée à la compilation par les tests). */
export function getPublicConfig(): MainPublicConfig {
  return bundled
}

/** Taille maximale d'un fichier de config téléchargé (protection contre un fichier énorme). */
const MAX_FILE_BYTES = 2 * 1024 * 1024
export const PUBLIC_CONFIG_REFRESH_MS = 10 * 60_000

export interface PublicConfigServiceDeps {
  /** Dossier config/ en ligne (se termine par « / »), ou null tant qu'il n'est pas renseigné. */
  baseUrl: string | null
  cacheDir: string
  fetch: FetchLike
  userAgent: string
  log: Logger
}

export class PublicConfigService {
  private config: MainPublicConfig = bundled
  private origin: PublicConfigOrigin = { kind: 'bundled', updatedAt: null }
  private readonly listeners = new Set<(config: MainPublicConfig, origin: PublicConfigOrigin) => void>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: PublicConfigServiceDeps) {}

  current(): MainPublicConfig {
    return this.config
  }

  currentOrigin(): PublicConfigOrigin {
    return this.origin
  }

  onChange(listener: (config: MainPublicConfig, origin: PublicConfigOrigin) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(config: MainPublicConfig, origin: PublicConfigOrigin): void {
    const changed = JSON.stringify(config) !== JSON.stringify(this.config)
    this.config = config
    this.origin = origin
    for (const listener of this.listeners) listener(config, origin)
    if (changed) this.deps.log.info(`Configuration publique mise à jour (${origin.kind})`)
  }

  /** Au démarrage : dernière copie téléchargée si elle existe et est valide (sans Internet). */
  async loadCache(): Promise<void> {
    try {
      const files = {} as Record<PublicConfigFile, unknown>
      for (const name of PUBLIC_CONFIG_FILES) {
        files[name] = JSON.parse(await fs.readFile(path.join(this.deps.cacheDir, `${name}.json`), 'utf8'))
      }
      const stat = await fs.stat(path.join(this.deps.cacheDir, 'launcher.json'))
      this.set(parsePublicConfig(files), { kind: 'cache', updatedAt: stat.mtime.toISOString() })
    } catch {
      // Pas de cache (première ouverture) ou cache abîmé : la copie embarquée reste utilisée.
    }
  }

  /** Télécharge les 4 fichiers. Vrai si la version en ligne est maintenant utilisée. */
  async refresh(): Promise<boolean> {
    const base = this.deps.baseUrl
    if (!base) return false
    try {
      const files = {} as Record<PublicConfigFile, unknown>
      const texts = {} as Record<PublicConfigFile, string>
      for (const name of PUBLIC_CONFIG_FILES) {
        const response = await this.deps.fetch(`${base}${name}.json`, {
          headers: { 'User-Agent': this.deps.userAgent, Accept: 'application/json', 'Cache-Control': 'no-cache' },
          signal: AbortSignal.timeout(15_000)
        })
        if (!response.ok) throw new Error(`${name}.json : HTTP ${response.status}`)
        const text = await response.text()
        if (text.length > MAX_FILE_BYTES) throw new Error(`${name}.json : fichier trop gros`)
        texts[name] = text
        files[name] = JSON.parse(text)
      }
      const config = parsePublicConfig(files)
      await fs.mkdir(this.deps.cacheDir, { recursive: true })
      for (const name of PUBLIC_CONFIG_FILES) {
        await fs.writeFile(path.join(this.deps.cacheDir, `${name}.json.tmp`), texts[name], 'utf8')
        await fs.rename(path.join(this.deps.cacheDir, `${name}.json.tmp`), path.join(this.deps.cacheDir, `${name}.json`))
      }
      this.set(config, { kind: 'online', updatedAt: new Date().toISOString() })
      return true
    } catch (error) {
      this.deps.log.warn(`Configuration en ligne indisponible ou invalide (${this.origin.kind} conservée) : ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  /** Lecture du cache, premier téléchargement, puis relecture régulière. */
  async start(intervalMs = PUBLIC_CONFIG_REFRESH_MS): Promise<void> {
    await this.loadCache()
    if (!this.deps.baseUrl) {
      this.deps.log.info('Adresse de la config en ligne absente (app-config.json) : copie embarquée utilisée')
      return
    }
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
