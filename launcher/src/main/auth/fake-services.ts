/**
 * Faux serveurs Microsoft / Xbox / Mojang pour les tests : aucune requête ne sort du PC.
 * Chaque réponse peut être remplacée pour simuler une erreur précise.
 */
import type { FetchLike } from './http'
import { MC_ENTITLEMENTS_URL, MC_LOGIN_URL, MC_PROFILE_URL, XBL_URL, XSTS_URL } from './minecraft'
import { TOKEN_URL } from './oauth'

export interface FakeReply {
  status: number
  body?: unknown
}

type Handler = (init: RequestInit | undefined) => FakeReply

export interface FakeServices {
  fetch: FetchLike
  /** Requêtes reçues (URL + corps), pour vérifier ce que le launcher envoie. */
  calls: { url: string; body: string }[]
  /** Remplace la réponse d'un service. */
  override(url: string, handler: Handler | null): void
  /** Profil renvoyé par Mojang (modifiable pour simuler un changement de pseudo). */
  profile: { id: string; name: string; skinUrl: string | null }
  /** Coupe le réseau : toutes les requêtes échouent. */
  offline: boolean
}

export function createFakeServices(): FakeServices {
  let refreshCount = 0
  const overrides = new Map<string, Handler>()
  const services: FakeServices = {
    calls: [],
    offline: false,
    profile: { id: '069a79f444e94726a5befca90e38aaf5', name: 'Steve', skinUrl: 'http://textures.minecraft.net/texture/abc' },
    override(url, handler) {
      if (handler) overrides.set(url, handler)
      else overrides.delete(url)
    },
    fetch: async (url, init) => {
      if (services.offline) throw new TypeError('fetch failed: getaddrinfo ENOTFOUND')
      const body = typeof init?.body === 'string' ? init.body : ''
      services.calls.push({ url, body })
      const base = url.split('?')[0] ?? url
      const handler = overrides.get(base) ?? defaults[base]
      const reply = handler ? handler(init) : { status: 404 }
      return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status })
    }
  }

  const defaults: Record<string, Handler> = {
    [TOKEN_URL]: (init) => {
      const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
      if (params.get('grant_type') === 'refresh_token') {
        refreshCount++
        return { status: 200, body: { access_token: `ms-at-r${refreshCount}`, refresh_token: `rt-r${refreshCount}`, expires_in: 3600 } }
      }
      return { status: 200, body: { access_token: 'ms-at-1', refresh_token: 'rt-1', expires_in: 3600 } }
    },
    [XBL_URL]: () => ({ status: 200, body: { Token: 'xbl-token', DisplayClaims: { xui: [{ uhs: 'uhs-123' }] } } }),
    [XSTS_URL]: () => ({ status: 200, body: { Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: 'uhs-123' }] } } }),
    [MC_LOGIN_URL]: () => ({ status: 200, body: { access_token: 'mc-token', expires_in: 86400, token_type: 'Bearer' } }),
    [MC_ENTITLEMENTS_URL]: () => ({ status: 200, body: { items: [{ name: 'product_minecraft' }, { name: 'game_minecraft' }] } }),
    [MC_PROFILE_URL]: () => ({
      status: 200,
      body: {
        id: services.profile.id,
        name: services.profile.name,
        skins: services.profile.skinUrl ? [{ state: 'ACTIVE', url: services.profile.skinUrl, variant: 'CLASSIC' }] : []
      }
    })
  }
  return services
}
