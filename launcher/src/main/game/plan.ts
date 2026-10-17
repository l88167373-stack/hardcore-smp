/**
 * Plan d'installation : la liste complète des fichiers nécessaires (Java, Minecraft, Fabric, mods, Guard),
 * chacun avec son adresse, sa taille et son empreinte. Rien n'est codé en dur : tout vient des fichiers
 * officiels de Mojang, Fabric et Modrinth, et de config/launcher.json.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { InstallGroupId } from '../../shared/game'
import { KIND_FOLDER } from '../../shared/mods'
import type { LauncherConfig } from '../../shared/schemas'
import type { ManagedFile } from '../mods/content'
import { hashFile, type FetchLike, type FileItem } from './download'
import { GameError } from './errors'
import { fetchJson } from './fetch-json'
import type { GameLayout } from './layout'
import { mavenPath, mergeVersions, rulesAllow, type RuleContext, type VersionJson } from './version'

export const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
export const JAVA_RUNTIME_MANIFEST_URL =
  'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
export const FABRIC_META = 'https://meta.fabricmc.net/v2'
export const ASSETS_BASE = 'https://resources.download.minecraft.net'

export interface InstallPlan {
  schema: 2
  minecraftVersion: string
  fabricLoaderVersion: string
  /** Identifiant de la version lancée (ex. fabric-loader-0.19.5-26.2). */
  versionId: string
  version: VersionJson
  assetIndexId: string
  javaExecutable: string
  javaLinks: { path: string; target: string }[]
  loggingArgument: string | null
  files: FileItem[]
  /** Mods, packs et shaders actifs + HSMP Guard. */
  content: ManagedFile[]
  skipped: { group: InstallGroupId; note: string }[]
}

export interface PlanContext {
  layout: GameLayout
  config: LauncherConfig
  /** Mods, packs et shaders actifs (fournis par le service des mods). */
  content: ManagedFile[]
  platform: NodeJS.Platform
  arch: string
  ruleContext: RuleContext
  fetch: FetchLike
  userAgent: string
  /** Développement uniquement : jar de HSMP Guard compilé sur ce PC (tant qu'il n'est pas publié). */
  devGuardJar?: string
}

/** Clé de plateforme du Java officiel de Mojang. */
export function javaPlatformKey(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'x64' ? 'windows-x64' : arch === 'ia32' ? 'windows-x86' : null
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  if (platform === 'linux') return arch === 'x64' ? 'linux' : arch === 'ia32' ? 'linux-i386' : null
  return null
}

export function javaExecutablePath(runtimeDir: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return path.join(runtimeDir, 'bin', 'javaw.exe')
  if (platform === 'darwin') return path.join(runtimeDir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
  return path.join(runtimeDir, 'bin', 'java')
}

/** Empêche un fichier distant de s'écrire en dehors du dossier prévu (« ../ »). */
function inside(base: string, relative: string): string {
  const resolved = path.resolve(base, relative)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new GameError('unknown', `Chemin refusé : ${relative}`)
  return resolved
}

async function writeText(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text, 'utf8')
}

interface JavaManifestEntry {
  type: 'file' | 'directory' | 'link'
  executable?: boolean
  target?: string
  downloads?: { raw: { url: string; sha1: string; size: number } }
}

