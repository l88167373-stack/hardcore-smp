/**
 * Onglet Mods : catalogue Modrinth filtré sur la version du serveur, projets installés,
 * installation / mise à jour / désactivation / désinstallation, et quarantaine.
 * Toutes les opérations sont faites par le process principal ; cet écran ne fait qu'afficher et demander.
 */
import {
  ALL_CONTENT,
  GUARD_PROJECT_ID,
  KIND_LABEL,
  type CatalogProject,
  type CatalogQuery,
  type CatalogSort,
  type ContentKind,
  type ContentOperation,
  type InstalledContent,
  type ModsActionResult,
  type ModsState,
  type ProjectAccess,
  type ProjectDetails
} from '@shared/mods'
import { ArrowUpCircle, ExternalLink, FolderOpen, Lightbulb, Lock, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Markdown } from '../components/Markdown'
import { useActions } from '../lib/actions'
import { bridge } from '../lib/bridge'
import { formatCompact, formatInteger } from '../lib/format'
import { useAppState } from '../state/app-state'
import { useToasts } from '../state/toasts'
import styles from './Mods.module.css'
import { ScreenHeader } from './ScreenHeader'

type Tab = 'recommended' | 'installed' | ContentKind

/** Une ligne de la liste : projet du catalogue ou projet installé. */
interface Row {
  projectId: string
  kind: ContentKind
  title: string
  author: string
  summary: string
  downloads: number | null
  iconUrl: string | null
  access: ProjectAccess
  slug: string | null
}

const MODRINTH_PATH: Record<ContentKind, string> = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader' }

const OPERATION_LABEL: Record<ContentOperation, string> = {
  install: 'Installation…',
  update: 'Mise à jour…',
  remove: 'Désinstallation…',
  toggle: 'Modification…',
  check: 'Vérification…'
}

const KIND_HINT: Partial<Record<ContentKind, string>> = {
  resourcepack: 'Après l’installation, active le pack en jeu : Options → Packs de ressources.',
  shader: 'Les shaders ont besoin d’Iris (installé automatiquement). Active-les en jeu : Options → Vidéo → Packs de shaders.'
}

const OFFLINE = 'Modrinth ne répond pas. Vérifie ta connexion Internet, puis réessaie.'

interface SearchResult {
  /** Recherche qui a produit ce résultat (onglet, texte, tri, filtre). */
  key: string
  rows: Row[]
  total: number
  error: string | null
}

/** Le mod du serveur, toujours installé (il n'est pas sur Modrinth). */
const GUARD_ROW: Row = {
  projectId: GUARD_PROJECT_ID,
  kind: 'mod',
  title: 'HSMP Guard',
  author: 'HARDCORE SMP',
  summary: 'Le mod officiel du serveur : il prouve au serveur que tu joues avec le launcher et des mods autorisés.',
  downloads: null,
  iconUrl: null,
  access: 'required',
  slug: null
}

function fromCatalog(project: CatalogProject): Row {
  return { ...project, slug: project.slug }
}

function fromInstalled(item: InstalledContent): Row {
  return {
    projectId: item.projectId,
    kind: item.kind,
    title: item.title,
    author: item.author,
    summary: `${KIND_LABEL[item.kind]} · version ${item.versionNumber} · ${item.fileName}`,
    downloads: null,
    iconUrl: item.iconUrl,
    access: item.required ? 'required' : item.auto ? 'dependency' : 'allowed',
    slug: null
  }
}

