import { captureSnapshot, restoreSnapshot, type Snapshot } from './canvasState.svelte'

interface HistoryEntry { label: string; snapshot: Snapshot }
const MAX_HISTORY = 100

export const history = $state({
  undoStack: [] as HistoryEntry[],
  redoStack: [] as HistoryEntry[],
})

export function canUndo() { return history.undoStack.length > 0 }
export function canRedo() { return history.redoStack.length > 0 }
export function getUndoLabels() { return history.undoStack.map((e) => e.label) }
export function getRedoLabels() { return [...history.redoStack.map((e) => e.label)].reverse() }

export function pushUndo(label: string, preSnapshot?: Snapshot) {
  const snap = preSnapshot ?? captureSnapshot()
  history.undoStack = [...history.undoStack, { label, snapshot: snap }]
  if (history.undoStack.length > MAX_HISTORY) history.undoStack = history.undoStack.slice(1)
  history.redoStack = []
}

export function undo() {
  if (history.undoStack.length === 0) return
  const entry = history.undoStack[history.undoStack.length - 1]
  history.undoStack = history.undoStack.slice(0, -1)
  history.redoStack = [...history.redoStack, { label: entry.label, snapshot: captureSnapshot() }]
  restoreSnapshot(entry.snapshot)
}

export function redo() {
  if (history.redoStack.length === 0) return
  const entry = history.redoStack[history.redoStack.length - 1]
  history.redoStack = history.redoStack.slice(0, -1)
  history.undoStack = [...history.undoStack, { label: entry.label, snapshot: captureSnapshot() }]
  restoreSnapshot(entry.snapshot)
}
