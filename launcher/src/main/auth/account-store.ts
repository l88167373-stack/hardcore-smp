/**
 * Fichier des comptes (accounts.json dans le dossier de l'application).
 * Les jetons y sont uniquement sous forme chiffrée (champ `secret`).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const storedAccountSchema = z.object({
  uuid: z.string(),
  username: z.string(),
  skinUrl: z.string().nullable(),
  /** Jetons chiffrés par le système (base64), ou null si non mémorisés. */
  secret: z.string().nullable(),
  addedAt: z.string()
})
export type StoredAccount = z.infer<typeof storedAccountSchema>

const fileSchema = z.object({
  version: z.literal(1),
  activeUuid: z.string().nullable(),
  accounts: z.array(storedAccountSchema)
})
export type AccountsFile = z.infer<typeof fileSchema>

/** Ce qui est chiffré : de quoi renouveler la session sans redemander le mot de passe. */
export const secretSchema = z.object({
  microsoftRefreshToken: z.string(),
  minecraftAccessToken: z.string(),
  minecraftExpiresAt: z.number()
})
export type AccountSecret = z.infer<typeof secretSchema>

const EMPTY: AccountsFile = { version: 1, activeUuid: null, accounts: [] }

export interface AccountStore {
  load(): Promise<AccountsFile>
  save(file: AccountsFile): Promise<void>
}

export function fileAccountStore(file: string): AccountStore {
  let writing: Promise<void> = Promise.resolve()
  return {
    async load() {
      try {
        const parsed = fileSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')))
        return parsed.success ? parsed.data : EMPTY
      } catch {
        return EMPTY
      }
    },
    save(data) {
      writing = writing.then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        const tmp = `${file}.tmp`
        await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(tmp, file)
      })
      return writing
    }
  }
}

/** Stockage en mémoire (tests). */
export function memoryAccountStore(initial: AccountsFile = EMPTY): AccountStore & { data: AccountsFile } {
  const store = {
    data: structuredClone(initial),
    load: async () => structuredClone(store.data),
    save: async (data: AccountsFile) => {
      store.data = structuredClone(data)
    }
  }
  return store
}
