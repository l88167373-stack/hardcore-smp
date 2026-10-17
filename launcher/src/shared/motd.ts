/**
 * MOTD Minecraft → segments affichables (texte + couleur + styles).
 * Deux formats existent : l'ancien avec les codes « § », et le JSON (« composants de texte ») envoyé par
 * les serveurs récents, avec couleurs nommées ou hexadécimales et styles hérités des parents.
 */

export interface MotdSegment {
  text: string
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
}

/** Couleurs officielles de Minecraft. */
export const MINECRAFT_COLORS: Record<string, string> = {
  '0': '#000000',
  '1': '#0000AA',
  '2': '#00AA00',
  '3': '#00AAAA',
  '4': '#AA0000',
  '5': '#AA00AA',
  '6': '#FFAA00',
  '7': '#AAAAAA',
  '8': '#555555',
  '9': '#5555FF',
  a: '#55FF55',
  b: '#55FFFF',
  c: '#FF5555',
  d: '#FF55FF',
  e: '#FFFF55',
  f: '#FFFFFF'
}

const DEFAULT_COLOR = '#AAAAAA'

type MotdStyle = Omit<MotdSegment, 'text'>

const DEFAULT_STYLE: MotdStyle = { color: DEFAULT_COLOR, bold: false, italic: false, underline: false, strikethrough: false }

/** Noms de couleurs du format JSON → codes « § ». */
const NAMED_COLORS: Record<string, string> = {
  black: '0',
  dark_blue: '1',
  dark_green: '2',
  dark_aqua: '3',
  dark_red: '4',
  dark_purple: '5',
  gold: '6',
  gray: '7',
  dark_gray: '8',
  blue: '9',
  green: 'a',
  aqua: 'b',
  red: 'c',
  light_purple: 'd',
  yellow: 'e',
  white: 'f'
}

/** Au-delà, le reste du MOTD est ignoré (un serveur pourrait envoyer n'importe quoi). */
const MAX_MOTD_LENGTH = 1000

export function parseMotd(raw: string, base: MotdStyle = DEFAULT_STYLE): MotdSegment[] {
  const segments: MotdSegment[] = []
  let style: MotdStyle = { ...base }
  let buffer = ''

  const flush = (): void => {
    if (buffer.length > 0) segments.push({ text: buffer, ...style })
    buffer = ''
  }

  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i)
    if (char === '§' && i + 1 < raw.length) {
      const code = raw.charAt(i + 1).toLowerCase()
      i++
      flush()
      const color = MINECRAFT_COLORS[code]
      if (color) {
        // Une couleur réinitialise aussi les styles (comportement de Minecraft).
        style = { color, bold: false, italic: false, underline: false, strikethrough: false }
      } else if (code === 'l') style = { ...style, bold: true }
      else if (code === 'o') style = { ...style, italic: true }
      else if (code === 'n') style = { ...style, underline: true }
      else if (code === 'm') style = { ...style, strikethrough: true }
      else if (code === 'r') {
        style = { color: DEFAULT_COLOR, bold: false, italic: false, underline: false, strikethrough: false }
      }
      // §k (texte brouillé) est ignoré volontairement.
      continue
    }
    buffer += char
  }
  flush()
  return segments
}

interface TextComponent {
  text?: unknown
  extra?: unknown
  color?: unknown
  bold?: unknown
  italic?: unknown
  underlined?: unknown
  strikethrough?: unknown
}

function colorOf(value: unknown, inherited: string): string {
  if (typeof value !== 'string') return inherited
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase()
  const code = NAMED_COLORS[value]
  return code ? (MINECRAFT_COLORS[code] ?? inherited) : inherited
}

/** MOTD reçu du serveur (« description ») : texte avec codes « § » ou composant JSON. */
export function parseDescription(description: unknown): MotdSegment[] {
  const segments: MotdSegment[] = []
  let length = 0
  const walk = (node: unknown, style: MotdStyle, depth: number): void => {
    if (length >= MAX_MOTD_LENGTH || depth > 16 || node === null || node === undefined) return
    if (typeof node === 'string') {
      for (const segment of parseMotd(node.slice(0, MAX_MOTD_LENGTH - length), style)) {
        segments.push(segment)
        length += segment.text.length
      }
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, style, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const component = node as TextComponent
    const own: MotdStyle = {
      color: colorOf(component.color, style.color),
      bold: typeof component.bold === 'boolean' ? component.bold : style.bold,
      italic: typeof component.italic === 'boolean' ? component.italic : style.italic,
      underline: typeof component.underlined === 'boolean' ? component.underlined : style.underline,
      strikethrough: typeof component.strikethrough === 'boolean' ? component.strikethrough : style.strikethrough
    }
    if (typeof component.text === 'string') walk(component.text, own, depth + 1)
    if (Array.isArray(component.extra)) for (const child of component.extra) walk(child, own, depth + 1)
  }
  walk(description, DEFAULT_STYLE, 0)
  return segments
}
