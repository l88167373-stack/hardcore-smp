/**
 * Faux Mojang / Fabric / Modrinth pour les tests : petits fichiers, vraies empreintes, aucun accès réseau.
 */
import { createHash } from 'node:crypto'
import type { FetchLike } from './download'
import { JAVA_RUNTIME_MANIFEST_URL, VERSION_MANIFEST_URL } from './plan'

const sha1 = (data: string | Buffer): string => createHash('sha1').update(data).digest('hex')
const sha512 = (data: string | Buffer): string => createHash('sha512').update(data).digest('hex')

/** Projet du faux Modrinth : ses versions, de la plus récente à la plus ancienne. */
export interface FakeProject {
  id: string
  slug: string
  title: string
  type: 'mod' | 'resourcepack' | 'shader'
  author: string
  versions: FakeVersion[]
}

export interface FakeVersion {
  id: string
  project_id: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha512: string; sha1: string } }[]
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[]
}

export interface FakeWorld {
  fetch: FetchLike
  requests: string[]
  /** Contenu servi par adresse (modifiable pour simuler un fichier corrompu). */
  content: Map<string, string>
  offline: boolean
  modrinth: Map<string, FakeProject>
  /** Publie une version sur le faux Modrinth (elle devient la plus récente) et renvoie son fichier. */
  publish(projectId: string, versionNumber: string, fileName: string, data: string, dependencies?: string[]): FakeVersion
}

