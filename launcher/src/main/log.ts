/**
 * Journal du launcher (logs/launcher.log dans le dossier de l'application).
 * Les jetons ne doivent jamais y apparaître : toute longue suite de caractères qui ressemble à un jeton est masquée.
 */
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import path from 'node:path'

export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const MAX_LOG_BYTES = 2 * 1024 * 1024
const TOKEN_LIKE = /[A-Za-z0-9_\-.~+/=]{40,}/g

export function redact(message: string): string {
  return message.replace(TOKEN_LIKE, (match) => `[masqué:${match.length}]`)
}

export function fileLogger(file: string): Logger {
  mkdirSync(path.dirname(file), { recursive: true })
  const write = (level: string, message: string): void => {
    const line = `${new Date().toISOString()} [${level}] ${redact(message)}\n`
    try {
      // Rotation simple : on garde l'ancien journal en .old quand il devient trop gros.
      const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
      if (size > MAX_LOG_BYTES) renameSync(file, `${file}.old`)
      appendFileSync(file, line, 'utf8')
    } catch {
      // Le journal ne doit jamais faire planter le launcher.
    }
    if (level === 'ERREUR') console.error(line.trimEnd())
    else console.log(line.trimEnd())
  }
  return {
    info: (message) => write('INFO', message),
    warn: (message) => write('ATTENTION', message),
    error: (message) => write('ERREUR', message)
  }
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined }
