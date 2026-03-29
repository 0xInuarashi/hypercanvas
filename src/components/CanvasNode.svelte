<script lang="ts">
  import type { CanvasNode as CanvasNodeType, PortSide } from '../types'
  import ConsoleWidget from '../widgets/ConsoleWidget.svelte'
  import MacroWidget from '../widgets/MacroWidget.svelte'
import MemoWidget from '../widgets/MemoWidget.svelte'
  import FileBrowserWidget from '../widgets/FileBrowserWidget.svelte'
  import GenieWidget from '../widgets/GenieWidget.svelte'
  import SketchpadWidget from '../widgets/SketchpadWidget.svelte'
  import BrowserWidget from '../widgets/BrowserWidget.svelte'
  import ReaderWidget from '../widgets/ReaderWidget.svelte'

  let { node, selected, onSelect, onMove, onResize, onPortDragStart, onContextMenu, onTextContextMenu, onUpdateLabel, onReplaceNode, onSpawnTerminal, onBashStart, onBashOutput, onBashDone, onToggleActive, onOpenBrowser, onOpenInReader, onGoToDefinition, onDragStart, onDragEnd, fullscreen, topmost, ephemeralGenie, ephemeralMacro }: {
    node: CanvasNodeType
    selected: boolean
    onSelect: (id: string, additive?: boolean) => void
    onMove: (id: string, x: number, y: number) => void
    onResize: (id: string, x: number, y: number, w: number, h: number) => void
    onPortDragStart: (nodeId: string, side: PortSide, e: PointerEvent) => void
    onContextMenu: (nodeId: string, e: MouseEvent) => void
    onTextContextMenu?: (nodeId: string, text: string, e: MouseEvent) => void
    onUpdateLabel: (id: string, label: string) => void
    onReplaceNode: (id: string, newProps: Partial<CanvasNodeType>) => void
    onSpawnTerminal?: (nodeId: string, command: string) => void
    onBashStart?: (nodeId: string, command: string) => string
    onBashOutput?: (id: string, chunk: string) => void
    onBashDone?: (id: string, exitCode?: number) => void
    onToggleActive?: (id: string, active: boolean) => void
    onOpenBrowser?: (nodeId: string, url: string) => void
    onOpenInReader?: (nodeId: string, filePath: string) => void
    onGoToDefinition?: (nodeId: string, filePath: string, line: number) => void
    onDragStart?: () => void
    onDragEnd?: (label: string) => void
    fullscreen?: boolean
    topmost?: boolean
    ephemeralGenie?: boolean
    ephemeralMacro?: boolean
  } = $props()

  const PORTS: { side: PortSide; style: string }[] = [
    { side: 'top', style: 'top:-6px;left:50%;margin-left:-6px' },
    { side: 'right', style: 'top:50%;right:-6px;margin-top:-6px' },
    { side: 'bottom', style: 'bottom:-6px;left:50%;margin-left:-6px' },
    { side: 'left', style: 'top:50%;left:-6px;margin-top:-6px' },
  ]

  type ResizeDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

  const DIR_FLAGS: Record<ResizeDir, { left: boolean; top: boolean; right: boolean; bottom: boolean }> = {
    n:  { left: false, top: true,  right: false, bottom: false },
    ne: { left: false, top: true,  right: true,  bottom: false },
    e:  { left: false, top: false, right: true,  bottom: false },
    se: { left: false, top: false, right: true,  bottom: true  },
    s:  { left: false, top: false, right: false, bottom: true  },
    sw: { left: true,  top: false, right: false, bottom: true  },
    w:  { left: true,  top: false, right: false, bottom: false },
    nw: { left: true,  top: true,  right: false, bottom: false },
  }

  const CURSORS: Record<ResizeDir, string> = {
    n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize',
    s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize', nw: 'nwse-resize',
  }

  const CORNERS: { dir: ResizeDir; style: string }[] = [
    { dir: 'nw', style: 'top:-4px;left:-4px' },
    { dir: 'ne', style: 'top:-4px;right:-4px' },
    { dir: 'sw', style: 'bottom:-4px;left:-4px' },
    { dir: 'se', style: 'bottom:-4px;right:-4px' },
  ]

  const EDGES: { dir: ResizeDir; style: string }[] = [
    { dir: 'n',  style: 'top:-4px;left:8px;right:8px;height:8px' },
    { dir: 's',  style: 'bottom:-4px;left:8px;right:8px;height:8px' },
    { dir: 'e',  style: 'right:-4px;top:8px;bottom:8px;width:8px' },
    { dir: 'w',  style: 'left:-4px;top:8px;bottom:8px;width:8px' },
  ]

  const MIN_SIZE = 40
  let dragStartPos = { x: 0, y: 0 }
  let nodeStartPos = { x: 0, y: 0, w: 0, h: 0 }
  let resizingDir: ResizeDir | null = null
  let hasMoved = false
  let hasResized = false
  let cachedScale = 1

  function readScale(el: HTMLElement): number {
    const parent = el.closest('.canvas-world')
    if (!parent) return 1
    const transform = getComputedStyle(parent).transform
    if (transform === 'none') return 1
    return Math.sqrt(parseFloat(transform.split(',')[0].replace('matrix(', '')) ** 2 + parseFloat(transform.split(',')[1]) ** 2)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button === 1) return
    const target = e.target as HTMLElement
    if (target.classList.contains('port') || target.classList.contains('resize-handle') || target.classList.contains('edge-handle')) return

    if (e.altKey && (node.type === 'console' || node.type === 'browser') && !node.active && onToggleActive) {
      e.stopPropagation(); onSelect(node.id); onToggleActive(node.id, true); return
    }

    onSelect(node.id, e.shiftKey)
    e.stopPropagation()
    hasMoved = false
    dragStartPos = { x: e.clientX, y: e.clientY }
    nodeStartPos = { x: node.x, y: node.y, w: node.width, h: node.height }
    cachedScale = readScale(e.currentTarget as HTMLElement)
    onDragStart?.()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    hasMoved = true
    const dx = (e.clientX - dragStartPos.x) / cachedScale
    const dy = (e.clientY - dragStartPos.y) / cachedScale
    onMove(node.id, nodeStartPos.x + dx, nodeStartPos.y + dy)
  }

  function onPointerUp(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    if (hasMoved) onDragEnd?.('Move node')
    hasMoved = false
  }

  function onNodeDoubleClick(e: MouseEvent) {
    if ((node.type === 'console' || node.type === 'browser') && !node.active && onToggleActive) {
      e.stopPropagation(); onToggleActive(node.id, true)
    }
  }

  function onResizeDown(dir: ResizeDir, e: PointerEvent) {
    e.stopPropagation(); e.preventDefault()
    resizingDir = dir; hasResized = false
    dragStartPos = { x: e.clientX, y: e.clientY }
    nodeStartPos = { x: node.x, y: node.y, w: node.width, h: node.height }
    cachedScale = readScale(e.currentTarget as HTMLElement)
    onDragStart?.()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onResizeMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId) || !resizingDir) return
    const dx = (e.clientX - dragStartPos.x) / cachedScale
    const dy = (e.clientY - dragStartPos.y) / cachedScale
    const f = DIR_FLAGS[resizingDir]; const s = nodeStartPos
    let nx = s.x, ny = s.y, nw = s.w, nh = s.h
    if (f.left) { nw = Math.max(MIN_SIZE, s.w - dx); nx = s.x + (s.w - nw) }
    if (f.right) { nw = Math.max(MIN_SIZE, s.w + dx) }
    if (f.top) { nh = Math.max(MIN_SIZE, s.h - dy); ny = s.y + (s.h - nh) }
    if (f.bottom) { nh = Math.max(MIN_SIZE, s.h + dy) }
    hasResized = true
    onResize(node.id, nx, ny, nw, nh)
  }

  function onResizeUp(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    if (hasResized) onDragEnd?.('Resize node')
    hasResized = false; resizingDir = null
  }

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="canvas-node"
  data-node-id={node.id}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  ondblclick={onNodeDoubleClick}
  oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node.id, e) }}
  style="position:absolute;left:{node.x}px;top:{node.y}px;width:{node.width}px;height:{node.height}px;background-color:#0c0c0c;border:1px solid #3a3a3a;border-radius:{fullscreen ? '0' : '8px'};padding:0;cursor:default;color:#e0e0e0;font-size:13px;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:stretch;overflow:hidden;box-shadow:{selected ? '0 0 0 1px #7c8fff, 0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.3)'};{fullscreen ? 'z-index:999;' : topmost ? 'z-index:10;' : ''}"
