/**
 * Accès à l'API du process principal.
 * Dans Electron : `window.hsmp` (preload). Dans un navigateur (aperçu du design avec `npm run dev:web`) :
 * une version factice, pour pouvoir travailler l'interface sans lancer Electron.
 */
import { defaultSettings } from '@shared/defaults'
import type { GameState, InstallGroupProgress } from '@shared/game'
import type { AccountSummary, HsmpApi } from '@shared/ipc'
import { clampMemory } from '@shared/memory'
import type { CatalogProject, ContentKind, InstalledContent, ModsActionResult, ModsState } from '@shared/mods'
import type { Settings } from '@shared/schemas'
import { MOCK_CATALOG, MOCK_INSTALLED, mockServerStatus } from '../mock/data'
import { bundledConfig } from './config'

/** Faux catalogue pour l'aperçu navigateur : même règle d'accès que le vrai (allowlist). */
function createBrowserMods(): HsmpApi['mods'] {
  const { allowlist, launcher } = bundledConfig
  const lists: Record<ContentKind, { projectId: string; recommended?: boolean; required?: boolean }[]> = {
    mod: allowlist.mods,
    resourcepack: allowlist.resourcepacks,
    shader: allowlist.shaders
  }
  const entry = (p: { projectId: string; kind: ContentKind }) => lists[p.kind].find((e) => e.projectId === p.projectId)
  const catalog: CatalogProject[] = MOCK_CATALOG.map((p) => ({
    ...p,
    iconUrl: null,
    access: launcher.requiredMods.includes(p.projectId) || entry(p)?.required ? 'required' : entry(p) ? 'allowed' : 'forbidden'
  }))
  const toInstalled = (p: CatalogProject): InstalledContent => ({
    projectId: p.projectId,
    kind: p.kind,
    title: p.title,
    author: p.author,
    iconUrl: null,
    versionNumber: '1.0.0',
    fileName: `${p.slug}.${p.kind === 'mod' ? 'jar' : 'zip'}`,
    enabled: true,
    active: true,
    required: p.access === 'required',
    auto: false,
    requiredBy: [],
    update: null
  })
  let state: ModsState = {
    items: catalog.filter((p) => MOCK_INSTALLED.includes(p.projectId)).map(toInstalled),
    busy: {},
    updatesCheckedAt: null,
    quarantineCount: 0
  }
  const listeners = new Set<(s: ModsState) => void>()
  const set = (next: ModsState): void => {
    state = next
    listeners.forEach((l) => l(state))
  }
  const slowly = async (projectId: string, change: () => ModsState, message: string): Promise<ModsActionResult> => {
    set({ ...state, busy: { ...state.busy, [projectId]: 'install' } })
    await new Promise((resolve) => setTimeout(resolve, 700))
    set({ ...change(), busy: {} })
    return { ok: true, message }
  }
  const title = (id: string): string => catalog.find((p) => p.projectId === id)?.title ?? id
  return {
    getState: async () => state,
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    search: async ({ kind, query, sort, offset, onlyAllowed }) => {
      const q = query.toLowerCase()
      let hits = catalog.filter((p) => p.kind === kind && `${p.title} ${p.summary}`.toLowerCase().includes(q))
      if (onlyAllowed) hits = hits.filter((p) => p.access !== 'forbidden')
      if (sort === 'downloads') hits = [...hits].sort((a, b) => b.downloads - a.downloads)
      return { hits: hits.slice(offset, offset + 20), total: hits.length, offset }
    },
    recommended: async () => catalog.filter((p) => p.access === 'required' || entry(p)?.recommended),
    details: async (projectId) => ({ projectId, body: `**${title(projectId)}** — description complète (aperçu navigateur).`, gallery: [] }),
    install: (projectId) =>
      slowly(projectId, () => {
        const project = catalog.find((p) => p.projectId === projectId)
        return project ? { ...state, items: [...state.items, toInstalled(project)] } : state
      }, `${title(projectId)} installé.`),
    uninstall: (projectId) =>
      slowly(projectId, () => ({ ...state, items: state.items.filter((i) => i.projectId !== projectId) }), `${title(projectId)} désinstallé.`),
    setEnabled: (projectId, enabled) =>
      slowly(
        projectId,
        () => ({ ...state, items: state.items.map((i) => (i.projectId === projectId ? { ...i, enabled, active: enabled } : i)) }),
        `${title(projectId)} ${enabled ? 'activé' : 'désactivé'}.`
      ),
    checkUpdates: async () => {
      set({ ...state, updatesCheckedAt: new Date().toISOString() })
      return { ok: true, message: 'Tout est à jour.' }
    },
    update: async () => ({ ok: true, message: 'Tout est à jour.' })
  }
}

