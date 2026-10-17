import path from 'node:path'

/** Résout un chemin d'URL dans `rootDir`, ou `null` s'il tente d'en sortir. */
export function resolveInside(rootDir: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, relative)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}
