import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const here = (...parts: string[]): string => resolve(process.cwd(), ...parts)

const alias = {
  '@renderer': here('src/renderer/src'),
  '@shared': here('src/shared'),
  '@config': here('../config'),
  '@assets': here('../assets')
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'tests/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'interface',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/test/setup.ts'],
          css: { modules: { classNameStrategy: 'non-scoped' } }
        }
      }
    ]
  }
})
