import { HTTP_URL, authHeaders } from '../config'
import type { CanvasNode, Link, NodeType, PortSide, ViewportState, WorkspaceData, WorkspacesState } from '../types'

export const DEFAULT_SIZES: Record<NodeType, { w: number; h: number }> = {
  console: { w: 600, h: 400 },
  macro: { w: 180, h: 60 },
memo: { w: 300, h: 250 },
  files: { w: 300, h: 400 },
  genie: { w: 450, h: 550 },
  sketchpad: { w: 500, h: 400 },
  browser: { w: 700, h: 500 },
}

const STORAGE_KEY = 'hypercanvas'

export function stripRuntimeState(node: CanvasNode): CanvasNode {
  const { active, satellitePassword: _, ...rest } = node
  const shouldActivate = node.type === 'console' && node.sessionId
  return { ...rest, active: shouldActivate ? true : false }
}

function loadState(): WorkspacesState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed.version) {
      const oldNodes: CanvasNode[] = (parsed.nodes || []).map(stripRuntimeState)
      const oldLinks: Link[] = parsed.links || []
      return { version: 2, activeWorkspaceId: 1, nextWorkspaceId: 2, nextId: parsed.nextId ?? 0, nextLinkId: parsed.nextLinkId ?? 0,
        workspaces: [{ id: 1, name: '1', nodes: oldNodes, links: oldLinks, bgColor: parsed.bgColor ?? '#0a0a0a', viewport: { offsetX: 0, offsetY: 0, scale: 1 } }] }
    }
    return parsed as WorkspacesState
  } catch (err) { console.warn('failed to load saved state:', err); return null }
}

function saveState(state: WorkspacesState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

const saved = loadState()
const activeWs = saved?.workspaces.find((w) => w.id === saved.activeWorkspaceId) ?? saved?.workspaces[0]
const initialWorkspaces: WorkspaceData[] = saved
  ? saved.workspaces
  : [{ id: 1, name: '1', nodes: [], links: [], bgColor: '#0a0a0a', viewport: { offsetX: 0, offsetY: 0, scale: 1 } }]

// --- State object (exported as single $state to allow property reassignment) ---

export const cs = $state({
  nodes: (activeWs?.nodes.map(stripRuntimeState) ?? []) as CanvasNode[],
  links: (activeWs?.links ?? []) as Link[],
  bgColor: activeWs?.bgColor ?? '#0a0a0a',
  activeTool: null as NodeType | null,
  workspaces: initialWorkspaces,
  activeWorkspaceId: saved?.activeWorkspaceId ?? 1,
  nextWorkspaceId: saved?.nextWorkspaceId ?? 2,
})

let nextId = saved?.nextId ?? 0
let nextLinkId = saved?.nextLinkId ?? 0

export let viewportActions: { getViewport: () => ViewportState; setViewport: (v: ViewportState) => void } | null = null
export function setViewportActions(actions: typeof viewportActions) { viewportActions = actions }

const pendingDestroys = new Map<string, ReturnType<typeof setTimeout>>()

let _nodeSizesGetter: (() => Record<NodeType, { w: number; h: number }>) | null = null
export function setNodeSizesGetter(getter: () => Record<NodeType, { w: number; h: number }>) { _nodeSizesGetter = getter }
function getNodeSizes(): Record<NodeType, { w: number; h: number }> { return _nodeSizesGetter ? _nodeSizesGetter() : DEFAULT_SIZES }

// --- Mutations ---

export function selectTool(type: NodeType) { cs.activeTool = cs.activeTool === type ? null : type }
export function clearActiveTool() { cs.activeTool = null }

export function addNode(type: NodeType, x: number, y: number, w?: number, h?: number, initialProps?: Partial<CanvasNode>): string {
  const sizes = getNodeSizes(); const size = sizes[type]
  const width = w ?? size.w; const height = h ?? size.h
  const id = String(nextId++)
  const node: CanvasNode = { id, type, x: w != null ? x : x - size.w / 2, y: h != null ? y : y - size.h / 2, width, height, label: '', active: type === 'console' || type === 'browser', ...initialProps }
  cs.nodes = [...cs.nodes, node]
  return id
}

// Fullscreen state — shared across components
let fullscreen = $state(false)
export const fullscreenState = { get active() { return fullscreen }, set active(v: boolean) { fullscreen = v } }

export function moveNode(id: string, x: number, y: number) { cs.nodes = cs.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }
export function resizeNode(id: string, x: number, y: number, width: number, height: number) { cs.nodes = cs.nodes.map((n) => (n.id === id ? { ...n, x, y, width, height } : n)) }

export function deleteNode(id: string) {
  const node = cs.nodes.find((n) => n.id === id)
  if (node?.sessionId && node.type === 'console') {
    if (node.type === 'console' && node.persistent) {
      const sessionId = node.sessionId
      const timer = setTimeout(() => { pendingDestroys.delete(sessionId); fetch(`${HTTP_URL}/daemon/destroy`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ sessionId }) }).catch((err) => console.warn('daemon destroy failed:', err)) }, 5000)
      pendingDestroys.set(sessionId, timer)
    } else {
      fetch(`${HTTP_URL}/daemon/destroy`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ sessionId: node.sessionId }) }).catch((err) => console.warn('daemon destroy failed:', err))
    }
  }
  cs.nodes = cs.nodes.filter((n) => n.id !== id)
  cs.links = cs.links.filter((l) => l.fromNodeId !== id && l.toNodeId !== id)
}

