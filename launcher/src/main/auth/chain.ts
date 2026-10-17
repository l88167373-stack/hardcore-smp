/**
 * Chaîne complète : jetons Microsoft → session Minecraft prête à jouer.
 */
import { AuthError } from './errors'
import type { Http } from './http'
import { authenticateXbox, authorizeXsts, fetchProfile, loginMinecraft, ownsMinecraft, type MinecraftProfile } from './minecraft'
import type { MicrosoftTokens } from './oauth'

export interface MinecraftSession {
  microsoftRefreshToken: string
  minecraftAccessToken: string
  /** Expiration du jeton Minecraft (24 h en général), en ms depuis 1970. */
  minecraftExpiresAt: number
  profile: MinecraftProfile
}

export async function sessionFromMicrosoft(http: Http, microsoft: MicrosoftTokens, now = Date.now()): Promise<MinecraftSession> {
  const xbox = await authenticateXbox(http, microsoft.accessToken)
  const xsts = await authorizeXsts(http, xbox)
  const minecraft = await loginMinecraft(http, xsts, now)

  const profile = await fetchProfile(http, minecraft.accessToken)
  if (!profile) {
    // Pas de profil : soit le jeu n'est pas acheté, soit le joueur n'a jamais choisi de pseudo.
    const owned = await ownsMinecraft(http, minecraft.accessToken)
    throw new AuthError(owned ? 'no-profile' : 'game-not-owned')
  }
  // Un profil existe : le compte possède Minecraft : Java Edition (achat direct ou Game Pass PC).

  return {
    microsoftRefreshToken: microsoft.refreshToken,
    minecraftAccessToken: minecraft.accessToken,
    minecraftExpiresAt: minecraft.expiresAt,
    profile
  }
}
