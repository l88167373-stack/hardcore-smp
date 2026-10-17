import { gameError, type GameErrorCode } from '@shared/game'
import { formatMemory } from '@shared/memory'
import { ChevronRight, Copy, MessageCircle, UserPlus } from 'lucide-react'
import { useEffect } from 'react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ErrorBox } from '../components/ErrorBox'
import { Logo } from '../components/Logo'
import { Motd } from '../components/Motd'
import { PlayButton } from '../components/PlayButton'
import { SkinHead } from '../components/SkinHead'
import { useActions } from '../lib/actions'
import { formatShortDate, formatTime, markdownExcerpt } from '../lib/format'
import { useRoute, type Screen } from '../lib/router'
import { useAppState } from '../state/app-state'
import { useToasts } from '../state/toasts'
import styles from './Home.module.css'

/** Action proposée sous une erreur de lancement, selon sa cause. */
const ERROR_ACTIONS: Partial<Record<GameErrorCode, { label: string; screen: Screen; param?: string }>> = {
  'not-logged-in': { label: 'Connecter un compte', screen: 'accounts' },
  'session-expired': { label: 'Se reconnecter', screen: 'accounts' },
  'rules-not-accepted': { label: 'Lire le règlement', screen: 'onboarding', param: '2' },
  'java-failed': { label: 'Réparer les fichiers', screen: 'settings' },
  memory: { label: 'Régler la mémoire', screen: 'settings' },
  'game-crashed': { label: 'Voir le plantage', screen: 'support' }
}

