import type { AuthErrorInfo } from '@shared/auth-errors'
import { LogOut, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ErrorBox } from '../components/ErrorBox'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { SkinHead } from '../components/SkinHead'
import { useAppState } from '../state/app-state'
import { useToasts } from '../state/toasts'
import styles from './Accounts.module.css'
import { ScreenHeader } from './ScreenHeader'

export function AccountsScreen(): React.JSX.Element {
  const { accounts, authStatus, setActiveAccount, removeAccount, addAccount } = useAppState()
  const { push } = useToasts()
  const [confirmUuid, setConfirmUuid] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthErrorInfo | null>(null)
  const toRemove = accounts.find((a) => a.uuid === confirmUuid)

  const connect = async (): Promise<void> => {
    setError(null)
    setPending(true)
    try {
      const result = await addAccount()
      if (result.ok) push(`Connecté : ${result.account.username}.`, 'success')
      else if (result.error.code !== 'cancelled') setError(result.error)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={styles.page}>
      <ScreenHeader
        title="Comptes Microsoft"
        highlight="Microsoft"
        lede={
          authStatus.secureStorage
            ? 'Tu peux enregistrer plusieurs comptes et choisir celui qui joue. Les connexions sont chiffrées sur ton PC.'
            : 'Tu peux enregistrer plusieurs comptes et choisir celui qui joue.'
        }
        actions={
          <Button variant="fire" icon={<Plus />} disabled={pending} onClick={() => void connect()}>
            {pending ? 'Connexion en cours…' : 'Ajouter un compte'}
          </Button>
        }
      />

      {!authStatus.configured && (
        <p className={styles.notice}>
          <Badge tone="alert">Pas encore activée</Badge>
          La connexion Microsoft attend le Client ID Azure du serveur (fichier app-config.json du launcher).
        </p>
      )}
      {!authStatus.secureStorage && (
        <p className={styles.notice}>
          <Badge tone="ember">Attention</Badge>
          Ton système n’a pas de trousseau sécurisé : pour protéger ton compte, le launcher ne garde pas ta connexion
          après sa fermeture. Tu devras te reconnecter à chaque ouverture.
        </p>
      )}
      {pending && (
        <p className={styles.notice}>
          Une fenêtre Microsoft s’est ouverte : connecte-toi avec le compte qui possède Minecraft. Ton mot de passe est
          saisi chez Microsoft, jamais dans le launcher.
        </p>
      )}
      {error && <ErrorBox error={error} />}

      {accounts.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Aucun compte connecté.</p>
          <p>Ajoute ton compte Microsoft qui possède Minecraft : Java Edition pour pouvoir jouer.</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {accounts.map((account) => (
            <li key={account.uuid} className={`${styles.account} ${account.active ? styles.active : ''}`}>
              <SkinHead skin={account.skin} size={56} title={account.username} />
              <div className={styles.identity}>
                <p className={styles.name}>
                  {account.username}
                  {account.active && <Badge tone="ember">Compte actif</Badge>}
                  {account.needsRelogin && <Badge tone="alert">Reconnexion nécessaire</Badge>}
                </p>
                <p className={styles.uuid}>{account.uuid}</p>
              </div>
              <div className={styles.actions}>
                {account.needsRelogin && (
                  <Button size="sm" variant="outline" icon={<RefreshCw />} disabled={pending} onClick={() => void connect()}>
                    Se reconnecter
                  </Button>
                )}
                {!account.active && (
                  <Button size="sm" variant="outline" onClick={() => void setActiveAccount(account.uuid)}>
                    Jouer avec ce compte
                  </Button>
                )}
                <Button size="sm" variant="danger" icon={<LogOut />} onClick={() => setConfirmUuid(account.uuid)}>
                  Se déconnecter
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toRemove && (
        <Modal title="Se déconnecter" onClose={() => setConfirmUuid(null)}>
          <h2 className={styles.modalTitle}>Déconnecter {toRemove.username} ?</h2>
          <p className={styles.modalText}>
            Le compte et sa connexion seront supprimés de ce PC. Tu pourras le reconnecter à tout moment avec Microsoft.
          </p>
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => setConfirmUuid(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              icon={<LogOut />}
              onClick={() => {
                const { uuid, username } = toRemove
                setConfirmUuid(null)
                void removeAccount(uuid).then(() => push(`${username} est déconnecté.`))
              }}
            >
              Se déconnecter
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
