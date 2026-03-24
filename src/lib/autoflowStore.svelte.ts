export type FlowNodeType = 'prompt' | 'execute' | 'eval'

export interface FlowNode {
  id: string
  type: FlowNodeType
  x: number
  y: number
  width: number
  height: number
  config: { text: string }
}

export interface FlowLink {
  id: string
  from: string
  to: string
}

export interface FlowGraph {
  nodes: FlowNode[]
  links: FlowLink[]
  nextId: number
}

export type FlowNodeStatus = 'idle' | 'running' | 'done' | 'error'

export interface AutoflowLogEntry {
  content: string
  timestamp: number
}

export class AutoflowState {
  isRunning = $state(false)
  nodeStatuses = $state<Record<string, FlowNodeStatus>>({})
  logs = $state<AutoflowLogEntry[]>([])
  error = $state<string | null>(null)
}

const stores = new Map<string, AutoflowState>()
const aborts = new Map<string, AbortController>()

export function getAutoflow(nodeId: string): AutoflowState {
  let s = stores.get(nodeId)
  if (!s) { s = new AutoflowState(); stores.set(nodeId, s) }
  return s
}

export function getAutoflowAbort(nodeId: string): AbortController | undefined {
  return aborts.get(nodeId)
}

export function setAutoflowAbort(nodeId: string, controller: AbortController) {
  aborts.set(nodeId, controller)
}

export function deleteAutoflowAbort(nodeId: string) {
  aborts.delete(nodeId)
}

export function parseGraph(label: string): FlowGraph {
  try {
    const g = JSON.parse(label)
    return { nodes: g.nodes ?? [], links: g.links ?? [], nextId: g.nextId ?? 1 }
  } catch { return { nodes: [], links: [], nextId: 1 } }
}
