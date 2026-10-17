// Génère les icônes de l'application (.ico Windows, .icns macOS, .png Linux) dans launcher/build/.
// Source : assets/icon-1024.png (fourni par le propriétaire du serveur),
// ou l'icône provisoire resources/placeholder-icon.svg tant qu'il n'existe pas.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import png2icons from 'png2icons'
import sharp from 'sharp'

const root = process.cwd()
const official = resolve(root, '..', 'assets', 'icon-1024.png')
const placeholder = resolve(root, 'resources', 'placeholder-icon.svg')
const outDir = resolve(root, 'build')
const linuxDir = join(outDir, 'icons')

const source = existsSync(official) ? official : placeholder
console.log(`Icône source : ${source === official ? 'assets/icon-1024.png' : 'icône provisoire (assets/icon-1024.png absent)'}`)

mkdirSync(linuxDir, { recursive: true })
const master = await sharp(source, { density: 300 }).resize(1024, 1024).png().toBuffer()

writeFileSync(join(outDir, 'icon.png'), master)
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  writeFileSync(join(linuxDir, `${size}x${size}.png`), await sharp(master).resize(size, size).png().toBuffer())
}

const ico = png2icons.createICO(master, png2icons.BICUBIC2, 0, true, true)
const icns = png2icons.createICNS(master, png2icons.BICUBIC2, 0)
if (!ico || !icns) throw new Error('La conversion de l’icône a échoué.')
writeFileSync(join(outDir, 'icon.ico'), ico)
writeFileSync(join(outDir, 'icon.icns'), icns)
console.log('Icônes générées dans launcher/build/ : icon.ico, icon.icns, icon.png, icons/*.png')