export function createFakeWorld(): FakeWorld {
  const content = new Map<string, string>()
  const file = (url: string, data: string): { url: string; sha1: string; size: number } => {
    content.set(url, data)
    return { url, sha1: sha1(data), size: Buffer.byteLength(data) }
  }

  const client = file('https://piston-data.test/client.jar', 'CLIENT-JAR')
  const core = file('https://libraries.test/core-1.0.jar', 'CORE')
  const nativeWin = file('https://libraries.test/native-1.0-natives-windows.jar', 'NATIVE-WIN')
  const asmOld = file('https://libraries.test/asm-9.0.jar', 'ASM-OLD')
  const logging = file('https://piston-data.test/client.xml', '<Configuration/>')
  const objectA = file('https://resources.download.minecraft.net/aa/placeholder', 'SON-A')
  const objectC = file('https://resources.download.minecraft.net/cc/placeholder', 'LANGUE-C')
  // Les assets sont servis à l'adresse calculée à partir de leur empreinte.
  for (const object of [objectA, objectC]) {
    content.set(`https://resources.download.minecraft.net/${object.sha1.slice(0, 2)}/${object.sha1}`, content.get(object.url) ?? '')
  }

  const assetIndexText = JSON.stringify({
    objects: {
      'minecraft/sounds/a.ogg': { hash: objectA.sha1, size: objectA.size },
      'minecraft/sounds/a-copie.ogg': { hash: objectA.sha1, size: objectA.size },
      'minecraft/lang/fr_fr.json': { hash: objectC.sha1, size: objectC.size }
    }
  })
  const assetIndex = file('https://piston-meta.test/32.json', assetIndexText)

  const vanillaText = JSON.stringify({
    id: '26.2',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    arguments: {
      game: [
        '--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}',
        '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}',
        '--accessToken', '${auth_access_token}', '--userType', '${user_type}',
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
        { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }
      ],
      jvm: [
        { rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['-XstartOnFirstThread'] },
        '-Djava.library.path=${natives_directory}/java',
        '-cp',
        '${classpath}'
      ]
    },
    libraries: [
      { name: 'com.example:core:1.0', downloads: { artifact: { path: 'com/example/core/1.0/core-1.0.jar', ...core } } },
      {
        name: 'com.example:native:1.0:natives-windows',
        downloads: { artifact: { path: 'com/example/native/1.0/native-1.0-natives-windows.jar', ...nativeWin } },
        rules: [{ action: 'allow', os: { name: 'windows' } }]
      },
      { name: 'org.ow2.asm:asm:9.0', downloads: { artifact: { path: 'org/ow2/asm/asm/9.0/asm-9.0.jar', ...asmOld } } }
    ],
    assetIndex: { id: '32', ...assetIndex, totalSize: objectA.size + objectC.size },
    downloads: { client },
    javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 },
    logging: { client: { argument: '-Dlog4j.configurationFile=${path}', file: { id: 'client.xml', ...logging } } }
  })
  const vanilla = file('https://piston-meta.test/26.2.json', vanillaText)
  content.set(VERSION_MANIFEST_URL, JSON.stringify({ versions: [{ id: '26.2', url: vanilla.url, sha1: vanilla.sha1 }] }))

  const asmNew = file('https://maven.fabric.test/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar', 'ASM-NEW')
  const loader = file('https://maven.fabric.test/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar', 'FABRIC-LOADER')
  content.set(
    'https://meta.fabricmc.net/v2/versions/loader/26.2/0.19.5/profile/json',
    JSON.stringify({
      id: 'fabric-loader-0.19.5-26.2',
      inheritsFrom: '26.2',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
      libraries: [
        { name: 'org.ow2.asm:asm:9.10.1', url: 'https://maven.fabric.test/', sha1: asmNew.sha1, size: asmNew.size },
        { name: 'net.fabricmc:fabric-loader:0.19.5', url: 'https://maven.fabric.test/', sha1: loader.sha1, size: loader.size }
      ]
    })
  )

  const javaBin = file('https://piston-data.test/java', 'JAVA-BINAIRE')
  const javaExe = file('https://piston-data.test/javaw.exe', 'JAVAW-EXE')
  const javaManifest = file(
    'https://piston-meta.test/java-manifest.json',
    JSON.stringify({
      files: {
        bin: { type: 'directory' },
        'bin/java': { type: 'file', executable: true, downloads: { raw: javaBin } },
        'bin/javaw.exe': { type: 'file', executable: true, downloads: { raw: javaExe } }
      }
    })
  )
  const runtime = [{ manifest: { url: javaManifest.url, sha1: javaManifest.sha1 } }]
  content.set(JAVA_RUNTIME_MANIFEST_URL, JSON.stringify({ linux: { 'java-runtime-epsilon': runtime }, 'windows-x64': { 'java-runtime-epsilon': runtime } }))

  // Faux Modrinth : Fabric API (obligatoire), Sodium (recommandé) qui dépend d'une bibliothèque, Iris (shaders),
  // un shader, un pack de ressources, et Freecam (non autorisé).
  const modrinth = new Map<string, FakeProject>()
  const project = (id: string, slug: string, title: string, type: FakeProject['type']): void => {
    modrinth.set(id, { id, slug, title, type, author: `auteur-${slug}`, versions: [] })
  }
  const publish = (projectId: string, versionNumber: string, fileName: string, data: string, dependencies: string[] = []): FakeVersion => {
    const target = modrinth.get(projectId)
    if (!target) throw new Error(`projet inconnu ${projectId}`)
    const url = `https://cdn.modrinth.com/data/${projectId}/${fileName}`
    content.set(url, data)
    const loaders = target.type === 'mod' ? ['fabric'] : target.type === 'shader' ? ['iris', 'optifine'] : ['minecraft']
    const version: FakeVersion = {
      id: `${projectId}-${versionNumber}`,
      project_id: projectId,
      version_number: versionNumber,
      version_type: 'release',
      game_versions: ['26.2'],
      loaders,
      files: [{ url, filename: fileName, primary: true, size: Buffer.byteLength(data), hashes: { sha512: sha512(data), sha1: sha1(data) } }],
      dependencies: dependencies.map((d) => ({ project_id: d, version_id: null, dependency_type: 'required' }))
    }
    target.versions.unshift(version)
    return version
  }
  project('P7dR8mSH', 'fabric-api', 'Fabric API', 'mod')
  project('AANobbMI', 'sodium', 'Sodium', 'mod')
  project('LIBlib01', 'lib', 'Bibliothèque', 'mod')
  project('YL57xq9U', 'iris', 'Iris Shaders', 'mod')
  project('XeEZ3fK2', 'freecam', 'Freecam', 'mod')
  project('HVnmMxH1', 'complementary', 'Complementary', 'shader')
  project('w0TnApzs', 'faithful', 'Faithful 32x', 'resourcepack')
  publish('P7dR8mSH', '0.161.0', 'fabric-api-0.161.0.jar', 'FABRIC-API')
  publish('LIBlib01', '1.0', 'lib-1.0.jar', 'LIB')
  publish('AANobbMI', '0.9.2', 'sodium-0.9.2.jar', 'SODIUM', ['LIBlib01'])
  publish('YL57xq9U', '1.11.4', 'iris-1.11.4.jar', 'IRIS', ['AANobbMI'])
  publish('XeEZ3fK2', '1.5.0', 'freecam-1.5.0.jar', 'FREECAM')
  publish('HVnmMxH1', 'r5.9.3', 'Complementary_r5.9.3.zip', 'SHADER')
  publish('w0TnApzs', '26.2', 'Faithful-32x.zip', 'PACK')

  const json = (data: unknown): Response => new Response(JSON.stringify(data), { status: 200 })
  const hit = (p: FakeProject): unknown => ({
    project_id: p.id,
    slug: p.slug,
    title: p.title,
    author: p.author,
    description: `Description de ${p.title}`,
    downloads: 1000,
    icon_url: `https://cdn.modrinth.com/data/${p.id}/icon.png`,
    project_type: p.type
  })
  const allVersions = (): FakeVersion[] => [...modrinth.values()].flatMap((p) => p.versions)

  /** Routes de l'API Modrinth (GET et POST). */
  const modrinthApi = (url: URL, init?: RequestInit): Response => {
    const route = url.pathname.replace(/^\/v2/, '')
    const versionList = /^\/project\/([^/]+)\/version$/.exec(route)
    if (versionList) {
      const loaders = JSON.parse(url.searchParams.get('loaders') ?? '[]') as string[]
      const games = JSON.parse(url.searchParams.get('game_versions') ?? '[]') as string[]
      const versions = modrinth.get(versionList[1] ?? '')?.versions ?? []
      return json(versions.filter((v) => loaders.some((l) => v.loaders.includes(l)) && games.some((g) => v.game_versions.includes(g))))
    }
    const single = /^\/project\/([^/]+)$/.exec(route)
    if (single) {
      const p = modrinth.get(single[1] ?? '')
      if (!p) return new Response('introuvable', { status: 404 })
      return json({ id: p.id, slug: p.slug, title: p.title, description: `Description de ${p.title}`, body: `# ${p.title}`, project_type: p.type, downloads: 1000, icon_url: null, gallery: [] })
    }
    if (route === '/projects') {
      const ids = JSON.parse(url.searchParams.get('ids') ?? '[]') as string[]
      return json(ids.flatMap((id) => {
        const p = modrinth.get(id)
        return p ? [{ id: p.id, slug: p.slug, title: p.title, description: '', project_type: p.type, downloads: 1000, icon_url: null }] : []
      }))
    }
    if (route === '/search') {
      const facets = JSON.parse(url.searchParams.get('facets') ?? '[]') as string[][]
      const matches = (p: FakeProject): boolean =>
        facets.every((group) =>
          group.some((facet) => {
            const [key, value] = facet.split(':')
            if (key === 'project_type') return p.type === value
            if (key === 'project_id') return p.id === value
            return true
          })
        )
      const found = [...modrinth.values()].filter(matches)
      return json({ hits: found.map(hit), total_hits: found.length })
    }
    if (route === '/version_files' && init?.method === 'POST') {
      const { hashes } = JSON.parse(String(init.body)) as { hashes: string[] }
      const result: Record<string, FakeVersion> = {}
      for (const hash of hashes) {
        const version = allVersions().find((v) => v.files.some((f) => f.hashes.sha512 === hash))
        if (version) result[hash] = version
      }
      return json(result)
    }
    if (route === '/version_files/update' && init?.method === 'POST') {
      const { hashes, loaders } = JSON.parse(String(init.body)) as { hashes: string[]; loaders: string[] }
      const result: Record<string, FakeVersion> = {}
      for (const hash of hashes) {
        const current = allVersions().find((v) => v.files.some((f) => f.hashes.sha512 === hash))
        const latest = current && modrinth.get(current.project_id)?.versions.find((v) => loaders.some((l) => v.loaders.includes(l)))
        if (latest) result[hash] = latest
      }
      return json(result)
    }
    return new Response('introuvable', { status: 404 })
  }

  const world: FakeWorld = {
    content,
    requests: [],
    offline: false,
    modrinth,
    publish,
    fetch: async (url, init) => {
      if (world.offline) throw new TypeError('fetch failed: getaddrinfo ENOTFOUND')
      world.requests.push(url)
      if (url.startsWith('https://api.modrinth.com/v2/')) return modrinthApi(new URL(url), init)
      const body = content.get(url)
      if (body === undefined) return new Response('introuvable', { status: 404 })
      return new Response(body, { status: 200 })
    }
  }
  return world
}
