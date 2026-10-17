// Capture chaque écran du launcher (vraie fenêtre Electron) dans launcher/screenshots/.
// Usage : npm run screenshots  (après un build ; le script `screenshots` le fait pour toi)
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')

const outDir = resolve(process.cwd(), 'screenshots')
const userData = join(outDir, '.userdata')
mkdirSync(userData, { recursive: true })
// Onboarding déjà fait pour voir les écrans principaux ; ses étapes restent accessibles par leur adresse.
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ onboardingCompleted: true, acceptedRulesVersion: 1 }))

const defaultRoutes = [
  'home',
  'news',
  'server',
  'mods',
  'mods|Installés',
  'mods|Shaders',
  'mods|Sodium',
  'settings',
  'settings|Vérifier et réparer les fichiers',
  'accounts',
  'accounts|Ajouter un compte',
  'support',
  'onboarding/1|Se connecter avec Microsoft',
  'onboarding/1',
  'onboarding/2',
  'onboarding/3',
  'onboarding/4',
  'onboarding/5'
]
// HSMP_ROUTES=mods,mods|Shaders : ne capturer que certains écrans.
const routes = process.env.HSMP_ROUTES ? process.env.HSMP_ROUTES.split(',') : defaultRoutes

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HSMP_SCREENSHOTS: outDir,
    HSMP_SCREENSHOT_ROUTES: routes.join(','),
    ELECTRON_RENDERER_URL: '',
    // Dossier de jeu de test : les captures ne téléchargent rien dans ton vrai dossier du jeu.
    HSMP_GAME_DIR: process.env.HSMP_GAME_DIR ?? join(outDir, '.jeu')
  }
})
child.on('exit', (code) => {
  console.log(`Captures dans ${outDir}`)
  process.exit(code ?? 0)
})
