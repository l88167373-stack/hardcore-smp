const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDateFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' })
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const compactFormat = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })
const integerFormat = new Intl.NumberFormat('fr-FR')

/** « 2026-10-16 » → « 16 octobre 2026 ». */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T12:00:00`))
}

/** « 2026-10-16 » → « 16 oct. ». */
export function formatShortDate(isoDate: string): string {
  return shortDateFormat.format(new Date(`${isoDate}T12:00:00`))
}

export function formatTime(date: Date): string {
  return timeFormat.format(date)
}

/** 280 060 987 → « 280,1 M ». */
export function formatCompact(value: number): string {
  return compactFormat.format(value)
}

export function formatInteger(value: number): string {
  return integerFormat.format(value)
}

/** Premier paragraphe d'un texte Markdown, sans la mise en forme, pour un aperçu. */
export function markdownExcerpt(markdown: string, maxLength = 140): string {
  const firstParagraph =
    markdown
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .find((p) => p.length > 0 && !p.startsWith('#')) ?? ''
  const plain = firstParagraph
    .replace(/[*_`>#]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain
}

/** Vrai si une valeur de config est encore un TODO_… (info pas encore fournie). */
export function isTodo(value: string | undefined): boolean {
  return value === undefined || value.startsWith('TODO_')
}