export function cancelPendingDestroys() {
  for (const [sessionId, timer] of pendingDestroys) {
    if (cs.nodes.some((n) => n.sessionId === sessionId)) { clearTimeout(timer); pendingDestroys.delete(sessionId) }
  }
}

export function addLink(fromNodeId: string, fromSide: PortSide, toNodeId: string, toSide: PortSide) {
  if (cs.links.some((l) => l.fromNodeId === fromNodeId && l.fromSide === fromSide && l.toNodeId === toNodeId && l.toSide === toSide)) return
  cs.links = [...cs.links, { id: String(nextLinkId++), fromNodeId, fromSide, toNodeId, toSide }]
}

export function deleteLink(id: string) { cs.links = cs.links.filter((l) => l.id !== id) }
export function updateNodeLabel(id: string, label: string) { cs.nodes = cs.nodes.map((n) => (n.id === id ? { ...n, label } : n)) }
export function updateNodeScript(id: string, script: string) { cs.nodes = cs.nodes.map((n) => (n.id === id ? { ...n, script } : n)) }
export function replaceNode(id: string, newProps: Partial<CanvasNode>) { cs.nodes = cs.nodes.map((n) => (n.id === id ? { ...n, ...newProps } : n)) }
export function toggleNodeActive(id: string, active: boolean) {
  if (!active) {
    const node = cs.nodes.find((n) => n.id === id)
    if (node?.type === 'console' && node.sessionId) {
      fetch(`${HTTP_URL}/daemon/destroy`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ sessionId: node.sessionId }) }).catch((err) => console.warn('daemon destroy failed:', err))
      cs.nodes = cs.nodes.map((n) => (n.id === id ? { ...n, active, sessionId: undefined } : n))
      return
    }
  }
  cs.nodes = cs.nodes.map((n) => (n.id === id ? { ...n, active } : n))
}
export function changeBgColor(color: string) { cs.bgColor = color }

// --- Workspaces ---

function freezeCurrentWorkspace(): WorkspaceData[] {
  const viewport = viewportActions?.getViewport() ?? { offsetX: 0, offsetY: 0, scale: 1 }
  const existing = cs.workspaces.find((w) => w.id === cs.activeWorkspaceId)
  const currentSnapshot: WorkspaceData = { id: cs.activeWorkspaceId, name: existing?.name ?? String(cs.activeWorkspaceId), nodes: cs.nodes, links: cs.links, bgColor: cs.bgColor, viewport, snaps: existing?.snaps }
  return cs.workspaces.map((w) => w.id === cs.activeWorkspaceId ? currentSnapshot : w)
}

export function switchWorkspace(targetId: number) {
  if (targetId === cs.activeWorkspaceId) return
  const updatedWorkspaces = freezeCurrentWorkspace()
  const target = updatedWorkspaces.find((w) => w.id === targetId); if (!target) return
  cs.workspaces = updatedWorkspaces; cs.activeWorkspaceId = targetId
  cs.nodes = target.nodes; cs.links = target.links; cs.bgColor = target.bgColor
  viewportActions?.setViewport(target.viewport)
}

