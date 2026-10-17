/**
 * Statut du serveur par « Server List Ping » (le même échange que la liste des serveurs du jeu) :
 * poignée de main → demande de statut → réponse JSON (MOTD, joueurs, version, icône) → ping/pong.
 * Implémentation propre en Node.js, sans dépendance. https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping
 *
 * Comme le jeu, on suit l'enregistrement DNS SRV (`_minecraft._tcp.<hôte>`) quand le port est 25565 :
 * hardcore-smp.mine.fun n'a pas d'adresse directe, seulement un SRV vers l'hébergeur.
 */
import dns from 'node:dns/promises'
import net from 'node:net'
import { parseDescription } from '../shared/motd'
import { DEFAULT_MINECRAFT_PORT } from '../shared/server-address'
import { SERVER_STATUS_REFRESH_MS, type ServerStatus } from '../shared/server-status'
import type { Logger } from './log'

/** Réponse JSON au-delà de laquelle on abandonne (l'icône fait ~10 Ko). */
const MAX_RESPONSE_BYTES = 512 * 1024

export interface PingOptions {
  timeoutMs?: number
  /** Résolution SRV (remplaçable dans les tests). */
  resolveSrv?: (hostname: string) => Promise<{ name: string; port: number; priority: number; weight: number }[]>
}

function varint(value: number): Buffer {
  const bytes: number[] = []
  let n = value >>> 0
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n !== 0) byte |= 0x80
    bytes.push(byte)
  } while (n !== 0)
  return Buffer.from(bytes)
}

function mcString(text: string): Buffer {
  const data = Buffer.from(text, 'utf8')
  return Buffer.concat([varint(data.length), data])
}

function packet(id: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat([varint(id), ...parts])
  return Buffer.concat([varint(body.length), body])
}

/** Lit un VarInt ; null s'il manque encore des octets. */
function readVarint(buffer: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buffer.length) return null
    const byte = buffer[offset + i] ?? 0
    value |= (byte & 0x7f) << (7 * i)
    if ((byte & 0x80) === 0) return { value: value >>> 0, size: i + 1 }
  }
  throw new Error('VarInt trop long')
}

/** Paquets complets reçus : [identifiant, contenu]. */
function takePackets(buffer: Buffer): { packets: { id: number; data: Buffer }[]; rest: Buffer } {
  const packets: { id: number; data: Buffer }[] = []
  let offset = 0
  for (;;) {
    const length = readVarint(buffer, offset)
    if (!length || offset + length.size + length.value > buffer.length) break
    const body = buffer.subarray(offset + length.size, offset + length.size + length.value)
    const id = readVarint(body, 0)
    if (!id) throw new Error('paquet invalide')
    packets.push({ id: id.value, data: body.subarray(id.size) })
    offset += length.size + length.value
  }
  return { packets, rest: buffer.subarray(offset) }
}

/** Hôte et port réellement contactés (après l'éventuel SRV). */
export async function resolveTarget(host: string, port: number, options: PingOptions = {}): Promise<{ host: string; port: number }> {
  if (port !== DEFAULT_MINECRAFT_PORT || net.isIP(host) !== 0) return { host, port }
  const resolveSrv = options.resolveSrv ?? ((name: string) => dns.resolveSrv(name))
  try {
    const records = await resolveSrv(`_minecraft._tcp.${host}`)
    const best = [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0]
    if (best) return { host: best.name, port: best.port }
  } catch {
    // Pas de SRV : on contacte l'hôte directement.
  }
  return { host, port }
}

interface StatusJson {
  description?: unknown
  players?: { online?: unknown; max?: unknown }
  version?: { name?: unknown }
  favicon?: unknown
}

