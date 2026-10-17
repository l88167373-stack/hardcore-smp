/**
 * Tests de la connexion Microsoft → Xbox → Minecraft, avec de faux serveurs (aucun accès réseau).
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAppConfig } from '../app-config'
import { redact, silentLogger } from '../log'
import { AccountService } from './account-service'
import { memoryAccountStore } from './account-store'
import { sessionFromMicrosoft } from './chain'
import { AuthError } from './errors'
import { createFakeServices, type FakeServices } from './fake-services'
import { createHttp } from './http'
import { cleanUserAgent, isMicrosoftLoginUrl } from './login-policy'
import { MC_ENTITLEMENTS_URL, MC_LOGIN_URL, MC_PROFILE_URL, XSTS_URL, dashUuid } from './minecraft'
import {
  REDIRECT_URI,
  TOKEN_URL,
  buildAuthorizeUrl,
  createPkce,
  createState,
  exchangeCode,
  isRedirectUrl,
  parseRedirect,
  refreshTokens
} from './oauth'
import { isOfficialSkinUrl, type SkinCache } from './skins'
import type { Cipher } from './vault'

const CLIENT_ID = '00001111-aaaa-2222-bbbb-3333cccc4444'
const STEVE_UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5'
const HOUR = 3600 * 1000

/** Faux chiffrement réversible (le vrai utilise le trousseau du système). */
const fakeCipher = (available = true): Cipher => ({
  available,
  encrypt: (plain) => `enc:${[...plain].map((c) => String.fromCharCode(c.charCodeAt(0) + 1)).join('')}`,
  decrypt: (encoded) => {
    if (!encoded.startsWith('enc:')) throw new Error('illisible')
    return [...encoded.slice(4)].map((c) => String.fromCharCode(c.charCodeAt(0) - 1)).join('')
  }
})

const fakeSkins = (): SkinCache & { updated: string[] } => {
  const updated: string[] = []
  return {
    updated,
    update: async (uuid) => {
      updated.push(uuid)
    },
    read: async () => null,
    remove: async () => undefined
  }
}

/** Fausse fenêtre Microsoft : l'utilisateur se connecte et Microsoft renvoie le code. */
const approvingWindow = async (authorizeUrl: string): Promise<string> => {
  const state = new URL(authorizeUrl).searchParams.get('state') ?? ''
  return `${REDIRECT_URI}?code=code-123&state=${encodeURIComponent(state)}`
}

const expectAuthError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(AuthError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('OAuth Microsoft (PKCE)', () => {
  it('génère un vérificateur valide et son défi SHA-256', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(createPkce().verifier).not.toBe(verifier)
    expect(createState()).not.toBe(createState())
  })

  it('construit l’adresse de connexion (comptes personnels, scope Xbox, PKCE S256)', () => {
    const url = new URL(buildAuthorizeUrl(CLIENT_ID, { verifier: 'v', challenge: 'c' }, 'etat'))
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe('https://login.microsoftonline.com/common/oauth2/nativeclient')
    expect(url.searchParams.get('scope')).toBe('XboxLive.signin offline_access')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('prompt')).toBe('select_account')
  })

  it('reconnaît uniquement la vraie adresse de retour', () => {
    expect(isRedirectUrl(`${REDIRECT_URI}?code=x`)).toBe(true)
    expect(isRedirectUrl('https://login.microsoftonline.com/common/oauth2/nativeclient.evil.com/?code=x')).toBe(false)
    expect(isRedirectUrl('https://evil.com/?r=https://login.microsoftonline.com/common/oauth2/nativeclient')).toBe(false)
  })

  it('extrait le code et vérifie « state »', () => {
    expect(parseRedirect(`${REDIRECT_URI}?code=abc&state=s1`, 's1')).toBe('abc')
    expect(() => parseRedirect(`${REDIRECT_URI}?code=abc&state=autre`, 's1')).toThrow(AuthError)
    expect(() => parseRedirect(`${REDIRECT_URI}?state=s1`, 's1')).toThrow(AuthError)
  })

  it('traduit les refus de Microsoft', () => {
    const codeOf = (query: string): string => {
      try {
        parseRedirect(`${REDIRECT_URI}?${query}`, 's')
        return 'aucune erreur'
      } catch (error) {
        return (error as AuthError).code
      }
    }
    expect(codeOf('error=access_denied&error_description=The+user+has+cancelled')).toBe('cancelled')
    expect(codeOf('error=access_denied&error_description=consent+denied')).toBe('consent-denied')
    expect(codeOf('error=unauthorized_client')).toBe('app-misconfigured')
  })
})

