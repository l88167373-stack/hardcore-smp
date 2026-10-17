// Certaines configurations de npm n'exécutent pas le script d'installation d'Electron
// (téléchargement du binaire). Ce script vérifie qu'il est bien là et le télécharge sinon.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

// La CI qui vérifie seulement config/ n'a pas besoin d'Electron.
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0)

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))

if (existsSync(join(electronDir, 'path.txt')) && existsSync(join(electronDir, 'dist'))) {
  process.exit(0)
}

console.log('Téléchargement du binaire Electron…')
const result = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
process.exit(result.status ?? 1)
