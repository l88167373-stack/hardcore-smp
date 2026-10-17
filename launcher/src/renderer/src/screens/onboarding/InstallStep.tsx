import type { InstallProgress } from '@shared/game'
import { Check, Minus } from 'lucide-react'
import { ProgressBar } from '../../components/ProgressBar'
import { formatInteger } from '../../lib/format'
import styles from './Onboarding.module.css'

const MB = 1_000_000

/** Progression réelle de l'installation (Java, Minecraft, Fabric, HSMP Guard, mods). */
export function InstallStep({ progress }: { progress: InstallProgress | null }): React.JSX.Element {
  if (!progress) {
    return (
      <div className={styles.install}>
        <div className={styles.installTotal}>
          <span className={`${styles.installPercent} fire-text tabular`}>0 %</span>
          <span className={styles.installSize}>Préparation de la liste des fichiers…</span>
        </div>
        <ProgressBar value={0} label="Installation" />
      </div>
    )
  }

  const ratio = progress.totalBytes > 0 ? progress.doneBytes / progress.totalBytes : 0
  return (
    <div className={styles.install}>
      <div className={styles.installTotal}>
        <span className={`${styles.installPercent} fire-text tabular`}>{Math.round(ratio * 100)} %</span>
        <span className={styles.installSize}>
          {progress.step} : {formatInteger(Math.round(progress.doneBytes / MB))} Mo sur {formatInteger(Math.round(progress.totalBytes / MB))} Mo
        </span>
      </div>
      <ProgressBar value={ratio} label="Installation" />
      <ul className={styles.installList}>
        {progress.groups.map((group) => {
          const groupRatio = group.totalBytes > 0 ? group.doneBytes / group.totalBytes : 1
          return (
            <li key={group.id} className={`${styles.installItem} ${styles[group.state]}`}>
              <span className={styles.installIcon} aria-hidden="true">
                {group.state === 'done' && <Check size={14} strokeWidth={3} />}
                {group.state === 'skipped' && <Minus size={14} strokeWidth={3} />}
              </span>
              <span className={styles.installLabel}>
                {group.label}
                <span>{group.note ?? group.detail}</span>
              </span>
              <span className={styles.installState}>
                {group.state === 'done'
                  ? 'Installé'
                  : group.state === 'skipped'
                    ? 'Plus tard'
                    : group.state === 'active'
                      ? `${Math.round(groupRatio * 100)} %`
                      : 'En attente'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
