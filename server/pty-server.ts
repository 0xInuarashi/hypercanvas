// ---------------------------------------------------------------------------
// Hypercanvas — PTY Server (Bun runtime)
//
// Uses Bun built-ins: Bun.serve (HTTP + WebSocket), Bun.spawn (PTY terminal)
// No native addons required — compiles to a standalone binary.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs'
import { join, extname, dirname, resolve, basename } from 'node:path'
import type { ServerWebSocket, Subprocess } from 'bun'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// In dev mode, import.meta.dir = directory of this source file (server/).
// In compiled binaries, import.meta.dir = /$bunfs/root (virtual FS), so
// we fall back to dirname(process.execPath) for the real binary location.
const SCRIPT_DIR = import.meta.dir
const EXEC_DIR = dirname(process.execPath)
const BASE_DIR = existsSync(join(SCRIPT_DIR, 'package.json'))
  ? SCRIPT_DIR                                        // dev: running from server/ subdir
  : existsSync(join(EXEC_DIR, 'dist', 'index.html'))
    ? EXEC_DIR                                        // compiled binary next to dist/
    : resolve(SCRIPT_DIR, '..')
// Detect install root for versioned deployments:
//   /opt/hypercanvas/versions/v0.0.5/  →  INSTALL_ROOT = /opt/hypercanvas/
//   /opt/hypercanvas/                  →  INSTALL_ROOT = /opt/hypercanvas/
const INSTALL_ROOT = basename(dirname(BASE_DIR)) === 'versions'
  ? resolve(BASE_DIR, '..', '..')
  : BASE_DIR

// Load .env — check BASE_DIR first, then INSTALL_ROOT (shared across versions)
const ENV_CANDIDATES = INSTALL_ROOT !== BASE_DIR
  ? [join(BASE_DIR, '.env'), join(INSTALL_ROOT, '.env')]
  : [join(BASE_DIR, '.env')]
for (const envFile of ENV_CANDIDATES) {
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
    }
    break
  }
}

// Version
const VERSION_FILE = join(BASE_DIR, 'VERSION')
const CURRENT_VERSION = existsSync(VERSION_FILE)
  ? readFileSync(VERSION_FILE, 'utf-8').trim()
  : 'dev'

const PORT = parseInt(process.env.PORT || '7888', 10)
const HOST = process.env.HOST || '0.0.0.0'
const AUTH_TOKEN = process.env.AUTH_TOKEN || null
const CLOUD_DIR = join(process.env.HOME || '/', '.hypercanvas')
const CLOUD_CONFIG_FILE = join(CLOUD_DIR, `cloud-config-${PORT}.json`)
const CLOUD_STATE_FILE = join(CLOUD_DIR, `cloud-state-${PORT}.json`)
const DIST_DIR = join(BASE_DIR, 'dist')
const SERVE_STATIC = existsSync(join(DIST_DIR, 'index.html'))

function childEnv(): Record<string, string> {
  const { PORT: _p, HOST: _h, NODE_ENV: _n, AUTH_TOKEN: _a, ...rest } = process.env
  return { ...rest, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function timingSafeCompare(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function isValidToken(provided: string): boolean {
  if (!AUTH_TOKEN) return true
  return timingSafeCompare(AUTH_TOKEN, provided)
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
  })
}

function cors204(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ---------------------------------------------------------------------------
// MIME types for static serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

const MAX_SCROLLBACK = 512 * 1024

// ---------------------------------------------------------------------------
// WebSocket per-connection state
// ---------------------------------------------------------------------------

interface WsData {
  mode: 'pending' | 'ephemeral' | 'daemon' | 'satellite' | 'lsp'
  ephemeralProc: Subprocess | null
  daemonSessionId: string | null
  satSessionId: string | null
  lspLanguage: string | null
}

// ---------------------------------------------------------------------------
// Daemon session registry
// ---------------------------------------------------------------------------

interface DaemonSession {
  id: string
  command: string
  proc: Subprocess | null
  generation: number
  status: 'running' | 'stopped' | 'error'
  exitCode: number | null
  scrollback: string[]
  scrollbackBytes: number
  clients: Set<ServerWebSocket<WsData>>
  satellitePassword: string | null
}

const daemonSessions = new Map<string, DaemonSession>()
const decoder = new TextDecoder()

// ---------------------------------------------------------------------------
// LSP session registry
// ---------------------------------------------------------------------------

interface LspSession {
  language: string
  proc: Subprocess
  clients: Set<ServerWebSocket<WsData>>
  pendingRequests: Map<number, ServerWebSocket<WsData>>
  nextId: number
  initialized: boolean
  rootUri: string | null
}

const lspSessions = new Map<string, LspSession>()

const LSP_COMMANDS: Record<string, string[]> = {
  typescript: ['bunx', 'typescript-language-server', '--stdio'],
  javascript: ['bunx', 'typescript-language-server', '--stdio'],
  python: ['pylsp'],
  go: ['gopls', 'serve'],
  rust: ['rust-analyzer'],
  json: ['bunx', 'vscode-json-language-server', '--stdio'],
  yaml: ['bunx', 'yaml-language-server', '--stdio'],
  svelte: ['bunx', 'svelteserver', '--stdio'],
}

const ROOT_PATTERNS: Record<string, string[]> = {
  typescript: ['tsconfig.json', 'package.json'],
  javascript: ['package.json'],
  python: ['pyproject.toml', 'setup.py', 'requirements.txt'],
  go: ['go.mod'],
  rust: ['Cargo.toml'],
  svelte: ['svelte.config.js', 'package.json'],
}

function findProjectRoot(filePath: string, language: string): string {
  const patterns = ROOT_PATTERNS[language] || ['package.json']
  let dir = dirname(filePath)
  const home = process.env.HOME || '/'
  while (dir.length >= home.length) {
    for (const pattern of patterns) {
      if (existsSync(join(dir, pattern))) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirname(filePath)
}

async function getOrCreateLspSession(language: string, filePath: string): Promise<LspSession | null> {
  const lspKey = language === 'tsx' || language === 'jsx' ? 'typescript' : language
  let session = lspSessions.get(lspKey)
  if (session) return session

  const cmd = LSP_COMMANDS[lspKey]
  if (!cmd) return null

  try {
    const proc = Bun.spawn(cmd, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: childEnv(),
    })

    const rootUri = `file://${findProjectRoot(filePath, lspKey)}`

    session = {
      language: lspKey,
      proc,
      clients: new Set(),
      pendingRequests: new Map(),
      nextId: 1,
      initialized: false,
      rootUri,
    }
    lspSessions.set(lspKey, session)

    // Read stdout for JSON-RPC responses
    readLspOutput(session)

    // Initialize the language server
    const initId = session.nextId++
    sendLspMessage(session, {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: true },
          },
        },
      },
    })

    // Wait for initialize response (with timeout)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('LSP init timeout')), 15000)
      const check = setInterval(() => {
        if (session!.initialized) {
          clearInterval(check)
          clearTimeout(timeout)
          resolve()
        }
      }, 50)
    })

    // Send initialized notification
    sendLspMessage(session, { jsonrpc: '2.0', method: 'initialized', params: {} })

    return session
  } catch (err) {
    console.warn(`[LSP] Failed to start ${lspKey}:`, err)
    lspSessions.delete(lspKey)
    return null
  }
}

