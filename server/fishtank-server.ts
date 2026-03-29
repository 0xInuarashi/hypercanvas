// ---------------------------------------------------------------------------
// Hypercanvas — Fishtank Server (Bun runtime)
//
// A physically separate process with NO PTY, exec, or filesystem access.
// Receives terminal output from the PTY server via an internal WebSocket relay
// and fans it out to read-only viewer connections. All viewer input is ignored.
// ---------------------------------------------------------------------------

import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { ServerWebSocket } from 'bun'

// ---------------------------------------------------------------------------
// Configuration — all from environment, set by the PTY server at spawn time
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.FISHTANK_PORT || '7889', 10)
const HOST = process.env.FISHTANK_HOST || '0.0.0.0'
const RELAY_SECRET = process.env.FISHTANK_RELAY_SECRET || ''

if (!RELAY_SECRET) {
  console.error('[fishtank] FISHTANK_RELAY_SECRET not set — refusing to start')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

function timingSafeCompare(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const bufA = enc.encode(a)
  const bufB = enc.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  return timingSafeEqual(bufA, bufB)
}

// ---------------------------------------------------------------------------
// Session registry — populated by relay messages from PTY server
// ---------------------------------------------------------------------------

const MAX_SCROLLBACK = 512 * 1024

interface FishtankSession {
  id: string
  password: string
  scrollback: string[]
  scrollbackBytes: number
  viewers: Set<ServerWebSocket<WsData>>
}

interface WsData {
  mode: 'relay' | 'viewer'
  sessionId: string | null
}

const sessions = new Map<string, FishtankSession>()

// ---------------------------------------------------------------------------
// Rate limiting for password checks (same as PTY server)
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_WINDOW = 60_000
const RATE_LIMIT_MAX = 10

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  let attempts = rateLimitMap.get(ip)
  if (!attempts) { attempts = []; rateLimitMap.set(ip, attempts) }
  while (attempts.length && attempts[0] < now - RATE_LIMIT_WINDOW) attempts.shift()
  if (attempts.length >= RATE_LIMIT_MAX) return true
  attempts.push(now)
  return false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

function cors204(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

// ---------------------------------------------------------------------------
// Broadcast output to all viewers of a session
// ---------------------------------------------------------------------------

function broadcastViewers(session: FishtankSession, payload: string) {
  for (const v of session.viewers) {
    if (v.readyState === 1) v.send(payload)
  }
}

// ---------------------------------------------------------------------------
// Handle relay messages from PTY server
// ---------------------------------------------------------------------------

function handleRelayMessage(msg: Record<string, unknown>) {
  const sessionId = msg.sessionId as string

  if (msg.type === 'session:add') {
    const existing = sessions.get(sessionId)
    if (existing) {
      // Update password if session already exists
      existing.password = msg.password as string
      return
    }
    const session: FishtankSession = {
      id: sessionId,
      password: msg.password as string,
      scrollback: [],
      scrollbackBytes: 0,
      viewers: new Set(),
    }
    // Replay scrollback from PTY server
    const scrollback = msg.scrollback as string[] | undefined
    if (scrollback) {
      for (const chunk of scrollback) {
        session.scrollback.push(chunk)
        session.scrollbackBytes += chunk.length
      }
    }
    sessions.set(sessionId, session)
    return
  }

  if (msg.type === 'session:remove') {
    const session = sessions.get(sessionId)
    if (!session) return
    for (const v of session.viewers) {
      if (v.readyState === 1) v.close(1000, 'Session ended')
    }
    sessions.delete(sessionId)
    return
  }

  if (msg.type === 'output') {
    const session = sessions.get(sessionId)
    if (!session) return
    const data = msg.data as string
    session.scrollback.push(data)
    session.scrollbackBytes += data.length
    while (session.scrollbackBytes > MAX_SCROLLBACK && session.scrollback.length > 1) {
      const removed = session.scrollback.shift()!
      session.scrollbackBytes -= removed.length
    }
    broadcastViewers(session, JSON.stringify({ type: 'output', data }))
    return
  }

  if (msg.type === 'status') {
    const session = sessions.get(sessionId)
    if (!session) return
    broadcastViewers(session, JSON.stringify({
      type: 'daemon:status',
      status: msg.status,
      exitCode: msg.exitCode ?? null,
    }))
    return
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve<WsData>({
  port: PORT,
  hostname: HOST,

  fetch(req, server) {
    const url = new URL(req.url)

    // CORS preflight
    if (req.method === 'OPTIONS') return cors204()

    // Password check endpoint (rate-limited)
    if (req.method === 'POST' && url.pathname === '/fishtank/check') {
      const ip = server.requestIP(req)?.address || 'unknown'
      if (isRateLimited(ip)) return json({ error: 'Too many attempts, try again later' }, 429)
      return req.json().then(body => {
        const sessionId = (body as Record<string, string>).sessionId || ''
        const password = (body as Record<string, string>).password || ''
        const session = sessions.get(sessionId)
        if (session && timingSafeCompare(session.password, password)) {
          return json({ ok: true })
        }
        return json({ error: 'Unauthorized' }, 401)
      }).catch(() => json({ error: 'Bad request' }, 400))
    }

    // WebSocket upgrade
    if (url.pathname === '/ws' && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      // Internal relay from PTY server
      const relaySecret = url.searchParams.get('relay')
      if (relaySecret) {
        if (!timingSafeCompare(RELAY_SECRET, relaySecret)) {
          return json({ error: 'Unauthorized' }, 401)
        }
        if (server.upgrade(req, { data: { mode: 'relay' as const, sessionId: null } })) return
        return json({ error: 'Upgrade failed' }, 500)
      }

      // Viewer connection
      const sessionId = url.searchParams.get('session')
      const password = url.searchParams.get('password')
      if (sessionId && password) {
        const session = sessions.get(sessionId)
        if (session && timingSafeCompare(session.password, password)) {
          if (server.upgrade(req, { data: { mode: 'viewer' as const, sessionId } })) return
        }
        return json({ error: 'Unauthorized' }, 401)
      }

      return json({ error: 'Missing credentials' }, 400)
    }

    return json({ error: 'Not found' }, 404)
  },

  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      if (ws.data.mode === 'viewer') {
        const session = sessions.get(ws.data.sessionId!)
        if (!session) { ws.close(1008, 'Session not found'); return }
        session.viewers.add(ws)
        // Replay scrollback
        for (const chunk of session.scrollback) {
          ws.send(JSON.stringify({ type: 'output', data: chunk }))
        }
        ws.send(JSON.stringify({ type: 'fishtank:connected', sessionId: session.id }))
      }
      if (ws.data.mode === 'relay') {
        // Nothing to do on relay open
      }
    },

    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      // Viewers: ignore ALL messages. This is the entire security model.
      if (ws.data.mode === 'viewer') return

      // Relay: parse and handle PTY server messages
      if (ws.data.mode === 'relay') {
        try {
          const parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))
          handleRelayMessage(parsed)
        } catch { /* malformed relay message */ }
      }
    },

    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.mode === 'viewer' && ws.data.sessionId) {
        const session = sessions.get(ws.data.sessionId)
        if (session) session.viewers.delete(ws)
      }
    },
  },
})

console.log(`[fishtank] Listening on http://${HOST}:${PORT}`)

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown() {
  console.log('[fishtank] Shutting down…')
  for (const [, session] of sessions) {
    for (const v of session.viewers) {
      if (v.readyState === 1) v.close(1000, 'Server shutting down')
    }
  }
  sessions.clear()
  server.stop()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
