import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { bridge } from '../lib/bridge'
import styles from './Markdown.module.css'

/**
 * Affichage sécurisé du Markdown (actus, règlement) :
 * le HTML brut n'est jamais interprété, le résultat est assaini,
 * et les liens s'ouvrent dans le navigateur (uniquement vers les sites autorisés).
 */
export function Markdown({ children }: { children: string }): React.JSX.Element {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ href, children: label }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault()
                if (href) void bridge.shell.openExternal(href)
              }}
            >
              {label}
            </a>
          ),
          img: ({ alt }) => <span className={styles.imageAlt}>{alt}</span>
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
