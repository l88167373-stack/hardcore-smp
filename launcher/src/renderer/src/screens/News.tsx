import { ExternalLink } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Markdown } from '../components/Markdown'
import { useActions } from '../lib/actions'
import { formatDate, formatShortDate } from '../lib/format'
import { useRoute } from '../lib/router'
import { useAppState } from '../state/app-state'
import styles from './News.module.css'
import { ScreenHeader } from './ScreenHeader'

export function NewsScreen({ selectedId }: { selectedId: string | undefined }): React.JSX.Element {
  const { config } = useAppState()
  const { openLink } = useActions()
  const [, navigate] = useRoute()
  const news = config.news
  const selected = news.find((n) => n.id === selectedId) ?? news[0]

  return (
    <div className={styles.page}>
      <ScreenHeader title="Les actus du serveur" highlight="actus" />
      {news.length === 0 || !selected ? (
        <p className={styles.empty}>Aucune actu pour l’instant. Les annonces arrivent ici et sur le Discord.</p>
      ) : (
        <div className={styles.layout}>
          <ol className={styles.list}>
            {news.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`${styles.item} ${item.id === selected.id ? styles.active : ''}`}
                  aria-current={item.id === selected.id ? 'true' : undefined}
                  onClick={() => navigate('news', item.id)}
                >
                  <span className={styles.itemMeta}>
                    <Badge tone="ember">{item.tag}</Badge>
                    <time dateTime={item.date}>{formatShortDate(item.date)}</time>
                  </span>
                  <span className={styles.itemTitle}>{item.title}</span>
                </button>
              </li>
            ))}
          </ol>

          <article className={styles.article}>
            {selected.image && (
              // Image hébergée ailleurs que sur les sites autorisés (CSP) : on la masque au lieu d'afficher une image cassée.
              <img className={styles.cover} src={selected.image} alt="" onError={(event) => (event.currentTarget.hidden = true)} />
            )}
            <p className={styles.articleMeta}>
              <Badge tone="ember">{selected.tag}</Badge>
              <time dateTime={selected.date}>{formatDate(selected.date)}</time>
            </p>
            <h2 className={styles.articleTitle}>{selected.title}</h2>
            <Markdown>{selected.body}</Markdown>
            {selected.link && (
              <Button
                className={styles.more}
                variant="outline"
                icon={<ExternalLink />}
                onClick={() => openLink(selected.link, 'Lien de l’actu')}
              >
                En savoir plus
              </Button>
            )}
          </article>
        </div>
      )}
    </div>
  )
}