function sendLspMessage(session: LspSession, msg: Record<string, unknown>) {
  const content = JSON.stringify(msg)
  const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`
  try {
    session.proc.stdin!.write(header + content)
  } catch (err) {
    console.warn(`[LSP] Write error for ${session.language}:`, err)
  }
}

function readLspOutput(session: LspSession) {
  const stdout = session.proc.stdout as ReadableStream<Uint8Array>
  const reader = stdout.getReader()
  let buffer = ''

  async function pump() {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += new TextDecoder().decode(value)

        // Parse JSON-RPC messages from buffer
        while (true) {
          const headerEnd = buffer.indexOf('\r\n\r\n')
          if (headerEnd === -1) break

          const header = buffer.slice(0, headerEnd)
          const match = header.match(/Content-Length:\s*(\d+)/i)
          if (!match) { buffer = buffer.slice(headerEnd + 4); continue }

          const contentLength = parseInt(match[1], 10)
          const contentStart = headerEnd + 4
          if (buffer.length < contentStart + contentLength) break

          const content = buffer.slice(contentStart, contentStart + contentLength)
          buffer = buffer.slice(contentStart + contentLength)

          try {
            const msg = JSON.parse(content) as Record<string, unknown>
            handleLspServerMessage(session, msg)
          } catch { /* ignore malformed */ }
        }
      }
    } catch { /* stream closed */ }
  }
  pump()

  // Read stderr for debugging
  if (session.proc.stderr) {
    const stderrReader = (session.proc.stderr as ReadableStream<Uint8Array>).getReader()
    async function drainStderr() {
      try {
        while (true) {
          const { done } = await stderrReader.read()
          if (done) break
        }
      } catch { /* ignore */ }
    }
    drainStderr()
  }
}

function handleLspServerMessage(session: LspSession, msg: Record<string, unknown>) {
  // Response to a request
  if ('id' in msg && ('result' in msg || 'error' in msg)) {
    const id = msg.id as number

    // Check if this is the initialize response
    if (!session.initialized && msg.result) {
      session.initialized = true
      return
    }

    // Route response to requesting client
    const client = session.pendingRequests.get(id)
    if (client) {
      session.pendingRequests.delete(id)
      try {
        client.send(JSON.stringify({
          type: 'lsp:response',
          id,
          result: msg.result ?? null,
          error: msg.error ?? undefined,
        }))
      } catch { /* client gone */ }
    }
    return
  }

  // Notification from server (e.g., diagnostics)
  if ('method' in msg && !('id' in msg)) {
    const notification = JSON.stringify({
      type: 'lsp:notification',
      method: msg.method,
      params: msg.params,
    })
    for (const client of session.clients) {
      try { client.send(notification) } catch { /* ignore */ }
    }
  }
}

function destroyLspSession(language: string) {
  const session = lspSessions.get(language)
  if (!session) return
  try {
    sendLspMessage(session, { jsonrpc: '2.0', id: session.nextId++, method: 'shutdown', params: null })
    setTimeout(() => {
      try { sendLspMessage(session, { jsonrpc: '2.0', method: 'exit', params: null }) } catch {}
      setTimeout(() => { try { session.proc.kill() } catch {} }, 1000)
    }, 500)
  } catch { try { session.proc.kill() } catch {} }
  lspSessions.delete(language)
}

function handleLspClientMessage(ws: ServerWebSocket<WsData>, parsed: Record<string, unknown>) {
  const language = ws.data.lspLanguage
  if (!language) return
  const lspKey = language === 'tsx' || language === 'jsx' ? 'typescript' : language
  const session = lspSessions.get(lspKey)
  if (!session) return

  if (parsed.type === 'lsp:request') {
    const clientId = parsed.id as number
    const serverId = session.nextId++
    session.pendingRequests.set(serverId, ws)
    // Remap id so we can route the response back, and store the original client id
    sendLspMessage(session, {
      jsonrpc: '2.0',
      id: serverId,
      method: parsed.method,
      params: parsed.params,
    })
    // Store mapping from server id back to client id
    const origSend = ws.send.bind(ws)
    const originalHandler = session.pendingRequests.get(serverId)
    if (originalHandler) {
      // We need to remap the ID in the response — override the pending entry
      session.pendingRequests.set(serverId, {
        send(data: string) {
          // Rewrite the id in the response
          try {
            const msg = JSON.parse(data)
            if (msg.type === 'lsp:response') msg.id = clientId
            origSend(JSON.stringify(msg))
          } catch { origSend(data) }
        },
        data: ws.data,
        readyState: ws.readyState,
      } as unknown as ServerWebSocket<WsData>)
    }
    return
  }

  if (parsed.type === 'lsp:notify') {
    sendLspMessage(session, {
      jsonrpc: '2.0',
      method: parsed.method as string,
      params: parsed.params,
    })
  }
}

// ---------------------------------------------------------------------------
// Process tree management
// ---------------------------------------------------------------------------

const activeEphemeralProcs = new Set<Subprocess>()

/** Walk the process tree to collect all descendant PIDs of `pid`. */
function getDescendantPids(pid: number): number[] {
  try {
    const output = execSync(`pgrep -P ${pid}`, {
      encoding: 'utf-8',
      timeout: 1000,
    }).trim()
    if (!output) return []
    const children = output.split('\n').map(Number).filter(Boolean)
    const all = [...children]
    for (const child of children) {
      all.push(...getDescendantPids(child))
    }
    return all
  } catch {
    return [] // pgrep exits 1 when no matches
  }
}

/**
 * Kill a process and its entire descendant tree.
 *
 * 1. Snapshots descendant PIDs (children reparent to init once parent dies)
 * 2. SIGHUP + SIGTERM to the process group — works for PTY sessions where
 *    forkpty/setsid made the child a session leader, mimics terminal close
 * 3. SIGTERM each descendant individually — catches processes that changed PGID
 * 4. SIGKILL everything after 2 s as a safety net
 */
function killProcessTree(pid: number): void {
  const descendants = getDescendantPids(pid)

  // Process group signals (effective for PTY sessions)
  try { process.kill(-pid, 'SIGHUP') } catch {}
  try { process.kill(-pid, 'SIGTERM') } catch {}

  // Individual descendant signals (catches PGID escapees)
  for (const dpid of descendants) {
    try { process.kill(dpid, 'SIGTERM') } catch {}
  }

  // SIGKILL safety net
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL') } catch {}
    for (const dpid of descendants) {
      try { process.kill(dpid, 'SIGKILL') } catch {}
    }
  }, 2000)
}

/**
 * Read a ReadableStream up to `maxBytes`, then drain the rest without
 * accumulating — prevents both OOM and pipe-deadlock (where unread pipe
 * buffer stalls the child process).
 */
async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (bytes >= maxBytes) continue // drain without accumulating
    const remaining = maxBytes - bytes
    if (value.byteLength <= remaining) {
      chunks.push(value)
      bytes += value.byteLength
    } else {
      chunks.push(value.slice(0, remaining))
      bytes += remaining
    }
  }

  const combined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

function broadcastDaemon(session: DaemonSession, msg: object) {
  const payload = JSON.stringify(msg)
  for (const c of session.clients) {
    if (c.readyState === 1) c.send(payload)
  }
}

function spawnDaemon(session: DaemonSession) {
  const shell = process.env.SHELL || '/bin/bash'
  const args = session.command ? [shell, '-lc', session.command] : [shell, '-l']
  const ptyDecoder = new TextDecoder()
  const gen = ++session.generation

  const proc = Bun.spawn(args, {
    cwd: process.env.HOME || '/',
    env: childEnv(),
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal: unknown, data: Uint8Array) {
        if (session.generation !== gen) return
        const str = ptyDecoder.decode(data, { stream: true })
        session.scrollback.push(str)
        session.scrollbackBytes += str.length
        while (session.scrollbackBytes > MAX_SCROLLBACK && session.scrollback.length > 1) {
          const removed = session.scrollback.shift()!
          session.scrollbackBytes -= removed.length
        }
        broadcastDaemon(session, { type: 'output', data: str })
      },
    },
    onExit(_proc: unknown, exitCode: number | null) {
      // Guard: after a restart, a stale exit event must not overwrite the new proc
      if (session.proc !== proc) return
      session.proc = null
      session.exitCode = exitCode
      session.status = exitCode === 0 ? 'stopped' : 'error'
      broadcastDaemon(session, { type: 'daemon:status', status: session.status, exitCode })
    },
  })

  session.proc = proc
  session.status = 'running'
  session.exitCode = null
}

function handleDaemonMessage(ws: ServerWebSocket<WsData>, parsed: Record<string, unknown>, trackedSessionId?: string | null) {
  const sessionId = (parsed.sessionId as string | undefined) || trackedSessionId || undefined

  if (parsed.type === 'daemon:create') {
    const command = (parsed.command as string | undefined) || ''
    const session: DaemonSession = {
      id: randomUUID(),
      command,
      proc: null,
      generation: 0,
      status: 'stopped',
      exitCode: null,
      scrollback: [],
      scrollbackBytes: 0,
      clients: new Set([ws]),
      satellitePassword: null,
    }
    spawnDaemon(session)
    daemonSessions.set(session.id, session)
    ws.send(JSON.stringify({ type: 'daemon:created', sessionId: session.id, status: session.status }))
    return
  }

  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'daemon:error', message: 'Missing sessionId' }))
    return
  }

  const session = daemonSessions.get(sessionId)
  if (!session) {
    ws.send(JSON.stringify({ type: 'daemon:error', message: 'Session not found' }))
    return
  }

  if (parsed.type === 'daemon:attach') {
    session.clients.add(ws)
    for (const chunk of session.scrollback) {
      ws.send(JSON.stringify({ type: 'output', data: chunk }))
    }
    ws.send(JSON.stringify({
      type: 'daemon:attached',
      sessionId: session.id,
      status: session.status,
      exitCode: session.exitCode,
    }))
    return
  }

  if (parsed.type === 'daemon:stop') {
    if (session.proc) killProcessTree(session.proc.pid)
    return
  }

  if (parsed.type === 'daemon:restart') {
    if (session.proc) killProcessTree(session.proc.pid)
    session.scrollback = []
    session.scrollbackBytes = 0
    spawnDaemon(session)
    broadcastDaemon(session, { type: 'daemon:status', status: 'running' })
    return
  }

  if (parsed.type === 'daemon:destroy') {
    if (session.proc) killProcessTree(session.proc.pid)
    daemonSessions.delete(sessionId)
    broadcastDaemon(session, { type: 'daemon:status', status: 'stopped', exitCode: null })
    return
  }

  if (parsed.type === 'resize' && session.proc?.terminal) {
    session.proc.terminal.resize(parsed.cols as number, parsed.rows as number)
    return
  }

  if (parsed.type === 'input' && session.proc?.terminal) {
    session.proc.terminal.write(parsed.data as string)
    return
  }
}

// ---------------------------------------------------------------------------
// Ephemeral PTY setup
// ---------------------------------------------------------------------------

function setupEphemeral(ws: ServerWebSocket<WsData>, firstParsed?: Record<string, unknown>) {
  ws.data.mode = 'ephemeral'
  const shell = process.env.SHELL || '/bin/bash'
  const ptyDecoder = new TextDecoder()

  const proc = Bun.spawn([shell], {
    cwd: process.env.HOME || '/',
    env: childEnv(),
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal: unknown, data: Uint8Array) {
        try {
          const str = ptyDecoder.decode(data, { stream: true })
          ws.send(JSON.stringify({ type: 'output', data: str }))
        } catch { /* WS closed mid-stream */ }
      },
    },
    onExit(_proc: unknown, exitCode: number | null) {
      activeEphemeralProcs.delete(proc)
      ws.data.ephemeralProc = null
      try {
        ws.send(JSON.stringify({ type: 'exit', exitCode: exitCode ?? null }))
        ws.close()
      } catch { /* WS already closed/closing — client timeout will handle cleanup */ }
    },
  })

  activeEphemeralProcs.add(proc)
  ws.data.ephemeralProc = proc

  if (firstParsed) {
    if (firstParsed.type === 'input' && proc.terminal) proc.terminal.write(firstParsed.data as string)
    else if (firstParsed.type === 'resize' && proc.terminal) proc.terminal.resize(firstParsed.cols as number, firstParsed.rows as number)
  }
}

// ---------------------------------------------------------------------------
// Browse proxy — dedicated per-target reverse proxy servers (Bun.serve)
//
// Each target port gets its own Bun.serve instance that proxies both HTTP and
// WebSocket traffic.  The previous http.createServer approach silently dropped
// WebSocket upgrades because Bun's Node-compat layer does not emit the
// `upgrade` event — Bun.serve handles upgrades natively via server.upgrade().
// ---------------------------------------------------------------------------

interface BrowseProxy {
  targetPort: number
  proxyPort: number
  server: ReturnType<typeof Bun.serve>
  lastAccess: number
}

interface BrowseWsData {
  targetWs: WebSocket | null
  pendingMessages: (string | ArrayBuffer | Buffer)[]
  targetPort: number
  path: string
  protocols: string[]
}

const browseProxies = new Map<number, BrowseProxy>()
const targetToProxy = new Map<number, number>()
const PROXY_IDLE_MS = 5 * 60 * 1000

function createBrowseProxy(targetPort: number): Promise<number> {
  const existing = targetToProxy.get(targetPort)
  if (existing && browseProxies.has(existing)) {
    browseProxies.get(existing)!.lastAccess = Date.now()
    return Promise.resolve(existing)
  }

  const proxyServer = Bun.serve<BrowseWsData>({
    port: 0,
    hostname: HOST,

    async fetch(req, server) {
      const entry = browseProxies.get(proxyServer.port)
      if (entry) entry.lastAccess = Date.now()

      const url = new URL(req.url)

      // --- WebSocket upgrade ------------------------------------------------
      // Do NOT echo sec-websocket-protocol back to the client here — the proxy
      // hasn't connected to the target yet, so it can't know which protocol the
      // target will actually accept.  Omitting the header is spec-compliant (the
      // connection succeeds with no subprotocol) and avoids a mismatch if the
      // target selects a different protocol.  The actual protocols offered by the
      // client are forwarded to the target in the open() handler.
      //
      // Ping/pong: Bun's ServerWebSocket auto-responds to client pings with
      // pongs, and Bun's client WebSocket auto-responds to target pings with
      // pongs.  Neither side will time out due to missing pong responses.
      if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const protoHeader = req.headers.get('sec-websocket-protocol')

        const ok = server.upgrade(req, {
          data: {
            targetWs: null,
            pendingMessages: [],
            targetPort,
            path: url.pathname + url.search,
            protocols: protoHeader ? protoHeader.split(',').map(s => s.trim()) : [],
          },
        })
        return ok ? undefined : new Response('WebSocket upgrade failed', { status: 500 })
      }

      // --- CORS preflight ---------------------------------------------------
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          },
        })
      }

      // --- HTTP reverse proxy (IPv4 → IPv6 fallback) -----------------------
      for (const hostname of ['127.0.0.1', '::1']) {
        try {
          const host = hostname.includes(':') ? `[${hostname}]` : hostname
          const targetUrl = `http://${host}:${targetPort}${url.pathname}${url.search}`
          const headers = new Headers(req.headers)
          headers.set('host', `localhost:${targetPort}`)

          const proxyRes = await fetch(targetUrl, {
            method: req.method,
            headers,
            body: req.body,
            redirect: 'manual',
          })

          const resHeaders = new Headers(proxyRes.headers)
          // fetch() auto-decompresses gzip/br — strip stale encoding
          // headers so the browser sees the correct body length
          resHeaders.delete('content-encoding')
          resHeaders.delete('content-length')
          resHeaders.delete('transfer-encoding')
          resHeaders.set('Access-Control-Allow-Origin', '*')
          resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
          resHeaders.set('Access-Control-Allow-Headers', '*')

          return new Response(proxyRes.body, {
            status: proxyRes.status,
            statusText: proxyRes.statusText,
            headers: resHeaders,
          })
        } catch {
          continue
        }
      }

      return new Response(`Cannot connect to localhost:${targetPort}`, { status: 502 })
    },

    websocket: {
      open(ws) {
        let connected = false

        const tryConnect = (hostname: string, fallback?: string) => {
          const host = hostname.includes(':') ? `[${hostname}]` : hostname
          const targetUrl = `ws://${host}:${ws.data.targetPort}${ws.data.path}`
          const protocols = ws.data.protocols.length ? ws.data.protocols : undefined
          const targetWs = new WebSocket(targetUrl, protocols)
          targetWs.binaryType = 'arraybuffer'

          targetWs.addEventListener('open', () => {
            connected = true
            ws.data.targetWs = targetWs
            for (const msg of ws.data.pendingMessages) targetWs.send(msg)
            ws.data.pendingMessages = []
          })

          targetWs.addEventListener('message', (event) => {
            try {
              if (typeof event.data === 'string') ws.sendText(event.data)
              else ws.send(event.data as ArrayBuffer)
            } catch { /* client disconnected */ }
          })

          targetWs.addEventListener('close', () => {
            if (!connected && fallback) { tryConnect(fallback); return }
            try { ws.close() } catch { /* */ }
          })

          targetWs.addEventListener('error', () => { /* close will follow */ })
        }

        tryConnect('127.0.0.1', '::1')
      },

      message(ws, message) {
        const targetWs = ws.data.targetWs
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(message)
        } else {
          ws.data.pendingMessages.push(message)
        }
      },

      close(ws) {
        if (ws.data.targetWs) {
          try { ws.data.targetWs.close() } catch { /* */ }
        }
      },
    },
  })

  const port = proxyServer.port
  browseProxies.set(port, { targetPort, proxyPort: port, server: proxyServer, lastAccess: Date.now() })
  targetToProxy.set(targetPort, port)
  console.log(`[browse-proxy] :${port} → :${targetPort}`)
  return Promise.resolve(port)
}

