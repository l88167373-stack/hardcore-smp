/**
 * Réglages propres au launcher, embarqués à la compilation (launcher/app-config.json).
 *
 * Ils sont ici plutôt que dans config/launcher.json (téléchargé en ligne) : ainsi, une modification
 * malveillante de la config publique ne pourrait pas rediriger la connexion Microsoft, la source des
 * mises à jour du launcher ou l'adresse de la config elle-même. Aucun de ces réglages n'est un secret.
 */
import { z } from 'zod'
import { httpsUrl, todoValue } from '../shared/schemas'
import raw from '../../app-config.json'

const appConfigSchema = z.strictObject({
  azureClientId: z.union([z.guid('Client ID Azure au format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx attendu'), todoValue]),
  /** Dossier config/ en ligne, se terminant par « / » (ex. https://raw.githubusercontent.com/<compte>/<dépôt>/main/config/). */
  publicConfigUrl: z.union([httpsUrl.refine((url) => url.endsWith('/'), 'l’adresse doit se terminer par « / »'), todoValue]),
  /** Application Discord utilisée pour la Rich Presence (« Joue à HARDCORE SMP »). */
  discordApplicationId: z.union([z.string().regex(/^\d{17,20}$/, 'identifiant Discord (17 à 20 chiffres) attendu'), todoValue]),
  /** Dépôt GitHub des releases du launcher, au format « compte/dépôt ». */
  updateRepository: z.union([z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'format « compte/dépôt » attendu'), todoValue])
})

export interface AppConfig {
  /** null tant que la valeur n'est pas renseignée (valeur TODO_…). */
  azureClientId: string | null
  publicConfigUrl: string | null
  discordApplicationId: string | null
  updateRepository: { owner: string; repo: string } | null
}

const filled = (value: string): string | null => (value.startsWith('TODO_') ? null : value)

export function parseAppConfig(value: unknown): AppConfig {
  const parsed = appConfigSchema.parse(value)
  const repository = filled(parsed.updateRepository)
  const [owner = '', repo = ''] = repository?.split('/') ?? []
  return {
    azureClientId: filled(parsed.azureClientId),
    publicConfigUrl: filled(parsed.publicConfigUrl),
    discordApplicationId: filled(parsed.discordApplicationId),
    updateRepository: repository ? { owner, repo } : null
  }
}

export const appConfig: AppConfig = parseAppConfig(raw)
