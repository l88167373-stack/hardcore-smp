/**
 * Étape 1 de la connexion : compte Microsoft (OAuth 2.0 « code d'autorisation » + PKCE, client public).
 * https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow
 */
import { createHash, randomBytes } from 'node:crypto'
import { AuthError } from './errors'
import { stringField, field, type Http } from './http'

/** « consumers » : comptes Microsoft personnels uniquement (les seuls qui peuvent posséder Minecraft). */
const TENANT = 'consumers'
export const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
export const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
/** Adresse de retour recommandée par Microsoft pour une fenêtre de connexion intégrée. */
export const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
export const SCOPE = 'XboxLive.signin offline_access'

export interface Pkce {
  verifier: string
  challenge: string
}

export interface MicrosoftTokens {
  accessToken: string
  refreshToken: string
  /** Date d'expiration du jeton d'accès Microsoft (ms depuis 1970). */
  expiresAt: number
}

const base64url = (buffer: Buffer): string => buffer.toString('base64url')

/** Vérificateur PKCE (43 à 128 caractères autorisés) et son défi SHA-256. */
export function createPkce(): Pkce {
  const verifier = base64url(randomBytes(64))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Valeur aléatoire renvoyée par Microsoft, pour vérifier que la réponse correspond bien à notre demande. */
export function createState(): string {
  return base64url(randomBytes(32))
}

export function buildAuthorizeUrl(clientId: string, pkce: Pkce, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPE,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    // Toujours proposer le choix du compte : indispensable pour ajouter un deuxième compte.
    prompt: 'select_account'
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

/** Vrai si la fenêtre de connexion arrive sur l'adresse de retour (fin du parcours Microsoft). */
export function isRedirectUrl(url: string): boolean {
  return url.split(/[?#]/)[0] === REDIRECT_URI
}

/** Extrait le code de l'adresse de retour, en vérifiant `state`. */
export function parseRedirect(url: string, expectedState: string): string {
  const parsed = new URL(url)
  const params = new URLSearchParams(parsed.search || parsed.hash.replace(/^#/, ''))
  const error = params.get('error')
  if (error) {
    const description = params.get('error_description') ?? ''
    if (error === 'access_denied') {
      // Microsoft utilise aussi access_denied quand l'utilisateur annule.
      throw new AuthError(/cancel/i.test(description) ? 'cancelled' : 'consent-denied', description)
    }
    if (error === 'unauthorized_client' || error === 'invalid_client' || error === 'invalid_request') {
      throw new AuthError('app-misconfigured', `${error}: ${description}`)
    }
    if (error === 'temporarily_unavailable' || error === 'server_error') throw new AuthError('network', description)
    throw new AuthError('unknown', `${error}: ${description}`)
  }
  if (params.get('state') !== expectedState) throw new AuthError('unknown', 'state OAuth différent : réponse ignorée')
  const code = params.get('code')
  if (!code) throw new AuthError('unknown', 'aucun code dans la réponse Microsoft')
  return code
}

async function tokenRequest(http: Http, body: Record<string, string>, now: number): Promise<MicrosoftTokens> {
  const response = await http.request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  if (response.status !== 200) {
    const error = stringField(response.json, 'error') ?? `HTTP ${response.status}`
    const description = stringField(response.json, 'error_description') ?? ''
    const detail = `${error}: ${description.split('\n')[0]}`
    if (error === 'invalid_grant' || error === 'interaction_required') throw new AuthError('session-expired', detail)
    if (error === 'invalid_client' || error === 'unauthorized_client' || error === 'invalid_request') {
      throw new AuthError('app-misconfigured', detail)
    }
    if (error === 'temporarily_unavailable') throw new AuthError('network', detail)
    throw new AuthError('unknown', detail)
  }
  const accessToken = stringField(response.json, 'access_token')
  const refreshToken = stringField(response.json, 'refresh_token')
  const expiresIn = field(response.json, 'expires_in')
  if (!accessToken || !refreshToken) throw new AuthError('unknown', 'réponse Microsoft incomplète (jetons absents)')
  return {
    accessToken,
    refreshToken,
    expiresAt: now + (typeof expiresIn === 'number' ? expiresIn : 3600) * 1000
  }
}

export function exchangeCode(http: Http, clientId: string, code: string, pkce: Pkce, now = Date.now()): Promise<MicrosoftTokens> {
  return tokenRequest(
    http,
    {
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.verifier,
      scope: SCOPE
    },
    now
  )
}

/** Renouvelle les jetons. Microsoft peut fournir un nouveau jeton de rafraîchissement : il remplace l'ancien. */
export function refreshTokens(http: Http, clientId: string, refreshToken: string, now = Date.now()): Promise<MicrosoftTokens> {
  return tokenRequest(
    http,
    { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE },
    now
  )
}