function destroyBrowseProxy(proxyPort: number) {
  const p = browseProxies.get(proxyPort)
  if (!p) return
  p.server.stop()
  browseProxies.delete(proxyPort)
  targetToProxy.delete(p.targetPort)
  console.log(`[browse-proxy] Destroyed :${proxyPort}`)
}

setInterval(() => {
  const now = Date.now()
  for (const [port, p] of browseProxies) {
    if (now - p.lastAccess > PROXY_IDLE_MS) destroyBrowseProxy(port)
  }
}, 60_000)

// ---------------------------------------------------------------------------
// Rate limiter for satellite/check
// ---------------------------------------------------------------------------

const satCheckAttempts = new Map<string, { count: number; resetAt: number }>()
const SAT_CHECK_WINDOW = 60_000
const SAT_CHECK_MAX = 10

function satCheckRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = satCheckAttempts.get(ip)
  if (!entry || now >= entry.resetAt) {
    satCheckAttempts.set(ip, { count: 1, resetAt: now + SAT_CHECK_WINDOW })
    return false
  }
  entry.count++
  return entry.count > SAT_CHECK_MAX
}

// ---------------------------------------------------------------------------
// Background update
// ---------------------------------------------------------------------------

let updateProgress: { status: 'idle' | 'downloading' | 'installing' | 'restarting' | 'error'; detail: string; error: string | null } = { status: 'idle', detail: '', error: null }

