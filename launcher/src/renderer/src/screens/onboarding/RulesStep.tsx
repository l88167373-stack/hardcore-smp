import type { Rules } from '@shared/schemas'
import { useEffect, useRef, useState } from 'react'
import { Markdown } from '../../components/Markdown'
import styles from './Onboarding.module.css'

/** Tolérance en pixels pour considérer que le bas est atteint (arrondis du navigateur). */
const BOTTOM_TOLERANCE = 12

interface RulesStepProps {
  rules: Rules
  accepted: boolean
  onAcceptedChange: (accepted: boolean) => void
}

/**
 * Lecture du règlement : la case « J'accepte » ne s'active
 * qu'une fois le texte entièrement défilé jusqu'en bas.
 */
export function RulesStep({ rules, accepted, onAcceptedChange }: RulesStepProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [readToBottom, setReadToBottom] = useState(accepted)
  const [progress, setProgress] = useState(0)

  const check = (): void => {
    const el = scrollRef.current
    // Zone pas encore dessinée (hauteur 0) : on ne conclut rien.
    if (!el || el.scrollHeight === 0) return
    const scrollable = el.scrollHeight - el.clientHeight
    const ratio = scrollable <= 0 ? 1 : el.scrollTop / scrollable
    setProgress(Math.min(1, ratio))
    if (scrollable - el.scrollTop <= BOTTOM_TOLERANCE) setReadToBottom(true)
  }

  // Un règlement très court (ou une très grande fenêtre) n'a pas besoin de défilement.
  useEffect(() => check(), [])

  return (
    <div className={styles.rules}>
      <div className={styles.rulesMeter} aria-hidden="true">
        <span style={{ width: `${Math.round((readToBottom ? 1 : progress) * 100)}%` }} />
      </div>
      <div
        ref={scrollRef}
        className={styles.rulesScroll}
        onScroll={check}
        tabIndex={0}
        role="region"
        aria-label={`Règlement, version ${rules.version}`}
        data-testid="rules-scroll"
      >
        <Markdown>{rules.content}</Markdown>
      </div>
      <label className={`${styles.accept} ${readToBottom ? '' : styles.acceptLocked}`}>
        <input
          type="checkbox"
          checked={accepted}
          disabled={!readToBottom}
          onChange={(e) => onAcceptedChange(e.target.checked)}
        />
        <span className={styles.checkbox} aria-hidden="true" />
        <span>
          J’ai lu et j’accepte le règlement <span className={styles.version}>(version {rules.version})</span>
        </span>
      </label>
      {!readToBottom && <p className={styles.hint}>Fais défiler le règlement jusqu’en bas pour pouvoir l’accepter.</p>}
    </div>
  )
}
