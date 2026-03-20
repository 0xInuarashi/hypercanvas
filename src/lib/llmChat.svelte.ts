import { streamChatCompletion, AuthError } from '../services/openrouter'
import type { ChatMessage, ToolCall, ToolDefinition } from '../services/openrouter'
import { HTTP_URL, authHeaders } from '../config'

const API_KEY_STORAGE = 'openrouter-api-key'

export interface StreamRoundCallbacks {
  onReasoning: (delta: string) => void
  onContent: (delta: string) => void
  onToolCall: (tc: ToolCall, args: Record<string, unknown>, signal: AbortSignal) => Promise<{ result: string; stop?: boolean }>
  onNextRound: () => void
}

export class LLMChat {
  apiKey = $state<string | null>(localStorage.getItem(API_KEY_STORAGE))
  keyInput = $state('')
  isLoading = $state(false)
  error = $state<string | null>(null)
  fileTree = $state<string | null>(null)
  private abortController: AbortController | null = null

  constructor() {
    // Fetch file tree on creation
    fetch(`${HTTP_URL}/tree`, { headers: authHeaders() })
      .then((r) => r.ok ? r.text() : null)
      .then((t) => { this.fileTree = t })
      .catch((err) => console.warn('failed to fetch file tree:', err))
  }

  saveKey() {
    const trimmed = this.keyInput.trim()
    if (!trimmed) return
    localStorage.setItem(API_KEY_STORAGE, trimmed)
    this.apiKey = trimmed
    this.keyInput = ''
    this.error = null
  }

  stop() {
    this.abortController?.abort()
  }

  clearApiKey() {
    localStorage.removeItem(API_KEY_STORAGE)
    this.apiKey = null
  }

  destroy() {
    this.abortController?.abort()
  }

  async runStreamLoop(
    systemPrompt: ChatMessage,
    initialHistory: ChatMessage[],
    tools: ToolDefinition[],
    maxRounds: number,
    callbacks: StreamRoundCallbacks,
  ): Promise<ChatMessage[]> {
    if (!this.apiKey) throw new Error('No API key')

    this.isLoading = true
    this.error = null

    const controller = new AbortController()
    this.abortController = controller
    const runningHistory = [...initialHistory]

    try {
      let rounds = 0
      while (rounds < maxRounds) {
        rounds++
        let streamedReasoning = ''
        let streamedContent = ''

        const reply = await streamChatCompletion(
          [systemPrompt, ...runningHistory],
          tools,
          this.apiKey,
          {
            onReasoning(delta) {
              streamedReasoning += delta
              callbacks.onReasoning(streamedReasoning)
            },
            onContent(delta) {
              streamedContent += delta
              callbacks.onContent(streamedContent)
            },
            onToolCall() {},
          },
          controller.signal,
        )

        runningHistory.push({
          role: 'assistant',
          content: reply.content,
          tool_calls: reply.tool_calls,
        })

        if (!reply.tool_calls?.length) break

        let stopped = false
        for (const tc of reply.tool_calls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments) } catch { /* skip */ }

          const { result, stop } = await callbacks.onToolCall(tc, args, controller.signal)
          runningHistory.push({ role: 'tool', content: result, tool_call_id: tc.id })
          if (stop) { stopped = true; break }
        }

        if (stopped) break
        callbacks.onNextRound()
      }

      return runningHistory
    } catch (err) {
      if (controller.signal.aborted) throw err
      if (err instanceof AuthError) {
        this.clearApiKey()
        this.error = 'Invalid API key — please re-enter.'
      } else {
        this.error = err instanceof Error ? err.message : 'Something went wrong'
      }
      throw err
    } finally {
      this.isLoading = false
      this.abortController = null
    }
  }
}
