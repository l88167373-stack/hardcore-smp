import type { ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  /** Étiquette d'en-tête (point orange + texte mono), comme « FICHE DU SERVEUR » dans la vidéo. */
  label?: string
  /** Contenu à droite de l'en-tête (lien, bouton…). */
  aside?: ReactNode
  /** Point rouge au lieu d'orange (carte d'alerte). */
  alert?: boolean
  className?: string
  children: ReactNode
}

export function Card({ label, aside, alert = false, className, children }: CardProps): React.JSX.Element {
  return (
    <section className={`${styles.card} ${className ?? ''}`}>
      {label && (
        <header className={styles.header}>
          <span className={`${styles.dot} ${alert ? styles.dotAlert : ''}`} aria-hidden="true" />
          <h2 className={styles.label}>{label}</h2>
          {aside && <div className={styles.aside}>{aside}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
