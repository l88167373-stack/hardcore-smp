/**
 * Comparaison de versions X.Y.Z (suffixe -beta.1 etc. considéré comme antérieur à la version finale).
 * Suffisant pour le launcher et le Guard, sans dépendance externe.
 */

interface ParsedVersion {
  core: [number, number, number]
  pre: string | null
}

function parse(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? null
  }
}

/** Renvoie un nombre négatif si a < b, 0 si égales, positif si a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) throw new Error(`Version invalide : « ${!pa ? a : b} »`)
  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  return pa.pre.localeCompare(pb.pre, 'en', { numeric: true })
}

/** Vrai si `current` est plus ancienne que la version minimale exigée. */
export function isBelowMinimum(current: string, minimum: string): boolean {
  return compareVersions(current, minimum) < 0
}
