import { describe, expect, it } from 'vitest'
import { authError, authErrorFromXErr } from './auth-errors'
import { clampMemory, formatMemory, memoryBounds, recommendedMemory } from './memory'
import { parseDescription, parseMotd } from './motd'
import { compareVersions, isBelowMinimum } from './semver'
import { formatServerAddress, quickPlayAddress } from './server-address'

const GB = 1024

describe('mémoire', () => {
  it('maximum = RAM totale − 2 Go', () => {
    expect(memoryBounds(16 * GB).max).toBe(14 * GB)
    expect(memoryBounds(8 * GB).max).toBe(6 * GB)
  })

  it('arrondit le maximum au pas de 512 Mo (RAM réelle jamais ronde)', () => {
    expect(memoryBounds(16_234).max).toBe(13_824)
  })

  it('ne descend jamais sous 2 Go, même sur un petit PC', () => {
    expect(memoryBounds(3 * GB).max).toBe(2 * GB)
    expect(recommendedMemory(3 * GB)).toBe(2 * GB)
  })

  it('valeur par défaut selon la RAM du PC', () => {
    expect(recommendedMemory(4 * GB)).toBe(2 * GB)
    expect(recommendedMemory(8 * GB)).toBe(4 * GB)
    expect(recommendedMemory(16 * GB)).toBe(6 * GB)
    expect(recommendedMemory(32 * GB)).toBe(8 * GB)
  })

  it('ramène une valeur hors limites dans les bornes', () => {
    expect(clampMemory(64 * GB, 16 * GB)).toBe(14 * GB)
    expect(clampMemory(512, 16 * GB)).toBe(2 * GB)
    expect(clampMemory(Number.NaN, 16 * GB)).toBe(6 * GB)
  })

  it('affiche les Go à la française', () => {
    expect(formatMemory(4096)).toBe('4 Go')
    expect(formatMemory(4608)).toBe('4,5 Go')
  })
})

describe('versions', () => {
  it('compare les versions X.Y.Z', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0)
  })

  it('une pré-version est antérieure à la version finale', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
  })

  it('détecte une mise à jour obligatoire', () => {
    expect(isBelowMinimum('0.1.0', '0.2.0')).toBe(true)
    expect(isBelowMinimum('0.2.0', '0.2.0')).toBe(false)
  })

  it('refuse une version mal écrite', () => {
    expect(() => compareVersions('abc', '1.0.0')).toThrow()
  })
})

describe('erreurs de connexion', () => {
  it('traduit les codes XErr connus', () => {
    expect(authErrorFromXErr(2148916233).code).toBe('no-xbox-account')
    expect(authErrorFromXErr('2148916238').code).toBe('child-account')
  })

  it('code inconnu → message générique', () => {
    expect(authErrorFromXErr(42).code).toBe('unknown')
  })

  it('chaque message est en français et non vide', () => {
    expect(authError('game-not-owned').message).toContain('Minecraft')
    expect(authError('app-not-approved').message).toContain('Mojang')
  })
})

describe('MOTD', () => {
  it('découpe les couleurs et le gras', () => {
    const segments = parseMotd('§c§lHARDCORE §7— §6Saison 2')
    expect(segments.map((s) => s.text)).toEqual(['HARDCORE ', '— ', 'Saison 2'])
    expect(segments[0]).toMatchObject({ color: '#FF5555', bold: true })
    expect(segments[1]).toMatchObject({ color: '#AAAAAA', bold: false })
  })

  it('texte sans code → un seul segment gris', () => {
    expect(parseMotd('Salut')).toEqual([
      { text: 'Salut', color: '#AAAAAA', bold: false, italic: false, underline: false, strikethrough: false }
    ])
  })

  it('format JSON : couleurs nommées et hexadécimales, styles hérités des parents, codes « § » à l’intérieur', () => {
    const segments = parseDescription({
      text: 'A',
      color: 'gold',
      bold: true,
      extra: [{ text: 'B', color: '#12ab34' }, { text: 'C', bold: false, underlined: true }, '§cD', [{ text: 'E', italic: true }]]
    })
    expect(segments.map((s) => [s.text, s.color, s.bold, s.underline, s.italic])).toEqual([
      ['A', '#FFAA00', true, false, false],
      ['B', '#12AB34', true, false, false],
      ['C', '#FFAA00', false, true, false],
      ['D', '#FF5555', false, false, false],
      ['E', '#FFAA00', true, false, true]
    ])
  })

  it('format JSON : ce qui est inconnu ou démesuré est ignoré sans planter', () => {
    expect(parseDescription(null)).toEqual([])
    expect(parseDescription({ text: 'X', color: 'licorne' })[0]?.color).toBe('#AAAAAA')
    expect(parseDescription({ text: 'x'.repeat(5000) }).reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(1000)
    let deep: unknown = { text: 'fond' }
    for (let i = 0; i < 100; i++) deep = { extra: [deep] }
    expect(parseDescription(deep)).toEqual([])
  })
})

describe('adresse du serveur', () => {
  it('cache le port par défaut', () => {
    expect(formatServerAddress('hardcore-smp.mine.fun', 25565)).toBe('hardcore-smp.mine.fun')
    expect(formatServerAddress('hardcore-smp.mine.fun', 25566)).toBe('hardcore-smp.mine.fun:25566')
  })

  it('la connexion directe donne toujours le port', () => {
    expect(quickPlayAddress('hardcore-smp.mine.fun', 25565)).toBe('hardcore-smp.mine.fun:25565')
  })
})
