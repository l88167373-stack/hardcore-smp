/**
 * Vérification du dossier config/ (lancée aussi par GitHub Actions à chaque envoi) :
 * en cas d'erreur, le message dit quel fichier et quelle ligne corriger, en français.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_CONFIG_FILES, PublicConfigError, parsePublicConfig, type PublicConfigFile } from '../src/shared/public-config'

const CONFIG_DIR = path.resolve(process.cwd(), '..', 'config')

function readConfigFile(name: PublicConfigFile): unknown {
  const file = path.join(CONFIG_DIR, `${name}.json`)
  const text = readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    // Ex. : « config/news.json n'est pas un JSON valide : Expected ',' or '}' after property value (ligne 12) »
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`config/${name}.json n’est pas un JSON valide (virgule ou guillemet oublié ?) : ${message}`, { cause: error })
  }
}

describe('dossier config/', () => {
  it('les 4 fichiers sont des JSON valides, conformes et cohérents entre eux', () => {
    const files = Object.fromEntries(PUBLIC_CONFIG_FILES.map((name) => [name, readConfigFile(name)])) as Record<PublicConfigFile, unknown>
    try {
      const config = parsePublicConfig(files)
      expect(config.launcher.rulesVersion).toBe(config.rules.version)
    } catch (error) {
      if (error instanceof PublicConfigError) {
        throw new Error(`config/ contient des erreurs à corriger :\n- ${error.problems.join('\n- ')}`, { cause: error })
      }
      throw error
    }
  })

  it('les actus ont des dates valides et pas dans un futur lointain', () => {
    const config = parsePublicConfig(Object.fromEntries(PUBLIC_CONFIG_FILES.map((name) => [name, readConfigFile(name)])) as Record<PublicConfigFile, unknown>)
    const nextYear = new Date()
    nextYear.setFullYear(nextYear.getFullYear() + 1)
    for (const item of config.news) expect(new Date(item.date).getTime(), `actu « ${item.id} »`).toBeLessThan(nextYear.getTime())
  })
})
