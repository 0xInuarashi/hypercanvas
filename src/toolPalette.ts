import type { NodeType } from './types'

export const TOOL_PALETTE: { type: NodeType; label: string; icon: string }[] = [
  { type: 'console', label: 'Console', icon: '⎚' },
  { type: 'macro', label: 'Macro', icon: '▸' },
{ type: 'memo', label: 'Memo', icon: '✎' },
  { type: 'files', label: 'Files', icon: '☰' },
  { type: 'genie', label: 'Genie', icon: '⚗' },
  { type: 'sketchpad', label: 'Sketchpad', icon: '✿' },
  { type: 'browser', label: 'Browser', icon: '⊞' },
]
