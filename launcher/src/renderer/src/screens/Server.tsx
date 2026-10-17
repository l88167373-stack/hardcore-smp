import { Copy, MessageCircle } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useActions } from '../lib/actions'
import { ScreenHeader } from './ScreenHeader'
import styles from './Server.module.css'

/** Commandes annoncées pour la Saison 2. */
const COMMANDS: { command: string; description: string }[] = [
  { command: '/spawn', description: 'Retourner au spawn' },
  { command: '/eggs', description: 'Voir les chances d’obtenir chaque œuf' },
  { command: '/custom craft', description: 'Voir les crafts personnalisés' },
  { command: '/discord', description: 'Obtenir le lien du Discord' },
  { command: '/hud toggle', description: 'Masquer ou afficher le scoreboard' }
]

const POWERFUL_MOBS = ['Wither squelette', 'Blaze', 'Enderman', 'Shulker', 'Golem de fer']

export function ServerScreen(): React.JSX.Element {
  const { copyAddress, copyText, openDiscord, serverAddress } = useActions()

  return (
    <div className={styles.page}>
      <ScreenHeader
        title="Une seule vie… ou presque."
        highlight="ou presque."
        lede="Tout ce qu’il faut savoir avant d’entrer sur HARDCORE SMP, Saison 2."
        actions={
          <Button variant="outline" icon={<Copy />} onClick={copyAddress}>
            {serverAddress}
          </Button>
        }
      />

      <div className={styles.grid}>
        <Card label="Mort et retour" alert className={styles.wide}>
          <ol className={styles.cycle}>
            <li>
              <span className={styles.step}>1</span>
              <div>
                <h3>Tu meurs</h3>
                <p>Tu es envoyé dans la zone des morts. Ta tombe apparaît là où tu es tombé.</p>
              </div>
            </li>
            <li>
              <span className={styles.step}>2</span>
              <div>
                <h3>Tes potes déposent les offrandes</h3>
                <p>
                  Clic droit sur ta tombe avec l’objet demandé, ou <kbd>accroupi + clic droit</kbd> pour tout déposer
                  d’un coup.
                </p>
              </div>
            </li>
            <li>
              <span className={styles.step}>3</span>
              <div>
                <h3>Tu reviens</h3>
                <p>Toutes les offrandes déposées, tu reprends la partie.</p>
              </div>
            </li>
          </ol>
          <p className={styles.warning}>
            <Badge tone="alert">Attention</Badge>
            Plus tu meurs, plus les offrandes sont chères.
          </p>
        </Card>

        <Card label="Têtes de mobs">
          <p className={styles.text}>
            Chaque mob peut lâcher sa tête quand tu le tues toi-même. Plus un mob est commun, plus sa tête est rare.
          </p>
          <div className={styles.odds}>
            <div>
              <span className={`${styles.oddsValue} fire-text`}>5 %</span>
              <span className={styles.oddsLabel}>Vache</span>
            </div>
            <div className={styles.oddsArrow} aria-hidden="true" />
            <div>
              <span className={`${styles.oddsValue} fire-text`}>50 %</span>
              <span className={styles.oddsLabel}>Warden</span>
            </div>
          </div>
        </Card>

        <Card label="Œufs et spawners">
          <div className={styles.odds}>
            <div>
              <span className={`${styles.oddsValue} fire-text`}>~1 %</span>
              <span className={styles.oddsLabel}>la plupart des mobs</span>
            </div>
            <div>
              <span className={`${styles.oddsValue} fire-text`}>0,01 %</span>
              <span className={styles.oddsLabel}>mobs trop puissants</span>
            </div>
          </div>
          <p className={styles.small}>Mobs trop puissants : {POWERFUL_MOBS.join(', ')}… Tape /eggs pour tout voir.</p>
          <h3 className={styles.subTitle}>Craft du spawner</h3>
          <ul className={styles.recipe}>
            <li>
              <span className="fire-text tabular">4</span> blocs de netherite
            </li>
            <li>
              <span className="fire-text tabular">4</span> barreaux de fer
            </li>
            <li>
              <span className="fire-text tabular">1</span> étoile du Nether
            </li>
          </ul>
          <p className={styles.small}>
            Clic droit avec un œuf pour choisir le mob. Une pioche Toucher de soie le récupère, et il garde son mob.
          </p>
        </Card>

        <Card label="Infos à l’écran">
          <ul className={styles.list}>
            <li>Vie, morts, temps de jeu, ping et TPS sur le côté</li>
            <li>Vie et nombre de morts à côté des pseudos</li>
            <li>Classement des morts au spawn</li>
            <li>
              <code>/hud toggle</code> pour masquer le scoreboard
            </li>
          </ul>
        </Card>

        <Card label="Commandes">
          <ul className={styles.commands}>
            {COMMANDS.map(({ command, description }) => (
              <li key={command}>
                <button
                  type="button"
                  className={styles.command}
                  onClick={() => copyText(command, `Commande copiée : ${command}`)}
                  title="Copier la commande"
                >
                  <code>{command}</code>
                  <span>{description}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card label="Discord relié au jeu">
          <p className={styles.text}>
            Le chat du jeu et le salon Discord se répondent en direct : tu peux parler aux joueurs connectés même sans
            être en jeu.
          </p>
          <Button className={styles.cardAction} variant="outline" icon={<MessageCircle />} onClick={openDiscord}>
            Rejoindre le Discord
          </Button>
        </Card>

        <Card label="À savoir" alert>
          <ul className={styles.rules}>
            <li>
              <Badge tone="neutral">L’End est fermé</Badge>
              <span>au lancement de la saison.</span>
            </li>
            <li>
              <Badge tone="alert">Triche interdite</Badge>
              <span>Clients de triche bannis, sans avertissement.</span>
            </li>
            <li>
              <Badge tone="ember">Launcher officiel</Badge>
              <span>Obligatoire pour se connecter.</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