>
  <svelte:boundary onerror={(e) => console.error(`[Widget] ${node.type} crashed:`, e)}>
    {#snippet failed(error, reset)}
      <div style="display:flex;flex-direction:column;width:100%;height:100%;align-items:center;justify-content:center;gap:8px;background:#0c0c0c;color:#ff6b6b;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;padding:16px;text-align:center;">
        <span style="font-size:18px;opacity:0.5">!</span>
        <span>{node.type} crashed</span>
        <span style="color:#888;font-size:10px;max-width:250px;word-break:break-word;">{error instanceof Error ? error.message : String(error)}</span>
        <button onpointerdown={(e) => e.stopPropagation()} onclick={reset} style="margin-top:8px;padding:4px 12px;background:#1a1a2e;border:1px solid #3a3a3a;border-radius:3px;color:#aaa;cursor:pointer;font-size:11px;">Retry</button>
      </div>
    {/snippet}
    {#if node.type === 'console'}
      <ConsoleWidget active={!!node.active} defaultCommand={node.label} persistent={!!node.persistent} sessionId={node.sessionId} satellitePassword={node.satellitePassword} fishtankPassword={node.fishtankPassword} onSessionCreated={(sid) => onReplaceNode(node.id, { sessionId: sid })} onOpenBrowser={onOpenBrowser ? (url) => onOpenBrowser(node.id, url) : undefined} onTextContextMenu={onTextContextMenu ? (text, e) => onTextContextMenu(node.id, text, e) : undefined} />
    {:else if node.type === 'macro'}
      <MacroWidget label={node.label} script={node.script || ''} onBashStart={onBashStart && ephemeralMacro ? (cmd) => onBashStart(node.id, cmd) : undefined} onBashOutput={ephemeralMacro ? onBashOutput : undefined} onBashDone={ephemeralMacro ? onBashDone : undefined} />
    {:else if node.type === 'memo'}
      <MemoWidget label={node.label} onUpdateLabel={(label) => onUpdateLabel(node.id, label)} />
    {:else if node.type === 'files'}
      <FileBrowserWidget initialPath={node.label || undefined} onSetDefaultPath={(path) => onUpdateLabel(node.id, path)} onOpenInReader={onOpenInReader ? (path) => onOpenInReader(node.id, path) : undefined} />
    {:else if node.type === 'genie'}
      <GenieWidget nodeId={node.id} onSpawnTerminal={onSpawnTerminal ? (cmd) => onSpawnTerminal(node.id, cmd) : undefined} onBashStart={onBashStart && ephemeralGenie && node.showEphemeral !== false ? (cmd) => onBashStart(node.id, cmd) : undefined} onBashOutput={ephemeralGenie && node.showEphemeral !== false ? onBashOutput : undefined} onBashDone={ephemeralGenie && node.showEphemeral !== false ? onBashDone : undefined} />
    {:else if node.type === 'sketchpad'}
      <SketchpadWidget label={node.label} onUpdateLabel={(label) => onUpdateLabel(node.id, label)} />
    {:else if node.type === 'browser'}
      <BrowserWidget url={node.label} active={!!node.active} onUpdateUrl={(url) => onUpdateLabel(node.id, url)} />
    {:else if node.type === 'reader'}
      <ReaderWidget filePath={node.filePath || ''} scrollLine={node.scrollLine} label={node.label} onGoToDefinition={onGoToDefinition ? (fp, line) => onGoToDefinition(node.id, fp, line) : undefined} />
    {/if}
  </svelte:boundary>

  {#each PORTS as p}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="port" onpointerdown={(e) => onPortDragStart(node.id, p.side, e)} style="position:absolute;width:12px;height:12px;border-radius:50%;background:#3a3a5a;border:2px solid #5a5a8a;{p.style}"></div>
  {/each}

  {#each CORNERS as c}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle" onpointerdown={(e) => onResizeDown(c.dir, e)} onpointermove={onResizeMove} onpointerup={onResizeUp} style="position:absolute;width:8px;height:8px;border-radius:2px;background:#5a5a8a;border:1px solid #7a7aaa;cursor:{CURSORS[c.dir]};{c.style}"></div>
  {/each}

  {#each EDGES as edge}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="edge-handle" onpointerdown={(e) => onResizeDown(edge.dir, e)} onpointermove={onResizeMove} onpointerup={onResizeUp} style="position:absolute;cursor:{CURSORS[edge.dir]};{edge.style}"></div>
  {/each}
</div>
