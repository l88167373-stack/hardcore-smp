/**
 * Gestion des comptes Microsoft : ajout (connexion), plusieurs comptes, compte actif,
 * renouvellement automatique des jetons et déconnexion.
 *
 * L'interface ne reçoit jamais de jeton : seulement pseudo, UUID, skin et état.
 */
import { authError } from '../../shared/auth-errors'
import type { AccountSummary, AddAccountResult, AuthStatus } from '../../shared/ipc'
import type { Logger } from '../log'
import { secretSchema, type AccountSecret, type AccountStore, type AccountsFile, type StoredAccount } from './account-store'
import { sessionFromMicrosoft, type MinecraftSession } from './chain'
import { AuthError, toAuthError } from './errors'
import type { Http } from './http'
import { buildAuthorizeUrl, createPkce, createState, exchangeCode, parseRedirect, refreshTokens } from './oauth'
import type { SkinCache } from './skins'
import type { Cipher } from './vault'

/** Avant de lancer le jeu, le jeton Minecraft doit encore être valable au moins 10 minutes. */
export const LAUNCH_MIN_VALIDITY_MS = 10 * 60 * 1000
/** En arrière-plan, on renouvelle dès qu'il reste moins de 6 heures. */
export const BACKGROUND_MIN_VALIDITY_MS = 6 * 60 * 60 * 1000

export interface AccountServiceDeps {
  http: Http
  clientId: string | null
  cipher: Cipher
  store: AccountStore
  skins: SkinCache
  /** Ouvre la fenêtre Microsoft et renvoie l'adresse de retour finale (ou rejette si elle est fermée). */
  openLoginWindow: (authorizeUrl: string) => Promise<string>
  log: Logger
  now?: () => number
}

/** Ce dont le lancement du jeu a besoin (phase 3). Ne quitte jamais le process principal. */
export interface LaunchSession {
  uuid: string
  username: string
  accessToken: string
}

export class AccountService {
  private readonly secrets = new Map<string, AccountSecret>()
  private readonly refreshing = new Map<string, Promise<AccountSecret>>()
  private readonly listeners = new Set<(accounts: AccountSummary[]) => void>()
  private loginInProgress = false
  private readonly now: () => number