export function createWorkspace() {
  const updatedWorkspaces = freezeCurrentWorkspace()
  const newId = cs.nextWorkspaceId
  cs.workspaces = [...updatedWorkspaces, { id: newId, name: String(updatedWorkspaces.length + 1), nodes: [], links: [], bgColor: '#0a0a0a', viewport: { offsetX: 0, offsetY: 0, scale: 1 } }]
  cs.nextWorkspaceId = newId + 1; cs.activeWorkspaceId = newId
  cs.nodes = []; cs.links = []; cs.bgColor = '#0a0a0a'
  viewportActions?.setViewport({ offsetX: 0, offsetY: 0, scale: 1 })
}

export function deleteWorkspace(id: number) {
  if (cs.workspaces.length <= 1) return
  const remaining = cs.workspaces.filter((w) => w.id !== id).map((w, i) => ({ ...w, name: String(i + 1) }))
  cs.workspaces = remaining
  if (id === cs.activeWorkspaceId) {
    const target = remaining[0]; cs.activeWorkspaceId = target.id
    cs.nodes = target.nodes; cs.links = target.links; cs.bgColor = target.bgColor
    viewportActions?.setViewport(target.viewport)
  }
}

// --- Snapshot ---

export interface Snapshot {
  nodes: CanvasNode[]; links: Link[]; bgColor: string; nextId: number; nextLinkId: number
  activeWorkspaceId?: number; workspaces?: WorkspaceData[]; viewport?: ViewportState; nextWorkspaceId?: number
}

export function captureSnapshot(): Snapshot {
  return { nodes: cs.nodes, links: cs.links, bgColor: cs.bgColor, nextId, nextLinkId, activeWorkspaceId: cs.activeWorkspaceId, workspaces: cs.workspaces, viewport: viewportActions?.getViewport(), nextWorkspaceId: cs.nextWorkspaceId }
}

export function restoreSnapshot(s: Snapshot) {
  cs.nodes = s.nodes; cs.links = s.links; cs.bgColor = s.bgColor; nextId = s.nextId; nextLinkId = s.nextLinkId
  if (s.workspaces !== undefined) { cs.workspaces = s.workspaces; cs.activeWorkspaceId = s.activeWorkspaceId!; if (s.nextWorkspaceId !== undefined) cs.nextWorkspaceId = s.nextWorkspaceId }
  if (s.viewport && viewportActions) viewportActions.setViewport(s.viewport)
}

// --- Snaps (viewport bookmarks) ---

export function saveSnap(slot: number) {
  if (!viewportActions) return
  const ws = cs.workspaces.find((w) => w.id === cs.activeWorkspaceId)
  if (!ws) return
  const snaps = { ...ws.snaps, [slot]: viewportActions.getViewport() }
  cs.workspaces = cs.workspaces.map((w) => w.id === cs.activeWorkspaceId ? { ...w, snaps } : w)
}

export function recallSnap(slot: number) {
  const snap = cs.workspaces.find((w) => w.id === cs.activeWorkspaceId)?.snaps?.[slot]
  if (snap && viewportActions) viewportActions.setViewport(snap)
}

export function deleteSnap(slot: number) {
  const ws = cs.workspaces.find((w) => w.id === cs.activeWorkspaceId)
  if (!ws?.snaps) return
  const { [slot]: _, ...rest } = ws.snaps
  const snaps = Object.keys(rest).length > 0 ? rest : undefined
  cs.workspaces = cs.workspaces.map((w) => w.id === cs.activeWorkspaceId ? { ...w, snaps } : w)
}

// --- Persist ---

export function persistState() {
  const viewport = viewportActions?.getViewport() ?? { offsetX: 0, offsetY: 0, scale: 1 }
  const existingWs = cs.workspaces.find((w) => w.id === cs.activeWorkspaceId)
  const currentWs: WorkspaceData = { id: cs.activeWorkspaceId, name: existingWs?.name ?? String(cs.activeWorkspaceId), nodes: cs.nodes.map(stripRuntimeState), links: cs.links, bgColor: cs.bgColor, viewport, snaps: existingWs?.snaps }
  const allWorkspaces = cs.workspaces.map((w) => w.id === cs.activeWorkspaceId ? currentWs : w)
  saveState({ version: 2, activeWorkspaceId: cs.activeWorkspaceId, nextWorkspaceId: cs.nextWorkspaceId, nextId, nextLinkId, workspaces: allWorkspaces })
}
