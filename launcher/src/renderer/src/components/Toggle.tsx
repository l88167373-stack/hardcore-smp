import { useId } from 'react'
import styles from './Toggle.module.css'

interface ToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** Interrupteur on/off avec son libellé (tout le bloc est cliquable). */
export function Toggle({ label, description, checked, onChange, disabled = false }: ToggleProps): React.JSX.Element {
  const id = useId()
  return (
    <label className={`${styles.row} ${disabled ? styles.disabled : ''}`} htmlFor={id}>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.switch} aria-hidden="true" />
    </label>
  )
}
