/** Organisation du dossier du jeu (%APPDATA%/.hardcore-smp sous Windows). */
import path from 'node:path'

export interface GameLayout {
  root: string
  versions: string
  libraries: string
  assets: string
  runtime: string
  natives: string
  mods: string
  resourcepacks: string
  shaderpacks: string
  quarantine: string
  logs: string
  crashReports: string
  /** Fichiers du launcher : plan d'installation, mods gérés, marqueur pour le Guard. */
  hsmp: string
}

export function gameLayout(root: string): GameLayout {
  return {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtime: path.join(root, 'runtime'),
    natives: path.join(root, 'natives'),
    mods: path.join(root, 'mods'),
    resourcepacks: path.join(root, 'resourcepacks'),
    shaderpacks: path.join(root, 'shaderpacks'),
    quarantine: path.join(root, 'quarantaine'),
    logs: path.join(root, 'logs'),
    crashReports: path.join(root, 'crash-reports'),
    hsmp: path.join(root, 'hsmp')
  }
}