export function HomeScreen(): React.JSX.Element {
  const { config, settings, activeAccount, mustUpdate, server, game, launchGame } = useAppState()
  const { copyAddress, openDiscord, serverAddress } = useActions()
  const { push } = useToasts()
  const [, navigate] = useRoute()

  const progress = game.progress
  const percent = progress && progress.totalBytes > 0 ? progress.doneBytes / progress.totalBytes : 0
  // Le règlement peut changer en ligne pendant que le launcher est ouvert : on le signale tout de suite.
  const rulesOutdated = settings.acceptedRulesVersion < config.rules.version
  let playState: 'ready' | 'busy' | 'blocked' = 'ready'
  let playStatus = ''
  if (mustUpdate) [playState, playStatus] = ['blocked', 'Mise à jour requise']
  else if (!activeAccount) [playState, playStatus] = ['blocked', 'Connecte un compte']
  else if (activeAccount.needsRelogin) [playState, playStatus] = ['blocked', 'Reconnexion nécessaire']
  else if (rulesOutdated) [playState, playStatus] = ['blocked', 'Nouveau règlement à accepter']
  else if (game.phase === 'installing') [playState, playStatus] = ['busy', `${progress?.step ?? 'Préparation'} ${Math.round(percent * 100)} %`]
  else if (game.phase === 'launching') [playState, playStatus] = ['busy', progress?.step ?? 'Lancement du jeu']
  else if (game.phase === 'running') [playState, playStatus] = ['blocked', 'En jeu']

  // Prévient le joueur quand des fichiers non autorisés ont été mis de côté (détail dans l'onglet Mods → Installés).
  useEffect(() => {
    const [first] = game.quarantined
    if (game.quarantined.length === 1 && first) push(`${first.file} mis en quarantaine : ${first.reason}.`, 'info')
    else if (game.quarantined.length > 1) push(`${game.quarantined.length} fichiers mis en quarantaine (détail : onglet Mods → Installés).`, 'info')
  }, [game.quarantined, push])

  useEffect(() => {
    if (game.adopted.length > 0) push(`Ajouté à la main et autorisé : ${game.adopted.join(', ')}.`, 'success')
  }, [game.adopted, push])

  const errorAction = game.error ? ERROR_ACTIONS[game.error.code] : undefined

  return (
    <div className={styles.home}>
      <section className={styles.hero} aria-label="Jouer">
        <Logo size="lg" />
        <p className={styles.slogan}>
          SURVIS. MEURS. <span className="ember">REVIENS.</span>
        </p>

        <div className={styles.playRow}>
          <PlayButton
            state={playState}
            status={playStatus}
            progress={game.phase === 'installing' ? percent : 0}
            onPlay={() => void launchGame()}
          />
          {activeAccount ? (
            <button
              type="button"
              className={`${styles.accountChip} ${activeAccount.needsRelogin ? styles.accountExpired : ''}`}
              onClick={() => navigate('accounts')}
            >
              <SkinHead skin={activeAccount.skin} size={34} title={activeAccount.username} />
              <span className={styles.accountText}>
                <span className={styles.accountCaption}>
                  {activeAccount.needsRelogin ? 'Reconnexion nécessaire' : 'Compte'}
                </span>
                <span className={styles.accountName}>{activeAccount.username}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className={styles.accountChip} onClick={() => navigate('accounts')}>
              <UserPlus size={22} aria-hidden="true" />
              <span className={styles.accountText}>
                <span className={styles.accountCaption}>Aucun compte</span>
                <span className={styles.accountName}>Se connecter</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <p className={styles.playHint}>
          {game.installed
            ? `Minecraft ${config.launcher.minecraftVersion} avec Fabric, ${formatMemory(settings.memoryMb)} de RAM, connexion directe au serveur.`
            : `Premier lancement : le jeu s’installe d’abord (environ 700 Mo).`}
        </p>

        {rulesOutdated && !game.error && settings.onboardingCompleted && (
          <ErrorBox error={gameError('rules-not-accepted')}>
            <Button size="sm" variant="outline" onClick={() => navigate('onboarding', '2')}>
              Lire le nouveau règlement
            </Button>
          </ErrorBox>
        )}

        {game.error && (
          <ErrorBox error={game.error}>
            {errorAction && (
              <Button size="sm" variant="outline" onClick={() => navigate(errorAction.screen, errorAction.param)}>
                {errorAction.label}
              </Button>
            )}
          </ErrorBox>
        )}

        <div className={styles.quickActions}>
          <Button variant="outline" icon={<Copy />} onClick={copyAddress}>
            Copier l’IP
          </Button>
          <Button variant="outline" icon={<MessageCircle />} onClick={openDiscord}>
            Rejoindre le Discord
          </Button>
        </div>
      </section>

      <Card
        label="Fiche du serveur"
        className={styles.serverCard}
        alert={server?.online === false}
        aside={
          !server ? (
            <Badge tone="neutral">Vérification…</Badge>
          ) : server.online ? (
            <Badge tone="live">En ligne</Badge>
          ) : (
            <Badge tone="alert">Hors ligne</Badge>
          )
        }
      >
        {!server ? (
          <p className={styles.offlineText}>Connexion au serveur…</p>
        ) : server.online ? (
          <>
            <div className={styles.players}>
              {server.favicon && <img className={styles.favicon} src={server.favicon} width={44} height={44} alt="" />}
              <span className={`${styles.playersCount} fire-text tabular`}>{server.players}</span>
              <span className={styles.playersMax}>/ {server.maxPlayers}</span>
            </div>
            <p className={styles.playersLabel}>joueurs en ligne</p>
            <dl className={styles.stats}>
              <div>
                <dt>Ping</dt>
                <dd className="tabular">{server.pingMs} ms</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{server.version || config.launcher.minecraftVersion}</dd>
              </div>
            </dl>
            {server.motd.length > 0 && <Motd segments={server.motd} className={styles.motd} />}
          </>
        ) : (
          <div className={styles.offline}>
            <p className={styles.offlineTitle}>Le serveur ne répond pas.</p>
            <p className={styles.offlineText}>
              Il redémarre peut-être. Le statut se met à jour toutes les 30 secondes ; les annonces sont sur le Discord.
            </p>
          </div>
        )}
        <div className={styles.address}>
          <code>{serverAddress}</code>
          <button type="button" className={styles.copy} onClick={copyAddress} aria-label="Copier l’adresse du serveur">
            <Copy size={14} />
          </button>
        </div>
        {server && <p className={styles.checked}>Actualisé à {formatTime(new Date(server.checkedAt))}</p>}
      </Card>

      <Card
        label="Dernières actus"
        className={styles.news}
        aside={
          <Button variant="ghost" size="sm" onClick={() => navigate('news')}>
            Toutes les actus
          </Button>
        }
      >
        <div className={styles.newsGrid}>
          {config.news.slice(0, 2).map((item) => (
            <button key={item.id} type="button" className={styles.newsItem} onClick={() => navigate('news', item.id)}>
              <span className={styles.newsMeta}>
                <Badge tone="ember">{item.tag}</Badge>
                <time dateTime={item.date}>{formatShortDate(item.date)}</time>
              </span>
              <span className={styles.newsTitle}>{item.title}</span>
              <span className={styles.newsExcerpt}>{markdownExcerpt(item.body)}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
