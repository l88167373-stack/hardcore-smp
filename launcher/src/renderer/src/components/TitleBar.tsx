import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { bridge } from '../lib/bridge'
import { useAppState } from '../state/app-state'
import styles from './TitleBar.module.css'

/** Barre de titre personnalisée (la fenêtre n'a pas de cadre système). */
export function TitleBar(): React.JSX.Element {
  const { info } = useAppState()
  const [maximized, setMaximized] = useState(false)
  const isMac = info.platform === 'darwin'

  useEffect(() => {
    void bridge.window.getState().then((s) => setMaximized(s.maximized))
    return bridge.window.onStateChange((s) => setMaximized(s.maximized))
  }, [])

  return (
    <header className={`${styles.bar} ${isMac ? styles.mac : ''}`} onDoubleClick={() => bridge.window.toggleMaximize()}>
      <div className={styles.brand}>
        <span className={styles.flame} aria-hidden="true" />
        <span className={styles.name}>HARDCORE SMP</span>
        <span className={styles.season}>Saison 2</span>
      </div>
      {!isMac && (
        <div className={styles.controls} onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" className={styles.control} onClick={() => bridge.window.minimize()} aria-label="Réduire">
            <Minus size={15} />
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => bridge.window.toggleMaximize()}
            aria-label={maximized ? 'Restaurer' : 'Agrandir'}
          >
            {maximized ? <Copy size={13} /> : <Square size={12} />}
          </button>
          <button
            type="button"
            className={`${styles.control} ${styles.close}`}
            onClick={() => bridge.window.close()}
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </header>
  )
}
