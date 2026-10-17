import type { AuthErrorInfo } from '@shared/auth-errors'
import type { GameErrorInfo } from '@shared/game'
import { Check, Copy, MessageCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ErrorBox } from '../../components/ErrorBox'
import { Button } from '../../components/Button'
import { Logo } from '../../components/Logo'
import { PlayButton } from '../../components/PlayButton'
import { SkinHead } from '../../components/SkinHead'
import { useActions } from '../../lib/actions'
import { DEMO_MODE } from '../../lib/demo'
import { useRoute } from '../../lib/router'
import { useAppState } from '../../state/app-state'
import { useToasts } from '../../state/toasts'
import { InstallStep } from './InstallStep'
import styles from './Onboarding.module.css'
import { RulesStep } from './RulesStep'

const STEPS = ['Connexion', 'Règlement', 'Discord', 'Installation', 'Jouer'] as const

function parseStep(param: string | undefined): number {
  const n = Number(param)
  return Number.isInteger(n) && n >= 1 && n <= STEPS.length ? n : 1
}

export function Onboarding({ step: stepParam }: { step: string | undefined }): React.JSX.Element {
  const { config, settings, updateSettings, activeAccount, addAccount, game, installGame } = useAppState()
  const { openDiscord, copyText } = useActions()
  const { push } = useToasts()
  const [, navigate] = useRoute()
  const step = parseStep(stepParam)

  const [loginPending, setLoginPending] = useState(false)
  const [loginError, setLoginError] = useState<AuthErrorInfo | null>(null)
  // Démo (phase 1-2) : permet de visiter la suite de l'onboarding tant que la connexion n'est pas ouverte.
  const [demoBypass, setDemoBypass] = useState(false)
  const loggedIn = (activeAccount !== null && !activeAccount.needsRelogin) || demoBypass
  const [rulesAccepted, setRulesAccepted] = useState(settings.acceptedRulesVersion >= config.rules.version)
  const [discordDone, setDiscordDone] = useState(step > 3)
  const [installDone, setInstallDone] = useState(step > 4)

  const goTo = (n: number): void => navigate('onboarding', String(n))

  const login = async (): Promise<void> => {
    setLoginError(null)
    setLoginPending(true)
    try {
      const result = await addAccount()
      if (!result.ok && result.error.code !== 'cancelled') setLoginError(result.error)
    } finally {
      setLoginPending(false)
    }
  }

  // Étape 4 : vraie installation (ou vérification rapide si le jeu est déjà là).
  const [installError, setInstallError] = useState<GameErrorInfo | null>(null)
  const installStarted = useRef(false)
  const startInstall = (): void => {
    installStarted.current = true
    setInstallError(null)
    void installGame('quick').then((result) => {
      if (result.ok) setInstallDone(true)
      else setInstallError(result.error)
    })
  }
  useEffect(() => {
    if (step === 4 && !installDone && !installStarted.current && game.phase === 'idle') startInstall()
    // startInstall ne change pas de comportement d'un rendu à l'autre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, installDone, game.phase])

  const finish = (): void => {
    void updateSettings({ onboardingCompleted: true }).then(() => {
      navigate('home')
      push('Bienvenue sur HARDCORE SMP. Bonne chance.', 'success')
    })
  }

  const canOpen = (n: number): boolean =>
    n === 1 ||
    (n === 2 && loggedIn) ||
    (n === 3 && loggedIn && rulesAccepted) ||
    (n === 4 && loggedIn && rulesAccepted && discordDone) ||
    (n === 5 && loggedIn && rulesAccepted && discordDone && installDone)

  return (
    <div className={styles.onboarding}>
      <aside className={styles.side}>
        <Logo size="md" />
        <ol className={styles.stepper} aria-label="Étapes de la première ouverture">
          {STEPS.map((label, index) => {
            const n = index + 1
            const state = n < step ? 'done' : n === step ? 'current' : 'todo'
            return (
              <li key={label}>
                <button
                  type="button"
                  className={`${styles.stepItem} ${styles[state]}`}
                  disabled={!canOpen(n)}
                  aria-current={n === step ? 'step' : undefined}
                  onClick={() => goTo(n)}
                >
                  <span className={styles.stepNumber}>{state === 'done' ? <Check size={14} strokeWidth={3} /> : n}</span>
                  {label}
                </button>
              </li>
            )
          })}
        </ol>
        <p className={styles.sideNote}>
          Bloqué ? Demande de l’aide sur le Discord, le staff répond vite.
        </p>
      </aside>

      <section className={styles.content} aria-live="polite">
        <div className={styles.panel} key={step}>
          <p className={styles.counter}>
            Étape {step} sur {STEPS.length}
          </p>

          {step === 1 && (
            <>
              <h1 className={styles.title}>
                Connecte-toi avec <span className="ember">Microsoft</span>
              </h1>
              <p className={styles.lede}>
                Utilise le compte Microsoft qui possède Minecraft : Java Edition. Ton mot de passe est saisi chez
                Microsoft, jamais dans le launcher.
              </p>
              {loggedIn && activeAccount && !activeAccount.needsRelogin ? (
                <div className={styles.success}>
                  <SkinHead skin={activeAccount.skin} size={52} title={activeAccount.username} />
                  <div>
                    <p className={styles.successName}>{activeAccount.username}</p>
                    <p className={styles.successText}>Minecraft : Java Edition vérifié</p>
                  </div>
                  <Check className={styles.successCheck} aria-hidden="true" />
                </div>
              ) : (
                !demoBypass && (
                  <Button variant="fire" size="lg" disabled={loginPending} onClick={() => void login()}>
                    {loginPending ? 'Termine la connexion dans la fenêtre Microsoft…' : 'Se connecter avec Microsoft'}
                  </Button>
                )
              )}
              {loginError && !demoBypass && (
                <ErrorBox error={loginError}>
                  {DEMO_MODE && (loginError.code === 'not-configured' || loginError.code === 'app-not-approved') && (
                    <Button size="sm" variant="ghost" onClick={() => setDemoBypass(true)}>
                      Continuer sans compte (démo)
                    </Button>
                  )}
                </ErrorBox>
              )}
              {demoBypass && (
                <p className={styles.lede}>Mode démo : tu visites la suite sans compte. Il faudra se connecter pour jouer.</p>
              )}
              {loggedIn && (
                <div className={styles.footer}>
                  <Button variant="fire" onClick={() => goTo(2)}>
                    Continuer
                  </Button>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className={styles.title}>
                Lis le <span className="ember">règlement</span>
              </h1>
              <RulesStep
                rules={config.rules}
                accepted={rulesAccepted}
                onAcceptedChange={(accepted) => {
                  setRulesAccepted(accepted)
                  void updateSettings({ acceptedRulesVersion: accepted ? config.rules.version : 0 })
                }}
              />
              <div className={styles.footer}>
                <Button variant="ghost" onClick={() => goTo(1)}>
                  Retour
                </Button>
                <Button variant="fire" disabled={!rulesAccepted} onClick={() => goTo(3)}>
                  Continuer
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className={styles.title}>
                Rejoins le <span className="ember">Discord</span>
              </h1>
              <p className={styles.lede}>
                Le serveur est sur liste blanche : on t’y ajoute quand tu écris ton pseudo sur le Discord. Reste ensuite
                sur le Discord, sinon tu perds l’accès.
              </p>
              <ol className={styles.discordSteps}>
                <li>
                  <span className={styles.discordIndex}>1</span>
                  <div>
                    <p className={styles.discordTitle}>Rejoins le serveur Discord</p>
                    <Button size="sm" variant="outline" icon={<MessageCircle />} onClick={openDiscord}>
                      Ouvrir l’invitation
                    </Button>
                  </div>
                </li>
                <li>
                  <span className={styles.discordIndex}>2</span>
                  <div>
                    <p className={styles.discordTitle}>
                      Va dans le salon <code>#whitelist</code> et écris seulement ton pseudo
                    </p>
                    <div className={styles.discordMessage}>
                      <span className={styles.discordAvatar} aria-hidden="true" />
                      <div>
                        <p className={styles.discordAuthor}>Toi</p>
                        <p className={styles.discordText}>{activeAccount?.username ?? 'TonPseudo'}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Copy />}
                        onClick={() => copyText(activeAccount?.username ?? '', 'Pseudo copié.')}
                      >
                        Copier
                      </Button>
                    </div>
                  </div>
                </li>
                <li>
                  <span className={styles.discordIndex}>3</span>
                  <div>
                    <p className={styles.discordTitle}>Attends la réaction ✅ du bot</p>
                    <p className={styles.discordHelp}>
                      Elle arrive en quelques secondes et tu reçois le rôle « Whitelisté ». Une ❌ ? Le bot explique
                      pourquoi juste en dessous.
                    </p>
                  </div>
                </li>
              </ol>
              <label className={styles.accept}>
                <input type="checkbox" checked={discordDone} onChange={(e) => setDiscordDone(e.target.checked)} />
                <span className={styles.checkbox} aria-hidden="true" />
                <span>J’ai écrit mon pseudo dans #whitelist</span>
              </label>
              <div className={styles.footer}>
                <Button variant="ghost" onClick={() => goTo(2)}>
                  Retour
                </Button>
                <Button variant="fire" disabled={!discordDone} onClick={() => goTo(4)}>
                  Continuer
                </Button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className={styles.title}>
                <span className="ember">Installation</span> du jeu
              </h1>
              <p className={styles.lede}>
                Tout s’installe dans un dossier à part : ton Minecraft habituel n’est pas touché.
              </p>
              {(!installDone || game.progress) && <InstallStep progress={game.progress} />}
              {installDone && <p className={styles.lede}>Tout est installé et vérifié.</p>}
              {installError && (
                <ErrorBox error={installError}>
                  <Button size="sm" variant="outline" icon={<RefreshCw />} onClick={startInstall}>
                    Réessayer
                  </Button>
                </ErrorBox>
              )}
              <div className={styles.footer}>
                <Button variant="fire" disabled={!installDone} onClick={() => goTo(5)}>
                  Continuer
                </Button>
              </div>
            </>
          )}

          {step === 5 && (
            <div className={styles.ready}>
              <h1 className={styles.readyTitle}>
                Tout est prêt. <span className="ember">Survis.</span>
              </h1>
              <p className={styles.lede}>
                Un clic sur JOUER et tu arrives directement sur {config.launcher.server.host}. Bonne chance.
              </p>
              <PlayButton state="ready" onPlay={finish} />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
