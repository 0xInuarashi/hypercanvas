import type { ChatMessage } from '../services/openrouter'

interface ToolResultMsg {
  kind: 'tool'
  label: string
  result: string
}

interface TextMsg {
  kind: 'text'
  role: 'user' | 'assistant'
  content: string
  reasoning?: string | null
}

export type GenieDisplayMessage = TextMsg | ToolResultMsg

export class GenieState {
  messages = $state<GenieDisplayMessage[]>([])
  chatHistory = $state<ChatMessage[]>([])
  isRunning = $state(false)
  error = $state<string | null>(null)
}

const stores = new Map<string, GenieState>()
const aborts = new Map<string, AbortController>()

export function getGenie(nodeId: string): GenieState {
  let s = stores.get(nodeId)
  if (!s) {
    s = new GenieState()
    stores.set(nodeId, s)
  }
  return s
}

export function getGenieAbort(nodeId: string): AbortController | undefined {
  return aborts.get(nodeId)
}

export function setGenieAbort(nodeId: string, controller: AbortController) {
  aborts.set(nodeId, controller)
}

export function deleteGenieAbort(nodeId: string) {
  aborts.delete(nodeId)
}
