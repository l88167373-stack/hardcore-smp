import type { AuthErrorCode } from '@shared/auth-errors'
import { FlaskConical, Play, X } from 'lucide-react'
import { useState } from 'react'
import { bridge } from '../lib/bridge'
import { DEMO_MODE } from '../lib/demo'
import { useRoute } from '../lib/router'
import { useAppState } from '../state/app-state'
import styles from './Overlays.module.css'

const LOGIN_ERRORS: { value: AuthErrorCode | ''; label: string }[] = [
  { value: '', label: 'Aucune (vraie connexion)' },
  { value: 'not-configured', label: 'Client ID Azure manquant' },
  { value: 'session-expired', label: 'Connexion expirée' },
  { value: 'no-xbox-account', label: 'Pas de profil Xbox' },
  { value: 'child-account', label: 'Compte enfant' },
  { value: 'game-not-owned', label: 'Jeu non acheté' },
  { value: 'app-not-approved', label: 'App pas encore validée par Mojang' },
  { value: 'network', label: 'Problème réseau' }
]

/**
 * Panneau de démonstration (phase 1) : permet de voir chaque état de l'interface.
 * Il disparaîtra quand les vraies fonctions seront branchées.
 */
export function DemoPanel(): React.JSX.Element | null {
  const { demo, setDemo, updateSettings, info, game } = useAppState()
  const [, navigate] = useRoute()
  const [open, setOpen] = useState(false)
  // Outil de développement : absent de l'application installée.
  if (!DEMO_MODE || info.isPackaged) return null

  if (!open) {
    return (
      <button type="button" className={styles.demoFab} onClick={() => setOpen(true)}>
        <FlaskConical size={14} aria-hidden="true" />
        Démo
      </button>
    )
  }

  return (
    <aside className={styles.demo} aria-label="Panneau de démonstration">
      <header className={styles.demoHeader}>
        <strong>Panneau de démo</strong>
        <button type="button" className={styles.toastClose} onClick={() => setOpen(false)} aria-label="Fermer">
          <X size={14} />
        </button>
      </header>
      <p className={styles.demoNote}>Voir les messages d’erreur sans compte réel, ou rejouer la première ouverture.</p>
      <label className={styles.demoField}>
        <span>Erreur de connexion Microsoft</span>
        <select
          value={demo.loginError ?? ''}
          onChange={(e) => setDemo({ loginError: (e.target.value || null) as AuthErrorCode | null })}
        >
          {LOGIN_ERRORS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={styles.demoLink}
        onClick={() => {
          void updateSettings({ onboardingCompleted: false, acceptedRulesVersion: 0 })
          navigate('onboarding', '1')
        }}
      >
        Recommencer la première ouverture
      </button>
      {!info.isPackaged && (
        <>
          <p className={styles.demoNote}>
            Développement uniquement : lance Minecraft sans compte (hors ligne, sans connexion au serveur) pour tester
            l’installation et le lancement.
          </p>
          <button
            type="button"
            className={styles.demoLink}
            disabled={game.phase !== 'idle'}
            onClick={() => void bridge.game.testLaunchOffline()}
          >
            <Play size={12} aria-hidden="true" /> Tester le lancement hors ligne
          </button>
        </>
      )}
    </aside>
  )
}
