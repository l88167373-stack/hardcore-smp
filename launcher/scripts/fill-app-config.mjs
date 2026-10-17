// Utilisé par GitHub Actions avant de construire un installateur publié.
// Remplit dans app-config.json les valeurs qui se déduisent du dépôt GitHub (si elles sont encore « TODO_… ») :
//   - updateRepository : « compte/dépôt » (mises à jour du launcher)
//   - publicConfigUrl  : https://raw.githubusercontent.com/<compte>/<dépôt>/<branche>/config/ (config en ligne)
// Les autres valeurs (Client ID Azure, application Discord) ne sont jamais devinées.
//
// Usage : node scripts/fill-app-config.mjs <compte/dépôt> <branche>
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [repository, branch = 'main'] = process.argv.slice(2)
if (!repository || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
  console.error('Usage : node scripts/fill-app-config.mjs <compte/dépôt> <branche>')
  process.exit(1)
}
if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
  console.error(`Nom de branche refusé : ${branch}`)
  process.exit(1)
}

const file = resolve(process.cwd(), 'app-config.json')
const config = JSON.parse(readFileSync(file, 'utf8'))
const todo = (value) => typeof value === 'string' && value.startsWith('TODO_')

if (todo(config.updateRepository)) config.updateRepository = repository
if (todo(config.publicConfigUrl)) config.publicConfigUrl = `https://raw.githubusercontent.com/${repository}/${branch}/config/`
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)

for (const [key, value] of Object.entries(config)) {
  console.log(`${key} : ${todo(value) ? `${value}  ← à renseigner (voir docs/INSTALL-ADMIN.md)` : value}`)
}
