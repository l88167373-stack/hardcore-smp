/**
 * Calcul de la mémoire (RAM) allouable au jeu.
 * Règle du projet : maximum = RAM totale du PC − 2 Go, valeur par défaut selon la RAM du PC.
 */

export const MEMORY_STEP_MB = 512
export const MIN_GAME_MEMORY_MB = 2048
/** RAM laissée au système et au launcher. */
export const SYSTEM_RESERVED_MB = 2048

export interface MemoryBounds {
  min: number
  max: number
  step: number
  recommended: number
}

const floorToStep = (value: number): number => Math.floor(value / MEMORY_STEP_MB) * MEMORY_STEP_MB

/** Bornes du curseur de RAM pour un PC qui a `totalMb` Mo de mémoire. */
export function memoryBounds(totalMb: number): MemoryBounds {
  const max = Math.max(MIN_GAME_MEMORY_MB, floorToStep(totalMb - SYSTEM_RESERVED_MB))
  return { min: MIN_GAME_MEMORY_MB, max, step: MEMORY_STEP_MB, recommended: recommendedMemory(totalMb) }
}

/**
 * Valeur conseillée : 26.x + Fabric + Sodium tourne bien avec 4 Go ;
 * on monte un peu sur les PC bien équipés (shaders, packs HD).
 */
export function recommendedMemory(totalMb: number): number {
  const max = Math.max(MIN_GAME_MEMORY_MB, floorToStep(totalMb - SYSTEM_RESERVED_MB))
  let wanted: number
  if (totalMb < 6 * 1024) wanted = max
  else if (totalMb < 12 * 1024) wanted = 4096
  else if (totalMb < 24 * 1024) wanted = 6144
  else wanted = 8192
  return Math.min(Math.max(wanted, MIN_GAME_MEMORY_MB), max)
}

/** Ramène une valeur saisie dans les bornes, arrondie au pas du curseur. */
export function clampMemory(valueMb: number, totalMb: number): number {
  const { min, max } = memoryBounds(totalMb)
  if (!Number.isFinite(valueMb)) return recommendedMemory(totalMb)
  return Math.min(Math.max(floorToStep(valueMb), min), max)
}

/** 4096 → « 4 Go », 4608 → « 4,5 Go ». */
export function formatMemory(mb: number): string {
  const gb = mb / 1024
  const text = Number.isInteger(gb) ? String(gb) : gb.toFixed(1).replace('.', ',')
  return `${text} Go`
}
