/**
 * État global de l'interface : tout vient du process principal (comptes, jeu, paramètres, config publique
 * en ligne, statut du serveur, mises à jour du launcher). Les mods ont leur propre état (écran Mods, `bridge.mods`).
 */
import { authError } from '@shared/auth-errors'
import type { GameActionResult, GameState } from '@shared/game'
import type { AccountSummary, AddAccountResult, AppInfo, AuthStatus } from '@shared/ipc'
import type { PublicConfigOrigin } from '@shared/public-config'
import type { Settings, SettingsPatch } from '@shared/schemas'
import { isBelowMinimum } from '@shared/semver'
import type { ServerStatus } from '@shared/server-status'
import type { UpdateState } from '@shared/updates'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { bridge } from '../lib/bridge'
import { bundledConfig, type PublicConfig } from '../lib/config'
import { DEFAULT_DEMO, type DemoFlags } from '../lib/demo'

interface AppStateValue {
  info: AppInfo
  settings: Settings
  updateSettings: (patch: SettingsPatch) => Promise<void>
  config: PublicConfig
  /** Provenance de la config : en ligne, dernière copie téléchargée ou copie embarquée. */
  configOrigin: PublicConfigOrigin
  authStatus: AuthStatus
  accounts: AccountSummary[]
  activeAccount: AccountSummary | null
  setActiveAccount: (uuid: string) => Promise<void>
  /** Ouvre la fenêtre de connexion Microsoft. */
  addAccount: () => Promise<AddAccountResult>
  removeAccount: (uuid: string) => Promise<void>
  game: GameState
  installGame: (mode: 'quick' | 'repair') => Promise<GameActionResult>
  launchGame: () => Promise<GameActionResult>
  /** Statut du serveur (null avant la première vérification). */
  server: ServerStatus | null
  refreshServer: () => Promise<void>
  update: UpdateState
  /** Le launcher est trop ancien (minLauncherVersion) : il faut le mettre à jour avant de jouer. */
  mustUpdate: boolean
  demo: DemoFlags
  setDemo: (patch: Partial<DemoFlags>) => void
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [game, setGame] = useState<GameState | null>(null)
  const [server, setServer] = useState<ServerStatus | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [snapshot, setSnapshot] = useState<{ config: PublicConfig; origin: PublicConfigOrigin }>({
    config: bundledConfig,
    origin: { kind: 'bundled', updatedAt: null }
  })
  const [demo, setDemoState] = useState<DemoFlags>(DEFAULT_DEMO)

  useEffect(() => {
    const unsubscribe = [
      bridge.accounts.onChange(setAccounts),
      bridge.game.onStateChange(setGame),
      bridge.config.onChange(setSnapshot),
      bridge.server.onChange(setServer),
      bridge.updates.onChange(setUpdate)
    ]
    void Promise.all([
      bridge.app.getInfo(),
      bridge.settings.get(),
      bridge.auth.getStatus(),
      bridge.accounts.list(),
      bridge.game.getState(),
      bridge.config.get(),
      bridge.server.getStatus(),
      bridge.updates.getState()
    ]).then(([appInfo, appSettings, status, list, gameState, configSnapshot, serverStatus, updateState]) => {
      setInfo(appInfo)
      setSettings(appSettings)
      setAuthStatus(status)
      setAccounts(list)
      setGame(gameState)
      setSnapshot(configSnapshot)
      // Un statut arrivé entre-temps (événement) est plus récent : on ne l'écrase pas.
      setServer((current) => current ?? serverStatus)
      setUpdate((current) => current ?? updateState)
    })
    return () => unsubscribe.forEach((stop) => stop())
  }, [])

  const refreshServer = useCallback(async () => {
    setServer(await bridge.server.refresh())
  }, [])

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    setSettings(await bridge.settings.update(patch))
  }, [])

  const setDemo = useCallback((patch: Partial<DemoFlags>) => setDemoState((d) => ({ ...d, ...patch })), [])

  const addAccount = useCallback(async (): Promise<AddAccountResult> => {
    // Panneau Démo : permet d'afficher chaque message d'erreur sans compte réel.
    if (demo.loginError) {
      await new Promise((resolve) => window.setTimeout(resolve, 600))
      return { ok: false, error: authError(demo.loginError) }
    }
    const result = await bridge.accounts.add()
    setAccounts(await bridge.accounts.list())
    return result
  }, [demo.loginError])

  const removeAccount = useCallback(async (uuid: string) => {
    await bridge.accounts.remove(uuid)
    setAccounts(await bridge.accounts.list())
  }, [])

  const installGame = useCallback((mode: 'quick' | 'repair') => bridge.game.install(mode), [])
  const launchGame = useCallback(() => bridge.game.launch(), [])

  const setActiveAccount = useCallback(async (uuid: string) => {
    await bridge.accounts.setActive(uuid)
    setAccounts(await bridge.accounts.list())
  }, [])

  const value = useMemo<AppStateValue | null>(() => {
    if (!info || !settings || !authStatus || !game || !update) return null
    const { config, origin } = snapshot
    return {
      info,
      settings,
      updateSettings,
      config,
      configOrigin: origin,
      authStatus,
      accounts,
      activeAccount: accounts.find((a) => a.active) ?? null,
      setActiveAccount,
      addAccount,
      removeAccount,
      game,
      installGame,
      launchGame,
      server,
      refreshServer,
      update,
      mustUpdate: isBelowMinimum(info.version, config.launcher.minLauncherVersion),
      demo,
      setDemo
    }
  }, [
    info,
    settings,
    updateSettings,
    snapshot,
    authStatus,
    accounts,
    setActiveAccount,
    addAccount,
    removeAccount,
    game,
    installGame,
    launchGame,
    server,
    refreshServer,
    update,
    demo,
    setDemo
  ])

  if (!value) return null
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState doit être utilisé dans <AppStateProvider>')
  return value
}
