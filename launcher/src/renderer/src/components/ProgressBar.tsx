import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  /** Entre 0 et 1. */
  value: number
  label?: string
  size?: 'sm' | 'md'
}

/** Barre de progression qui « brûle » : dégradé feu, braise lumineuse au bout. */
export function ProgressBar({ value, label, size = 'md' }: ProgressBarProps): React.JSX.Element {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      className={`${styles.track} ${styles[size]}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div className={`${styles.fill} ${percent >= 100 ? styles.done : ''}`} style={{ width: `${percent}%` }} />
    </div>
  )
}