async function runUpdate(version: string, tarballUrl: string) {
  try {
    // Download
    updateProgress = { status: 'downloading', detail: 'Downloading tarball...', error: null }
    const tmpPath = `/tmp/hypercanvas-${version}.tar.gz`
    const tmpExtract = `/tmp/hypercanvas-${version}`
    const dlResp = await fetch(tarballUrl)
    if (!dlResp.ok) { updateProgress = { status: 'error', detail: '', error: `Download failed: ${dlResp.status}` }; return }
    await Bun.write(tmpPath, dlResp)

    // Extract to temp dir first
    updateProgress = { status: 'installing', detail: 'Extracting...', error: null }
    execSync(`rm -rf ${JSON.stringify(tmpExtract)}`)
    execSync(`mkdir -p ${JSON.stringify(tmpExtract)}`)
    execSync(`tar -xzf ${JSON.stringify(tmpPath)} -C ${JSON.stringify(tmpExtract)}`)
    execSync(`rm -f ${JSON.stringify(tmpPath)}`)

    // Overwrite in-place: copy binary + dist + VERSION into INSTALL_ROOT
    updateProgress = { status: 'installing', detail: 'Installing files...', error: null }
    const newBinary = join(tmpExtract, 'hypercanvas')
    const newDist = join(tmpExtract, 'dist')
    const newVersion = join(tmpExtract, 'VERSION')

    if (existsSync(newBinary)) {
      execSync(`cp -f ${JSON.stringify(newBinary)} ${JSON.stringify(join(INSTALL_ROOT, 'hypercanvas'))}`)
      execSync(`chmod +x ${JSON.stringify(join(INSTALL_ROOT, 'hypercanvas'))}`)
    }
    if (existsSync(newDist)) {
      execSync(`rm -rf ${JSON.stringify(join(INSTALL_ROOT, 'dist'))}`)
      execSync(`cp -rf ${JSON.stringify(newDist)} ${JSON.stringify(join(INSTALL_ROOT, 'dist'))}`)
    }
    if (existsSync(newVersion)) {
      execSync(`cp -f ${JSON.stringify(newVersion)} ${JSON.stringify(join(INSTALL_ROOT, 'VERSION'))}`)
    }
    execSync(`rm -rf ${JSON.stringify(tmpExtract)}`)

    // Exit so systemd restarts with the new binary
    updateProgress = { status: 'restarting', detail: 'Restarting server...', error: null }
    setTimeout(() => process.exit(0), 1000)
  } catch (err) {
    updateProgress = { status: 'error', detail: '', error: err instanceof Error ? err.message : 'Update failed' }
  }
}

