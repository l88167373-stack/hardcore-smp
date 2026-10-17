/**
 * Construction de la ligne de commande de Minecraft à partir du fichier de version.
 */
import { rulesAllow, type Argument, type RuleContext, type VersionJson } from './version'

export interface LaunchValues {
  gameDirectory: string
  assetsDirectory: string
  librariesDirectory: string
  nativesDirectory: string
  classpath: string[]
  classpathSeparator: string
  versionName: string
  versionType: string
  assetIndexName: string
  username: string
  /** UUID sans tirets (format attendu par le jeu). */
  uuid: string
  accessToken: string
  userType: 'msa' | 'legacy'
  xuid: string
  clientId: string
  launcherName: string
  launcherVersion: string
  memoryMb: number
  resolution: { width: number; height: number } | null
  fullscreen: boolean
  /** « hôte:port » pour se connecter directement au serveur, ou null. */
  quickPlayMultiplayer: string | null
  /** Arguments JVM ajoutés par le launcher (marqueur du Guard…). */
  launcherJvmArgs: string[]
  /** Arguments JVM saisis par le joueur (déjà filtrés, voir sanitizeUserJvmArgs). */
  userJvmArgs: string[]
  /** Argument de configuration des logs (log4j), déjà résolu. */
  loggingArgument: string | null
}

function expand(value: string, values: Record<string, string>): string {
  return value.replace(/\$\{([a-zA-Z_]+)\}/g, (match, key: string) => values[key] ?? match)
}

function resolveArguments(args: Argument[], ctx: RuleContext, values: Record<string, string>): string[] {
  const result: string[] = []
  for (const arg of args) {
    if (typeof arg === 'string') {
      result.push(expand(arg, values))
    } else if (rulesAllow(arg.rules, ctx)) {
      const list = Array.isArray(arg.value) ? arg.value : [arg.value]
      result.push(...list.map((v) => expand(v, values)))
    }
  }
  return result
}

export function buildLaunchArguments(version: VersionJson, launch: LaunchValues, baseCtx: RuleContext): string[] {
  const ctx: RuleContext = {
    ...baseCtx,
    features: {
      ...baseCtx.features,
      is_demo_user: false,
      has_custom_resolution: launch.resolution !== null && !launch.fullscreen,
      is_quick_play_multiplayer: launch.quickPlayMultiplayer !== null
    }
  }
  const values: Record<string, string> = {
    natives_directory: launch.nativesDirectory,
    launcher_name: launch.launcherName,
    launcher_version: launch.launcherVersion,
    classpath: launch.classpath.join(launch.classpathSeparator),
    classpath_separator: launch.classpathSeparator,
    library_directory: launch.librariesDirectory,
    version_name: launch.versionName,
    game_directory: launch.gameDirectory,
    assets_root: launch.assetsDirectory,
    assets_index_name: launch.assetIndexName,
    auth_uuid: launch.uuid,
    auth_access_token: launch.accessToken,
    auth_player_name: launch.username,
    auth_xuid: launch.xuid,
    clientid: launch.clientId,
    user_type: launch.userType,
    version_type: launch.versionType,
    resolution_width: String(launch.resolution?.width ?? 1280),
    resolution_height: String(launch.resolution?.height ?? 720),
    quickPlayMultiplayer: launch.quickPlayMultiplayer ?? ''
  }

  const jvm = [
    `-Xms${Math.min(1024, launch.memoryMb)}M`,
    `-Xmx${launch.memoryMb}M`,
    ...launch.launcherJvmArgs,
    ...launch.userJvmArgs,
    ...(launch.loggingArgument ? [launch.loggingArgument] : []),
    ...resolveArguments(version.arguments?.jvm ?? [], ctx, values)
  ]
  const game = resolveArguments(version.arguments?.game ?? [], ctx, values)
  if (launch.fullscreen) game.push('--fullscreen')
  return [...jvm, version.mainClass, ...game]
}

/**
 * Arguments JVM du joueur : on retire ce qui permettrait d'injecter du code dans le jeu
 * (agents Java, classpath modifié…) et ce qui doublonne le réglage de RAM.
 */
const FORBIDDEN_PREFIXES = [
  '-javaagent',
  '-agentlib',
  '-agentpath',
  '-Xbootclasspath',
  '--patch-module',
  '--add-opens',
  '--add-exports',
  '-cp',
  '-classpath',
  '--class-path',
  '-jar',
  '-Xmx',
  '-Xms',
  '-Dhsmp.'
]

export function sanitizeUserJvmArgs(raw: string): { args: string[]; rejected: string[] } {
  const tokens = raw.match(/"[^"]*"|\S+/g) ?? []
  const args: string[] = []
  const rejected: string[] = []
  for (const token of tokens.map((t) => t.replace(/^"(.*)"$/, '$1'))) {
    if (!token.startsWith('-') || FORBIDDEN_PREFIXES.some((prefix) => token.toLowerCase().startsWith(prefix.toLowerCase()))) {
      rejected.push(token)
    } else {
      args.push(token)
    }
  }
  return { args, rejected }
}
