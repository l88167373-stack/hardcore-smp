import { House, LifeBuoy, Newspaper, Puzzle, Settings, Skull, Users, type LucideIcon } from 'lucide-react'
import type { AccountSummary } from '@shared/ipc'
import type { Screen } from '../lib/router'
import { SkinHead } from './SkinHead'
import styles from './Sidebar.module.css'

interface NavItem {
  screen: Screen
  label: string
  icon: LucideIcon
}

const MAIN: NavItem[] = [
  { screen: 'home', label: 'Accueil', icon: House },
  { screen: 'news', label: 'Actus', icon: Newspaper },
  { screen: 'server', label: 'Le serveur', icon: Skull },
  { screen: 'mods', label: 'Mods', icon: Puzzle }
]

const SECONDARY: NavItem[] = [
  { screen: 'settings', label: 'Paramètres', icon: Settings },
  { screen: 'support', label: 'Support', icon: LifeBuoy }
]

interface SidebarProps {
  current: Screen
  account: AccountSummary | null
  onNavigate: (screen: Screen) => void
}

export function Sidebar({ current, account, onNavigate }: SidebarProps): React.JSX.Element {
  const renderItem = ({ screen, label, icon: Icon }: NavItem): React.JSX.Element => (
    <li key={screen}>
      <button
        type="button"
        className={`${styles.item} ${current === screen ? styles.active : ''}`}
        aria-current={current === screen ? 'page' : undefined}
        onClick={() => onNavigate(screen)}
      >
        <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
        <span>{label}</span>
      </button>
    </li>
  )

  return (
    <nav className={styles.rail} aria-label="Navigation principale">
      <ul className={styles.list}>{MAIN.map(renderItem)}</ul>
      <ul className={`${styles.list} ${styles.bottom}`}>
        {SECONDARY.map(renderItem)}
        <li>
          <button
            type="button"
            className={`${styles.item} ${styles.account} ${current === 'accounts' ? styles.active : ''}`}
            aria-current={current === 'accounts' ? 'page' : undefined}
            onClick={() => onNavigate('accounts')}
          >
            {account ? (
              <span className={styles.headWrap}>
                <SkinHead skin={account.skin} size={30} title={account.username} />
                {account.needsRelogin && <span className={styles.alertDot} aria-label="Reconnexion nécessaire" />}
              </span>
            ) : (
              <Users size={21} />
            )}
            <span className={styles.accountName}>{account?.username ?? 'Comptes'}</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