// ---------------------------------------------------------------------------
// Main server — Bun.serve with HTTP + WebSocket
// ---------------------------------------------------------------------------

const server = Bun.serve<WsData>({
  port: PORT,
  hostname: HOST,
  maxRequestBodySize: 100 * 1024 * 1024,

  async fetch(req, server) {
    const url = new URL(req.url)

    // -- WebSocket upgrade --
    if (url.pathname === '/ws' && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const satId = url.searchParams.get('satellite')
      const satPwd = url.searchParams.get('password')

      if (satId && satPwd) {
        const session = daemonSessions.get(satId)
        if (session?.satellitePassword && timingSafeCompare(session.satellitePassword, satPwd)) {
          if (server.upgrade(req, { data: { mode: 'satellite' as const, ephemeralProc: null, daemonSessionId: null, satSessionId: satId, lspLanguage: null } })) return
        }
        return json({ error: 'Unauthorized' }, 401)
      }

      if (AUTH_TOKEN) {
        const token = url.searchParams.get('token') || ''
        if (!isValidToken(token)) return json({ error: 'Unauthorized' }, 401)
      }

      if (server.upgrade(req, { data: { mode: 'pending' as const, ephemeralProc: null, daemonSessionId: null, satSessionId: null, lspLanguage: null } })) return
      return json({ error: 'Upgrade failed' }, 500)
    }

    // -- CORS preflight --
    if (req.method === 'OPTIONS') return cors204()

    // -- Auth check endpoint --
    if (req.method === 'POST' && url.pathname === '/auth/check') {
      const authHeader = req.headers.get('authorization') || ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
      return isValidToken(token) ? json({ ok: true }) : json({ error: 'Unauthorized' }, 401)
    }

    // -- Satellite check (no auth gate) --
    if (req.method === 'POST' && url.pathname === '/satellite/check') {
      const ip = server.requestIP(req)?.address || 'unknown'
      if (satCheckRateLimited(ip)) return json({ error: 'Too many attempts, try again later' }, 429)
      try {
        const body = await req.json()
        const sessionId = body.sessionId || ''
        const password = body.password || ''
        const session = daemonSessions.get(sessionId)
        if (session?.satellitePassword && timingSafeCompare(session.satellitePassword, password)) {
          return json({ ok: true, status: session.status })
        }
        return json({ error: 'Unauthorized' }, 401)
      } catch {
        return json({ error: 'Bad request' }, 400)
      }
    }

    // -- Auth gate for API endpoints --
    if (AUTH_TOKEN) {
      const API_PATHS = ['/cloud', '/tree', '/find-dir', '/ls', '/exec', '/read-file', '/write-file', '/fetch', '/daemon', '/browse-proxy', '/satellite', '/update', '/lsp']
      if (API_PATHS.some(p => url.pathname.startsWith(p))) {
        const authHeader = req.headers.get('authorization') || ''
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (!isValidToken(token)) return json({ error: 'Unauthorized' }, 401)
      }
    }

    // -- Cloud canvas --
    if (req.method === 'GET' && url.pathname === '/cloud/config') {
      try {
        if (!existsSync(CLOUD_CONFIG_FILE)) return json({ cloudCanvas: false })
        const raw = readFileSync(CLOUD_CONFIG_FILE, 'utf-8')
        return json(JSON.parse(raw))
      } catch {
        return json({ cloudCanvas: false })
      }
    }

    if (req.method === 'PUT' && url.pathname === '/cloud/config') {
      try {
        const body = await req.json()
        if (!existsSync(CLOUD_DIR)) mkdirSync(CLOUD_DIR, { recursive: true })
        writeFileSync(CLOUD_CONFIG_FILE, JSON.stringify(body), 'utf-8')
        return json({ ok: true })
      } catch {
        return json({ error: 'Failed to write cloud config' }, 500)
      }
    }

    if (req.method === 'GET' && url.pathname === '/cloud/state') {
      try {
        if (!existsSync(CLOUD_STATE_FILE)) return json(null)
        const raw = readFileSync(CLOUD_STATE_FILE, 'utf-8')
        return json(JSON.parse(raw))
      } catch {
        return json({ error: 'Failed to read cloud state' }, 500)
      }
    }

    if (req.method === 'PUT' && url.pathname === '/cloud/state') {
      try {
        const body = await req.json()
        if (!existsSync(CLOUD_DIR)) mkdirSync(CLOUD_DIR, { recursive: true })
        writeFileSync(CLOUD_STATE_FILE, JSON.stringify(body), 'utf-8')
        return json({ ok: true })
      } catch {
        return json({ error: 'Failed to write cloud state' }, 500)
      }
    }

    // -- /tree --
    if (req.method === 'GET' && url.pathname === '/tree') {
      try {
        const home = process.env.HOME || '/'
        const rawPath = url.searchParams.get('path') || process.cwd()
        const targetPath = rawPath.startsWith('~') ? rawPath.replace('~', home) : rawPath
        if (!targetPath.startsWith(home)) return text(`Path must be within ${home}`, 400)
        const depth = Math.min(Math.max(parseInt(url.searchParams.get('depth') || '3', 10) || 3, 1), 5)
        const output = execSync(`tree -L ${depth} --noreport -I node_modules`, { cwd: targetPath, encoding: 'utf-8', timeout: 10000 })
        return text(`${targetPath}\n${output}`)
      } catch (err) {
        return text(err instanceof Error ? err.message : 'tree command failed', 500)
      }
    }

    // -- /find-dir --
    if (req.method === 'GET' && url.pathname === '/find-dir') {
      try {
        const home = process.env.HOME || '/'
        const name = url.searchParams.get('name')
        if (!name) return text('Missing required "name" parameter', 400)

        const exactOutput = execSync(
          `find ${home} -maxdepth 6 -type d -iname ${JSON.stringify(name)} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
          { encoding: 'utf-8', timeout: 10000 },
        ).trim()
        const fuzzyGlob = '*' + name.split('').join('*') + '*'
        const fuzzyOutput = execSync(
          `find ${home} -maxdepth 6 -type d -iname ${JSON.stringify(fuzzyGlob)} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
          { encoding: 'utf-8', timeout: 10000 },
        ).trim()
        const substringOutput = execSync(
          `find ${home} -maxdepth 6 -type d -iname ${JSON.stringify('*' + name + '*')} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
          { encoding: 'utf-8', timeout: 10000 },
        ).trim()

        const exact = exactOutput ? exactOutput.split('\n') : []
        const substring = substringOutput ? substringOutput.split('\n') : []
        const fuzzy = fuzzyOutput ? fuzzyOutput.split('\n') : []
        const seen = new Set<string>()
        const lines: string[] = []

        if (exact.length) {
          lines.push('--- exact matches ---')
          for (const p of exact) { seen.add(p); lines.push(p) }
        }
        const subOnly = substring.filter((p) => !seen.has(p))
        if (subOnly.length) {
          lines.push('--- substring matches ---')
          for (const p of subOnly) { seen.add(p); lines.push(p) }
        }
        const fuzzyOnly = fuzzy.filter((p) => !seen.has(p))
        if (fuzzyOnly.length) {
          lines.push('--- fuzzy matches ---')
          for (const p of fuzzyOnly) { seen.add(p); lines.push(p) }
        }

        return text(lines.length ? lines.join('\n') : `No directories matching "${name}" found under ${home}`)
      } catch (err) {
        return text(err instanceof Error ? err.message : 'find command failed', 500)
      }
    }

    // -- /ls --
    if (req.method === 'GET' && url.pathname === '/ls') {
      try {
        const home = process.env.HOME || '/'
        const rawPath = url.searchParams.get('path') || home
        const targetPath = resolve(rawPath.startsWith('~') ? rawPath.replace('~', home) : rawPath)
        if (!targetPath.startsWith(home)) return json({ error: `Path must be within ${home}` }, 400)
        if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) return json({ error: 'Directory not found' }, 404)
        const entries = readdirSync(targetPath, { withFileTypes: true })
          .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        return json({ path: targetPath, entries })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'ls failed' }, 500)
      }
    }

    // -- /exec --
    if (req.method === 'POST' && url.pathname === '/exec') {
      try {
        const body = await req.json()
        const home = process.env.HOME || '/'
        const shell = process.env.SHELL || '/bin/bash'
        const command = body.command as string
        if (!command) return json({ error: 'Missing command' }, 400)
        const rawCwd = (body.cwd as string) || home
        const cwd = resolve(rawCwd.startsWith('~') ? rawCwd.replace('~', home) : rawCwd)
        if (!cwd.startsWith(home)) return json({ error: `cwd must be within ${home}` }, 400)
        const timeout = Math.min(Math.max(Number(body.timeout) || 30000, 1000), 120000)
        const MAX_BUF = 512 * 1024

        const proc = Bun.spawn([shell, '-c', command], {
          cwd: existsSync(cwd) ? cwd : home,
          env: childEnv(),
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        })

        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          const descendants = getDescendantPids(proc.pid)
          for (const dpid of descendants) {
            try { process.kill(dpid, 'SIGKILL') } catch {}
          }
          proc.kill(9)
        }, timeout)

        try {
          const [stdout, stderr, exitCode] = await Promise.all([
            readCapped(proc.stdout!, MAX_BUF),
            readCapped(proc.stderr!, MAX_BUF),
            proc.exited,
          ])
          clearTimeout(timer)
          return json({ stdout, stderr, exitCode, timedOut })
        } catch (err) {
          clearTimeout(timer)
          return json({ error: err instanceof Error ? err.message : 'exec failed' }, 500)
        }
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'exec failed' }, 500)
      }
    }

    // -- /fetch --
    if (req.method === 'POST' && url.pathname === '/fetch') {
      try {
        const body = await req.json()
        const targetUrl = body.url as string
        if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
          return json({ error: 'URL must start with http:// or https://' }, 400)
        }
        const maxBytes = Math.min(Number(body.maxBytes) || 65536, 256 * 1024)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10000)

        try {
          const resp = await fetch(targetUrl, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Genie/1.0)' },
          })
          clearTimeout(timer)
          const contentType = resp.headers.get('content-type') || ''
          let respText = await resp.text()
          const truncated = respText.length > maxBytes
          if (truncated) respText = respText.slice(0, maxBytes)

          if (contentType.includes('html')) {
            respText = respText
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s{2,}/g, ' ')
              .replace(/\n\s*\n/g, '\n')
              .trim()
          }

          return json({ status: resp.status, contentType, body: respText, truncated, error: null })
        } catch (fetchErr) {
          clearTimeout(timer)
          return json({ status: 0, contentType: '', body: '', truncated: false, error: fetchErr instanceof Error ? fetchErr.message : 'fetch failed' })
        }
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'fetch failed' }, 500)
      }
    }

    // -- /read-file --
    if (req.method === 'POST' && url.pathname === '/read-file') {
      try {
        const body = await req.json()
        const home = process.env.HOME || '/'
        const rawPath = body.path as string
        if (!rawPath) return json({ error: 'Missing path' }, 400)
        const targetPath = resolve(rawPath.startsWith('~') ? rawPath.replace('~', home) : rawPath)
        if (!targetPath.startsWith(home)) return json({ error: `Path must be within ${home}` }, 400)
        if (!existsSync(targetPath) || !statSync(targetPath).isFile()) return json({ error: 'File not found' }, 404)
        const maxLines = Math.min(Math.max(Number(body.maxLines) || 200, 1), 50000)
        const raw = readFileSync(targetPath, 'utf-8')
        const allLines = raw.split('\n')
        const truncated = allLines.length > maxLines
        const content = truncated ? allLines.slice(0, maxLines).join('\n') : raw
        return json({ content, totalLines: allLines.length, truncated, path: targetPath })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'read failed' }, 500)
      }
    }

    // -- /write-file --
    if (req.method === 'POST' && url.pathname === '/write-file') {
      try {
        const body = await req.json()
        const home = process.env.HOME || '/'
        const rawPath = body.path as string
        const content = body.content as string
        if (!rawPath || content == null) return json({ error: 'Missing path or content' }, 400)
        const targetPath = resolve(rawPath.startsWith('~') ? rawPath.replace('~', home) : rawPath)
        if (!targetPath.startsWith(home)) return json({ error: `Path must be within ${home}` }, 400)
        const parentDir = dirname(targetPath)
        if (!existsSync(parentDir)) return json({ error: `Parent directory does not exist: ${parentDir}` }, 400)
        writeFileSync(targetPath, content, 'utf-8')
        return json({ bytesWritten: Buffer.byteLength(content, 'utf-8'), path: targetPath })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'write failed' }, 500)
      }
    }

    // -- Daemon HTTP control endpoints --

    if (req.method === 'GET' && url.pathname === '/daemon/list') {
      const list = Array.from(daemonSessions.values()).map((s) => ({
        sessionId: s.id, command: s.command, status: s.status, exitCode: s.exitCode,
      }))
      return json(list)
    }

    if (req.method === 'POST' && url.pathname === '/daemon/stop') {
      const body = await req.json()
      const session = daemonSessions.get(body.sessionId)
      if (!session) return json({ error: 'Session not found' }, 404)
      if (session.proc) killProcessTree(session.proc.pid)
      return json({ status: 'stopped' })
    }

    if (req.method === 'POST' && url.pathname === '/daemon/restart') {
      const body = await req.json()
      const session = daemonSessions.get(body.sessionId)
      if (!session) return json({ error: 'Session not found' }, 404)
      if (session.proc) killProcessTree(session.proc.pid)
      session.scrollback = []
      session.scrollbackBytes = 0
      spawnDaemon(session)
      broadcastDaemon(session, { type: 'daemon:status', status: 'running' })
      return json({ status: 'running' })
    }

    if (req.method === 'POST' && url.pathname === '/daemon/cwd') {
      const body = await req.json()
      const session = daemonSessions.get(body.sessionId)
      if (!session?.proc?.pid) return json({ error: 'No running process' }, 404)
      try {
        const { readlink } = await import('node:fs/promises')
        let cwd = await readlink(`/proc/${session.proc.pid}/cwd`)
        const home = process.env.HOME
        if (home && cwd.startsWith(home)) cwd = '~' + cwd.slice(home.length)
        return json({ cwd })
      } catch { return json({ error: 'Could not read cwd' }, 500) }
    }

    if (req.method === 'POST' && url.pathname === '/daemon/destroy') {
      const body = await req.json()
      const session = daemonSessions.get(body.sessionId)
      if (session) {
        if (session.proc) killProcessTree(session.proc.pid)
        daemonSessions.delete(body.sessionId)
      }
      return json({ ok: true })
    }

    // -- Satellite endpoints --

    if (req.method === 'POST' && url.pathname === '/satellite/enable') {
      try {
        const body = await req.json()
        const password = (body.password as string || '').trim()
        if (!password) return json({ error: 'Missing password' }, 400)
        const session = daemonSessions.get(body.sessionId)
        if (!session) return json({ error: 'Session not found' }, 404)
        session.satellitePassword = password
        return json({ ok: true })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Failed' }, 500)
      }
    }

    if (req.method === 'POST' && url.pathname === '/satellite/disable') {
      try {
        const body = await req.json()
        const session = daemonSessions.get(body.sessionId)
        if (!session) return json({ error: 'Session not found' }, 404)
        session.satellitePassword = null
        for (const c of session.clients) {
          if (c.data.mode === 'satellite' && c.readyState === 1) {
            c.close(1000, 'Satellite revoked')
          }
        }
        return json({ ok: true })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Failed' }, 500)
      }
    }

    // -- Browse proxy endpoints --

    if (req.method === 'POST' && url.pathname === '/browse-proxy') {
      try {
        const body = await req.json()
        const target = parseInt(body.port)
        if (!target || target < 1 || target > 65535) return json({ error: 'Invalid port' }, 400)
        const proxyPort = await createBrowseProxy(target)
        return json({ proxyPort, targetPort: target })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Failed to create proxy' }, 500)
      }
    }

    if (req.method === 'DELETE' && url.pathname === '/browse-proxy') {
      try {
        const body = await req.json()
        destroyBrowseProxy(parseInt(body.proxyPort))
        return json({ ok: true })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Failed' }, 500)
      }
    }

    if (req.method === 'GET' && url.pathname === '/browse-proxy/list') {
      const list = Array.from(browseProxies.values()).map(p => ({
        proxyPort: p.proxyPort, targetPort: p.targetPort, lastAccess: p.lastAccess,
      }))
      return json(list)
    }

    // -- /lsp --
    if (req.method === 'GET' && url.pathname === '/lsp/status') {
      const status: Record<string, { clients: number; initialized: boolean }> = {}
      for (const [lang, session] of lspSessions) {
        status[lang] = { clients: session.clients.size, initialized: session.initialized }
      }
      return json(status)
    }

    // -- /update --
    if (req.method === 'GET' && url.pathname === '/update/version') {
      return json({ version: CURRENT_VERSION })
    }

    if (req.method === 'GET' && url.pathname === '/update/status') {
      return json({ status: updateProgress.status, detail: updateProgress.detail, error: updateProgress.error })
    }

    if (req.method === 'POST' && url.pathname === '/update') {
      try {
        const body = await req.json()
        const version = body.version as string
        const tarballUrl = body.tarballUrl as string
        if (!version || !tarballUrl) return json({ error: 'Missing version or tarballUrl' }, 400)
        if (updateProgress.status === 'downloading' || updateProgress.status === 'installing') {
          return json({ error: 'Update already in progress' }, 409)
        }

        // Respond immediately, run update in background
        updateProgress = { status: 'downloading', detail: 'Downloading tarball...', error: null }
        runUpdate(version, tarballUrl)
        return json({ ok: true, status: 'started' })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Update failed' }, 500)
      }
    }

    // -- LLM proxy (forward to Claude OAuth API) --
    if (url.pathname.startsWith('/__llm__/')) {
      const target = 'https://claude-oauth-api-production.up.railway.app' + url.pathname.replace(/^\/__llm__/, '') + url.search
      const proxyRes = await fetch(target, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'POST' ? req.body : undefined,
        redirect: 'follow',
      })
      const resHeaders = new Headers(proxyRes.headers)
      resHeaders.set('Access-Control-Allow-Origin', '*')
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: resHeaders,
      })
    }

    // -- Serve built frontend (production) --
    if (SERVE_STATIC) {
      let filePath = join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname)
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        filePath = join(DIST_DIR, 'index.html') // SPA fallback
      }
      const mime = MIME_TYPES[extname(filePath)] || 'application/octet-stream'
      return new Response(readFileSync(filePath), {
        headers: { 'Content-Type': mime, ...CORS_HEADERS },
      })
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS })
  },

  // ---------------------------------------------------------------------------
  // WebSocket handler
  // ---------------------------------------------------------------------------
  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      if (ws.data.mode === 'satellite') {
        const session = daemonSessions.get(ws.data.satSessionId!)
        if (!session?.satellitePassword) { ws.close(1008, 'Unauthorized'); return }
        session.clients.add(ws)
        for (const chunk of session.scrollback) {
          ws.send(JSON.stringify({ type: 'output', data: chunk }))
        }
        ws.send(JSON.stringify({
          type: 'daemon:attached',
          sessionId: session.id,
          status: session.status,
          exitCode: session.exitCode,
        }))
      }
    },

    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      let parsed: Record<string, unknown> | null = null
      try { parsed = JSON.parse(typeof message === 'string' ? message : decoder.decode(message)) } catch { /* raw */ }

      if (ws.data.mode === 'satellite') {
        if (!parsed) return
        const session = daemonSessions.get(ws.data.satSessionId!)
        if (!session?.proc?.terminal) return
        if (parsed.type === 'input') session.proc.terminal.write(parsed.data as string)
        else if (parsed.type === 'resize') session.proc.terminal.resize(parsed.cols as number, parsed.rows as number)
        return
      }

      if (ws.data.mode === 'pending') {
        if (parsed && typeof parsed.type === 'string' && (parsed.type as string).startsWith('daemon:')) {
          ws.data.mode = 'daemon'
          handleDaemonMessage(ws, parsed, ws.data.daemonSessionId)
          if (parsed.type === 'daemon:create' || parsed.type === 'daemon:attach') {
            for (const [id, s] of daemonSessions) {
              if (s.clients.has(ws)) { ws.data.daemonSessionId = id; break }
            }
          }
          return
        }
        if (parsed && parsed.type === 'lsp:init') {
          const language = parsed.language as string
          const filePath = parsed.filePath as string
          ws.data.mode = 'lsp'
          ws.data.lspLanguage = language
          getOrCreateLspSession(language, filePath).then(session => {
            if (session) {
              session.clients.add(ws)
              ws.send(JSON.stringify({ type: 'lsp:ready' }))
            } else {
              ws.send(JSON.stringify({ type: 'lsp:error', error: `No LSP server available for ${language}` }))
            }
          }).catch(err => {
            ws.send(JSON.stringify({ type: 'lsp:error', error: err instanceof Error ? err.message : 'LSP init failed' }))
          })
          return
        }
        setupEphemeral(ws, parsed ?? undefined)
        return
      }

      if (ws.data.mode === 'daemon') {
        if (parsed) {
          handleDaemonMessage(ws, parsed, ws.data.daemonSessionId)
          if (parsed.type === 'daemon:attach' || parsed.type === 'daemon:create') {
            for (const [id, s] of daemonSessions) {
              if (s.clients.has(ws)) { ws.data.daemonSessionId = id; break }
            }
          }
        }
        return
      }

      if (ws.data.mode === 'lsp') {
        if (parsed) handleLspClientMessage(ws, parsed)
        return
      }

      // Ephemeral mode
      if (!ws.data.ephemeralProc?.terminal) return
      if (parsed) {
        if (parsed.type === 'input') ws.data.ephemeralProc.terminal.write(parsed.data as string)
        else if (parsed.type === 'resize') ws.data.ephemeralProc.terminal.resize(parsed.cols as number, parsed.rows as number)
      } else {
        ws.data.ephemeralProc.terminal.write(typeof message === 'string' ? message : decoder.decode(message))
      }
    },

    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.mode === 'ephemeral' && ws.data.ephemeralProc) {
        activeEphemeralProcs.delete(ws.data.ephemeralProc)
        killProcessTree(ws.data.ephemeralProc.pid)
        ws.data.ephemeralProc = null
      }
      if (ws.data.mode === 'daemon' && ws.data.daemonSessionId) {
        const session = daemonSessions.get(ws.data.daemonSessionId)
        if (session) session.clients.delete(ws)
      }
      if (ws.data.mode === 'satellite' && ws.data.satSessionId) {
        const session = daemonSessions.get(ws.data.satSessionId)
        if (session) session.clients.delete(ws)
      }
      if (ws.data.mode === 'lsp' && ws.data.lspLanguage) {
        const lspKey = ws.data.lspLanguage === 'tsx' || ws.data.lspLanguage === 'jsx' ? 'typescript' : ws.data.lspLanguage
        const session = lspSessions.get(lspKey)
        if (session) {
          session.clients.delete(ws)
          if (session.clients.size === 0) {
            // Delay shutdown to allow quick reopen
            setTimeout(() => {
              const s = lspSessions.get(lspKey)
              if (s && s.clients.size === 0) destroyLspSession(lspKey)
            }, 30000)
          }
        }
      }
    },
  },
})

console.log(`PTY server listening on http://${HOST}:${PORT}`)
if (SERVE_STATIC) console.log(`Serving frontend from ${DIST_DIR}`)
if (!AUTH_TOKEN) console.warn('\x1b[33m⚠  WARNING: AUTH_TOKEN is not set. Server is running WITHOUT authentication.\x1b[0m')

// ---------------------------------------------------------------------------
// Graceful shutdown — kill all session trees so children don't become orphans
// ---------------------------------------------------------------------------

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('[pty-server] Shutting down, cleaning up all sessions…')

  for (const [id, session] of daemonSessions) {
    if (session.proc) killProcessTree(session.proc.pid)
    daemonSessions.delete(id)
  }

  for (const proc of activeEphemeralProcs) {
    killProcessTree(proc.pid)
  }
  activeEphemeralProcs.clear()

  for (const [lang] of lspSessions) {
    destroyLspSession(lang)
  }

  for (const [port] of browseProxies) {
    destroyBrowseProxy(port)
  }

  server.stop()

  // Allow SIGKILL safety-net timers (2 s) to fire before exiting
  setTimeout(() => process.exit(0), 3000)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
