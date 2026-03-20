import type { ScriptedNode } from '../types'

export function parseUrlScript(): ScriptedNode[] | null {
  const params = new URLSearchParams(window.location.search)
  let nodes: ScriptedNode[] | null = null

  // Format 1: ?script=<base64 JSON>
  const scriptB64 = params.get('script')
  if (scriptB64) {
    try {
      const decoded = JSON.parse(atob(scriptB64))
      if (Array.isArray(decoded.nodes) && decoded.nodes.length > 0) {
        nodes = decoded.nodes.filter(
          (n: Record<string, unknown>) => n.type === 'console' && (n.cmd || n.label),
        ) as ScriptedNode[]
        if (nodes.length === 0) nodes = null
      }
    } catch { /* ignore malformed */ }
  }

  // Format 2: ?spawn=console&cmd=...&label=...
  if (!nodes && params.get('spawn') === 'console') {
    const cmd = params.get('cmd') ?? undefined
    const label = params.get('label') ?? undefined
    if (cmd || label) {
      nodes = [{ type: 'console', cmd, label }]
    }
  }

  // Clean URL (synchronous, before any render)
  if (nodes && nodes.length > 0) {
    const clean = window.location.pathname + window.location.hash
    history.replaceState(null, '', clean)
    return nodes
  }

  return null
}
