import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlayButton } from './components/PlayButton'
import { Sidebar } from './components/Sidebar'
import { parseHash, routeToHash } from './lib/router'
import { RulesStep } from './screens/onboarding/RulesStep'
import { markdownExcerpt } from './lib/format'

const RULES = { version: 3, updatedAt: '2026-10-16', content: '# Règlement\n\n'.padEnd(400, 'Texte du règlement. ') }

/** Simule la taille de la zone de défilement (jsdom ne calcule pas la mise en page). */
function setScrollGeometry(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
}

describe('règlement (onboarding)', () => {
  it('la case « J’accepte » reste bloquée tant que le texte n’est pas lu jusqu’en bas', () => {
    const onAccepted = vi.fn()
    render(<RulesStep rules={RULES} accepted={false} onAcceptedChange={onAccepted} />)
    const scroller = screen.getByTestId('rules-scroll')
    const checkbox = screen.getByRole('checkbox')

    setScrollGeometry(scroller, { scrollHeight: 2000, clientHeight: 400 })
    scroller.scrollTop = 600
    fireEvent.scroll(scroller)
    expect(checkbox).toBeDisabled()
    expect(screen.getByText(/Fais défiler le règlement/)).toBeInTheDocument()

    scroller.scrollTop = 1600
    fireEvent.scroll(scroller)
    expect(checkbox).toBeEnabled()

    fireEvent.click(checkbox)
    expect(onAccepted).toHaveBeenCalledWith(true)
  })

  it('affiche la version du règlement à accepter', () => {
    render(<RulesStep rules={RULES} accepted={false} onAcceptedChange={() => undefined} />)
    expect(screen.getByText('(version 3)')).toBeInTheDocument()
  })
})

describe('bouton JOUER', () => {
  it('lance le jeu quand il est prêt', async () => {
    const onPlay = vi.fn()
    render(<PlayButton state="ready" onPlay={onPlay} />)
    await userEvent.click(screen.getByRole('button', { name: 'Jouer sur HARDCORE SMP' }))
    expect(onPlay).toHaveBeenCalledOnce()
  })

  it('est bloqué quand une mise à jour est obligatoire', () => {
    render(<PlayButton state="blocked" status="Mise à jour requise" onPlay={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Mise à jour requise' })).toBeDisabled()
  })
})

describe('navigation', () => {
  it('affiche tous les écrans demandés et signale l’écran actif', async () => {
    const onNavigate = vi.fn()
    render(<Sidebar current="mods" account={null} onNavigate={onNavigate} />)
    for (const label of ['Accueil', 'Actus', 'Le serveur', 'Mods', 'Paramètres', 'Support', 'Comptes']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /Mods/ })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: /Actus/ }))
    expect(onNavigate).toHaveBeenCalledWith('news')
  })

  it('lit et écrit les adresses internes', () => {
    expect(parseHash('#/news/saison-2-lancement')).toEqual({ screen: 'news', param: 'saison-2-lancement' })
    expect(parseHash('#/inconnu')).toEqual({ screen: 'home', param: undefined })
    expect(routeToHash('onboarding', '3')).toBe('#/onboarding/3')
  })
})

describe('aperçu des actus', () => {
  it('retire la mise en forme Markdown et coupe proprement', () => {
    expect(markdownExcerpt('## Titre\n\nUne **seule** vie… ou `presque`.')).toBe('Une seule vie… ou presque.')
    expect(markdownExcerpt('a'.repeat(200), 20)).toHaveLength(20)
  })
})

describe('accueil (données du process principal, ici l’aperçu navigateur)', () => {
  it('statut du serveur en couleurs, et règlement à ré-accepter quand sa version a changé', async () => {
    const { bridge } = await import('./lib/bridge')
    const { AppStateProvider } = await import('./state/app-state')
    const { ToastProvider } = await import('./state/toasts')
    const { HomeScreen } = await import('./screens/Home')
    // Première ouverture déjà faite, mais règlement accepté dans une ancienne version (0 < version actuelle).
    await bridge.settings.update({ onboardingCompleted: true, acceptedRulesVersion: 0 })
    render(
      <ToastProvider>
        <AppStateProvider>
          <HomeScreen />
        </AppStateProvider>
      </ToastProvider>
    )
    expect(await screen.findByText(/Rejoins nous sans mourir/)).toBeInTheDocument()
    expect(screen.getByText('Paper 26.2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lire le nouveau règlement' })).toBeInTheDocument()
    expect(screen.getByText('Le règlement a changé : lis-le et accepte-le avant de jouer.')).toBeInTheDocument()
  })
})