export async function resolveInstallPlan(ctx: PlanContext): Promise<InstallPlan> {
  const { layout, config, fetch: fetchFn, userAgent } = ctx
  const mcId = config.minecraftVersion
  const files: FileItem[] = []
  const skipped: InstallPlan['skipped'] = []

  // --- Minecraft -----------------------------------------------------------
  const { data: manifest } = await fetchJson<{ versions: { id: string; url: string; sha1: string }[] }>(fetchFn, VERSION_MANIFEST_URL, userAgent)
  const entry = manifest.versions.find((v) => v.id === mcId)
  if (!entry) throw new GameError('unknown', `Minecraft ${mcId} introuvable chez Mojang`)
  const vanillaJsonPath = path.join(layout.versions, mcId, `${mcId}.json`)
  const { data: vanilla, text: vanillaText } = await fetchJson<VersionJson>(fetchFn, entry.url, userAgent, entry.sha1)
  await writeText(vanillaJsonPath, vanillaText)
  files.push({ url: entry.url, path: vanillaJsonPath, sha1: entry.sha1, group: 'minecraft' })

  const client = vanilla.downloads?.client
  if (!client) throw new GameError('unknown', 'Fichier de version sans client.jar')
  files.push({ url: client.url, path: path.join(layout.versions, mcId, `${mcId}.jar`), sha1: client.sha1, size: client.size, group: 'minecraft' })

  // --- Fabric ----------------------------------------------------------------
  const loader = config.fabricLoaderVersion
  const profileUrl = `${FABRIC_META}/versions/loader/${encodeURIComponent(mcId)}/${encodeURIComponent(loader)}/profile/json`
  const { data: fabric, text: fabricText } = await fetchJson<VersionJson>(fetchFn, profileUrl, userAgent)
  if (fabric.inheritsFrom !== mcId) throw new GameError('unknown', `Profil Fabric inattendu (${fabric.inheritsFrom})`)
  await writeText(path.join(layout.versions, fabric.id, `${fabric.id}.json`), fabricText)

  const version = mergeVersions(fabric, vanilla)
  const fabricLibraryNames = new Set(fabric.libraries.map((l) => l.name))

  // --- Bibliothèques (Minecraft + Fabric) --------------------------------------
  for (const library of version.libraries) {
    if (!rulesAllow(library.rules, ctx.ruleContext)) continue
    const group: InstallGroupId = fabricLibraryNames.has(library.name) ? 'fabric' : 'minecraft'
    const artifact = library.downloads?.artifact
    if (artifact?.url && artifact.path) {
      files.push({ url: artifact.url, path: inside(layout.libraries, artifact.path), sha1: artifact.sha1, size: artifact.size, group })
    } else if (library.url) {
      const relative = mavenPath(library.name)
      files.push({ url: `${library.url.replace(/\/?$/, '/')}${relative}`, path: inside(layout.libraries, relative), sha1: library.sha1, size: library.size, group })
    }
  }

  // --- Configuration des logs ---------------------------------------------------
  let loggingArgument: string | null = null
  const logging = vanilla.logging?.client
  if (logging) {
    const logConfig = inside(path.join(layout.assets, 'log_configs'), logging.file.id)
    files.push({ url: logging.file.url, path: logConfig, sha1: logging.file.sha1, size: logging.file.size, group: 'minecraft' })
    loggingArgument = logging.argument.replace('${path}', logConfig)
  }

  // --- Assets (sons, langues, textures) -----------------------------------------
  const assetIndex = vanilla.assetIndex
  if (!assetIndex) throw new GameError('unknown', 'Fichier de version sans index des assets')
  const indexPath = path.join(layout.assets, 'indexes', `${assetIndex.id}.json`)
  const { data: assets, text: assetsText } = await fetchJson<{ objects: Record<string, { hash: string; size: number }> }>(
    fetchFn,
    assetIndex.url,
    userAgent,
    assetIndex.sha1
  )
  await writeText(indexPath, assetsText)
  files.push({ url: assetIndex.url, path: indexPath, sha1: assetIndex.sha1, size: assetIndex.size, group: 'minecraft' })
  const seenHashes = new Set<string>()
  for (const object of Object.values(assets.objects)) {
    if (!/^[0-9a-f]{40}$/.test(object.hash) || seenHashes.has(object.hash)) continue
    seenHashes.add(object.hash)
    const prefix = object.hash.slice(0, 2)
    files.push({
      url: `${ASSETS_BASE}/${prefix}/${object.hash}`,
      path: path.join(layout.assets, 'objects', prefix, object.hash),
      sha1: object.hash,
      size: object.size,
      group: 'minecraft'
    })
  }

  // --- Java (runtime officiel de Mojang) ------------------------------------------
  const component = vanilla.javaVersion?.component ?? 'java-runtime-epsilon'
  const platformKey = javaPlatformKey(ctx.platform, ctx.arch)
  if (!platformKey) throw new GameError('unsupported-platform', `${ctx.platform} ${ctx.arch}`)
  const { data: runtimes } = await fetchJson<Record<string, Record<string, { manifest: { url: string; sha1: string } }[]>>>(
    fetchFn,
    JAVA_RUNTIME_MANIFEST_URL,
    userAgent
  )
  const runtime = runtimes[platformKey]?.[component]?.[0]
  if (!runtime) throw new GameError('unsupported-platform', `${component} indisponible pour ${platformKey}`)
  const { data: javaFiles } = await fetchJson<{ files: Record<string, JavaManifestEntry> }>(
    fetchFn,
    runtime.manifest.url,
    userAgent,
    runtime.manifest.sha1
  )
  const runtimeDir = path.join(layout.runtime, component)
  const javaLinks: InstallPlan['javaLinks'] = []
  for (const [relative, info] of Object.entries(javaFiles.files)) {
    const target = inside(runtimeDir, relative)
    if (info.type === 'file' && info.downloads) {
      files.push({ url: info.downloads.raw.url, path: target, sha1: info.downloads.raw.sha1, size: info.downloads.raw.size, group: 'java', executable: info.executable === true })
    } else if (info.type === 'link' && info.target) {
      javaLinks.push({ path: target, target: info.target })
    }
  }

  // --- Mods, packs de ressources et shaders (choisis dans l'onglet Mods) ------------
  const content: ManagedFile[] = [...ctx.content]

  // --- HSMP Guard ---------------------------------------------------------------
  const guard = config.guard
  if (ctx.devGuardJar) {
    const stat = await fs.stat(ctx.devGuardJar)
    content.push({
      projectId: 'hsmp-guard',
      versionId: 'dev',
      kind: 'mod',
      fileName: path.basename(ctx.devGuardJar),
      url: pathToFileURL(ctx.devGuardJar).toString(),
      sha512: await hashFile(ctx.devGuardJar, 'sha512'),
      size: stat.size,
      required: true,
      source: 'guard'
    })
  } else if (guard.url.startsWith('TODO_') || guard.sha512.startsWith('TODO_')) {
    skipped.push({ group: 'guard', note: 'Pas encore publié sur GitHub' })
  } else {
    content.push({
      projectId: 'hsmp-guard',
      versionId: guard.version,
      kind: 'mod',
      fileName: `hsmp-guard-${guard.version}.jar`,
      url: guard.url,
      sha512: guard.sha512,
      size: 0,
      required: true,
      source: 'guard'
    })
  }

  for (const item of content) {
    files.push({
      url: item.url,
      path: inside(layout[KIND_FOLDER[item.kind]], item.fileName),
      sha512: item.sha512,
      size: item.size > 0 ? item.size : undefined,
      group: item.source === 'guard' ? 'guard' : 'mods'
    })
  }

  return {
    schema: 2,
    minecraftVersion: mcId,
    fabricLoaderVersion: loader,
    versionId: fabric.id,
    version,
    assetIndexId: assetIndex.id,
    javaExecutable: javaExecutablePath(runtimeDir, ctx.platform),
    javaLinks,
    loggingArgument,
    files,
    content,
    skipped
  }
}
