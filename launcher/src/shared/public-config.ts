/**
 * Configuration publique complète (les 4 fichiers de config/), validée d'un bloc :
 * soit tout est valide et cohérent, soit rien n'est utilisé.
 */
import {
  allowlistSchema,
  formatSchemaError,
  launcherConfigSchema,
  newsSchema,
  rulesSchema,
  type Allowlist,
  type LauncherConfig,
  type NewsItem,
  type Rules
} from './schemas'

export interface PublicConfig {
  launcher: LauncherConfig
  /** Actus triées de la plus récente à la plus ancienne. */
  news: NewsItem[]
  rules: Rules
  allowlist: Allowlist
}

export const PUBLIC_CONFIG_FILES = ['launcher', 'news', 'rules', 'allowlist'] as const
export type PublicConfigFile = (typeof PUBLIC_CONFIG_FILES)[number]

/** D'où vient la configuration utilisée. */
export interface PublicConfigOrigin {
  kind: 'bundled' | 'cache' | 'online'
  /** Date (ISO) du dernier téléchargement réussi, null pour la copie embarquée. */
  updatedAt: string | null
}

export class PublicConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' ; '))
    this.name = 'PublicConfigError'
  }
}

/** Valide les 4 fichiers (contenu JSON déjà lu). Lève PublicConfigError avec des messages en français. */
export function parsePublicConfig(files: Record<PublicConfigFile, unknown>): PublicConfig {
  const problems: string[] = []
  const check = <T>(name: PublicConfigFile, result: { success: true; data: T } | { success: false; error: Parameters<typeof formatSchemaError>[0] }): T | null => {
    if (result.success) return result.data
    problems.push(...formatSchemaError(result.error).map((line) => `${name}.json → ${line}`))
    return null
  }
  const launcher = check('launcher', launcherConfigSchema.safeParse(files.launcher))
  const news = check('news', newsSchema.safeParse(files.news))
  const rules = check('rules', rulesSchema.safeParse(files.rules))
  const allowlist = check('allowlist', allowlistSchema.safeParse(files.allowlist))
  if (launcher && rules && launcher.rulesVersion !== rules.version) {
    problems.push(`launcher.json → rulesVersion (${launcher.rulesVersion}) différent de rules.json → version (${rules.version})`)
  }
  if (!launcher || !news || !rules || !allowlist || problems.length > 0) throw new PublicConfigError(problems)
  return { launcher, news: [...news].sort((a, b) => b.date.localeCompare(a.date)), rules, allowlist }
}