  constructor(private readonly deps: AccountServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  status(): AuthStatus {
    return { configured: this.deps.clientId !== null, secureStorage: this.deps.cipher.available }
  }

  onChange(listener: (accounts: AccountSummary[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list(): Promise<AccountSummary[]> {
    const file = await this.deps.store.load()
    return Promise.all(file.accounts.map((account) => this.summarize(account, file.activeUuid)))
  }

  /** Connexion Microsoft complète. Si le compte existe déjà, il est simplement reconnecté. */
  async add(): Promise<AddAccountResult> {
    const { clientId } = this.deps
    if (!clientId) return { ok: false, error: authError('not-configured') }
    if (this.loginInProgress) return { ok: false, error: authError('login-in-progress') }
    this.loginInProgress = true
    try {
      const pkce = createPkce()
      const state = createState()
      const redirect = await this.deps.openLoginWindow(buildAuthorizeUrl(clientId, pkce, state))
      const code = parseRedirect(redirect, state)
      const microsoft = await exchangeCode(this.deps.http, clientId, code, pkce, this.now())
      const session = await sessionFromMicrosoft(this.deps.http, microsoft, this.now())
      const account = await this.saveSession(session, true)
      this.deps.log.info(`Connexion réussie : ${account.username} (${account.uuid})`)
      return { ok: true, account }
    } catch (error) {
      const authFailure = toAuthError(error)
      this.deps.log.warn(`Connexion échouée : ${authFailure.message}`)
      return { ok: false, error: authError(authFailure.code) }
    } finally {
      this.loginInProgress = false
    }
  }

  /** Déconnexion : le compte et ses jetons sont supprimés de ce PC. */
  async remove(uuid: string): Promise<void> {
    const file = await this.deps.store.load()
    const accounts = file.accounts.filter((a) => a.uuid !== uuid)
    const activeUuid = file.activeUuid === uuid ? (accounts[0]?.uuid ?? null) : file.activeUuid
    this.secrets.delete(uuid)
    await this.deps.store.save({ ...file, accounts, activeUuid })
    await this.deps.skins.remove(uuid)
    this.deps.log.info(`Compte déconnecté : ${uuid}`)
    await this.emit()
  }

  async setActive(uuid: string): Promise<void> {
    const file = await this.deps.store.load()
    if (!file.accounts.some((a) => a.uuid === uuid)) throw new AuthError('unknown', `compte inconnu : ${uuid}`)
    await this.deps.store.save({ ...file, activeUuid: uuid })
    await this.emit()
  }

  /**
   * Session prête à lancer le jeu, renouvelée si besoin.
   * Lève AuthError('session-expired') si le joueur doit se reconnecter.
   */
  async getLaunchSession(uuid?: string, minValidityMs = LAUNCH_MIN_VALIDITY_MS): Promise<LaunchSession> {
    const file = await this.deps.store.load()
    const account = file.accounts.find((a) => a.uuid === (uuid ?? file.activeUuid))
    if (!account) throw new AuthError('unknown', 'aucun compte sélectionné')
    let secret = this.readSecret(account)
    if (!secret) throw new AuthError('session-expired', 'aucun jeton enregistré pour ce compte')
    if (secret.minecraftExpiresAt - this.now() < minValidityMs) secret = await this.refresh(account, secret)
    const updated = (await this.deps.store.load()).accounts.find((a) => a.uuid === account.uuid) ?? account
    return { uuid: updated.uuid, username: updated.username, accessToken: secret.minecraftAccessToken }
  }

  /** Au démarrage : renouvelle le compte actif s'il expire bientôt. Les erreurs réseau sont ignorées (mode hors ligne). */
  async refreshActiveInBackground(): Promise<void> {
    try {
      const file = await this.deps.store.load()
      if (file.activeUuid) await this.getLaunchSession(file.activeUuid, BACKGROUND_MIN_VALIDITY_MS)
    } catch (error) {
      const failure = toAuthError(error)
      if (failure.code !== 'network') this.deps.log.warn(`Renouvellement en arrière-plan : ${failure.message}`)
    }
  }

  // --- interne -------------------------------------------------------------

  private refresh(account: StoredAccount, secret: AccountSecret): Promise<AccountSecret> {
    const pending = this.refreshing.get(account.uuid)
    if (pending) return pending
    const task = this.doRefresh(account, secret).finally(() => this.refreshing.delete(account.uuid))
    this.refreshing.set(account.uuid, task)
    return task
  }

  private async doRefresh(account: StoredAccount, secret: AccountSecret): Promise<AccountSecret> {
    const { clientId } = this.deps
    if (!clientId) throw new AuthError('not-configured')
    try {
      const microsoft = await refreshTokens(this.deps.http, clientId, secret.microsoftRefreshToken, this.now())
      const session = await sessionFromMicrosoft(this.deps.http, microsoft, this.now())
      if (session.profile.uuid !== account.uuid) throw new AuthError('unknown', 'le renouvellement a renvoyé un autre compte')
      await this.saveSession(session, false)
      this.deps.log.info(`Session renouvelée : ${session.profile.username}`)
      return this.toSecret(session)
    } catch (error) {
      const failure = toAuthError(error)
      if (failure.code === 'session-expired') {
        // Jeton révoqué ou trop vieux : on l'oublie, le joueur devra se reconnecter.
        await this.forgetSecret(account.uuid)
      }
      throw failure
    }
  }

  private toSecret(session: MinecraftSession): AccountSecret {
    return {
      microsoftRefreshToken: session.microsoftRefreshToken,
      minecraftAccessToken: session.minecraftAccessToken,
      minecraftExpiresAt: session.minecraftExpiresAt
    }
  }

  private async saveSession(session: MinecraftSession, makeActive: boolean): Promise<AccountSummary> {
    const secret = this.toSecret(session)
    this.secrets.set(session.profile.uuid, secret)
    const file = await this.deps.store.load()
    const existing = file.accounts.find((a) => a.uuid === session.profile.uuid)
    const stored: StoredAccount = {
      uuid: session.profile.uuid,
      // Le pseudo peut changer : on garde toujours le plus récent, l'UUID ne change jamais.
      username: session.profile.username,
      skinUrl: session.profile.skinUrl,
      secret: this.deps.cipher.available ? this.deps.cipher.encrypt(JSON.stringify(secret)) : null,
      addedAt: existing?.addedAt ?? new Date(this.now()).toISOString()
    }
    const accounts = existing
      ? file.accounts.map((a) => (a.uuid === stored.uuid ? stored : a))
      : [...file.accounts, stored]
    const next: AccountsFile = { ...file, accounts, activeUuid: makeActive ? stored.uuid : (file.activeUuid ?? stored.uuid) }
    await this.deps.store.save(next)
    await this.deps.skins.update(stored.uuid, stored.skinUrl)
    await this.emit()
    return this.summarize(stored, next.activeUuid)
  }

  private async forgetSecret(uuid: string): Promise<void> {
    this.secrets.delete(uuid)
    const file = await this.deps.store.load()
    await this.deps.store.save({ ...file, accounts: file.accounts.map((a) => (a.uuid === uuid ? { ...a, secret: null } : a)) })
    await this.emit()
  }

  private readSecret(account: StoredAccount): AccountSecret | null {
    const cached = this.secrets.get(account.uuid)
    if (cached) return cached
    if (!account.secret || !this.deps.cipher.available) return null
    try {
      const secret = secretSchema.parse(JSON.parse(this.deps.cipher.decrypt(account.secret)))
      this.secrets.set(account.uuid, secret)
      return secret
    } catch {
      // Trousseau du système changé ou fichier abîmé : reconnexion nécessaire.
      this.deps.log.warn(`Jetons illisibles pour ${account.uuid} : reconnexion nécessaire`)
      return null
    }
  }

  private async summarize(account: StoredAccount, activeUuid: string | null): Promise<AccountSummary> {
    return {
      uuid: account.uuid,
      username: account.username,
      skin: await this.deps.skins.read(account.uuid),
      active: account.uuid === activeUuid,
      needsRelogin: this.readSecret(account) === null
    }
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) return
    const accounts = await this.list()
    for (const listener of this.listeners) listener(accounts)
  }
}
