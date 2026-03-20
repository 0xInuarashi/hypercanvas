<script lang="ts">
  import { createCanvasControls } from '../lib/canvasControls.svelte'
  import {
    cs,
    moveNode, resizeNode, addLink, deleteNode, deleteLink,
    updateNodeLabel, updateNodeScript, toggleNodeActive, replaceNode,
    addNode, setViewportActions, cancelPendingDestroys, clearActiveTool,
  } from '../lib/canvasState.svelte'
  import { getNodeSizes } from '../lib/settingsState.svelte'
  import { pushUndo } from '../lib/historyManager.svelte'
  import { captureSnapshot, type Snapshot } from '../lib/canvasState.svelte'
  import CanvasNode from './CanvasNode.svelte'
  import LinkLayer from './LinkLayer.svelte'
  import ContextMenu, { type ContextMenuState } from './ContextMenu.svelte'
  import EphemeralConsole from './EphemeralConsole.svelte'
  import WorkspaceTabs from './WorkspaceTabs.svelte'
  import { HTTP_URL, authHeaders, clipboardWrite } from '../config'
  import { stripAnsi } from '../lib/stripAnsi'
  import type { CanvasNode as CanvasNodeType, NodeType, PortSide } from '../types'
  import '../canvas/Canvas.css'

  interface PendingLink { fromNodeId: string; fromSide: PortSide; toX: number; toY: number }
  interface EphemeralState { id: string; command: string; output: string; done: boolean; exitCode?: number; x: number; y: number }

  let selectedNodeIds = $state(new Set<string>())
  let pendingLink = $state<PendingLink | null>(null)
  let isLinking = $state(false)
  let selectedLinkId = $state<string | null>(null)
  let contextMenu = $state<ContextMenuState | null>(null)
  let ephemeralConsoles = $state<EphemeralState[]>([])

  let linkingActive = false
  let linkFrom: { nodeId: string; side: PortSide } | null = null
  let dragSnapshot: Snapshot | null = null

  let worldEl: HTMLDivElement
  let previewEl: HTMLDivElement
  let selectionEl: HTMLDivElement

  function onSelectionComplete(bounds: { x: number; y: number; width: number; height: number }) {
    const ids = new Set<string>()
    for (const n of cs.nodes) {
      if (n.x + n.width > bounds.x && n.x < bounds.x + bounds.width && n.y + n.height > bounds.y && n.y < bounds.y + bounds.height) ids.add(n.id)
    }
    selectedNodeIds = ids; selectedLinkId = null
  }

  function onDrawComplete(bounds: { x: number; y: number; width: number; height: number }) {
    const type = cs.activeTool
    if (!type) return
    pushUndo('Draw node')
    addNode(type, bounds.x, bounds.y, bounds.width, bounds.height, {
      active: type === 'console' || type === 'browser',
    })
    clearActiveTool()
  }

  const controls = createCanvasControls({
    getActiveTool: () => cs.activeTool,
    onDrawComplete,
    onSelectionComplete,
  })

  $effect(() => {
    if (worldEl) controls.setWorldEl(worldEl)
    if (previewEl) controls.setPreviewEl(previewEl)
    if (selectionEl) controls.setSelectionEl(selectionEl)
  })

  $effect(() => {
    setViewportActions({ getViewport: controls.getViewport, setViewport: controls.setViewport })
  })

  // Cancel pending session destroys when nodes reappear (undo)
  $effect(() => { void cs.nodes; cancelPendingDestroys() })

  function onPortDragStart(nodeId: string, side: PortSide, e: PointerEvent) {
    e.stopPropagation(); e.preventDefault()
    linkingActive = true; linkFrom = { nodeId, side }; isLinking = true
    const worldPos = controls.screenToWorld(e.clientX, e.clientY)
    pendingLink = { fromNodeId: nodeId, fromSide: side, toX: worldPos.x, toY: worldPos.y }
  }

  // Link dragging
  $effect(() => {
    function onMove(e: PointerEvent) {
      if (!linkingActive) return
      const worldPos = controls.screenToWorld(e.clientX, e.clientY)
      pendingLink = pendingLink ? { ...pendingLink, toX: worldPos.x, toY: worldPos.y } : null
    }
    function onUp(e: PointerEvent) {
      if (!linkingActive || !linkFrom) return
      const worldPos = controls.screenToWorld(e.clientX, e.clientY)
      const target = cs.nodes.find((n) => n.id !== linkFrom!.nodeId && worldPos.x >= n.x && worldPos.x <= n.x + n.width && worldPos.y >= n.y && worldPos.y <= n.y + n.height)
      if (target) {
        const cx = target.x + target.width / 2, cy = target.y + target.height / 2
        const dx = worldPos.x - cx, dy = worldPos.y - cy
        const adx = Math.abs(dx) / target.width, ady = Math.abs(dy) / target.height
        const side: PortSide = adx > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top')
        pushUndo('Add link'); addLink(linkFrom!.nodeId, linkFrom!.side, target.id, side)
      }
      linkingActive = false; linkFrom = null; pendingLink = null; isLinking = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  })

  // Keyboard shortcuts
  $effect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (selectedNodeIds.size > 0) {
          const count = selectedNodeIds.size
          if (window.confirm(`Delete ${count} node${count > 1 ? 's' : ''}?`)) {
            pushUndo(`Delete ${count} node${count > 1 ? 's' : ''}`)
            for (const id of selectedNodeIds) deleteNode(id)
            selectedNodeIds = new Set()
          }
        } else if (selectedLinkId) {
          pushUndo('Delete link'); deleteLink(selectedLinkId); selectedLinkId = null
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Suppress browser context menu
  $effect(() => {
    // We use the viewport action for this; suppress is handled via oncontextmenu on the element
  })

  function onNodeSelect(nodeId: string) { selectedNodeIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]); selectedLinkId = null }

  function onNodeContextMenu(nodeId: string, e: MouseEvent) {
    const node = cs.nodes.find((n) => n.id === nodeId)
    const isActive = node?.active
    contextMenu = { x: e.clientX, y: e.clientY, targetType: 'node', targetId: nodeId, nodeType: node?.type, nodeActive: isActive, nodePersistent: node?.persistent, nodeShowEphemeral: node?.showEphemeral, nodeSessionId: node?.sessionId, nodeSatellitePassword: node?.satellitePassword }
    selectedNodeIds = new Set([nodeId]); selectedLinkId = null
  }

  function onLinkContextMenu(linkId: string, e: MouseEvent) { contextMenu = { x: e.clientX, y: e.clientY, targetType: 'link', targetId: linkId }; selectedLinkId = linkId }

  function handleDelete(type: 'node' | 'link', id: string) {
    pushUndo(type === 'node' ? 'Delete node' : 'Delete link')
    if (type === 'node') { deleteNode(id); selectedNodeIds = new Set() } else { deleteLink(id) }
    selectedLinkId = null
  }

  function handleSetCommand(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    const cmd = window.prompt('Set default command:', node?.label || '')
    if (cmd !== null) { pushUndo('Set command'); updateNodeLabel(id, cmd.trim()) }
  }

  function handleRestartConsole(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    if (!node) return
    if (node.sessionId) {
      fetch(`${HTTP_URL}/daemon/destroy`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId: node.sessionId }),
      }).catch(() => {})
    }
    replaceNode(id, { active: false, sessionId: undefined })
    setTimeout(() => toggleNodeActive(id, true), 50)
  }

  function handleToggleActive(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    if (node) { pushUndo('Toggle active'); toggleNodeActive(id, !node.active) }
  }

  function handleTogglePersistent(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    if (!node) return
    pushUndo('Toggle persistent')
    if (node.persistent) {
      if (node.sessionId) {
        fetch(`${HTTP_URL}/daemon/destroy`, {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ sessionId: node.sessionId }),
        }).catch(() => {})
      }
      replaceNode(id, { persistent: false, sessionId: undefined, active: false })
    } else {
      replaceNode(id, { persistent: true, active: false })
    }
  }

  function handleToggleEphemeral(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    if (node) replaceNode(id, { showEphemeral: node.showEphemeral === false ? true : false })
  }

  function handleShareSatellite(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    if (!node?.sessionId) return
    const buf = new Uint8Array(32)
    crypto.getRandomValues(buf)
    const password = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
    fetch(`${HTTP_URL}/satellite/enable`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId: node.sessionId, password }),
    }).then(res => {
      if (res.ok) {
        replaceNode(id, { satellitePassword: password })
        clipboardWrite(`${window.location.origin}/?satellite=${encodeURIComponent(node.sessionId!)}&password=${encodeURIComponent(password)}`)
      }
    }).catch(() => {})
  }

  function handleRevokeSatellite(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    if (!node?.sessionId) return
    fetch(`${HTTP_URL}/satellite/disable`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId: node.sessionId }),
    }).then(() => replaceNode(id, { satellitePassword: null })).catch(() => {})
  }

  function handleProgramMacro(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    const script = window.prompt('Enter macro script (bash):', node?.script || '')
    if (script !== null) { pushUndo('Program macro'); updateNodeScript(id, script) }
  }

  function handleRenameMacro(id: string) {
    const node = cs.nodes.find(n => n.id === id)
    const name = window.prompt('Rename macro:', node?.label || '')
    if (name !== null) { pushUndo('Rename macro'); updateNodeLabel(id, name.trim()) }
  }

  function handlePlaceTool(type: NodeType, worldX: number, worldY: number) {
    const size = getNodeSizes()[type]
    addNode(type, worldX, worldY, size.w, size.h)
  }

  function getGridPosition(n: number): { col: number; row: number } {
    let remaining = n; let phase = 0
    while (true) { const size = Math.floor(phase / 2) + 1; if (remaining < size) { if (phase === 0) return { col: 0, row: 0 }; if (phase % 2 === 1) return { col: (phase + 1) >> 1, row: remaining }; return { col: remaining, row: phase >> 1 } }; remaining -= size; phase++ }
  }

  function findSpawnPosition(sourceNode: CanvasNodeType) {
    const gap = 20; const baseX = sourceNode.x + sourceNode.width + gap
    for (let i = 0; i < 200; i++) { const pos = getGridPosition(i); const x = baseX + pos.col * (sourceNode.width + gap); const y = sourceNode.y + pos.row * (sourceNode.height + gap); const occupied = cs.nodes.some(n => n.id !== sourceNode.id && Math.abs(n.x - x) < sourceNode.width / 2 && Math.abs(n.y - y) < sourceNode.height / 2); if (!occupied) return { x, y } }
    return { x: baseX, y: sourceNode.y }
  }

  function handleDuplicateConsole(id: string) { const node = cs.nodes.find(n => n.id === id); if (!node) return; const { x, y } = findSpawnPosition(node); const newId = addNode('console', x, y, node.width, node.height, { label: node.label, active: true }); addLink(id, 'right', newId, 'left') }
  function handleSpawnConsole(id: string) { const node = cs.nodes.find(n => n.id === id); if (!node) return; const firstCmd = node.label ? node.label.split('&&')[0].trim() : ''; const { x, y } = findSpawnPosition(node); const newId = addNode('console', x, y, node.width, node.height, { label: firstCmd, active: true }); addLink(id, 'right', newId, 'left') }
  function handleSpawnTerminal(nodeId: string, command: string) { const node = cs.nodes.find(n => n.id === nodeId); if (!node) return; addNode('console', node.x + node.width + 30, node.y, 500, 300, { label: command, active: true }) }
  function handleOpenBrowser(nodeId: string, url: string) { const node = cs.nodes.find(n => n.id === nodeId); if (!node) return; const browserId = addNode('browser', node.x + node.width + 30, node.y, 700, 500, { label: url }); addLink(nodeId, 'right', browserId, 'left') }

  function handleBashStart(nodeId: string, command: string): string {
    const id = `eph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const node = cs.nodes.find(n => n.id === nodeId); if (!node) return id
    const running = ephemeralConsoles.filter(e => !e.done).length
    ephemeralConsoles = [...ephemeralConsoles, { id, command, output: '', done: false, x: node.x + node.width * 0.6, y: node.y - 40 + running * 60 }]
    return id
  }
  function handleBashOutput(id: string, chunk: string) { const clean = stripAnsi(chunk); ephemeralConsoles = ephemeralConsoles.map(e => e.id === id ? { ...e, output: e.output + clean } : e) }
  function handleBashDone(id: string, exitCode?: number) { ephemeralConsoles = ephemeralConsoles.map(e => e.id === id ? { ...e, done: true, exitCode } : e) }
  function removeEphemeral(id: string) { ephemeralConsoles = ephemeralConsoles.filter(e => e.id !== id) }

  function handleMoveNode(id: string, x: number, y: number) {
    if (selectedNodeIds.has(id) && selectedNodeIds.size > 1) {
      const node = cs.nodes.find(n => n.id === id); if (!node) return
      const dx = x - node.x; const dy = y - node.y
      for (const n of cs.nodes) { if (selectedNodeIds.has(n.id)) moveNode(n.id, n.x + dx, n.y + dy) }
    } else { moveNode(id, x, y) }
  }

  function onCanvasContextMenu(e: MouseEvent) {
    e.preventDefault()
    const el = e.target as HTMLElement
    if (el !== e.currentTarget && !el.classList.contains('canvas-world')) return
    const worldPos = controls.screenToWorld(e.clientX, e.clientY)
    contextMenu = { x: e.clientX, y: e.clientY, targetType: 'canvas', targetId: '', worldX: worldPos.x, worldY: worldPos.y }
  }

  function onViewportClick() { if (controls.justSelected.current) return; selectedNodeIds = new Set(); selectedLinkId = null }

  function onDragStartHandler() { dragSnapshot = captureSnapshot() }
  function onDragEndHandler(label: string) { if (dragSnapshot) { pushUndo(label, dragSnapshot); dragSnapshot = null } }


</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:controls.action
  class="canvas-viewport"
  class:tool-active={cs.activeTool}
  class:linking={isLinking}
  style:background-color={cs.bgColor}
  onclick={onViewportClick}
  oncontextmenu={onCanvasContextMenu}
>
  <div bind:this={worldEl} class="canvas-world">
    <LinkLayer links={cs.links} nodes={cs.nodes} {pendingLink} {selectedLinkId} onSelectLink={(id) => selectedLinkId = id} onContextMenu={onLinkContextMenu} />
    {#each cs.nodes as node (node.id)}
      <CanvasNode
        {node}
        selected={selectedNodeIds.has(node.id)}
        onSelect={onNodeSelect}
        onMove={handleMoveNode}
        onResize={resizeNode}
        onPortDragStart={onPortDragStart}
        onContextMenu={onNodeContextMenu}
        onUpdateLabel={updateNodeLabel}
        onReplaceNode={replaceNode}
        onSpawnTerminal={handleSpawnTerminal}
        onBashStart={handleBashStart}
        onBashOutput={handleBashOutput}
        onBashDone={handleBashDone}
        onToggleActive={toggleNodeActive}
        onOpenBrowser={handleOpenBrowser}
        onDragStart={onDragStartHandler}
        onDragEnd={onDragEndHandler}
      />
    {/each}
    {#each ephemeralConsoles as eph (eph.id)}
      <div style="position:absolute;left:{eph.x}px;top:{eph.y}px;z-index:1000;">
        <EphemeralConsole command={eph.command} output={eph.output} done={eph.done} exitCode={eph.exitCode} onRemove={() => removeEphemeral(eph.id)} />
      </div>
    {/each}
    <div bind:this={previewEl} class="draw-preview" style="display:none;"></div>
    <div bind:this={selectionEl} style="display:none;position:absolute;border:1px dashed #7c8fff;background:rgba(124,143,255,0.08);border-radius:2px;pointer-events:none;"></div>
  </div>

  {#if contextMenu}
    <ContextMenu menu={contextMenu} onDelete={handleDelete} onSetCommand={handleSetCommand} onToggleActive={handleToggleActive} onRestartConsole={handleRestartConsole} onDuplicateConsole={handleDuplicateConsole} onSpawnConsole={handleSpawnConsole} onTogglePersistent={handleTogglePersistent} onProgramMacro={handleProgramMacro} onRenameMacro={handleRenameMacro} onToggleEphemeral={handleToggleEphemeral} onShareSatellite={handleShareSatellite} onRevokeSatellite={handleRevokeSatellite} onPlaceTool={handlePlaceTool} onClose={() => contextMenu = null} />
  {/if}

  <!-- Bottom-right toolbar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div style="position:absolute;bottom:16px;right:16px;display:flex;gap:8px;z-index:10;align-items:center;">
    <WorkspaceTabs />
    <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:#161616;border:1px solid #2a2a2a;border-radius:8px;font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;color:#888;user-select:none;" onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()}>
      <button onclick={() => controls.setScale(controls.scaleValue / 1.25)} style="background:none;border:none;color:#aaa;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;">−</button>
      <input type="range" min="0.1" max="5" step="0.01" value={controls.scaleValue} oninput={(e) => controls.setScale(parseFloat((e.target as HTMLInputElement).value))} style="width:100px;accent-color:#5a5a8a;cursor:pointer;" />
      <button onclick={() => controls.setScale(controls.scaleValue * 1.25)} style="background:none;border:none;color:#aaa;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;">+</button>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <span style="min-width:36px;text-align:right;color:#aaa;cursor:pointer;" onclick={() => controls.setScale(1)} title="Reset to 100%">{Math.round(controls.scaleValue * 100)}%</span>
      <button onclick={controls.resetView} title="Reset to origin" style="background:none;border:1px solid #2a2a2a;border-radius:4px;color:#aaa;font-size:11px;cursor:pointer;padding:2px 6px;line-height:1;margin-left:4px;">⌂</button>
    </div>
  </div>
</div>
