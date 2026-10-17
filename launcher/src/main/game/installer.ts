/**
 * Exécution d'un plan d'installation : vérification des fichiers présents, téléchargement de ce qui manque
 * ou est abîmé, puis finitions (liens de Java sous macOS, dossiers du jeu).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { InstallGroupId, InstallGroupProgress, InstallProgress } from '../../shared/game'
import { downloadAll, isFileValid, type FetchLike, type FileItem, type VerifyMode } from './download'
import type { GameLayout } from './layout'
import type { InstallPlan } from './plan'

/** « 8 mods, 1 pack de ressources » : ce que le joueur a installé (hors HSMP Guard). */
function contentSummary(plan: InstallPlan): string {
  const count = (kind: 'mod' | 'resourcepack' | 'shader'): number => plan.content.filter((c) => c.source === 'modrinth' && c.kind === kind).length
  const parts: string[] = []
  const mods = count('mod')
  const packs = count('resourcepack')
  const shaders = count('shader')
  parts.push(`${mods} mod${mods > 1 ? 's' : ''}`)
  if (packs > 0) parts.push(`${packs} pack${packs > 1 ? 's' : ''} de ressources`)
  if (shaders > 0) parts.push(`${shaders} shader${shaders > 1 ? 's' : ''}`)
  return parts.join(', ')
}

const GROUPS: { id: InstallGroupId; label: string; detail: (plan: InstallPlan) => string }[] = [
  { id: 'java', label: 'Java 25', detail: () => 'Runtime officiel de Mojang' },
  { id: 'minecraft', label: 'Minecraft', detail: () => 'Jeu, bibliothèques et sons' },
  { id: 'fabric', label: 'Fabric Loader', detail: () => 'Chargeur de mods' },
  { id: 'guard', label: 'HSMP Guard', detail: () => 'Mod officiel du serveur' },
  { id: 'mods', label: 'Mods', detail: (plan) => contentSummary(plan) }
]

export interface ExecuteOptions {
  layout: GameLayout
  mode: VerifyMode
  fetch: FetchLike
  userAgent: string
  onProgress: (progress: InstallProgress) => void
  signal?: AbortSignal
}

/** Supprime les doublons (une même bibliothèque peut être listée deux fois). */
function uniqueByPath(files: FileItem[]): FileItem[] {
  const seen = new Map<string, FileItem>()
  for (const file of files) if (!seen.has(file.path)) seen.set(file.path, file)
  return [...seen.values()]
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let index = 0
  const worker = async (): Promise<void> => {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function executePlan(plan: InstallPlan, options: ExecuteOptions): Promise<void> {
  const files = uniqueByPath(plan.files)
  const groups: InstallGroupProgress[] = GROUPS.map((g) => {
    const skip = plan.skipped.find((s) => s.group === g.id)
    const total = files.filter((f) => f.group === g.id).reduce((sum, f) => sum + (f.size ?? 0), 0)
    const group: InstallGroupProgress = {
      id: g.id,
      label: g.id === 'minecraft' ? `Minecraft ${plan.minecraftVersion}` : g.id === 'fabric' ? `Fabric Loader ${plan.fabricLoaderVersion}` : g.label,
      detail: g.detail(plan),
      totalBytes: total,
      doneBytes: 0,
      state: skip ? 'skipped' : 'waiting'
    }
    if (skip) group.note = skip.note
    return group
  })
  const byId = new Map(groups.map((g) => [g.id, g]))
  let step = 'Vérification des fichiers'

  const emit = (): void => {
    const totalBytes = groups.reduce((sum, g) => sum + g.totalBytes, 0)
    const doneBytes = groups.reduce((sum, g) => sum + g.doneBytes, 0)
    for (const g of groups) {
      if (g.state === 'skipped') continue
      g.state = g.doneBytes >= g.totalBytes ? 'done' : g.doneBytes > 0 ? 'active' : 'waiting'
    }
    options.onProgress({ step, groups: structuredClone(groups), totalBytes, doneBytes })
  }

  // 1. Vérification : rapide (tailles) avant chaque lancement, complète (empreintes) pour une réparation.
  emit()
  const valid = await mapLimit(files, 16, (file) => isFileValid(file, options.mode))
  const missing: FileItem[] = []
  files.forEach((file, i) => {
    const group = byId.get(file.group)
    if (valid[i]) {
      if (group) group.doneBytes += file.size ?? 0
    } else {
      missing.push(file)
    }
  })

  // 2. Téléchargement de ce qui manque.
  step = missing.length > 0 ? 'Téléchargement' : 'Tout est à jour'
  emit()
  if (missing.length > 0) {
    let lastEmit = 0
    await downloadAll(missing, {
      fetch: options.fetch,
      userAgent: options.userAgent,
      ...(options.signal ? { signal: options.signal } : {}),
      onBytes: (groupId, delta) => {
        const group = byId.get(groupId)
        if (group) group.doneBytes = Math.max(0, group.doneBytes + delta)
        const now = Date.now()
        if (now - lastEmit > 150) {
          lastEmit = now
          emit()
        }
      }
    })
  }

  // 3. Finitions.
  step = 'Finalisation'
  emit()
  for (const link of plan.javaLinks) {
    await fs.mkdir(path.dirname(link.path), { recursive: true })
    const existing = await fs.readlink(link.path).catch(() => null)
    if (existing !== link.target) {
      await fs.rm(link.path, { force: true })
      await fs.symlink(link.target, link.path)
    }
  }
  const { layout } = options
  for (const dir of [layout.mods, layout.resourcepacks, layout.shaderpacks, layout.natives, layout.hsmp]) {
    await fs.mkdir(dir, { recursive: true })
  }
  for (const g of groups) if (g.state !== 'skipped') g.doneBytes = g.totalBytes
  step = 'Installation terminée'
  emit()
}