describe('chaîne Microsoft → Xbox → Minecraft', () => {
  let services: FakeServices
  const http = () => createHttp(services.fetch, 'hardcore-smp-launcher/test')

  beforeEach(() => {
    services = createFakeServices()
  })

  it('échange le code puis obtient une session Minecraft complète', async () => {
    const pkce = createPkce()
    const microsoft = await exchangeCode(http(), CLIENT_ID, 'code-123', pkce, 0)
    expect(microsoft).toEqual({ accessToken: 'ms-at-1', refreshToken: 'rt-1', expiresAt: HOUR })
    const tokenBody = new URLSearchParams(services.calls[0]?.body)
    expect(tokenBody.get('code_verifier')).toBe(pkce.verifier)
    expect(tokenBody.get('client_secret')).toBeNull()

    const session = await sessionFromMicrosoft(http(), microsoft, 0)
    expect(session.profile).toEqual({ uuid: STEVE_UUID, username: 'Steve', skinUrl: 'http://textures.minecraft.net/texture/abc' })
    expect(session.minecraftAccessToken).toBe('mc-token')
    expect(session.minecraftExpiresAt).toBe(24 * HOUR)
    expect(session.microsoftRefreshToken).toBe('rt-1')

    const xbl = JSON.parse(services.calls[1]?.body ?? '{}') as { Properties: { RpsTicket: string } }
    expect(xbl.Properties.RpsTicket).toBe('d=ms-at-1')
    const xsts = JSON.parse(services.calls[2]?.body ?? '{}') as { RelyingParty: string }
    expect(xsts.RelyingParty).toBe('rp://api.minecraftservices.com/')
    const login = JSON.parse(services.calls[3]?.body ?? '{}') as { identityToken: string }
    expect(login.identityToken).toBe('XBL3.0 x=uhs-123;xsts-token')
  })

  it.each([
    [2148916233, 'no-xbox-account'],
    [2148916238, 'child-account'],
    [2148916227, 'xbox-banned'],
    [2148916235, 'xbox-unavailable-country'],
    [2148916236, 'adult-verification']
  ])('XSTS XErr %s → %s', async (xerr, code) => {
    services.override(XSTS_URL, () => ({ status: 401, body: { XErr: xerr, Message: '' } }))
    await expectAuthError(sessionFromMicrosoft(http(), { accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), code)
  })

  it('application Azure pas encore validée par Mojang → message dédié', async () => {
    services.override(MC_LOGIN_URL, () => ({
      status: 403,
      body: { path: '/authentication/login_with_xbox', errorMessage: 'Invalid app registration, see https://aka.ms/AppRegInfo for more information' }
    }))
    await expectAuthError(sessionFromMicrosoft(http(), { accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), 'app-not-approved')
  })

  it('jeu non acheté → game-not-owned', async () => {
    services.override(MC_PROFILE_URL, () => ({ status: 404, body: { error: 'NOT_FOUND' } }))
    services.override(MC_ENTITLEMENTS_URL, () => ({ status: 200, body: { items: [] } }))
    await expectAuthError(sessionFromMicrosoft(http(), { accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), 'game-not-owned')
  })

  it('jeu acheté mais pas encore de pseudo → no-profile', async () => {
    services.override(MC_PROFILE_URL, () => ({ status: 404, body: { error: 'NOT_FOUND' } }))
    await expectAuthError(sessionFromMicrosoft(http(), { accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), 'no-profile')
  })

  it('pas d’Internet → network', async () => {
    services.offline = true
    await expectAuthError(exchangeCode(http(), CLIENT_ID, 'c', createPkce()), 'network')
  })

  it('trop de requêtes → rate-limited', async () => {
    services.override(MC_LOGIN_URL, () => ({ status: 429 }))
    await expectAuthError(sessionFromMicrosoft(http(), { accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), 'rate-limited')
  })

  it('jeton de rafraîchissement révoqué → session-expired', async () => {
    services.override(TOKEN_URL, () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'AADSTS70000: expired' } }))
    await expectAuthError(refreshTokens(http(), CLIENT_ID, 'vieux'), 'session-expired')
  })

  it('Client ID refusé par Microsoft → app-misconfigured', async () => {
    services.override(TOKEN_URL, () => ({ status: 401, body: { error: 'invalid_client', error_description: 'AADSTS7000218' } }))
    await expectAuthError(exchangeCode(http(), CLIENT_ID, 'c', createPkce()), 'app-misconfigured')
  })

  it('met l’UUID au format avec tirets', () => {
    expect(dashUuid('069a79f444e94726a5befca90e38aaf5')).toBe(STEVE_UUID)
    expect(() => dashUuid('pas-un-uuid')).toThrow(AuthError)
  })
})

describe('comptes (multi-comptes, chiffrement, renouvellement)', () => {
  let services: FakeServices
  let now: number

  const makeService = (overrides: Partial<ConstructorParameters<typeof AccountService>[0]> = {}) => {
    const store = overrides.store ?? memoryAccountStore()
    const skins = fakeSkins()
    const service = new AccountService({
      http: createHttp(services.fetch, 'test'),
      clientId: CLIENT_ID,
      cipher: fakeCipher(),
      store,
      skins,
      openLoginWindow: approvingWindow,
      log: silentLogger,
      now: () => now,
      ...overrides
    })
    return { service, store: store as ReturnType<typeof memoryAccountStore>, skins }
  }

  beforeEach(() => {
    services = createFakeServices()
    now = 1_000_000
  })

  it('sans Client ID Azure : message clair, aucune fenêtre ouverte', async () => {
    const openLoginWindow = vi.fn(approvingWindow)
    const { service } = makeService({ clientId: null, openLoginWindow })
    const result = await service.add()
    expect(result).toMatchObject({ ok: false, error: { code: 'not-configured' } })
    expect(openLoginWindow).not.toHaveBeenCalled()
    expect(service.status()).toEqual({ configured: false, secureStorage: true })
  })

  it('ajoute un compte : actif, jetons chiffrés, skin téléchargée', async () => {
    const { service, store, skins } = makeService()
    const result = await service.add()
    expect(result).toMatchObject({ ok: true, account: { uuid: STEVE_UUID, username: 'Steve', active: true, needsRelogin: false } })
    const saved = store.data.accounts[0]
    expect(saved?.secret).toBeTruthy()
    expect(saved?.secret).not.toContain('rt-1')
    expect(saved?.secret).not.toContain('mc-token')
    expect(skins.updated).toEqual([STEVE_UUID])
    // L'interface ne reçoit jamais de jeton.
    expect(JSON.stringify(await service.list())).not.toMatch(/rt-1|mc-token|ms-at/)
  })

  it('se reconnecter avec le même compte ne crée pas de doublon et met à jour le pseudo', async () => {
    const { service, store } = makeService()
    await service.add()
    services.profile.name = 'SteveRenamed'
    await service.add()
    expect(store.data.accounts).toHaveLength(1)
    expect(store.data.accounts[0]?.username).toBe('SteveRenamed')
  })

  it('plusieurs comptes : le dernier connecté devient actif, on peut changer', async () => {
    const { service } = makeService()
    await service.add()
    services.profile = { id: 'ec561538f3fd461daff5086b22154bce', name: 'Alex', skinUrl: null }
    await service.add()
    let list = await service.list()
    expect(list.map((a) => [a.username, a.active])).toEqual([
      ['Steve', false],
      ['Alex', true]
    ])
    await service.setActive(STEVE_UUID)
    list = await service.list()
    expect(list.find((a) => a.active)?.username).toBe('Steve')
  })

  it('déconnexion du compte actif : un autre compte prend le relais', async () => {
    const { service, store } = makeService()
    await service.add()
    services.profile = { id: 'ec561538f3fd461daff5086b22154bce', name: 'Alex', skinUrl: null }
    await service.add()
    await service.remove('ec561538-f3fd-461d-aff5-086b22154bce')
    expect(store.data.accounts.map((a) => a.username)).toEqual(['Steve'])
    expect(store.data.activeUuid).toBe(STEVE_UUID)
  })

  it('fenêtre fermée par le joueur → annulé, aucun compte ajouté', async () => {
    const { service, store } = makeService({ openLoginWindow: async () => Promise.reject(new AuthError('cancelled')) })
    expect(await service.add()).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(store.data.accounts).toHaveLength(0)
  })

  it('une seule connexion à la fois', async () => {
    let release: (url: string) => void = () => undefined
    const { service } = makeService({
      openLoginWindow: (url) =>
        new Promise((resolve) => {
          release = () => void approvingWindow(url).then(resolve)
        })
    })
    const first = service.add()
    expect(await service.add()).toMatchObject({ ok: false, error: { code: 'login-in-progress' } })
    release('')
    expect(await first).toMatchObject({ ok: true })
  })

  it('jeton encore valable : pas de renouvellement avant de jouer', async () => {
    const { service } = makeService()
    await service.add()
    const before = services.calls.length
    now += 2 * HOUR
    const session = await service.getLaunchSession()
    expect(session).toEqual({ uuid: STEVE_UUID, username: 'Steve', accessToken: 'mc-token' })
    expect(services.calls.length).toBe(before)
  })

  it('jeton bientôt expiré : renouvellement automatique et nouveau jeton de rafraîchissement enregistré', async () => {
    const { service, store } = makeService()
    await service.add()
    now += 24 * HOUR
    services.profile.name = 'NouveauPseudo'
    const session = await service.getLaunchSession()
    expect(session.username).toBe('NouveauPseudo')
    const refreshCall = services.calls.find((c) => c.url === TOKEN_URL && c.body.includes('grant_type=refresh_token'))
    expect(new URLSearchParams(refreshCall?.body).get('refresh_token')).toBe('rt-1')
    // Rotation : le nouveau jeton remplace l'ancien sur le disque.
    const decrypted = fakeCipher().decrypt(store.data.accounts[0]?.secret ?? '')
    expect(decrypted).toContain('rt-r1')
    expect(decrypted).not.toContain('"rt-1"')
  })

  it('connexion révoquée : le compte passe en « reconnexion nécessaire »', async () => {
    const { service } = makeService()
    await service.add()
    now += 24 * HOUR
    services.override(TOKEN_URL, () => ({ status: 400, body: { error: 'invalid_grant' } }))
    await expectAuthError(service.getLaunchSession(), 'session-expired')
    expect((await service.list())[0]?.needsRelogin).toBe(true)
  })

  it('hors ligne au démarrage : pas d’erreur, le compte reste utilisable plus tard', async () => {
    const { service } = makeService()
    await service.add()
    now += 23 * HOUR
    services.offline = true
    await expect(service.refreshActiveInBackground()).resolves.toBeUndefined()
    expect((await service.list())[0]?.needsRelogin).toBe(false)
  })

  it('après redémarrage, les jetons chiffrés sont relus', async () => {
    const store = memoryAccountStore()
    await makeService({ store }).service.add()
    const restarted = makeService({ store }).service
    expect((await restarted.list())[0]?.needsRelogin).toBe(false)
    expect((await restarted.getLaunchSession()).accessToken).toBe('mc-token')
  })

  it('sans trousseau sécurisé : rien n’est écrit, reconnexion après redémarrage', async () => {
    const store = memoryAccountStore()
    const first = makeService({ store, cipher: fakeCipher(false) }).service
    await first.add()
    expect(store.data.accounts[0]?.secret).toBeNull()
    expect((await first.list())[0]?.needsRelogin).toBe(false)
    const restarted = makeService({ store, cipher: fakeCipher(false) }).service
    expect((await restarted.list())[0]?.needsRelogin).toBe(true)
  })

  it('jetons illisibles (trousseau changé) → reconnexion nécessaire', async () => {
    const store = memoryAccountStore()
    await makeService({ store }).service.add()
    const account = store.data.accounts[0]
    if (account) account.secret = 'corrompu'
    expect((await makeService({ store }).service.list())[0]?.needsRelogin).toBe(true)
  })
})

describe('fenêtre de connexion et divers', () => {
  it('n’autorise que les pages Microsoft / Xbox en https', () => {
    expect(isMicrosoftLoginUrl('https://login.live.com/oauth20_authorize.srf')).toBe(true)
    expect(isMicrosoftLoginUrl('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')).toBe(true)
    expect(isMicrosoftLoginUrl('https://account.live.com/')).toBe(true)
    expect(isMicrosoftLoginUrl('https://sisu.xboxlive.com/connect')).toBe(true)
    expect(isMicrosoftLoginUrl('http://login.live.com/')).toBe(false)
    expect(isMicrosoftLoginUrl('https://live.com.evil.example/')).toBe(false)
    expect(isMicrosoftLoginUrl('https://evil.example/?u=login.live.com')).toBe(false)
  })

  it('retire « Electron » du User-Agent', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HARDCORE SMP/0.1.0 Chrome/152.0.0.0 Electron/44.8.0 Safari/537.36'
    expect(cleanUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36')
  })

  it('ne télécharge les skins que depuis Mojang', () => {
    expect(isOfficialSkinUrl('http://textures.minecraft.net/texture/abc')).toBe(true)
    expect(isOfficialSkinUrl('https://evil.example/skin.png')).toBe(false)
  })

  it('masque les jetons dans les logs', () => {
    const line = redact('Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuv ok')
    expect(line).not.toContain('eyJhbGci')
    expect(line).toContain('ok')
  })

  it('lit le Client ID Azure (TODO = pas encore configuré)', () => {
    const todo = {
      azureClientId: 'TODO_AZURE_CLIENT_ID',
      publicConfigUrl: 'TODO_PUBLIC_CONFIG_URL',
      discordApplicationId: 'TODO_DISCORD_APPLICATION_ID',
      updateRepository: 'TODO_GITHUB_REPOSITORY'
    }
    expect(parseAppConfig(todo)).toEqual({ azureClientId: null, publicConfigUrl: null, discordApplicationId: null, updateRepository: null })
    expect(
      parseAppConfig({
        azureClientId: CLIENT_ID,
        publicConfigUrl: 'https://raw.githubusercontent.com/moi/hardcore-smp/main/config/',
        discordApplicationId: '123456789012345678',
        updateRepository: 'moi/hardcore-smp'
      })
    ).toEqual({
      azureClientId: CLIENT_ID,
      publicConfigUrl: 'https://raw.githubusercontent.com/moi/hardcore-smp/main/config/',
      discordApplicationId: '123456789012345678',
      updateRepository: { owner: 'moi', repo: 'hardcore-smp' }
    })
    expect(() => parseAppConfig({ ...todo, azureClientId: 'pas-un-guid' })).toThrow()
    expect(() => parseAppConfig({ ...todo, publicConfigUrl: 'http://exemple.test/config/' })).toThrow()
    expect(() => parseAppConfig({ ...todo, updateRepository: 'pas un dépôt' })).toThrow()
  })
})
