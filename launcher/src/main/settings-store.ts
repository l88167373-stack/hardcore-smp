/**
 * Paramètres du launcher, enregistrés dans `settings.json` (dossier de l'application).
 * Chaque lecture/écriture est validée : un fichier abîmé ou modifié à la main ne fait pas planter le launcher.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { defaultSettings } from '../shared/defaults'
import { clampMemory } from '../shared/memory'
import { settingsPatchSchema, settingsSchema, type Settings } from '../shared/schemas'

export class SettingsStore {
  private cache: Settings | null = null
  private writing: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(settings: Settings) => void>()

  constructor(
    private readonly file: string,
    private readonly totalMemoryMb: number
  ) {}

  /** Prévenu après chaque modification (ex. Rich Presence activée ou non). */
  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async get(): Promise<Settings> {
    if (this.cache) return this.cache
    const defaults = defaultSettings(this.totalMemoryMb)
    let loaded: Settings = defaults
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      // On garde les valeurs valides et on complète le reste avec les valeurs par défaut.
      const merged = settingsSchema.safeParse({ ...defaults, ...(typeof raw === 'object' ? raw : {}) })
      if (merged.success) loaded = merged.data
    } catch {
      // Fichier absent ou illisible : valeurs par défaut.
    }
    loaded = { ...loaded, memoryMb: clampMemory(loaded.memoryMb, this.totalMemoryMb) }
    this.cache = loaded
    return loaded
  }

  async update(patch: unknown): Promise<Settings> {
    const parsed = settingsPatchSchema.parse(patch)
    const current = await this.get()
    const next = settingsSchema.parse({ ...current, ...parsed })
    next.memoryMb = clampMemory(next.memoryMb, this.totalMemoryMb)
    this.cache = next
    await this.save(next)
    for (const listener of this.listeners) listener(next)
    return next
  }

  /** Écriture atomique (fichier temporaire puis renommage), une à la fois. */
  private save(settings: Settings): Promise<void> {
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
      await fs.rename(tmp, this.file)
    })
    return this.writing
  }
}
