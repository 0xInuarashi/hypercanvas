import { getWsUrl } from '../config'

export interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
}

interface LspLocation {
  uri: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

export interface LspClient {
  hover(filePath: string, line: number, character: number): Promise<{ contents: unknown } | null>
  definition(filePath: string, line: number, character: number): Promise<LspLocation[] | null>
  references(filePath: string, line: number, character: number): Promise<LspLocation[] | null>
  didOpen(filePath: string, lang: string, content: string): void
  didClose(filePath: string): void
  onDiagnostics(filePath: string, cb: (diags: Diagnostic[]) => void): void
  destroy(): void
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: unknown) => void
}

// One LSP session per language key, shared across all readers
const sessions = new Map<string, LspSession>()

class LspSession {
  language: string
  ws: WebSocket | null = null
  ready = false
  refCount = 0
  nextId = 1
  pending = new Map<number, PendingRequest>()
  diagnosticListeners = new Map<string, Set<(diags: Diagnostic[]) => void>>()
  queuedMessages: string[] = []

  constructor(language: string) {
    this.language = language
  }

  async connect(filePath: string): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.refCount++
      return
    }

    this.refCount++
    return new Promise((resolve, reject) => {
      const baseUrl = getWsUrl()
      this.ws = new WebSocket(baseUrl)

      const timeout = setTimeout(() => {
        reject(new Error('LSP connection timeout'))
        this.ws?.close()
      }, 10000)

      this.ws.onopen = () => {
        // Tell server to enter LSP mode
        this.ws!.send(JSON.stringify({
          type: 'lsp:init',
          language: this.language,
          filePath,
        }))
      }

      this.ws.onmessage = (e) => {
        let msg: Record<string, unknown>
        try { msg = JSON.parse(e.data) } catch { return }

        if (msg.type === 'lsp:ready') {
          clearTimeout(timeout)
          this.ready = true
          // Flush queued messages
          for (const m of this.queuedMessages) this.ws!.send(m)
          this.queuedMessages = []
          resolve()
          return
        }

        if (msg.type === 'lsp:error') {
          clearTimeout(timeout)
          reject(new Error(msg.error as string || 'LSP init failed'))
          return
        }

        if (msg.type === 'lsp:response') {
          const id = msg.id as number
          const p = this.pending.get(id)
          if (p) {
            this.pending.delete(id)
            if (msg.error) p.reject(msg.error)
            else p.resolve(msg.result)
          }
          return
        }

        if (msg.type === 'lsp:notification') {
          const method = msg.method as string
          if (method === 'textDocument/publishDiagnostics') {
            const params = msg.params as { uri: string; diagnostics: Diagnostic[] }
            const uri = params.uri
            const path = uri.replace('file://', '')
            const listeners = this.diagnosticListeners.get(path)
            if (listeners) {
              for (const cb of listeners) cb(params.diagnostics)
            }
          }
        }
      }

      this.ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('LSP WebSocket error'))
      }

      this.ws.onclose = () => {
        this.ready = false
        // Reject all pending
        for (const [, p] of this.pending) p.reject(new Error('Connection closed'))
        this.pending.clear()
      }
    })
  }

  send(msg: Record<string, unknown>) {
    const str = JSON.stringify(msg)
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(str)
    } else {
      this.queuedMessages.push(str)
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.send({ type: 'lsp:request', id, method, params })
      // Timeout after 10s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('LSP request timeout'))
        }
      }, 10000)
    })
  }

  notify(method: string, params: unknown) {
    this.send({ type: 'lsp:notify', method, params })
  }

  release() {
    this.refCount--
    if (this.refCount <= 0) {
      this.ws?.close()
      this.ws = null
      this.ready = false
      sessions.delete(this.language)
    }
  }
}

export async function getLspClient(lspKey: string, filePath: string): Promise<LspClient | null> {
  let session = sessions.get(lspKey)
  if (!session) {
    session = new LspSession(lspKey)
    sessions.set(lspKey, session)
  }

  try {
    await session.connect(filePath)
  } catch {
    sessions.delete(lspKey)
    return null
  }

  const s = session

  return {
    async hover(fp, line, character) {
      try {
        const result = await s.request('textDocument/hover', {
          textDocument: { uri: `file://${fp}` },
          position: { line, character },
        })
        return result as { contents: unknown } | null
      } catch { return null }
    },

    async definition(fp, line, character) {
      try {
        const result = await s.request('textDocument/definition', {
          textDocument: { uri: `file://${fp}` },
          position: { line, character },
        })
        if (!result) return null
        return Array.isArray(result) ? result as LspLocation[] : [result as LspLocation]
      } catch { return null }
    },

    async references(fp, line, character) {
      try {
        const result = await s.request('textDocument/references', {
          textDocument: { uri: `file://${fp}` },
          position: { line, character },
          context: { includeDeclaration: true },
        })
        if (!result) return null
        return result as LspLocation[]
      } catch { return null }
    },

    didOpen(fp, lang, content) {
      s.notify('textDocument/didOpen', {
        textDocument: { uri: `file://${fp}`, languageId: lang, version: 1, text: content },
      })
    },

    didClose(fp) {
      s.notify('textDocument/didClose', {
        textDocument: { uri: `file://${fp}` },
      })
      // Clean up listeners
      s.diagnosticListeners.delete(fp)
      s.release()
    },

    onDiagnostics(fp, cb) {
      if (!s.diagnosticListeners.has(fp)) {
        s.diagnosticListeners.set(fp, new Set())
      }
      s.diagnosticListeners.get(fp)!.add(cb)
    },

    destroy() {
      s.release()
    },
  }
}
