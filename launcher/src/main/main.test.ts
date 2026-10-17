import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from './external-links'
import { gameDirectory, gameSubfolder } from './game-paths'
import { resolveInside } from './protocol-path'
import { SettingsStore } from './settings-store'

describe('dossier du jeu (jamais .minecraft)', () => {
  it('Windows : %APPDATA%/.hardcore-smp', () => {
    expect(gameDirectory('win32', { APPDATA: 'C:\\Users\\Steve\\AppData\\Roaming' }, 'C:\\Users\\Steve')).toBe(
      'C:\\Users\\Steve\\AppData\\Roaming\\.hardcore-smp'
    )
  })

  it('macOS : ~/Library/Application Support/hardcore-smp', () => {
    expect(gameDirectory('darwin', {}, '/Users/steve')).toBe('/Users/steve/Library/Application Support/hardcore-smp')
  })

  it('Linux : ~/.hardcore-smp', () => {
    expect(gameDirectory('linux', {}, '/home/steve')).toBe('/home/steve/.hardcore-smp')
  })

  it('sous-dossiers connus uniquement', () => {
    expect(gameSubfolder('/jeu', 'logs')).toBe(path.join('/jeu', 'logs'))
    expect(gameSubfolder('/jeu', 'root')).toBe(path.join('/jeu'))
  })
})

describe('liens externes autorisés', () => {
  it('accepte Discord, GitHub, Modrinth en https', () => {
    expect(isAllowedExternalUrl('https://discord.gg/abc')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/x/y/releases')).toBe(true)
    expect(isAllowedExternalUrl('https://modrinth.com/mod/sodium')).toBe(true)
  })

  it('refuse http, les autres sites et les adresses piégées', () => {
    expect(isAllowedExternalUrl('http://discord.gg/abc')).toBe(false)
    expect(isAllowedExternalUrl('https://evil.example/discord.gg')).toBe(false)
    expect(isAllowedExternalUrl('https://discord.gg.evil.example/')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pass@discord.gg/')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isAllowedExternalUrl('pas une url')).toBe(false)
  })
})

describe('protocole app:// : pas de sortie du dossier de l’interface', () => {
  const root = path.resolve('/launcher/out/renderer')

  it('sert index.html par défaut', () => {
    expect(resolveInside(root, '/')).toBe(path.join(root, 'index.html'))
  })

  it('sert les fichiers du dossier', () => {
    expect(resolveInside(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'))
  })

  it('refuse de remonter dans les dossiers parents', () => {
    expect(resolveInside(root, '/../../secrets.txt')).toBeNull()
    expect(resolveInside(root, '/%2e%2e/%2e%2e/secrets.txt')).toBeNull()
  })
})

describe('paramètres', () => {
  const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'hsmp-settings-'))

  it('valeurs par défaut quand le fichier n’existe pas', async () => {
    const store = new SettingsStore(path.join(tmp(), 'settings.json'), 16 * 1024)
    const settings = await store.get()
    expect(settings.memoryMb).toBe(6 * 1024)
    expect(settings.onboardingCompleted).toBe(false)
  })

  it('enregistre une modification sur le disque', async () => {
    const file = path.join(tmp(), 'settings.json')
    const store = new SettingsStore(file, 16 * 1024)
    await store.update({ discordRichPresence: false, memoryMb: 4096 })
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { discordRichPresence: boolean; memoryMb: number }
    expect(saved.discordRichPresence).toBe(false)
    expect(saved.memoryMb).toBe(4096)
  })

  it('ramène une RAM trop grande dans les bornes', async () => {
    const store = new SettingsStore(path.join(tmp(), 'settings.json'), 8 * 1024)
    expect((await store.update({ memoryMb: 32 * 1024 })).memoryMb).toBe(6 * 1024)
  })

  it('refuse une valeur du mauvais type', async () => {
    const store = new SettingsStore(path.join(tmp(), 'settings.json'), 8 * 1024)
    await expect(store.update({ closeOnLaunch: 'oui' })).rejects.toThrow()
  })

  it('un fichier abîmé ne fait pas planter le launcher', async () => {
    const file = path.join(tmp(), 'settings.json')
    writeFileSync(file, '{ ceci n’est pas du JSON', 'utf8')
    const store = new SettingsStore(file, 8 * 1024)
    expect((await store.get()).memoryMb).toBe(4096)
  })
})
