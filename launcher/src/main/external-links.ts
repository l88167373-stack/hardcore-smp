/**
 * Liens que le launcher accepte d'ouvrir dans le navigateur du joueur.
 * Tout le reste est refusé : une actu ou une page piégée ne peut pas ouvrir n'importe quoi.
 */

const ALLOWED_HOSTS = new Set([
  'discord.gg',
  'discord.com',
  'github.com',
  'modrinth.com',
  'minecraft.net',
  'www.minecraft.net',
  'help.minecraft.net',
  'xbox.com',
  'www.xbox.com',
  'account.microsoft.com',
  'aka.ms'
])

export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username !== '' || url.password !== '') return false
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase())
}