/** Interroge le serveur. Rejette (erreur réseau, délai dépassé, réponse invalide) si le serveur ne répond pas correctement. */
export async function pingServer(host: string, port: number, options: PingOptions = {}): Promise<ServerStatus> {
  const timeoutMs = options.timeoutMs ?? 5000
  const target = await resolveTarget(host, port, options)
  return new Promise<ServerStatus>((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port })
    let buffer: Buffer = Buffer.alloc(0)
    let status: StatusJson | null = null
    let requestedAt = 0
    let pingSentAt = 0
    let settled = false

    const finish = (error: Error | null, pingMs?: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error || !status) {
        reject(error ?? new Error('aucune réponse'))
        return
      }
      const players = status.players ?? {}
      const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)
      const favicon = typeof status.favicon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(status.favicon) ? status.favicon : null
      resolve({
        online: true,
        players: number(players.online),
        maxPlayers: number(players.max),
        pingMs: pingMs ?? 0,
        version: typeof status.version?.name === 'string' ? status.version.name.slice(0, 64) : '',
        motd: parseDescription(status.description),
        favicon,
        checkedAt: new Date().toISOString()
      })
    }

    const timer = setTimeout(() => {
      // Réponse reçue mais pas de pong : on garde la réponse, avec le temps mesuré jusqu'à elle.
      if (status) finish(null, pingSentAt > 0 ? Date.now() - requestedAt : 0)
      else finish(new Error(`pas de réponse en ${timeoutMs} ms`))
    }, timeoutMs)

    socket.once('connect', () => {
      const portBytes = Buffer.alloc(2)
      portBytes.writeUInt16BE(target.port)
      // Protocole -1 : « je veux seulement le statut ».
      socket.write(packet(0x00, varint(-1), mcString(target.host), portBytes, varint(1)))
      socket.write(packet(0x00))
      requestedAt = Date.now()
    })

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > MAX_RESPONSE_BYTES) {
        finish(new Error('réponse trop grosse'))
        return
      }
      try {
        const { packets, rest } = takePackets(buffer)
        buffer = rest
        for (const received of packets) {
          if (received.id === 0x00 && !status) {
            const length = readVarint(received.data, 0)
            if (!length) throw new Error('réponse invalide')
            const json = received.data.subarray(length.size, length.size + length.value).toString('utf8')
            status = JSON.parse(json) as StatusJson
            const payload = Buffer.alloc(8)
            payload.writeBigInt64BE(BigInt(Date.now()))
            pingSentAt = Date.now()
            socket.write(packet(0x01, payload))
          } else if (received.id === 0x01 && status) {
            finish(null, Date.now() - pingSentAt)
          }
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })

    socket.once('error', (error) => finish(error))
    socket.once('close', () => {
      // Certains serveurs ferment sans répondre au ping : la réponse de statut suffit.
      if (status) finish(null, Date.now() - requestedAt)
      else finish(new Error('connexion fermée par le serveur'))
    })
  })
}

export interface ServerStatusServiceDeps {
  server: () => { host: string; port: number }
  log: Logger
  ping?: typeof pingServer
}

/** Interroge le serveur toutes les 30 secondes et prévient l'interface. */
export class ServerStatusService {
  private status: ServerStatus | null = null
  private readonly listeners = new Set<(status: ServerStatus) => void>()
  private timer: NodeJS.Timeout | null = null
  private running: Promise<ServerStatus> | null = null
  private lastError = ''

  constructor(private readonly deps: ServerStatusServiceDeps) {}

  current(): ServerStatus | null {
    return this.status
  }

  onChange(listener: (status: ServerStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Nouvelle vérification (une seule à la fois). */
  refresh(): Promise<ServerStatus> {
    if (this.running) return this.running
    const { host, port } = this.deps.server()
    const ping = this.deps.ping ?? pingServer
    this.running = ping(host, port)
      .then((status) => {
        this.lastError = ''
        return status
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        // Un seul message par cause, pour ne pas remplir le journal toutes les 30 secondes.
        if (message !== this.lastError) this.deps.log.warn(`Serveur ${host}:${port} injoignable : ${message}`)
        this.lastError = message
        return { online: false, players: 0, maxPlayers: 0, pingMs: 0, version: '', motd: [], favicon: null, checkedAt: new Date().toISOString() }
      })
      .then((status) => {
        this.status = status
        for (const listener of this.listeners) listener(status)
        return status
      })
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  start(intervalMs = SERVER_STATUS_REFRESH_MS): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
