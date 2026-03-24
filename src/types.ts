export type NodeType = 'console' | 'macro' | 'memo' | 'files' | 'genie' | 'sketchpad' | 'browser' | 'reader' | 'autoflow'

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
  persistent?: boolean
  sessionId?: string
  showEphemeral?: boolean
  satellitePassword?: string | null
  filePath?: string
  scrollLine?: number
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

export type SnapSlots = Partial<Record<number, ViewportState>>

export interface WorkspaceData {
  id: number
  name: string
  nodes: CanvasNode[]
  links: Link[]
  bgColor: string
  viewport: ViewportState
  snaps?: SnapSlots
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
