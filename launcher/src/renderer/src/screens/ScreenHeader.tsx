import type { ReactNode } from 'react'
import styles from './ScreenHeader.module.css'

interface ScreenHeaderProps {
  /** Titre ; les mots-clés passés dans `highlight` s'affichent en orange. */
  title: string
  highlight?: string
  lede?: ReactNode
  actions?: ReactNode
}

export function ScreenHeader({ title, highlight, lede, actions }: ScreenHeaderProps): React.JSX.Element {
  const parts = highlight ? title.split(highlight) : [title]
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>
          {parts.map((part, i) => (
            <span key={i}>
              {part}
              {highlight && i < parts.length - 1 && <span className="ember">{highlight}</span>}
            </span>
          ))}
        </h1>
        {lede && <p className={styles.lede}>{lede}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
