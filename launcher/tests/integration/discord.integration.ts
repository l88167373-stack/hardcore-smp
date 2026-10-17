/**
 * Rich Presence contre le VRAI Discord ouvert sur ce PC, avec un identifiant d'application volontairement invalide :
 * Discord refuse la connexion, et le launcher doit simplement réessayer plus tard (aucune exception, aucun statut affiché).
 *
 *   HSMP_TEST_DISCORD=1 npx vitest run --config vitest.integration.mts discord
 */
import { describe, expect, it } from 'vitest'
import { RichPresenceService } from '../../src/main/rich-presence'

describe.skipIf(process.env.HSMP_TEST_DISCORD !== '1')('Rich Presence avec le vrai Discord', () => {
  it('application refusée par Discord : aucun plantage, nouvel essai prévu', async () => {
    const lines: string[] = []
    const log = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) }
    const presence = new RichPresenceService({
      applicationId: '100000000000000001',
      links: () => ({ discordInvite: 'TODO_DISCORD_INVITE', download: 'TODO_DOWNLOAD' }),
      log,
      retryMs: 60_000
    })
    presence.setEnabled(true)
    for (let i = 0; i < 60 && lines.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 250))
    console.log(lines.join('\n'))
    expect(lines.join('\n')).toMatch(/Rich Presence : (connexion à Discord impossible|connectée)/)
    await presence.stop()
  })
})
