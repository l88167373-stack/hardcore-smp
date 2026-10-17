import { Check, Info, TriangleAlert, X } from 'lucide-react'
import { useToasts } from '../state/toasts'
import styles from './Overlays.module.css'

const ICONS = { info: Info, success: Check, error: TriangleAlert }

export function ToastView(): React.JSX.Element {
  const { toasts, dismiss } = useToasts()
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone]
        return (
          <div key={toast.id} className={`${styles.toast} ${styles[`toast-${toast.tone}`]}`}>
            <Icon size={16} aria-hidden="true" />
            <span>{toast.message}</span>
            <button type="button" className={styles.toastClose} onClick={() => dismiss(toast.id)} aria-label="Fermer">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
