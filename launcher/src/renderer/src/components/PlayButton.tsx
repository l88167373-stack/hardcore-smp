import styles from './PlayButton.module.css'

interface PlayButtonProps {
  state: 'ready' | 'busy' | 'blocked'
  /** Texte affiché pendant le lancement ou quand le bouton est bloqué. */
  status?: string
  /** Progression du lancement, entre 0 et 1. */
  progress?: number
  onPlay: () => void
}

/** Le gros bouton JOUER : un bloc de braise. */
export function PlayButton({ state, status, progress = 0, onPlay }: PlayButtonProps): React.JSX.Element {
  const label = state === 'ready' ? 'JOUER' : (status ?? '')
  return (
    <button
      type="button"
      className={`${styles.play} ${styles[state]}`}
      onClick={onPlay}
      disabled={state !== 'ready'}
      aria-label={state === 'ready' ? 'Jouer sur HARDCORE SMP' : label}
    >
      <span className={styles.embers} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      {state === 'busy' && (
        <span className={styles.progress} aria-hidden="true">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
    </button>
  )
}
