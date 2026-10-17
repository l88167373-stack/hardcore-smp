/// <reference types="vite/client" />
import type { HsmpApi } from '@shared/ipc'

declare global {
  interface Window {
    /** API exposée par le preload. Absente quand l'interface est ouverte dans un simple navigateur. */
    hsmp?: HsmpApi
  }
}

export {}
