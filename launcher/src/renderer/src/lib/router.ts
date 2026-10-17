/**
 * Navigation minimale par le fragment d'URL (#/accueil…), sans dépendance.
 */
import { useCallback, useSyncExternalStore } from 'react'

export type Screen = 'home' | 'news' | 'server' | 'mods' | 'settings' | 'accounts' | 'support' | 'onboarding'

const SCREENS: readonly Screen[] = ['home', 'news', 'server', 'mods', 'settings', 'accounts', 'support', 'onboarding']

export interface Route {
  screen: Screen
  /** Paramètre facultatif : identifiant d'actu, étape d'onboarding… */
  param: string | undefined
}

export function parseHash(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/')
  const screen = SCREENS.find((s) => s === first) ?? 'home'
  return { screen, param: second ? decodeURIComponent(second) : undefined }
}

export function routeToHash(screen: Screen, param?: string): string {
  return param ? `#/${screen}/${encodeURIComponent(param)}` : `#/${screen}`
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): [Route, (screen: Screen, param?: string) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  const navigate = useCallback((screen: Screen, param?: string) => {
    window.location.hash = routeToHash(screen, param)
  }, [])
  return [parseHash(hash), navigate]
}
