import styles from './Logo.module.css'

// Logo officiel déposé dans assets/logo.png (facultatif). Absent → logo typographique de remplacement.
const officialLogos = import.meta.glob<string>('@assets/logo.png', { eager: true, query: '?url', import: 'default' })
const officialLogo = Object.values(officialLogos)[0]

export function Logo({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }): React.JSX.Element {
  if (officialLogo) {
    return <img src={officialLogo} alt="HARDCORE SMP" className={`${styles.image} ${styles[size]}`} draggable={false} />
  }
  return (
    <div className={`${styles.wordmark} ${styles[size]}`} role="img" aria-label="HARDCORE SMP, Saison 2">
      <span className={styles.hardcore}>HARDCORE</span>
      <span className={styles.line}>
        <span className={styles.smp}>SMP</span>
        <span className={styles.season}>Saison 2</span>
      </span>
    </div>
  )
}
