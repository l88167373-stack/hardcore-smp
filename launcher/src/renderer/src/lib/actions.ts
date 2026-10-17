/**
 * Actions courantes de l'interface (ouvrir le Discord, copier l'IP…), avec un message clair à chaque fois.
 */
import { formatServerAddress } from '@shared/server-address'
import { useCallback } from 'react'
import { useAppState } from '../state/app-state'
import { useToasts } from '../state/toasts'
import { bridge } from './bridge'
import { isTodo } from './format'

export function useActions(): {
  openLink: (url: string | undefined, what: string) => void
  openDiscord: () => void
  copyText: (text: string, confirmation: string) => void
  copyAddress: () => void
  serverAddress: string
} {
  const { config } = useAppState()
  const { push } = useToasts()
  const serverAddress = formatServerAddress(config.launcher.server.host, config.launcher.server.port)

  const openLink = useCallback(
    (url: string | undefined, what: string) => {
      if (isTodo(url) || !url) {
        push(`${what} : le lien n'est pas encore configuré (config/launcher.json).`, 'error')
        return
      }
      void bridge.shell.openExternal(url).then((opened) => {
        if (!opened) push(`${what} : ce lien n'est pas autorisé par le launcher.`, 'error')
      })
    },
    [push]
  )

  const copyText = useCallback(
    (text: string, confirmation: string) => {
      bridge.clipboard.writeText(text).then(
        () => push(confirmation, 'success'),
        () => push('Impossible de copier dans le presse-papiers.', 'error')
      )
    },
    [push]
  )

  return {
    openLink,
    openDiscord: () => openLink(config.launcher.discordInvite, 'Discord'),
    copyText,
    copyAddress: () => copyText(serverAddress, `IP copiée : ${serverAddress}`),
    serverAddress
  }
}
