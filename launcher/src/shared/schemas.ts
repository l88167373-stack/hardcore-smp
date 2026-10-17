/**
 * Schémas des fichiers publics de `config/` (launcher.json, news.json, rules.json, allowlist.json)
 * et des paramètres locaux du launcher.
 *
 * Une seule source de vérité : ces schémas servent au launcher (validation au chargement),
 * aux tests et, plus tard, à la GitHub Action qui vérifie les JSON à chaque push.
 */
import { z } from 'zod'

/** Valeur provisoire bien visible, ex. `TODO_DISCORD_INVITE`, en attendant la vraie info. */
export const todoValue = z.string().regex(/^TODO_[A-Z0-9_]+$/, 'valeur provisoire au format TODO_…')

/** Adresse web en https uniquement. */
export const httpsUrl = z.url({ protocol: /^https$/, error: 'adresse https:// attendue' })

const httpsUrlOrTodo = z.union([httpsUrl, todoValue])

/** Version au format X.Y.Z (avec suffixe facultatif, ex. 1.0.0-beta.1). */
export const semverString = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'version au format X.Y.Z attendue')

/** Version Minecraft : 26.2, 26.2.1… (numérotation par année depuis 2026). */
export const minecraftVersionString = z
  .string()
  .regex(/^\d+\.\d+(?:\.\d+)?$/, 'version Minecraft au format 26.2 attendue')

/** Identifiant de projet Modrinth (8 caractères alphanumériques). */
export const modrinthProjectId = z
  .string()
  .regex(/^[A-Za-z0-9]{8}$/, 'identifiant Modrinth de 8 caractères attendu')

const sha512Hex = z.string().regex(/^[a-f0-9]{128}$/, 'empreinte SHA-512 en hexadécimal attendue')

// ---------------------------------------------------------------------------
// launcher.json
// ---------------------------------------------------------------------------

export const launcherConfigSchema = z.strictObject({
  /** Version de Minecraft à installer (jamais codée en dur ailleurs). */
  minecraftVersion: minecraftVersionString,
  /** Version de Fabric Loader à installer. */
  fabricLoaderVersion: semverString,
  /** En dessous de cette version, la mise à jour du launcher est obligatoire avant de jouer. */
  minLauncherVersion: semverString,
  /** Version minimale du mod HSMP Guard acceptée par le serveur. */
  minGuardVersion: semverString,
  /** Version actuelle du règlement : doit correspondre à `rules.json`. */
  rulesVersion: z.int().positive(),
  server: z.strictObject({
    host: z.string().min(1),
    port: z.int().min(1).max(65535)
  }),
  /** Jar du mod HSMP Guard publié sur GitHub Releases. */
  guard: z.strictObject({
    version: semverString,
    url: httpsUrlOrTodo,
    sha512: z.union([sha512Hex, todoValue])
  }),
  /** Projets Modrinth obligatoires (ne peuvent pas être retirés), ex. Fabric API. */
  requiredMods: z.array(modrinthProjectId).min(1),
  discordInvite: httpsUrlOrTodo,
  links: z.strictObject({
    /** Page de téléchargement du launcher (bouton Rich Presence, écran « utilise le launcher »). */
    download: httpsUrlOrTodo,
    /** Salon Discord #suggestions-mods (bouton « Proposer ce mod »). */
    suggestions: httpsUrlOrTodo,
    website: httpsUrlOrTodo.optional()
  })
})
export type LauncherConfig = z.infer<typeof launcherConfigSchema>

// ---------------------------------------------------------------------------
// news.json
// ---------------------------------------------------------------------------

export const newsItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'identifiant en minuscules, chiffres et tirets'),
  title: z.string().min(1).max(90),
  date: z.iso.date(),
  tag: z.string().min(1).max(24),
  image: httpsUrl.optional(),
  /** Contenu en Markdown (le HTML brut n'est jamais exécuté). */
  body: z.string().min(1),
  link: httpsUrl.optional()
})
export type NewsItem = z.infer<typeof newsItemSchema>

export const newsSchema = z.array(newsItemSchema).superRefine((items, ctx) => {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({ code: 'custom', message: `identifiant en double : ${item.id}`, path: [index, 'id'] })
    }
    seen.add(item.id)
  })
})

// ---------------------------------------------------------------------------
// rules.json
// ---------------------------------------------------------------------------

export const rulesSchema = z.strictObject({
  version: z.int().positive(),
  updatedAt: z.iso.date(),
  /** Règlement complet en Markdown. */
  content: z.string().min(50)
})
export type Rules = z.infer<typeof rulesSchema>

// ---------------------------------------------------------------------------
// allowlist.json
// ---------------------------------------------------------------------------

export const allowlistEntrySchema = z.strictObject({
  projectId: modrinthProjectId,
  name: z.string().min(1),
  /** Proposé dans l'onglet « Recommandés » et pendant la première installation. */
  recommended: z.boolean().optional(),
  /** Obligatoire : installé d'office et impossible à retirer. */
  required: z.boolean().optional()
})
export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>

export const allowlistSchema = z
  .strictObject({
    mods: z.array(allowlistEntrySchema),
    resourcepacks: z.array(allowlistEntrySchema),
    shaders: z.array(allowlistEntrySchema)
  })
  .superRefine((list, ctx) => {
    const seen = new Set<string>()
    for (const kind of ['mods', 'resourcepacks', 'shaders'] as const) {
      list[kind].forEach((entry, index) => {
        if (seen.has(entry.projectId)) {
          ctx.addIssue({
            code: 'custom',
            message: `projet en double : ${entry.projectId} (${entry.name})`,
            path: [kind, index, 'projectId']
          })
        }
        seen.add(entry.projectId)
      })
    }
  })
export type Allowlist = z.infer<typeof allowlistSchema>

// ---------------------------------------------------------------------------
// Paramètres locaux du launcher (fichier settings.json dans le dossier de l'application)
// ---------------------------------------------------------------------------

export const settingsSchema = z.strictObject({
  /** Mémoire allouée au jeu, en Mo. */
  memoryMb: z.int().min(1024),
  resolution: z.strictObject({
    width: z.int().min(640).max(7680),
    height: z.int().min(480).max(4320),
    fullscreen: z.boolean()
  }),
  /** Fermer le launcher quand le jeu démarre (sinon il reste ouvert). */
  closeOnLaunch: z.boolean(),
  /** Arguments JVM supplémentaires (réglage avancé). */
  jvmArgs: z.string().max(2000),
  discordRichPresence: z.boolean(),
  onboardingCompleted: z.boolean(),
  /** Dernière version du règlement acceptée (0 = jamais acceptée). */
  acceptedRulesVersion: z.int().min(0)
})
export type Settings = z.infer<typeof settingsSchema>

/** Mise à jour partielle des paramètres envoyée par l'interface. */
export const settingsPatchSchema = settingsSchema.partial()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

/** Transforme une erreur zod en lignes lisibles en français. */
export function formatSchemaError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '(racine)'
    return `${where} : ${issue.message}`
  })
}
