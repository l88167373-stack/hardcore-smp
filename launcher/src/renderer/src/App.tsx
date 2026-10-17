import { useEffect } from 'react'
import styles from './App.module.css'
import { Background, type HaloPlacement } from './components/Background'
import { DemoPanel } from './components/DemoPanel'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { ToastView } from './components/ToastView'
import { MandatoryUpdate, UpdateBanner } from './components/UpdateNotices'
import { useRoute, type Screen } from './lib/router'
import { AccountsScreen } from './screens/Accounts'
import { HomeScreen } from './screens/Home'
import { ModsScreen } from './screens/Mods'
import { NewsScreen } from './screens/News'
import { Onboarding } from './screens/onboarding/Onboarding'
import { ServerScreen } from './screens/Server'
import { SettingsScreen } from './screens/Settings'
import { SupportScreen } from './screens/Support'
import { AppStateProvider, useAppState } from './state/app-state'
import { ToastProvider } from './state/toasts'

const HALO: Record<Screen, HaloPlacement> = {
  home: 'hero',
  onboarding: 'center',
  news: 'top',
  server: 'top',
  mods: 'top',
  settings: 'top',
  accounts: 'top',
  support: 'top'
}

function Shell(): React.JSX.Element {
  const { settings, activeAccount } = useAppState()
  const [route, navigate] = useRoute()

  // Première ouverture : on passe par l'onboarding tant qu'il n'est pas terminé.
  const showOnboarding = route.screen === 'onboarding' || !settings.onboardingCompleted
  const screen: Screen = showOnboarding ? 'onboarding' : route.screen

  useEffect(() => {
    document.getElementById('main-content')?.scrollTo({ top: 0 })
  }, [screen])

  return (
    <>
      <Background halo={HALO[screen]} />
      <div className={styles.app}>
        <TitleBar />
        {showOnboarding ? (
          <Onboarding step={route.screen === 'onboarding' ? route.param : undefined} />
        ) : (
          <div className={styles.body}>
            <Sidebar current={screen} account={activeAccount} onNavigate={(s) => navigate(s)} />
            <main id="main-content" className={styles.main} key={screen}>
              <UpdateBanner />
              {screen === 'home' && <HomeScreen />}
              {screen === 'news' && <NewsScreen selectedId={route.param} />}
              {screen === 'server' && <ServerScreen />}
              {screen === 'mods' && <ModsScreen />}
              {screen === 'settings' && <SettingsScreen />}
              {screen === 'accounts' && <AccountsScreen />}
              {screen === 'support' && <SupportScreen />}
            </main>
          </div>
        )}
      </div>
      <MandatoryUpdate />
      <DemoPanel />
      <ToastView />
    </>
  )
}

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppStateProvider>
        <Shell />
      </AppStateProvider>
    </ToastProvider>
  )
}
