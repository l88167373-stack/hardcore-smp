/**
 * Fichiers de version Minecraft (format officiel « client.json ») et règles de compatibilité.
 * https://minecraft.wiki/w/Client.json
 */

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; arch?: string; version?: string }
  features?: Record<string, boolean>
}

export type Argument = string | { rules?: Rule[]; value: string | string[] }

export interface DownloadInfo {
  url: string
  sha1?: string
  size?: number
  path?: string
}

export interface Library {
  name: string
  /** Bibliothèques Mojang : téléchargement décrit précisément. */
  downloads?: { artifact?: DownloadInfo }
  /** Bibliothèques Fabric : dépôt Maven de base. */
  url?: string
  sha1?: string
  size?: number
  rules?: Rule[]
}

export interface VersionJson {
  id: string
  inheritsFrom?: string
  type?: string
  mainClass: string
  arguments?: { game?: Argument[]; jvm?: Argument[] }
  libraries: Library[]
  assetIndex?: DownloadInfo & { id: string; totalSize?: number }
  assets?: string
  downloads?: { client?: DownloadInfo }
  javaVersion?: { component: string; majorVersion: number }
  logging?: { client?: { argument: string; file: DownloadInfo & { id: string } } }
}

export type OsName = 'windows' | 'osx' | 'linux'

export interface RuleContext {
  os: OsName
  /** « x86 » = 32 bits, comme dans les fichiers de Mojang. */
  arch: 'x86' | 'x86_64' | 'arm64' | string
  features: Record<string, boolean>
}

export function osName(platform: NodeJS.Platform): OsName {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'osx'
  return 'linux'
}

export function mojangArch(arch: string): string {
  if (arch === 'x64') return 'x86_64'
  if (arch === 'ia32') return 'x86'
  return arch
}

/**
 * Règles de Mojang : sans règle, c'est autorisé. Sinon on part de « interdit »
 * et chaque règle qui correspond impose son action (la dernière gagne).
 */
export function rulesAllow(rules: Rule[] | undefined, ctx: RuleContext): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    const osMatches =
      !rule.os ||
      ((rule.os.name === undefined || rule.os.name === ctx.os) && (rule.os.arch === undefined || rule.os.arch === ctx.arch))
    const featuresMatch =
      !rule.features || Object.entries(rule.features).every(([key, value]) => (ctx.features[key] ?? false) === value)
    if (osMatches && featuresMatch) allowed = rule.action === 'allow'
  }
  return allowed
}

/** « org.ow2.asm:asm:9.10.1[:classifier] » → « org/ow2/asm/asm/9.10.1/asm-9.10.1[-classifier].jar ». */
export function mavenPath(name: string): string {
  const [group, artifact, version, classifier] = name.split(':')
  if (!group || !artifact || !version) throw new Error(`Nom de bibliothèque invalide : ${name}`)
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
  return [...group.split('.'), artifact, version, file].join('/')
}

/** Clé d'unicité d'une bibliothèque (groupe:artefact:classifier, sans la version). */
function libraryKey(name: string): string {
  const [group, artifact, , classifier] = name.split(':')
  return `${group}:${artifact}:${classifier ?? ''}`
}

/**
 * Fusionne une version « enfant » (Fabric) avec sa version parente (Minecraft) :
 * bibliothèques de l'enfant d'abord (elles remplacent celles du parent), arguments ajoutés à la suite.
 */
export function mergeVersions(child: VersionJson, parent: VersionJson): VersionJson {
  const childKeys = new Set(child.libraries.map((l) => libraryKey(l.name)))
  return {
    ...parent,
    id: child.id,
    type: child.type ?? parent.type,
    mainClass: child.mainClass || parent.mainClass,
    libraries: [...child.libraries, ...parent.libraries.filter((l) => !childKeys.has(libraryKey(l.name)))],
    arguments: {
      jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
      game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])]
    }
  }
}