function createBrowserBridge(): HsmpApi {
  const totalMemoryMb = 16 * 1024
  let settings: Settings = defaultSettings(totalMemoryMb)
  // Comptes factices : uniquement pour l'aperçu dans un navigateur.
  let accounts: AccountSummary[] = [
    { uuid: '8667ba71-b85a-4004-af54-457a9734eed7', username: 'Steve', skin: null, active: true, needsRelogin: false },
    { uuid: 'ec561538-f3fd-461d-aff5-086b22154bce', username: 'Alex', skin: null, active: false, needsRelogin: true }
  ]
  const listeners = new Set<(list: AccountSummary[]) => void>()
  const emit = (): void => listeners.forEach((listener) => listener(accounts))

  // Installation simulée pour l'aperçu dans un navigateur.
  let game: GameState = { phase: 'idle', installed: false, progress: null, error: null, quarantined: [], adopted: [] }
  const gameListeners = new Set<(state: GameState) => void>()
  const setGame = (patch: Partial<GameState>): void => {
    game = { ...game, ...patch }
    gameListeners.forEach((listener) => listener(game))
  }
  const fakeInstall = async (): Promise<void> => {
    const groups: InstallGroupProgress[] = [
      { id: 'java', label: 'Java 25', detail: 'Runtime officiel de Mojang', totalBytes: 105e6, doneBytes: 0, state: 'waiting' },
      { id: 'minecraft', label: 'Minecraft 26.2', detail: 'Jeu, bibliothèques et sons', totalBytes: 560e6, doneBytes: 0, state: 'waiting' },
      { id: 'fabric', label: 'Fabric Loader 0.19.5', detail: 'Chargeur de mods', totalBytes: 2e6, doneBytes: 0, state: 'waiting' },
      { id: 'guard', label: 'HSMP Guard', detail: 'Mod officiel du serveur', totalBytes: 0, doneBytes: 0, state: 'skipped', note: 'Pas encore publié (phase 5)' },
      { id: 'mods', label: 'Mods', detail: '8 mods (Fabric API + recommandés)', totalBytes: 9e6, doneBytes: 0, state: 'waiting' }
    ]
    const total = groups.reduce((sum, g) => sum + g.totalBytes, 0)
    for (let done = 0; done <= total; done += total / 40) {
      let left = done
      for (const g of groups) {
        if (g.state === 'skipped') continue
        g.doneBytes = Math.min(g.totalBytes, left)
        left -= g.doneBytes
        g.state = g.doneBytes >= g.totalBytes ? 'done' : g.doneBytes > 0 ? 'active' : 'waiting'
      }
      setGame({ progress: { step: 'Téléchargement', groups: structuredClone(groups), totalBytes: total, doneBytes: done } })
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
  }

  return {
    app: {
      getInfo: async () => ({
        version: '0.1.0',
        platform: 'win32',
        arch: 'x64',
        totalMemoryMb,
        gameDirectory: 'C:\\Users\\Joueur\\AppData\\Roaming\\.hardcore-smp',
        isPackaged: false
      })
    },
    window: {
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      close: () => undefined,
      getState: async () => ({ maximized: false, focused: true }),
      onStateChange: () => () => undefined
    },
    settings: {
      get: async () => settings,
      update: async (patch) => {
        settings = { ...settings, ...patch }
        settings.memoryMb = clampMemory(settings.memoryMb, totalMemoryMb)
        return settings
      }
    },
    shell: {
      openExternal: async (url) => {
        console.log('[aperçu navigateur] ouverture de', url)
        return true
      },
      openGameFolder: async () => undefined
    },
    clipboard: {
      writeText: async (text) => {
        await navigator.clipboard?.writeText(text)
      }
    },
    auth: {
      getStatus: async () => ({ configured: true, secureStorage: true })
    },
    accounts: {
      list: async () => accounts,
      add: async () => {
        await new Promise((resolve) => setTimeout(resolve, 900))
        const account: AccountSummary = {
          uuid: crypto.randomUUID(),
          username: `Survivant${accounts.length + 1}`,
          skin: null,
          active: true,
          needsRelogin: false
        }
        accounts = [...accounts.map((a) => ({ ...a, active: false })), account]
        emit()
        return { ok: true, account }
      },
      remove: async (uuid) => {
        accounts = accounts.filter((a) => a.uuid !== uuid)
        if (!accounts.some((a) => a.active) && accounts[0]) accounts = [{ ...accounts[0], active: true }, ...accounts.slice(1)]
        emit()
      },
      setActive: async (uuid) => {
        accounts = accounts.map((a) => ({ ...a, active: a.uuid === uuid }))
        emit()
      },
      onChange: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    game: {
      getState: async () => game,
      install: async () => {
        setGame({ phase: 'installing', error: null })
        await fakeInstall()
        setGame({ phase: 'idle', installed: true, progress: null })
        return { ok: true }
      },
      launch: async () => {
        setGame({ phase: 'launching' })
        await new Promise((resolve) => setTimeout(resolve, 1200))
        setGame({ phase: 'running' })
        setTimeout(() => setGame({ phase: 'idle' }), 4000)
        return { ok: true }
      },
      testLaunchOffline: async () => ({ ok: true }),
      onStateChange: (listener) => {
        gameListeners.add(listener)
        return () => gameListeners.delete(listener)
      }
    },
    mods: createBrowserMods(),
    config: {
      get: async () => ({ config: bundledConfig, origin: { kind: 'bundled', updatedAt: null } }),
      onChange: () => () => undefined
    },
    server: {
      getStatus: async () => mockServerStatus(),
      refresh: async () => mockServerStatus(),
      onChange: () => () => undefined
    },
    updates: {
      getState: async () => ({ status: 'disabled', version: null, progress: null, error: 'Aperçu dans un navigateur.' }),
      check: async () => ({ status: 'disabled', version: null, progress: null, error: 'Aperçu dans un navigateur.' }),
      install: async () => false,
      onChange: () => () => undefined
    },
    support: {
      latestLog: async () => '[aperçu navigateur] pas de journal',
      lastCrash: async () => null
    }
  }
}

export const bridge: HsmpApi = window.hsmp ?? createBrowserBridge()
export const isBrowserPreview = window.hsmp === undefined
