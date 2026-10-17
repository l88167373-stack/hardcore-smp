/**
 * Dossier du jeu isolé, jamais `.minecraft` :
 *  - Windows : %APPDATA%/.hardcore-smp
 *  - macOS   : ~/Library/Application Support/hardcore-smp
 *  - Linux   : ~/.hardcore-smp
 */
import path from 'node:path'
import type { GameFolder } from '../shared/ipc'

export function gameDirectory(platform: NodeJS.Platform, env: { APPDATA?: string | undefined }, home: string): string {
  if (platform === 'win32') {
    const appData = env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming')
    return path.win32.join(appData, '.hardcore-smp')
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'hardcore-smp')
  }
  return path.posix.join(home, '.hardcore-smp')
}

const SUBFOLDERS: Record<GameFolder, string[]> = {
  root: [],
  logs: ['logs'],
  'crash-reports': ['crash-reports'],
  mods: ['mods'],
  resourcepacks: ['resourcepacks'],
  shaderpacks: ['shaderpacks'],
  quarantine: ['quarantaine']
}

/** Chemin d'un sous-dossier connu du jeu (liste fermée : l'interface ne peut pas choisir un chemin libre). */
export function gameSubfolder(root: string, folder: GameFolder): string {
  return path.join(root, ...SUBFOLDERS[folder])
}
