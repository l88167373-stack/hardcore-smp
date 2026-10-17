import { ExternalLink } from 'lucide-react'
import { useActions } from '../lib/actions'
import { Button } from './Button'
import styles from './ErrorBox.module.css'

export interface DisplayableError {
  title: string
  message: string
  help?: { label: string; url: string }
}

/** Erreur expliquée en français (connexion, installation, lancement), avec de quoi la régler. */
export function ErrorBox({ error, children }: { error: DisplayableError; children?: React.ReactNode }): React.JSX.Element {
  const { openLink } = useActions()
  return (
    <div className={styles.box} role="alert">
      <p className={styles.title}>{error.title}</p>
      <p>{error.message}</p>
      {(error.help || children) && (
        <div className={styles.actions}>
          {error.help && (
            <Button size="sm" variant="outline" icon={<ExternalLink />} onClick={() => openLink(error.help?.url, error.help?.label ?? 'Aide')}>
              {error.help.label}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  )
}
