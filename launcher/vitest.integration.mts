import { defineConfig } from 'vitest/config'

// Tests d'intégration : vrais téléchargements (Mojang, Fabric, Modrinth). Lancés à la main uniquement :
//   HSMP_TEST_GAME_DIR=C:\chemin\court npx vitest run --config vitest.integration.mts
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.integration.ts'],
    testTimeout: 20 * 60 * 1000,
    hookTimeout: 60_000
  }
})
