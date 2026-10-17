import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Overlays.module.css'

interface ModalProps {
  title: string
  children: ReactNode
  /** Absent = fenêtre impossible à fermer (ex. mise à jour obligatoire). */
  onClose?: () => void
}

export function Modal({ title, children, onClose }: ModalProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    if (!onClose) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
