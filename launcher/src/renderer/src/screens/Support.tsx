import type { CrashReport } from '@shared/game'
import { ClipboardCopy, FolderOpen, MessageCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useActions } from '../lib/actions'
import { bridge } from '../lib/bridge'
import { useAppState } from '../state/app-state'
import { useToasts } from '../state/toasts'
import { ScreenHeader } from './ScreenHeader'
import styles from './Support.module.css'

const crashDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function SupportScreen(): React.JSX.Element {
  const { info, config, game } = useAppState()
  const { copyText, openDiscord } = useActions()
  const { push } = useToasts()
  const [crash, setCrash] = useState<CrashReport | null | undefined>(undefined)

  const refreshCrash = useCallback(() => {
    void bridge.support.lastCrash().then(setCrash)
  }, [])

  useEffect(refreshCrash, [refreshCrash, game.phase])

  const copyLatestLog = async (): Promise<void> => {
    const log = await bridge.support.latestLog()
    if (!log.trim()) {
      push('Aucun journal pour l’instant : lance le jeu une première fois.', 'info')
      return
    }
    copyText(log, 'Derniers logs copiés : colle-les dans un message au staff.')
  }

  return (
    <div className={styles.page}>
      <ScreenHeader
        title="Un problème ?"
        highlight="problème"
        lede="Copie tes logs et envoie-les au staff sur le Discord : c’est le moyen le plus rapide d’être aidé."
        actions={
          <Button variant="outline" icon={<MessageCircle />} onClick={openDiscord}>
            Demander de l’aide sur Discord
          </Button>
        }
      />

      <div className={styles.grid}>
        <Card label="Logs du jeu">
          <p className={styles.text}>Le journal de la dernière partie : utile au staff pour comprendre un souci.</p>
          <div className={styles.actions}>
            <Button icon={<ClipboardCopy />} onClick={() => void copyLatestLog()}>
              Copier les derniers logs
            </Button>
            <Button variant="ghost" icon={<FolderOpen />} onClick={() => void bridge.shell.openGameFolder('logs')}>
              Ouvrir le dossier des logs
            </Button>
          </div>
        </Card>

        <Card label="Ton launcher">
          <dl className={styles.facts}>
            <div>
              <dt>Version du launcher</dt>
              <dd>{info.version}</dd>
            </div>
            <div>
              <dt>Minecraft</dt>
              <dd>
                {config.launcher.minecraftVersion} avec Fabric {config.launcher.fabricLoaderVersion}
              </dd>
            </div>
            <div>
              <dt>Jeu installé</dt>
              <dd>{game.installed ? 'Oui' : 'Pas encore'}</dd>
            </div>
            <div>
              <dt>Système</dt>
              <dd>
                {info.platform === 'win32' ? 'Windows' : info.platform === 'darwin' ? 'macOS' : 'Linux'} ({info.arch})
              </dd>
            </div>
          </dl>
        </Card>

        <Card
          label="Dernier plantage"
          alert={Boolean(crash)}
          className={styles.wide}
          aside={
            crash ? (
              <>
                <Badge tone="alert">{crashDate.format(new Date(crash.date))}</Badge>
                <Button size="sm" variant="ghost" icon={<ClipboardCopy />} onClick={() => copyText(crash.content, 'Rapport de plantage copié.')}>
                  Copier
                </Button>
                <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={() => void bridge.shell.openGameFolder('crash-reports')}>
                  Ouvrir le dossier
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={refreshCrash}>
                Actualiser
              </Button>
            )
          }
        >
          {crash ? (
            <pre className={styles.log}>{crash.content}</pre>
          ) : (
            <p className={styles.text}>{crash === undefined ? 'Recherche…' : 'Aucun plantage enregistré. Tant mieux.'}</p>
          )}
        </Card>
      </div>
    </div>
  )
}
