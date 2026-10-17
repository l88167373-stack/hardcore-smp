/** Adresse à afficher / copier : le port est omis s'il s'agit du port par défaut 25565. */
export const DEFAULT_MINECRAFT_PORT = 25565

export function formatServerAddress(host: string, port: number): string {
  return port === DEFAULT_MINECRAFT_PORT ? host : `${host}:${port}`
}

/** Adresse pour la connexion directe (`--quickPlayMultiplayer`), toujours avec le port. */
export function quickPlayAddress(host: string, port: number): string {
  return `${host}:${port}`
}
