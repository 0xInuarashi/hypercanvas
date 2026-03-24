<script lang="ts">
  import { onDestroy } from 'svelte'
  import WidgetHeader from '../components/WidgetHeader.svelte'
  import { getAutoflow, getAutoflowAbort, setAutoflowAbort, deleteAutoflowAbort, parseGraph, type FlowGraph, type FlowNode, type FlowLink, type FlowNodeType } from '../lib/autoflowStore.svelte'
  import { executeFlow } from '../lib/autoflowEngine'
  import { LLMChat } from '../lib/llmChat.svelte'

  let { nodeId, label, onUpdateLabel }: {
    nodeId: string
    label: string
    onUpdateLabel: (label: string) => void
  } = $props()

  const af = getAutoflow(nodeId)
  const llm = new LLMChat()
  let graph = $state<FlowGraph>(parseGraph(label))
  let selectedNodeId = $state<string | null>(null)
  let pendingLinkFrom = $state<string | null>(null)
  let cursorX = $state(0)
  let cursorY = $state(0)
  let draggingId = $state<string | null>(null)
  let dragStart = { x: 0, y: 0, nx: 0, ny: 0 }
  let canvasEl: HTMLDivElement
  let logEl: HTMLDivElement
  let logHeight = $state(140)
  let resizingLog = false
  let resizeStartY = 0
  let resizeStartH = 0

  onDestroy(() => llm.destroy())

  function save() { onUpdateLabel(JSON.stringify(graph)) }

  $effect(() => { void af.logs; if (logEl) logEl.scrollTop = logEl.scrollHeight })

  // --- Node colors ---
  const COLORS: Record<FlowNodeType, string> = { prompt: '#74c0fc', execute: '#ffd43b', eval: '#69db7c' }
  const SIZES: Record<FlowNodeType, { w: number; h: number }> = {
    prompt: { w: 180, h: 78 },
    execute: { w: 180, h: 58 },
    eval: { w: 180, h: 78 },
  }

  // --- Graph mutations ---
  function addNode(type: FlowNodeType) {
    const s = SIZES[type]
    const id = String(graph.nextId++)
    const x = 20 + (graph.nodes.length % 3) * 200
    const y = 20 + Math.floor(graph.nodes.length / 3) * 110
    graph.nodes = [...graph.nodes, { id, type, x, y, width: s.w, height: s.h, config: { text: '' } }]
    save()
  }

  function deleteNode(id: string) {
    graph.nodes = graph.nodes.filter(n => n.id !== id)
    graph.links = graph.links.filter(l => l.from !== id && l.to !== id)
    if (selectedNodeId === id) selectedNodeId = null
    save()
  }

  function deleteLink(id: string) {
    graph.links = graph.links.filter(l => l.id !== id)
    save()
  }

  // --- Port positions ---
  function outPort(n: FlowNode) { return { x: n.x + n.width, y: n.y + n.height / 2 } }
  function inPort(n: FlowNode) { return { x: n.x, y: n.y + n.height / 2 } }

  function bezier(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const cp = Math.max(40, Math.abs(to.x - from.x) / 2)
    return `M ${from.x} ${from.y} C ${from.x + cp} ${from.y}, ${to.x - cp} ${to.y}, ${to.x} ${to.y}`
  }

  function linkPath(link: FlowLink): string {
    const fn = graph.nodes.find(n => n.id === link.from)
    const tn = graph.nodes.find(n => n.id === link.to)
    if (!fn || !tn) return ''
    return bezier(outPort(fn), inPort(tn))
  }

  function linkMid(link: FlowLink): { x: number; y: number } | null {
    const fn = graph.nodes.find(n => n.id === link.from)
    const tn = graph.nodes.find(n => n.id === link.to)
    if (!fn || !tn) return null
    const a = outPort(fn), b = inPort(tn)
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  // --- Canvas dimensions ---
  let canvasW = $derived(Math.max(440, ...graph.nodes.map(n => n.x + n.width + 40)))
  let canvasH = $derived(Math.max(300, ...graph.nodes.map(n => n.y + n.height + 40)))

  // --- Event handlers ---
  function onNodeDown(node: FlowNode, e: PointerEvent) {
    if ((e.target as HTMLElement).classList.contains('af-port')) return
    e.stopPropagation()
    selectedNodeId = node.id
    draggingId = node.id
    dragStart = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onNodeMove(e: PointerEvent) {
    if (!draggingId || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    const node = graph.nodes.find(n => n.id === draggingId)
    if (!node) return
    node.x = Math.max(0, dragStart.nx + e.clientX - dragStart.x)
    node.y = Math.max(0, dragStart.ny + e.clientY - dragStart.y)
    graph.nodes = [...graph.nodes]
  }

  function onNodeUp() {
    if (draggingId) { draggingId = null; save() }
  }

  function onOutPortDown(nodeId: string, e: PointerEvent) {
    e.stopPropagation(); e.preventDefault()
    pendingLinkFrom = nodeId
  }

  function onInPortUp(nodeId: string, e: PointerEvent) {
    e.stopPropagation()
    if (pendingLinkFrom && pendingLinkFrom !== nodeId) {
      if (!graph.links.some(l => l.from === pendingLinkFrom && l.to === nodeId)) {
        const id = String(graph.nextId++)
        graph.links = [...graph.links, { id, from: pendingLinkFrom, to: nodeId }]
        save()
      }
    }
    pendingLinkFrom = null
  }

  function onCanvasMouseMove(e: MouseEvent) {
    if (!canvasEl || !pendingLinkFrom) return
    const rect = canvasEl.getBoundingClientRect()
    cursorX = e.clientX - rect.left + canvasEl.scrollLeft
    cursorY = e.clientY - rect.top + canvasEl.scrollTop
  }

  function onCanvasDown(_e: PointerEvent) {
    selectedNodeId = null
    pendingLinkFrom = null
  }

  function onCanvasUp() {
    if (pendingLinkFrom) pendingLinkFrom = null
  }

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation()
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId && !af.isRunning) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      deleteNode(selectedNodeId)
    }
  }

  // --- Execution ---
  async function run() {
    if (af.isRunning || graph.nodes.length === 0) return
    save()
    af.isRunning = true; af.error = null; af.logs = []; af.nodeStatuses = {}
    const controller = new AbortController()
    setAutoflowAbort(nodeId, controller)
    try {
      await executeFlow(graph, llm.apiKey ?? '', controller.signal, {
        onNodeStart(id) { af.nodeStatuses = { ...af.nodeStatuses, [id]: 'running' } },
        onNodeDone(id) { af.nodeStatuses = { ...af.nodeStatuses, [id]: 'done' } },
        onNodeError(id, err) { af.nodeStatuses = { ...af.nodeStatuses, [id]: 'error' }; af.error = err },
        onLog(entry) { af.logs = [...af.logs, { content: entry, timestamp: Date.now() }] },
      })
      af.logs = [...af.logs, { content: '\u2713 Flow complete.', timestamp: Date.now() }]
    } catch (err) {
      if (!controller.signal.aborted) af.error = err instanceof Error ? err.message : 'Flow failed'
      else af.logs = [...af.logs, { content: '[cancelled]', timestamp: Date.now() }]
    } finally {
      af.isRunning = false; deleteAutoflowAbort(nodeId)
    }
  }

  function stop() { getAutoflowAbort(nodeId)?.abort() }

  function statusColor(id: string): string {
    switch (af.nodeStatuses[id]) {
      case 'running': return '#ffd43b'
      case 'done': return '#69db7c'
      case 'error': return '#ff6b6b'
      default: return '#333'
    }
  }

  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function onLogResizeDown(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    resizingLog = true; resizeStartY = e.clientY; resizeStartH = logHeight
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onLogResizeMove(e: PointerEvent) {
    if (!resizingLog || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    logHeight = Math.max(40, Math.min(600, resizeStartH - (e.clientY - resizeStartY)))
  }
  function onLogResizeUp(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    resizingLog = false
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={onKeyDown}>
  <WidgetHeader icon="⟳" iconColor="#74c0fc">
    {#snippet label()}<span style="color:#aaa;flex:1">Autoflow</span>{/snippet}
    {#snippet children()}
      {#if af.isRunning}
        <button onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); stop() }} style="background:none;border:1px solid #5a5a5a;border-radius:3px;color:#ff6b6b;font-size:9px;font-family:'JetBrains Mono',monospace;cursor:pointer;padding:1px 6px;line-height:14px;">Stop</button>
      {:else}
        <button onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); run() }} disabled={graph.nodes.length === 0} style="background:none;border:1px solid {graph.nodes.length ? '#3a5a3a' : '#2a2a2a'};border-radius:3px;color:{graph.nodes.length ? '#69db7c' : '#444'};font-size:9px;font-family:'JetBrains Mono',monospace;cursor:{graph.nodes.length ? 'pointer' : 'default'};padding:1px 6px;line-height:14px;">Run</button>
      {/if}
    {/snippet}
  </WidgetHeader>

  <!-- Palette -->
  <div style="display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid #1a1a2a;flex-shrink:0;" onpointerdown={(e) => e.stopPropagation()}>
    {#each (['prompt', 'execute', 'eval'] as const) as type}
      <button
        onclick={() => addNode(type)}
        disabled={af.isRunning}
        style="padding:2px 8px;background:#0a0a12;border:1px solid {COLORS[type]}40;border-radius:3px;color:{COLORS[type]};font-size:9px;font-family:'JetBrains Mono',monospace;cursor:pointer;opacity:{af.isRunning ? 0.4 : 1};"
      >+ {type}</button>
    {/each}
  </div>

  <!-- Canvas -->
  <div
    bind:this={canvasEl}
    style="flex:1;overflow:auto;background:#08080e;position:relative;cursor:{pendingLinkFrom ? 'crosshair' : 'default'};"
    onpointerdown={onCanvasDown}
    onpointerup={onCanvasUp}
    onmousemove={onCanvasMouseMove}
  >
    <div style="position:relative;min-width:{canvasW}px;min-height:{canvasH}px;">
      <!-- SVG links -->
      <svg style="position:absolute;top:0;left:0;width:{canvasW}px;height:{canvasH}px;pointer-events:none;overflow:visible;">
        <defs>
          <marker id="af-arrow-{nodeId}" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M 0 0 L 8 3 L 0 6" fill="#4a4a6a" />
          </marker>
        </defs>
        {#each graph.links as link}
          <path d={linkPath(link)} fill="none" stroke="#3a3a5a" stroke-width="2" marker-end="url(#af-arrow-{nodeId})" />
        {/each}
        {#if pendingLinkFrom}
          {@const fn = graph.nodes.find(n => n.id === pendingLinkFrom)}
          {#if fn}
            <path d={bezier(outPort(fn), { x: cursorX, y: cursorY })} fill="none" stroke="#5a5a8a" stroke-width="2" stroke-dasharray="4 4" />
          {/if}
        {/if}
      </svg>

      <!-- Link delete buttons -->
      {#each graph.links as link}
        {@const mid = linkMid(link)}
        {#if mid && !af.isRunning}
          <button
            onclick={() => deleteLink(link.id)}
            onpointerdown={(e) => e.stopPropagation()}
            style="position:absolute;left:{mid.x - 7}px;top:{mid.y - 7}px;width:14px;height:14px;border-radius:50%;background:#1a1a2e;border:1px solid #3a3a5a;color:#666;font-size:9px;line-height:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1;padding:0;opacity:0.4;"
            onmouseenter={(e) => (e.currentTarget as HTMLElement).style.opacity = '1'}
            onmouseleave={(e) => (e.currentTarget as HTMLElement).style.opacity = '0.4'}
          >&times;</button>
        {/if}
      {/each}

      <!-- Sub-nodes -->
      {#each graph.nodes as node}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          onpointerdown={(e) => onNodeDown(node, e)}
          onpointermove={onNodeMove}
          onpointerup={onNodeUp}
          style="position:absolute;left:{node.x}px;top:{node.y}px;width:{node.width}px;background:#111118;border:1px solid {selectedNodeId === node.id ? COLORS[node.type] : '#2a2a3a'};border-radius:6px;cursor:default;overflow:hidden;z-index:2;box-shadow:{selectedNodeId === node.id ? `0 0 0 1px ${COLORS[node.type]}30` : 'none'};"
        >
          <!-- Header -->
          <div style="padding:3px 8px;font-size:9px;font-family:'JetBrains Mono',monospace;color:{COLORS[node.type]};text-transform:uppercase;letter-spacing:0.5px;background:#0a0a12;border-bottom:1px solid #1a1a2a;display:flex;align-items:center;cursor:grab;">
            {node.type}
            <span style="margin-left:auto;width:6px;height:6px;border-radius:50%;background:{statusColor(node.id)};flex-shrink:0;{af.nodeStatuses[node.id] === 'running' ? 'animation:af-pulse 1s infinite;' : ''}"></span>
          </div>

          <!-- Body -->
          <div style="padding:4px 6px;" onpointerdown={(e) => e.stopPropagation()}>
            {#if node.type === 'prompt'}
              <textarea bind:value={node.config.text} onblur={save} placeholder="Prompt text..." rows="2"
                style="width:100%;resize:none;padding:3px 5px;background:#0a0a12;border:1px solid #1a1a2a;border-radius:3px;color:#e0e0e0;font-size:10px;font-family:'JetBrains Mono',monospace;outline:none;box-sizing:border-box;" />
            {:else if node.type === 'execute'}
              <input type="text" bind:value={node.config.text} onblur={save} placeholder="binary name"
                style="width:100%;padding:3px 5px;background:#0a0a12;border:1px solid #1a1a2a;border-radius:3px;color:#e0e0e0;font-size:10px;font-family:'JetBrains Mono',monospace;outline:none;box-sizing:border-box;" />
            {:else if node.type === 'eval'}
              <textarea bind:value={node.config.text} onblur={save} placeholder="Validation criteria..." rows="2"
                style="width:100%;resize:none;padding:3px 5px;background:#0a0a12;border:1px solid #1a1a2a;border-radius:3px;color:#e0e0e0;font-size:10px;font-family:'JetBrains Mono',monospace;outline:none;box-sizing:border-box;" />
            {/if}
          </div>

          <!-- Input port (left) -->
          <div class="af-port"
            onpointerup={(e) => onInPortUp(node.id, e)}
            style="position:absolute;left:-5px;top:50%;margin-top:-5px;width:10px;height:10px;border-radius:50%;background:{pendingLinkFrom ? '#74c0fc' : '#2a2a3a'};border:1.5px solid {pendingLinkFrom ? '#74c0fc' : '#4a4a6a'};cursor:crosshair;z-index:3;"
          ></div>

          <!-- Output port (right) -->
          <div class="af-port"
            onpointerdown={(e) => onOutPortDown(node.id, e)}
            style="position:absolute;right:-5px;top:50%;margin-top:-5px;width:10px;height:10px;border-radius:50%;background:{COLORS[node.type]};border:1.5px solid {COLORS[node.type]};cursor:crosshair;z-index:3;"
          ></div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Log resize handle -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    onpointerdown={onLogResizeDown}
    onpointermove={onLogResizeMove}
    onpointerup={onLogResizeUp}
    style="height:5px;flex-shrink:0;cursor:ns-resize;background:#0a0a12;border-top:1px solid #1a1a2a;border-bottom:1px solid #1a1a2a;display:flex;align-items:center;justify-content:center;"
  >
    <div style="width:30px;height:2px;background:#2a2a3a;border-radius:1px;"></div>
  </div>

  <!-- Log -->
  <div style="height:{logHeight}px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;">
    <div style="font-size:8px;font-family:'JetBrains Mono',monospace;color:#444;padding:2px 8px;text-transform:uppercase;letter-spacing:0.5px;flex-shrink:0;">Log</div>
    <div bind:this={logEl} style="flex:1;overflow:auto;padding:0 8px 4px;" onpointerdown={(e) => e.stopPropagation()}>
      {#if af.logs.length === 0 && !af.error}
        <span style="color:#2a2a3a;font-size:9px;font-family:monospace;">No activity.</span>
      {/if}
      {#each af.logs as entry}
        {@const c = entry.content}
        <div style="font-size:9px;font-family:'JetBrains Mono','Fira Code',monospace;color:{c.startsWith('\u2713') ? '#69db7c' : c.startsWith('[cancelled') || c.startsWith('[error') ? '#ff6b6b' : c.startsWith('---') ? '#74c0fc' : c.startsWith('[thinking]') ? '#666' : c.startsWith('[llm]') ? '#aaa' : c.startsWith('[tool]') ? '#ffd43b' : c.startsWith('[output]') ? '#888' : c.startsWith('[result]') ? '#888' : c.startsWith('[input]') ? '#5a8a5a' : c.startsWith('[node done]') ? '#69db7c' : '#666'};margin-bottom:0;white-space:pre-wrap;word-break:break-word;">
          <span style="color:#333;margin-right:4px;">{fmtTime(entry.timestamp)}</span>{c}
        </div>
      {/each}
      {#if af.error}
        <div style="font-size:9px;font-family:monospace;color:#ff6b6b;margin-top:2px;">{af.error}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  @keyframes af-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
