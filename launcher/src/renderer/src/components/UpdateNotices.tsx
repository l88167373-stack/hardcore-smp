/**
 * Mises à jour du launcher : bandeau discret (téléchargement en arrière-plan, puis « Redémarrer maintenant »),
 * et fenêtre bloquante quand la config du serveur exige une version plus récente (minLauncherVersion).
 */
import { Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useActions } from '../lib/actions'
import { bridge } from '../lib/bridge'
import { useAppState } from '../state/app-state'
import { useToasts } from '../state/toasts'
import { Badge } from './Badge'
import { Button } from './Button'
import { Modal } from './Modal'
import styles from './Overlays.module.css'
import { ProgressBar } from './ProgressBar'

function useInstall(): () => void {
  const { push } = useToasts()
  return () =>
    void bridge.updates.install().then((started) => {
      if (!started) push('La mise à jour n’est pas encore prête.', 'error')
    })
}

/** Bandeau « Mise à jour » (installation au prochain redémarrage, ou tout de suite). */
export function UpdateBanner(): React.JSX.Element | null {
  const { update, mustUpdate } = useAppState()
  const install = useInstall()
  const { config } = useAppState()
  const { openLink } = useActions()
  if (mustUpdate || (update.status !== 'downloading' && update.status !== 'ready' && update.status !== 'available')) return null

  if (update.status === 'available') {
    return (
      <div className={styles.banner} role="status">
        <Badge tone="ember">Mise à jour</Badge>
        <span className={styles.bannerText}>
          La version <strong>{update.version}</strong> est disponible. Télécharge-la et installe-la par-dessus : tes réglages et ton
          compte sont conservés.
        </span>
        <Button size="sm" variant="outline" icon={<ExternalLink />} onClick={() => openLink(config.launcher.links.download, 'Téléchargement du launcher')}>
          Télécharger
        </Button>
      </div>
    )
  }

  const ready = update.status === 'ready'
  return (
    <div className={styles.banner} role="status">
      <Badge tone="ember">Mise à jour</Badge>
      <span className={styles.bannerText}>
        {ready ? (
          <>
            La version <strong>{update.version}</strong> est prête. Elle s’installera au prochain redémarrage du launcher.
          </>
        ) : (
          <>
            La version <strong>{update.version}</strong> se télécharge en arrière-plan
            {update.progress !== null ? ` (${Math.round(update.progress * 100)} %)` : ''}.
          </>
        )}
      </span>
      {ready && (
        <Button size="sm" variant="outline" icon={<RefreshCw />} onClick={install}>
          Redémarrer maintenant
        </Button>
      )}
    </div>
  )
}

/** Mise à jour obligatoire : bloque le jeu tant que le launcher n'est pas à jour. */
export function MandatoryUpdate(): React.JSX.Element | null {
  const { mustUpdate, update, config, info } = useAppState()
  const { openLink } = useActions()
  const install = useInstall()
  const [asked, setAsked] = useState(false)

  // À l'ouverture de la fenêtre : on vérifie tout de suite (le téléchargement suit automatiquement).
  useEffect(() => {
    if (mustUpdate) void bridge.updates.check()
  }, [mustUpdate])

  if (!mustUpdate) return null
  const checking = update.status === 'checking' || update.status === 'idle'
  // « available » : macOS, la nouvelle version se télécharge à la main.
  const failed = update.status === 'disabled' || update.status === 'error' || update.status === 'up-to-date' || update.status === 'available'

  return (
    <Modal title="Mise à jour obligatoire">
      <Badge tone="alert">Mise à jour obligatoire</Badge>
      <h2 className={styles.modalTitle}>Mets à jour le launcher pour jouer</h2>
      <p className={styles.modalText}>
        Le serveur demande la version <strong>{config.launcher.minLauncherVersion}</strong> du launcher (ou plus récente).
        Tu as la version {info.version}. La mise à jour prend moins d’une minute et le launcher redémarre tout seul.
      </p>
      {update.status === 'ready' ? (
        <Button variant="fire" size="lg" icon={<Download />} onClick={install}>
          Installer et redémarrer
        </Button>
      ) : update.status === 'downloading' ? (
        <div className={styles.modalProgress}>
          <ProgressBar value={update.progress ?? 0} label="Téléchargement de la mise à jour" />
          <span className="tabular">{Math.round((update.progress ?? 0) * 100)} %</span>
        </div>
      ) : checking ? (
        <p className={styles.modalText}>Recherche de la nouvelle version…</p>
      ) : failed ? (
        <>
          <p className={styles.modalText}>
            {update.status === 'available'
              ? `La version ${update.version ?? ''} est disponible.`
              : (update.error ?? 'La mise à jour automatique n’a pas abouti.')}{' '}
            Télécharge la nouvelle version et installe-la par-dessus : tes réglages et ton compte sont conservés.
          </p>
          <div className={styles.modalActions}>
            <Button variant="fire" icon={<ExternalLink />} onClick={() => openLink(config.launcher.links.download, 'Téléchargement du launcher')}>
              Télécharger le launcher
            </Button>
            <Button
              variant="outline"
              icon={<RefreshCw />}
              disabled={asked}
              onClick={() => {
                setAsked(true)
                void bridge.updates.check().finally(() => setAsked(false))
              }}
            >
              Réessayer
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  )
}
