/**
 * Ping du VRAI serveur HARDCORE SMP (simple demande de statut, comme la liste des serveurs du jeu).
 *
 *   HSMP_TEST_PING=1 npx vitest run --config vitest.integration.mts server-status
 */
import { describe, expect, it } from 'vitest'
import { getPublicConfig } from '../../src/main/public-config'
import { pingServer, resolveTarget } from '../../src/main/server-status'

describe.skipIf(process.env.HSMP_TEST_PING !== '1')('statut du vrai serveur', () => {
  it('suit le SRV de hardcore-smp.mine.fun et lit le statut', async () => {
    const { host, port } = getPublicConfig().launcher.server
    const target = await resolveTarget(host, port)
    console.log(`${host}:${port} → ${target.host}:${target.port}`)
    expect(target.host).not.toBe(host)
    const status = await pingServer(host, port)
    console.log({ ...status, favicon: status.favicon ? `${status.favicon.slice(0, 30)}…` : null, motd: status.motd.map((s) => `[${s.color}]${s.text}`).join('') })
    expect(status.online).toBe(true)
    expect(status.maxPlayers).toBeGreaterThan(0)
    expect(status.version).toMatch(/26\.2/)
    expect(status.motd.length).toBeGreaterThan(0)
  })
})
