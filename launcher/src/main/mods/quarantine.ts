/**
 * Quarantaine : avant chaque lancement, les dossiers mods/, resourcepacks/ et shaderpacks/ ne doivent contenir
 * QUE ce que le launcher a installé. Le reste est déplacé dans quarantaine/<date>/, avec POURQUOI.txt
 * qui explique fichier par fichier. Rien n'est supprimé : le joueur peut récupérer ses fichiers.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { KIND_FOLDER, type ContentKind, type QuarantinedFile } from '../../shared/mods'
import { hashFile } from '../game/download'
import type { GameLayout } from '../game/layout'

/** Fichier attendu dans un dossier du jeu (nom + empreinte). */
export interface ExpectedFile {
  kind: ContentKind
  fileName: string
  sha512: string
}

export interface FolderEntry {
  kind: ContentKind
  name: string
  full: string
  /** « mods/freecam.jar » : ce qu'on montre au joueur. */
  display: string
  directory: boolean
  /** Empreinte (null pour un dossier). */
  sha512: string | null
  /** Fichier géré par le launcher mais dont le contenu a changé. */
  modified: boolean
}

const EXPLANATION = `Ces fichiers ont été retirés du jeu par le launcher HARDCORE SMP.

Seuls les mods, packs de ressources et shaders autorisés par le serveur peuvent être utilisés,
et ils doivent être installés depuis l'onglet « Mods » du launcher.

Rien n'est supprimé : tu peux récupérer ces fichiers pour un autre usage.
Pour proposer un mod au serveur, utilise le bouton « Proposer ce mod » dans le launcher.

Détail :
`

function timestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/** Tout ce qui, dans les dossiers du jeu, ne correspond pas exactement à un fichier attendu. */
export async function findUnexpected(layout: GameLayout, expected: ExpectedFile[]): Promise<FolderEntry[]> {
  const result: FolderEntry[] = []
  for (const kind of ['mod', 'resourcepack', 'shader'] as const) {
    const folder = KIND_FOLDER[kind]
    const dir = layout[folder]
    const wanted = new Map(expected.filter((e) => e.kind === kind).map((e) => [e.fileName, e.sha512.toLowerCase()]))
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      // Téléchargements en cours, et réglages d'Iris rangés à côté des shaders : ignorés.
      if (entry.name.endsWith('.part')) continue
      if (kind === 'shader' && entry.isFile() && entry.name.endsWith('.txt')) continue
      const full = path.join(dir, entry.name)
      const display = `${folder}/${entry.name}`
      if (!entry.isFile()) {
        result.push({ kind, name: entry.name, full, display, directory: true, sha512: null, modified: false })
        continue
      }
      const sha512 = await hashFile(full, 'sha512')
      const expectedHash = wanted.get(entry.name)
      if (expectedHash === sha512) continue
      result.push({ kind, name: entry.name, full, display, directory: false, sha512, modified: expectedHash !== undefined })
    }
  }
  return result
}

/** Déplace les fichiers dans quarantaine/<date>/ et écrit POURQUOI.txt. */
export async function moveToQuarantine(
  layout: GameLayout,
  files: { entry: FolderEntry; reason: string }[],
  now = new Date()
): Promise<QuarantinedFile[]> {
  if (files.length === 0) return []
  const folder = path.join(layout.quarantine, timestamp(now))
  for (const { entry } of files) {
    const target = path.join(folder, KIND_FOLDER[entry.kind], entry.name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.rename(entry.full, target)
  }
  const detail = files.map(({ entry, reason }) => `- ${entry.display} : ${reason}`).join('\n')
  await fs.writeFile(path.join(folder, 'POURQUOI.txt'), `${EXPLANATION}${detail}\n`, 'utf8')
  return files.map(({ entry, reason }) => ({ file: entry.display, reason }))
}

/** Nombre de fichiers actuellement en quarantaine (hors explications). */
export async function countQuarantined(layout: GameLayout): Promise<number> {
  let count = 0
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Un pack de ressources « en dossier » compte pour un seul élément.
        if (path.basename(dir) === 'resourcepacks' || path.basename(dir) === 'shaderpacks') count++
        else await walk(path.join(dir, entry.name))
      } else if (entry.name !== 'POURQUOI.txt') count++
    }
  }
  await walk(layout.quarantine)
  return count
}
