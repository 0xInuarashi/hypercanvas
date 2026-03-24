<script lang="ts">
  import Canvas from './Canvas.svelte'
  import Sidebar from './Sidebar.svelte'
  import HistoryPanel from './HistoryPanel.svelte'
  import SettingsPanel from './SettingsPanel.svelte'
  import ScriptApprovalModal from './ScriptApprovalModal.svelte'
  import { cs, persistState, addNode, setNodeSizesGetter, saveSnap, recallSnap, fullscreenState, initCloud } from '../lib/canvasState.svelte'
  import { undo, redo } from '../lib/historyManager.svelte'
  import { ss, setShowSettings, getNodeSizes } from '../lib/settingsState.svelte'
  import { parseUrlScript } from '../lib/urlScript'
  import type { ScriptedNode } from '../types'

  // Register node sizes getter for addNode
  setNodeSizesGetter(() => getNodeSizes())

  // Check server for cloud canvas on startup
  let cloudLoading = $state(true)
  initCloud().finally(() => { cloudLoading = false })

  // URL scripting
  const pendingScriptInitial = parseUrlScript()
  let pendingScript = $state<ScriptedNode[] | null>(pendingScriptInitial)

  function onApproveScript() {
    if (!pendingScript) return
    pendingScript.forEach((desc, i) => {
      const x = 100 + i * 540
      addNode('console', x, 100, undefined, undefined, {
        label: desc.cmd ?? desc.label ?? '',
      })
    })
    pendingScript = null
  }

  // Ctrl+Z / Ctrl+Y
  $effect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      const digitMatch = e.code.match(/^Digit(\d)$/)
      if (digitMatch && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const slot = parseInt(digitMatch[1])
        if (e.shiftKey) saveSnap(slot)
        else recallSnap(slot)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Auto-persist (localStorage or cloud)
  $effect(() => {
    void cs.nodes; void cs.links; void cs.bgColor; void cs.workspaces; void cs.activeWorkspaceId; void cs.nextWorkspaceId
    if (!cloudLoading) persistState()
  })
</script>

{#if pendingScript}
  <ScriptApprovalModal
    nodes={pendingScript}
    onApprove={onApproveScript}
    onDeny={() => pendingScript = null}
  />
{/if}

<Canvas />

{#if !fullscreenState.active}<Sidebar />{/if}

<div style="position:absolute;bottom:16px;left:16px;display:{fullscreenState.active ? 'none' : 'flex'};gap:8px;align-items:flex-end;z-index:10;">
  <button
    onclick={() => setShowSettings(true)}
    title="Settings"
    style="background:#161616;border:1px solid #2a2a2a;border-radius:8px;color:#777;font-size:14px;cursor:pointer;padding:4px 8px;font-family:'JetBrains Mono','Fira Code',monospace;line-height:1;"
  >&#9881;</button>
  <HistoryPanel />
</div>

{#if ss.showSettings}
  <SettingsPanel />
{/if}
