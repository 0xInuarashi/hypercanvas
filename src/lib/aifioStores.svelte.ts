import type { ChatMessage } from '../services/openrouter'

export interface AifioDisplayMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string | null
}

export class AifioState {
  messages = $state<AifioDisplayMessage[]>([])
  chatHistory = $state<ChatMessage[]>([])
  isRunning = $state(false)
  error = $state<string | null>(null)
}

const stores = new Map<string, AifioState>()
const aborts = new Map<string, AbortController>()

export function getAifio(nodeId: string): AifioState {
  let s = stores.get(nodeId)
  if (!s) {
    s = new AifioState()
    stores.set(nodeId, s)
  }
  return s
}

export function getAifioAbort(nodeId: string): AbortController | undefined {
  return aborts.get(nodeId)
}

export function setAifioAbort(nodeId: string, controller: AbortController) {
  aborts.set(nodeId, controller)
}

export function deleteAifioAbort(nodeId: string) {
  aborts.delete(nodeId)
}