function ProjectIcon({ row, size = 48 }: { row: Row; size?: number }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  if (row.iconUrl && !broken) {
    return (
      <img
        className={styles.icon}
        src={row.iconUrl}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  const initials = row.title
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
  const hue = [...row.projectId].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360
  return (
    <span
      className={styles.icon}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 70% 42%), hsl(${(hue + 40) % 360} 75% 22%))`
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

/** État des mods installés, tenu à jour par le process principal. */
function useModsState(): ModsState | null {
  const [state, setState] = useState<ModsState | null>(null)
  useEffect(() => {
    const unsubscribe = bridge.mods.onChange(setState)
    void bridge.mods.getState().then(setState)
    return unsubscribe
  }, [])
  return state
}

export function ModsScreen(): React.JSX.Element {
  const { config, game } = useAppState()
  const { openLink } = useActions()
  const { push } = useToasts()
  const mods = useModsState()
  const [tab, setTab] = useState<Tab>('recommended')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sort, setSort] = useState<CatalogSort>('relevance')
  const [onlyAllowed, setOnlyAllowed] = useState(false)
  // Chaque résultat garde la recherche qui l'a produit : un ancien résultat n'est jamais affiché par erreur.
  const [results, setResults] = useState<SearchResult | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [recommended, setRecommended] = useState<{ rows: Row[] } | { error: string } | null>(null)
  const [selected, setSelected] = useState<Row | null>(null)
  const [details, setDetails] = useState<ProjectDetails | null>(null)

  const locked = game.phase !== 'idle'
  const searchTab = tab !== 'recommended' && tab !== 'installed'
  const installed = useMemo(() => new Map((mods?.items ?? []).map((i) => [i.projectId, i])), [mods])
  const updatesCount = (mods?.items ?? []).filter((i) => i.update).length

  // Recherche : on attend que le joueur ait fini de taper.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  const searchQuery: CatalogQuery | null =
    tab === 'recommended' || tab === 'installed' ? null : { kind: tab, query: debouncedQuery, sort, offset: 0, onlyAllowed }
  const searchKey = searchQuery ? JSON.stringify(searchQuery) : null
  const current = results && results.key === searchKey ? results : null

  // Première page de la recherche (onglets Mods, Packs, Shaders).
  useEffect(() => {
    if (!searchQuery || !searchKey) return
    let cancelled = false
    bridge.mods.search(searchQuery).then(
      (page) => !cancelled && setResults({ key: searchKey, rows: page.hits.map(fromCatalog), total: page.total, error: null }),
      () => !cancelled && setResults({ key: searchKey, rows: [], total: 0, error: OFFLINE })
    )
    return () => {
      cancelled = true
    }
    // searchKey résume searchQuery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey])

  const loadMore = (): void => {
    if (!searchQuery || !searchKey || !current) return
    setLoadingMore(true)
    bridge.mods
      .search({ ...searchQuery, offset: current.rows.length })
      .then(
        (page) =>
          setResults((previous) =>
            previous && previous.key === searchKey ? { ...previous, rows: [...previous.rows, ...page.hits.map(fromCatalog)] } : previous
          ),
        () => push(OFFLINE, 'error')
      )
      .finally(() => setLoadingMore(false))
  }

  // Onglet Recommandés : chargé une fois (« Réessayer » remet à zéro).
  useEffect(() => {
    if (tab !== 'recommended' || recommended) return
    bridge.mods.recommended().then(
      (projects) => setRecommended({ rows: projects.map(fromCatalog) }),
      () => setRecommended({ error: OFFLINE })
    )
  }, [tab, recommended])

  // Fiche projet : description et galerie chargées à l'ouverture.
  useEffect(() => {
    if (!selected || selected.projectId === GUARD_PROJECT_ID) return
    let cancelled = false
    bridge.mods.details(selected.projectId).then(
      (d) => !cancelled && setDetails(d),
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [selected])
  const shownDetails = details && selected && details.projectId === selected.projectId ? details : null

  useEffect(() => {
    if (!selected) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const report = useCallback(
    (result: ModsActionResult) => {
      if (result.ok) {
        if (result.message) push(result.message, 'success')
      } else push(result.error, 'error')
    },
    [push]
  )

  const run = (action: () => Promise<ModsActionResult>): void => {
    void action().then(report, () => push('Le launcher n’a pas pu terminer l’opération.', 'error'))
  }

  const rows = useMemo((): Row[] => {
    const filter = (list: Row[]): Row[] => {
      const q = query.trim().toLowerCase()
      return q ? list.filter((r) => `${r.title} ${r.author} ${r.summary}`.toLowerCase().includes(q)) : list
    }
    if (tab === 'recommended') return filter([GUARD_ROW, ...(recommended && 'rows' in recommended ? recommended.rows : [])])
    if (tab === 'installed') return filter([GUARD_ROW, ...(mods?.items ?? []).map(fromInstalled)])
    return current?.rows ?? []
  }, [tab, recommended, mods, current, query])
  const loadError = tab === 'recommended' ? (recommended && 'error' in recommended ? recommended.error : null) : (current?.error ?? null)
  const loading = (searchTab: boolean): boolean => (searchTab ? current === null : tab === 'recommended' && recommended === null)

  const suggest = (row: Row): void => openLink(config.launcher.links.suggestions, `Proposer « ${row.title} »`)

  const renderActions = (row: Row, compact: boolean): React.JSX.Element => {
    const busy = mods?.busy[row.projectId]
    if (busy) return <span className={styles.locked}>{OPERATION_LABEL[busy]}</span>
    if (row.projectId === GUARD_PROJECT_ID) {
      return (
        <span className={styles.locked}>
          <Lock size={14} aria-hidden="true" /> Toujours installé
        </span>
      )
    }
    const item = installed.get(row.projectId)
    const update = item?.update ? (
      <Button size="sm" variant="fire" icon={<ArrowUpCircle />} disabled={locked} onClick={() => run(() => bridge.mods.update(row.projectId))}>
        {compact ? undefined : `Mettre à jour (${item.update.versionNumber})`}
      </Button>
    ) : null

    if (item?.required) {
      return (
        <div className={styles.installedActions}>
          {update}
          <span className={styles.locked}>
            <Lock size={14} aria-hidden="true" /> Obligatoire
          </span>
        </div>
      )
    }
    if (item?.auto) {
      return (
        <div className={styles.installedActions}>
          {update}
          <span className={styles.locked} title="Installé automatiquement : un autre projet en a besoin">
            Requis par {item.requiredBy.join(', ') || 'un projet désactivé'}
          </span>
        </div>
      )
    }
    if (item) {
      return (
        <div className={styles.installedActions}>
          {update}
          <Button size="sm" variant="outline" disabled={locked} onClick={() => run(() => bridge.mods.setEnabled(row.projectId, !item.enabled))}>
            {item.enabled ? 'Désactiver' : 'Activer'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 />}
            aria-label={`Désinstaller ${row.title}`}
            disabled={locked}
            onClick={() => run(() => bridge.mods.uninstall(row.projectId))}
          >
            {compact ? undefined : 'Désinstaller'}
          </Button>
        </div>
      )
    }
    if (row.access === 'forbidden' || row.access === 'dependency') {
      return (
        <Button size="sm" variant="ghost" icon={<Lightbulb />} onClick={() => suggest(row)}>
          Proposer ce mod
        </Button>
      )
    }
    return (
      <Button size="sm" variant="fire" disabled={locked} onClick={() => run(() => bridge.mods.install(row.projectId, row.kind))}>
        Installer
      </Button>
    )
  }

  const renderBadges = (row: Row): React.JSX.Element => {
    const item = installed.get(row.projectId)
    return (
      <span className={styles.badges}>
        {row.access === 'required' && <Badge tone="ember">Obligatoire</Badge>}
        {!item && (row.access === 'forbidden' || row.access === 'dependency') && <Badge tone="alert">Non autorisé sur le serveur</Badge>}
        {item?.auto && <Badge tone="neutral">Dépendance</Badge>}
        {item && !item.auto && !item.required && <Badge tone={item.active ? 'live' : 'neutral'}>{item.active ? 'Installé' : 'Désactivé'}</Badge>}
        {item?.update && <Badge tone="ember">Mise à jour</Badge>}
      </span>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'recommended', label: 'Recommandés' },
    { id: 'installed', label: `Installés${mods ? ` (${mods.items.length + 1})` : ''}` },
    { id: 'mod', label: 'Mods' },
    { id: 'resourcepack', label: 'Packs de ressources' },
    { id: 'shader', label: 'Shaders' }
  ]
  const checking = mods?.busy[ALL_CONTENT] !== undefined
  const lastQuarantine = game.quarantined

  return (
    <div className={styles.page}>
      <ScreenHeader
        title="Mods, packs et shaders"
        highlight="Mods"
        lede={
          <>
            Catalogue Modrinth filtré pour <strong>Minecraft {config.launcher.minecraftVersion} + Fabric</strong>. Seuls
            les projets autorisés par le serveur peuvent être installés.
          </>
        }
      />

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Catégories">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder={searchTab ? 'Rechercher sur Modrinth' : 'Filtrer'}
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher un projet"
          />
        </label>
        {searchTab && (
          <select className={styles.sort} value={sort} onChange={(e) => setSort(e.target.value as CatalogSort)} aria-label="Trier par">
            <option value="relevance">Pertinence</option>
            <option value="downloads">Téléchargements</option>
          </select>
        )}
      </div>

      <div className={styles.infoBar}>
        {searchTab ? (
          <label className={styles.check}>
            <input type="checkbox" checked={onlyAllowed} onChange={(e) => setOnlyAllowed(e.target.checked)} />
            Autorisés sur le serveur uniquement
          </label>
        ) : (
          <span className={styles.infoText}>
            {mods?.updatesCheckedAt
              ? updatesCount > 0
                ? `${updatesCount} mise${updatesCount > 1 ? 's' : ''} à jour disponible${updatesCount > 1 ? 's' : ''}.`
                : 'Tout est à jour.'
              : 'Mises à jour pas encore vérifiées.'}
          </span>
        )}
        <span className={styles.infoActions}>
          {(mods?.quarantineCount ?? 0) > 0 && (
            <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={() => void bridge.shell.openGameFolder('quarantine')}>
              Quarantaine ({mods?.quarantineCount})
            </Button>
          )}
          <Button size="sm" variant="outline" icon={<RefreshCw />} disabled={checking} onClick={() => run(() => bridge.mods.checkUpdates())}>
            {checking ? 'Vérification…' : 'Vérifier les mises à jour'}
          </Button>
          {updatesCount > 0 && (
            <Button size="sm" variant="fire" icon={<ArrowUpCircle />} disabled={locked || checking} onClick={() => run(() => bridge.mods.update(null))}>
              Tout mettre à jour ({updatesCount})
            </Button>
          )}
        </span>
      </div>

      {locked && <p className={styles.banner}>Le jeu est lancé (ou s’installe) : ferme-le pour modifier tes mods.</p>}
      {searchTab && KIND_HINT[tab] && <p className={styles.hint}>{KIND_HINT[tab]}</p>}
      {tab === 'installed' && lastQuarantine.length > 0 && (
        <div className={styles.quarantine}>
          <strong>Au dernier lancement, {lastQuarantine.length} fichier(s) ont été mis de côté :</strong>
          <ul>
            {lastQuarantine.map((q) => (
              <li key={q.file}>
                <code>{q.file}</code> — {q.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loadError ? (
        <div className={styles.empty}>
          <p>{loadError}</p>
          <Button
            size="sm"
            variant="outline"
            icon={<RefreshCw />}
            onClick={() => (tab === 'recommended' ? setRecommended(null) : setResults(null))}
          >
            Réessayer
          </Button>
        </div>
      ) : rows.length === 0 || (tab === 'recommended' && recommended === null) ? (
        <p className={styles.empty}>
          {loading(searchTab)
            ? 'Chargement du catalogue…'
            : query
              ? `Aucun résultat pour « ${query} ». Essaie un autre mot, ou propose le mod sur le Discord.`
              : 'Rien à afficher.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.projectId} className={styles.row}>
              <button type="button" className={styles.rowMain} onClick={() => setSelected(row)}>
                <ProjectIcon row={row} />
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    {row.title}
                    {row.author && <span className={styles.author}>par {row.author}</span>}
                  </span>
                  <span className={styles.summary}>{row.summary}</span>
                </span>
              </button>
              {renderBadges(row)}
              <span className={styles.downloads}>
                {row.downloads !== null ? `${formatCompact(row.downloads)} téléch.` : row.projectId === GUARD_PROJECT_ID ? 'Serveur' : ''}
              </span>
              <div className={styles.rowActions}>{renderActions(row, true)}</div>
            </li>
          ))}
        </ul>
      )}

      {current && current.rows.length < current.total && !loadError && (
        <div className={styles.more}>
          <Button variant="outline" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Chargement…' : `Voir plus (${formatInteger(current.total - current.rows.length)} autres)`}
          </Button>
        </div>
      )}

      {selected && (
        <div className={styles.drawerBackdrop} onClick={() => setSelected(null)}>
          <aside className={styles.drawer} aria-label={`Fiche de ${selected.title}`} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.drawerClose} onClick={() => setSelected(null)} aria-label="Fermer">
              <X size={16} />
            </button>
            <div className={styles.drawerHead}>
              <ProjectIcon row={selected} size={72} />
              <div>
                <h2 className={styles.drawerTitle}>{selected.title}</h2>
                {selected.author && <p className={styles.author}>par {selected.author}</p>}
              </div>
            </div>
            {renderBadges(selected)}
            {selected.downloads !== null && (
              <p className={styles.drawerStat}>
                <span className="fire-text tabular">{formatInteger(selected.downloads)}</span> téléchargements
              </p>
            )}
            <p className={styles.drawerSummary}>{selected.summary}</p>
            {shownDetails && shownDetails.gallery.length > 0 && (
              <div className={styles.gallery} aria-label="Galerie">
                {shownDetails.gallery.map((image) => (
                  <img key={image.url} className={styles.shot} src={image.url} alt={image.title ?? ''} loading="lazy" />
                ))}
              </div>
            )}
            {shownDetails && (
              <div className={styles.body}>
                <Markdown>{shownDetails.body}</Markdown>
              </div>
            )}
            <div className={styles.drawerActions}>
              {renderActions(selected, false)}
              {selected.projectId !== GUARD_PROJECT_ID && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ExternalLink />}
                  onClick={() =>
                    openLink(`https://modrinth.com/${MODRINTH_PATH[selected.kind]}/${selected.slug ?? selected.projectId}`, 'Modrinth')
                  }
                >
                  Voir sur Modrinth
                </Button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
