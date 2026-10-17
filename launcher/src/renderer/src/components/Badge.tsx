import type { ReactNode } from 'react'
import styles from './Badge.module.css'

export type BadgeTone = 'alert' | 'ember' | 'neutral' | 'live'

/** Petite étiquette d'état. `alert` = rouge, comme le badge « ÉLIMINÉ » de la vidéo. */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }): React.JSX.Element {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>
}
