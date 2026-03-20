const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_PRIMARY_MODEL = 'stepfun/step-3.5-flash:free'
const DEFAULT_FALLBACK_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'

export function getPrimaryModel(): string {
  return localStorage.getItem('openrouter-primary-model') || DEFAULT_PRIMARY_MODEL
}

export function getFallbackModel(): string {
  return localStorage.getItem('openrouter-fallback-model') || DEFAULT_FALLBACK_MODEL
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  reasoning?: string | null
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface StreamCallbacks {
  onReasoning: (delta: string) => void
  onContent: (delta: string) => void
  onToolCall: (toolCall: ToolCall) => void
}

async function streamApi(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  model: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'hypercanvas',
    },
    body: JSON.stringify({ model, messages, tools, stream: true }),
    signal,
  })

  if (res.status === 401 || res.status === 403) {
    throw new AuthError('Invalid API key')
  }
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}`, res.status)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new ApiError('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullReasoning = ''
  const toolCalls: Record<number, { id: string; type: 'function'; function: { name: string; arguments: string } }> = {}

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const payload = trimmed.slice(6)
      if (payload === '[DONE]') continue

      try {
        const chunk = JSON.parse(payload)

        // Check for error in stream
        if (chunk.error) {
          throw new ApiError(chunk.error.message, chunk.error.code)
        }

        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        // Reasoning
        const reasoning = delta.reasoning ?? delta.reasoning_content ?? null
        if (reasoning) {
          fullReasoning += reasoning
          callbacks.onReasoning(reasoning)
        }

        // Content
        if (delta.content) {
          fullContent += delta.content
          callbacks.onContent(delta.content)
        }

        // Tool calls (accumulated across chunks)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (tc.id) {
              toolCalls[idx] = { id: tc.id, type: 'function', function: { name: tc.function?.name || '', arguments: '' } }
            }
            if (tc.function?.name && toolCalls[idx]) {
              toolCalls[idx].function.name = tc.function.name
            }
            if (tc.function?.arguments && toolCalls[idx]) {
              toolCalls[idx].function.arguments += tc.function.arguments
            }
          }
        }
      } catch (e) {
        if (e instanceof ApiError) throw e
        // skip malformed chunk
      }
    }
  }

  const assembled: ChatMessage = {
    role: 'assistant',
    content: fullContent || null,
    reasoning: fullReasoning || null,
  }

  const tcList = Object.values(toolCalls)
  if (tcList.length > 0) {
    assembled.tool_calls = tcList
    for (const tc of tcList) callbacks.onToolCall(tc)
  }

  return assembled
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  try {
    return await streamApi(messages, tools, apiKey, getPrimaryModel(), callbacks, signal)
  } catch (err) {
    if (err instanceof AuthError) throw err
    if (signal?.aborted) throw err
    return await streamApi(messages, tools, apiKey, getFallbackModel(), callbacks, signal)
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export class ApiError extends Error {
  code?: number
  constructor(message: string, code?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}
