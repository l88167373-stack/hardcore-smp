/**
 * Outil de développement : capture chaque écran de la vraie fenêtre Electron en PNG, puis quitte.
 * Utilisé par `npm run screenshots`. Désactivé dans l'application installée.
 */
import { app, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function runScreenshotsIfRequested(win: BrowserWindow): void {
  const outDir = process.env.HSMP_SCREENSHOTS
  if (!outDir || app.isPackaged) return
  const routes = (process.env.HSMP_SCREENSHOT_ROUTES ?? 'home').split(',').map((r) => r.trim())

  // Affiche les avertissements/erreurs de l'interface (ex. violation de la CSP) dans le terminal.
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') console.log(`[interface:${event.level}] ${event.message}`)
  })

  win.webContents.once('did-finish-load', () => {
    void (async () => {
      await fs.mkdir(outDir, { recursive: true })
      await wait(1500)
      for (const entry of routes) {
        // Format : « écran » ou « écran|texte du bouton à cliquer avant la capture ».
        const [route = 'home', click] = entry.split('|')
        await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#/${route}`)}; void 0`)
        await wait(1200)
        if (click) {
          await win.webContents.executeJavaScript(
            `[...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(click)}))?.click(); void 0`
          )
          await wait(1500)
        }
        // Fenêtre cachée : la première capture déclenche le rendu, la seconde récupère l'image à jour.
        win.webContents.invalidate()
        await win.webContents.capturePage()
        await wait(400)
        const image = await win.webContents.capturePage()
        const name = (click ? `${route}-${click.slice(0, 24)}` : route).normalize('NFD').replace(/[^a-z0-9-]+/gi, '_') || 'home'
        await fs.writeFile(path.join(outDir, `${name}.png`), image.toPNG())
        console.log(`capture : ${name}.png`)
      }
      app.quit()
    })().catch((error: unknown) => {
      console.error(error)
      app.exit(1)
    })
  })
}
