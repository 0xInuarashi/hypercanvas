export type NodeType = 'console' | 'macro' | 'aifio' | 'daemon' | 'memo' | 'files' | 'genie' | 'sketchpad' | 'browser'

export interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  width: number
  height: number
  label: string
  active?: boolean
  script?: string
  command?: string
  persistent?: boolean
  sessionId?: string
  daemonStatus?: 'running' | 'stopped' | 'error' | 'disconnected'
  showEphemeral?: boolean
  satellitePassword?: string | null
}

export interface Link {
  id: string
  fromNodeId: string
  fromSide: PortSide
  toNodeId: string
  toSide: PortSide
}

export type PortSide = 'top' | 'right' | 'bottom' | 'left'

export interface ViewportState {
  offsetX: number
  offsetY: number
  scale: number
}

export interface WorkspaceData {
  id: number
  name: string
  nodes: CanvasNode[]
  links: Link[]
  bgColor: string
  viewport: ViewportState
}

export interface WorkspacesState {
  version: 2
  activeWorkspaceId: number
  nextWorkspaceId: number
  nextId: number
  nextLinkId: number
  workspaces: WorkspaceData[]
}

export interface ScriptedNode {
  type: 'console'
  cmd?: string
  label?: string
}
