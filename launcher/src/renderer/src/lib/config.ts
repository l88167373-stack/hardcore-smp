/**
 * Configuration publique (config/*.json) côté interface.
 * La version utilisée vient du process principal (en ligne, cache ou copie embarquée : `bridge.config`).
 * La copie embarquée ci-dessous sert au premier affichage et à l'aperçu dans un navigateur.
 */
import allowlistJson from '@config/allowlist.json'
import launcherJson from '@config/launcher.json'
import newsJson from '@config/news.json'
import rulesJson from '@config/rules.json'
import { parsePublicConfig, type PublicConfig } from '@shared/public-config'

export type { PublicConfig }

export const bundledConfig: PublicConfig = parsePublicConfig({
  launcher: launcherJson,
  news: newsJson,
  rules: rulesJson,
  allowlist: allowlistJson
})
