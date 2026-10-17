import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

// Les scripts npm sont lancés depuis launcher/ : les chemins sont relatifs à ce dossier.
const here = (...parts: string[]): string => resolve(process.cwd(), ...parts)

export default defineConfig({
  main: {
    build: { externalizeDeps: true }
  },
  preload: {
    // Preload en CommonJS : obligatoire avec sandbox: true.
    build: { externalizeDeps: false, lib: { entry: here('src/preload/index.ts'), formats: ['cjs'] } }
  },
  renderer: {
    root: here('src/renderer'),
    resolve: {
      alias: {
        '@renderer': here('src/renderer/src'),
        '@shared': here('src/shared'),
        // Fichiers publics partagés avec le plugin (servent de données d'exemple en phase 1).
        '@config': here('../config'),
        // Logo officiel déposé par le propriétaire du serveur (facultatif).
        '@assets': here('../assets')
      }
    },
    server: {
      fs: { allow: [here('..')] }
    },
    build: { minify: true },
    plugins: [react()]
  }
})
