/**
 * Discord Rich Presence (@xhayper/discord-rpc) : « Dans le launcher » ou « En jeu sur HARDCORE SMP — Saison 2 »,
 * avec le temps écoulé, le logo et les boutons « Rejoindre le Discord » / « Télécharger le launcher ».
 *
 * Si Discord n'est pas ouvert, rien ne plante et rien ne s'affiche en erreur : on réessaie discrètement.
 */
import { Client } from '@xhayper/discord-rpc'
import type { Logger } from './log'

export type Presence = { kind: 'launcher' } | { kind: 'playing'; since: number }

export interface Activity {
  details: string
  state: string
  startTimestamp: number
  largeImageKey: string
  largeImageText: string
  buttons?: { label: string; url: string }[]
  instance: boolean
}

/** Ce dont on a besoin du client Discord (remplaçable dans les tests). */
export interface RpcClient {
  login(): Promise<void>
  destroy(): Promise<void>
  setActivity(activity: Activity): Promise<unknown>
  clearActivity(): Promise<unknown>
  onDisconnected(listener: () => void): void
}

export interface RichPresenceDeps {
  /** Application Discord (null tant qu'elle n'est pas renseignée dans app-config.json). */
  applicationId: string | null
  links: () => { discordInvite: string; download: string }
  log: Logger
  createClient?: (applicationId: string) => RpcClient
  retryMs?: number
  now?: () => number
}

const SEASON = 'HARDCORE SMP — Saison 2'
/** Clé de l'image envoyée dans le portail Discord (Rich Presence → Art Assets). */
export const LOGO_ASSET_KEY = 'logo'

function realClient(applicationId: string): RpcClient {
  const client = new Client({ clientId: applicationId, transport: { type: 'ipc' } })
  return {
    login: () => client.login(),
    destroy: () => client.destroy(),
    setActivity: async (activity) => client.user?.setActivity(activity),
    clearActivity: async () => client.user?.clearActivity(),
    onDisconnected: (listener) => {
      client.on('disconnected', listener)
    }
  }
}

const isLink = (url: string): boolean => url.startsWith('https://') && !url.includes('TODO_')

/** Ce qu'affiche Discord pour chaque état. */
export function activityFor(presence: Presence, launcherStartedAt: number, links: { discordInvite: string; download: string }): Activity {
  const buttons = [
    { label: 'Rejoindre le Discord', url: links.discordInvite },
    { label: 'Télécharger le launcher', url: links.download }
  ].filter((b) => isLink(b.url))
  return {
    details: presence.kind === 'playing' ? `En jeu sur ${SEASON}` : 'Dans le launcher',
    state: presence.kind === 'playing' ? 'Survis. Meurs. Reviens.' : SEASON,
    startTimestamp: presence.kind === 'playing' ? presence.since : launcherStartedAt,
    largeImageKey: LOGO_ASSET_KEY,
    largeImageText: SEASON,
    ...(buttons.length > 0 ? { buttons } : {}),
    instance: false
  }
}

export class RichPresenceService {
  private client: RpcClient | null = null
  private connecting: Promise<void> | null = null
  private enabled = false
  private presence: Presence = { kind: 'launcher' }
  private retry: NodeJS.Timeout | null = null
  private waitingLogged = false
  private readonly startedAt: number

  constructor(private readonly deps: RichPresenceDeps) {
    this.startedAt = (deps.now ?? Date.now)()
  }

  /** Activée / désactivée par le joueur (Paramètres). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (enabled) void this.connect()
    else void this.disconnect()
  }

  setPresence(presence: Presence): void {
    // Discord limite les changements de statut : on n'envoie que les vrais changements.
    if (JSON.stringify(presence) === JSON.stringify(this.presence)) return
    this.presence = presence
    void this.apply()
  }

  private async connect(): Promise<void> {
    const id = this.deps.applicationId
    if (!id) {
      if (!this.waitingLogged) this.deps.log.info('Rich Presence : identifiant de l’application Discord absent (app-config.json)')
      this.waitingLogged = true
      return
    }
    if (this.client || this.connecting || !this.enabled) return
    this.connecting = (async () => {
      const client = (this.deps.createClient ?? realClient)(id)
      try {
        await Promise.race([
          client.login(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), 10_000).unref())
        ])
        if (!this.enabled) {
          await client.destroy().catch(() => undefined)
          return
        }
        this.client = client
        this.waitingLogged = false
        this.deps.log.info('Rich Presence : connectée à Discord')
        client.onDisconnected(() => {
          if (this.client !== client) return
          this.client = null
          this.scheduleRetry()
        })
        await this.apply()
      } catch (error) {
        await client.destroy().catch(() => undefined)
        // Discord fermé (cas normal) ou application refusée : un seul message dans le journal, aucune erreur à l'écran.
        if (!this.waitingLogged) {
          this.deps.log.info(`Rich Presence : connexion à Discord impossible (${error instanceof Error ? error.message : String(error)}), nouvel essai plus tard`)
        }
        this.waitingLogged = true
        this.scheduleRetry()
      }
    })().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private scheduleRetry(): void {
    if (this.retry || !this.enabled) return
    this.retry = setTimeout(() => {
      this.retry = null
      void this.connect()
    }, this.deps.retryMs ?? 60_000)
    this.retry.unref()
  }

  private async apply(): Promise<void> {
    if (!this.client || !this.enabled) return
    try {
      await this.client.setActivity(activityFor(this.presence, this.startedAt, this.deps.links()))
    } catch (error) {
      this.deps.log.warn(`Rich Presence : statut refusé par Discord (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  private async disconnect(): Promise<void> {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const client = this.client
    this.client = null
    if (!client) return
    await client.clearActivity().catch(() => undefined)
    await client.destroy().catch(() => undefined)
  }

  stop(): Promise<void> {
    this.enabled = false
    return this.disconnect()
  }
}
