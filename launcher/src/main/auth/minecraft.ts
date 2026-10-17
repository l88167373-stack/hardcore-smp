/**
 * Étapes 2 à 5 de la connexion : Xbox Live → XSTS → Minecraft → achat du jeu → profil.
 * https://minecraft.wiki/w/Microsoft_authentication
 */
import { authErrorFromXErr } from '../../shared/auth-errors'
import { AuthError } from './errors'
import { field, stringField, type Http } from './http'

export const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
export const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
export const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
export const MC_ENTITLEMENTS_URL = 'https://api.minecraftservices.com/entitlements/mcstore'
export const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

export interface XboxToken {
  token: string
  /** « user hash » : identifie le joueur auprès des services Xbox. */
  uhs: string
}

export interface MinecraftToken {
  accessToken: string
  expiresAt: number
}

export interface MinecraftProfile {
  /** UUID avec tirets. */
  uuid: string
  username: string
  skinUrl: string | null
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

function readXboxToken(response: unknown, step: string): XboxToken {
  const token = stringField(response, 'Token')
  const uhs = stringField(response, 'DisplayClaims', 'xui', 0, 'uhs')
  if (!token || !uhs) throw new AuthError('unknown', `${step} : réponse incomplète`)
  return { token, uhs }
}

export async function authenticateXbox(http: Http, microsoftAccessToken: string): Promise<XboxToken> {
  const response = await http.request(
    XBL_URL,
    json({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${microsoftAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  )
  if (response.status !== 200) throw new AuthError('unknown', `Xbox Live : HTTP ${response.status}`)
  return readXboxToken(response.json, 'Xbox Live')
}

export async function authorizeXsts(http: Http, xbox: XboxToken): Promise<XboxToken> {
  const response = await http.request(
    XSTS_URL,
    json({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  )
  if (response.status === 401) {
    const xerr = field(response.json, 'XErr')
    const info = authErrorFromXErr(typeof xerr === 'number' || typeof xerr === 'string' ? xerr : 'inconnu')
    throw new AuthError(info.code, `XSTS XErr ${String(xerr)}`)
  }
  if (response.status !== 200) throw new AuthError('unknown', `XSTS : HTTP ${response.status}`)
  return readXboxToken(response.json, 'XSTS')
}

export async function loginMinecraft(http: Http, xsts: XboxToken, now = Date.now()): Promise<MinecraftToken> {
  const response = await http.request(MC_LOGIN_URL, json({ identityToken: `XBL3.0 x=${xsts.uhs};${xsts.token}` }))
  if (response.status === 403 || /invalid app registration/i.test(response.text)) {
    // Tant que Mojang n'a pas validé l'application Azure (formulaire aka.ms/mce-reviewappid).
    throw new AuthError('app-not-approved', `login_with_xbox : HTTP ${response.status}`)
  }
  if (response.status !== 200) throw new AuthError('unknown', `login_with_xbox : HTTP ${response.status}`)
  const accessToken = stringField(response.json, 'access_token')
  const expiresIn = field(response.json, 'expires_in')
  if (!accessToken) throw new AuthError('unknown', 'login_with_xbox : jeton absent')
  return { accessToken, expiresAt: now + (typeof expiresIn === 'number' ? expiresIn : 86_400) * 1000 }
}

const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } })

/** Vrai si le compte possède Minecraft (achat direct). */
export async function ownsMinecraft(http: Http, minecraftToken: string): Promise<boolean> {
  const response = await http.request(MC_ENTITLEMENTS_URL, bearer(minecraftToken))
  if (response.status !== 200) throw new AuthError('unknown', `entitlements : HTTP ${response.status}`)
  const items = field(response.json, 'items')
  if (!Array.isArray(items)) return false
  return items.some((item) => {
    const name = stringField(item, 'name')
    return name === 'game_minecraft' || name === 'product_minecraft'
  })
}

/** Profil Minecraft, ou null si le compte n'en a pas (jeu non acheté ou pseudo jamais choisi). */
export async function fetchProfile(http: Http, minecraftToken: string): Promise<MinecraftProfile | null> {
  const response = await http.request(MC_PROFILE_URL, bearer(minecraftToken))
  if (response.status === 404) return null
  if (response.status === 401) throw new AuthError('session-expired', 'profil : HTTP 401')
  if (response.status !== 200) throw new AuthError('unknown', `profil : HTTP ${response.status}`)
  const id = stringField(response.json, 'id')
  const name = stringField(response.json, 'name')
  if (!id || !name) throw new AuthError('unknown', 'profil incomplet')
  const skins = field(response.json, 'skins')
  const active = Array.isArray(skins) ? skins.find((s) => stringField(s, 'state') === 'ACTIVE') ?? skins[0] : undefined
  return { uuid: dashUuid(id), username: name, skinUrl: stringField(active, 'url') ?? null }
}

/** « 069a79f444e94726a5befca90e38aaf5 » → « 069a79f4-44e9-4726-a5be-fca90e38aaf5 ». */
export function dashUuid(id: string): string {
  const hex = id.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new AuthError('unknown', `UUID invalide : ${id}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
