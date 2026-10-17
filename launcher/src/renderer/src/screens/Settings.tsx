import { formatMemory, memoryBounds } from '@shared/memory'
import { ChevronDown, FolderOpen, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ProgressBar } from '../components/ProgressBar'
import { Toggle } from '../components/Toggle'
import { bridge } from '../lib/bridge'
import { useAppState } from '../state/app-state'
import { useToasts } from '../state/toasts'
import { ScreenHeader } from './ScreenHeader'
import styles from './Settings.module.css'

const RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
]

export function SettingsScreen(): React.JSX.Element {
  const { info, settings, updateSettings, game, installGame } = useAppState()
  const { push } = useToasts()
  const bounds = memoryBounds(info.totalMemoryMb)
  const [memory, setMemory] = useState(settings.memoryMb)
  const [jvmArgs, setJvmArgs] = useState(settings.jvmArgs)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)

  // Enregistrement de la RAM quand on relâche le curseur (pas à chaque pixel).
  const saveMemory = (): void => {
    if (memory !== settings.memoryMb) void updateSettings({ memoryMb: memory })
  }

  // Vérifie l'empreinte de chaque fichier du jeu et retélécharge ceux qui sont abîmés ou manquants.
  const repair = async (): Promise<void> => {
    setRepairing(true)
    const result = await installGame('repair')
    setRepairing(false)
    if (result.ok) push('Fichiers vérifiés : tout est en ordre.', 'success')
    else push(`${result.error.title} : ${result.error.message}`, 'error')
  }
  const repairRatio = game.progress && game.progress.totalBytes > 0 ? game.progress.doneBytes / game.progress.totalBytes : 0

  const fill = ((memory - bounds.min) / Math.max(1, bounds.max - bounds.min)) * 100
  const recommendedAt = ((bounds.recommended - bounds.min) / Math.max(1, bounds.max - bounds.min)) * 100
  const resolutionValue = `${settings.resolution.width}x${settings.resolution.height}`

  return (
    <div className={styles.page}>
      <ScreenHeader title="Paramètres" lede="Les changements sont enregistrés automatiquement." />

      <div className={styles.grid}>
        <Card label="Mémoire" className={styles.wide}>
          <div className={styles.memoryHead}>
            <p>
              <span className={`${styles.memoryValue} fire-text tabular`}>{formatMemory(memory)}</span>
              <span className={styles.memoryCaption}>
                pour Minecraft, sur {formatMemory(Math.round(info.totalMemoryMb / 1024) * 1024)} dans ton PC
              </span>
            </p>
            {memory !== bounds.recommended && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMemory(bounds.recommended)
                  void updateSettings({ memoryMb: bounds.recommended })
                }}
              >
                Revenir à la valeur conseillée ({formatMemory(bounds.recommended)})
              </Button>
            )}
          </div>
          <div className={styles.sliderWrap}>
            <input
              type="range"
              className={styles.slider}
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={memory}
              style={{ '--fill': `${fill}%` } as React.CSSProperties}
              onChange={(e) => setMemory(Number(e.target.value))}
              onPointerUp={saveMemory}
              onKeyUp={saveMemory}
              onBlur={saveMemory}
              aria-label="Mémoire allouée au jeu"
              aria-valuetext={formatMemory(memory)}
            />
            <span className={styles.recommendedMark} style={{ left: `${recommendedAt}%` }} aria-hidden="true" />
          </div>
          <div className={styles.sliderScale}>
            <span>{formatMemory(bounds.min)}</span>
            <span>Conseillé : {formatMemory(bounds.recommended)}</span>
            <span>{formatMemory(bounds.max)}</span>
          </div>
          <p className={styles.help}>
            Le maximum laisse 2 Go à ton système. Plus n’est pas toujours mieux : au-delà de 6 à 8 Go, le jeu peut même
            devenir moins fluide.
          </p>
        </Card>

        <Card label="Affichage">
          <label className={styles.field}>
            <span>Taille de la fenêtre du jeu</span>
            <select
              value={resolutionValue}
              disabled={settings.resolution.fullscreen}
              onChange={(e) => {
                const [width, height] = e.target.value.split('x').map(Number)
                if (width && height) void updateSettings({ resolution: { ...settings.resolution, width, height } })
              }}
            >
              {RESOLUTIONS.map((r) => (
                <option key={`${r.width}x${r.height}`} value={`${r.width}x${r.height}`}>
                  {r.width} × {r.height}
                </option>
              ))}
              {!RESOLUTIONS.some((r) => `${r.width}x${r.height}` === resolutionValue) && (
                <option value={resolutionValue}>
                  {settings.resolution.width} × {settings.resolution.height}
                </option>
              )}
            </select>
          </label>
          <Toggle
            label="Plein écran"
            description="Le jeu démarre directement en plein écran."
            checked={settings.resolution.fullscreen}
            onChange={(fullscreen) => void updateSettings({ resolution: { ...settings.resolution, fullscreen } })}
          />
        </Card>

        <Card label="Launcher">
          <Toggle
            label="Fermer le launcher quand le jeu démarre"
            description="Sinon, il reste ouvert pendant que tu joues."
            checked={settings.closeOnLaunch}
            onChange={(closeOnLaunch) => void updateSettings({ closeOnLaunch })}
          />
          <Toggle
            label="Afficher mon activité sur Discord"
            description="« En jeu sur HARDCORE SMP, Saison 2 » sur ton profil Discord."
            checked={settings.discordRichPresence}
            onChange={(discordRichPresence) => void updateSettings({ discordRichPresence })}
          />
        </Card>

        <Card label="Fichiers du jeu" className={styles.wide}>
          <p className={styles.path}>
            <code>{info.gameDirectory}</code>
          </p>
          <div className={styles.row}>
            <Button icon={<FolderOpen />} onClick={() => void bridge.shell.openGameFolder('root')}>
              Ouvrir le dossier du jeu
            </Button>
            <Button icon={<Wrench />} disabled={game.phase !== 'idle'} onClick={() => void repair()}>
              {repairing ? 'Vérification en cours…' : 'Vérifier et réparer les fichiers'}
            </Button>
          </div>
          {repairing && (
            <div className={styles.repair}>
              <ProgressBar value={repairRatio} label="Vérification des fichiers" />
              <span className="tabular">{game.progress?.step ?? 'Préparation'}</span>
            </div>
          )}
        </Card>

        <section className={`${styles.advanced} ${styles.wide}`}>
          <button
            type="button"
            className={styles.advancedToggle}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            <ChevronDown size={16} className={advancedOpen ? styles.chevronOpen : undefined} aria-hidden="true" />
            Avancé
          </button>
          {advancedOpen && (
            <div className={styles.advancedBody}>
              <label className={styles.field}>
                <span>Arguments JVM supplémentaires</span>
                <textarea
                  rows={3}
                  value={jvmArgs}
                  spellCheck={false}
                  placeholder="-XX:+UseZGC"
                  onChange={(e) => setJvmArgs(e.target.value)}
                  onBlur={() => {
                    if (jvmArgs !== settings.jvmArgs) void updateSettings({ jvmArgs })
                  }}
                />
              </label>
              <p className={styles.help}>
                Ne touche à ça que si tu sais ce que tu fais : un mauvais argument peut empêcher le jeu de démarrer. La
                mémoire se règle plus haut, pas ici.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
