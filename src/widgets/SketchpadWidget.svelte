<script lang="ts">
  import WidgetHeader from '../components/WidgetHeader.svelte'

  let { label, onUpdateLabel }: {
    label: string
    onUpdateLabel: (label: string) => void
  } = $props()

  interface Stroke {
    points: [number, number][]
    color: string
    width: number
  }

  const COLORS = ['#e0e0e0', '#ff6b6b', '#51cf66', '#339af0', '#ffd43b', '#cc5de8', '#ff922b', '#222222']
  const WIDTHS = [2, 4, 8, 16]

  let canvasEl: HTMLCanvasElement
  let containerEl: HTMLDivElement
  let penColor = $state('#e0e0e0')
  let penWidth = $state(4)
  let strokes: Stroke[] = []
  let current: Stroke | null = null
  let drawing = false
  let lastSaved = label

  // Sync from external label changes
  $effect(() => {
    if (label === lastSaved) return
    lastSaved = label
    try {
      strokes = label ? JSON.parse(label) : []
    } catch {
      strokes = []
    }
    redraw()
  })

  // ResizeObserver for canvas
  $effect(() => {
    if (!containerEl || !canvasEl) return
    const ro = new ResizeObserver(() => {
      const { width, height } = containerEl.getBoundingClientRect()
      const w = Math.floor(width)
      const h = Math.floor(height)
      if (canvasEl.width !== w || canvasEl.height !== h) {
        canvasEl.width = w
        canvasEl.height = h
        redraw()
      }
    })
    ro.observe(containerEl)
    return () => ro.disconnect()
  })

  function redraw() {
    if (!canvasEl) return
    const ctx = canvasEl.getContext('2d')
    if (!ctx) return
    const { width: cw, height: ch } = canvasEl
    ctx.clearRect(0, 0, cw, ch)
    const all: Stroke[] = [...strokes]
    if (current) all.push(current)
    for (const s of all) {
      if (s.points.length === 0) continue
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = s.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (s.points.length === 1) {
        const [x, y] = s.points[0]
        ctx.beginPath()
        ctx.arc(x * cw, y * ch, s.width / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.beginPath()
      ctx.moveTo(s.points[0][0] * cw, s.points[0][1] * ch)
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i][0] * cw, s.points[i][1] * ch)
      }
      ctx.stroke()
    }
  }

  function getPoint(e: PointerEvent): [number, number] {
    const rect = canvasEl.getBoundingClientRect()
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]
  }

  function saveStrokes() {
    const json = strokes.length > 0 ? JSON.stringify(strokes) : ''
    lastSaved = json
    onUpdateLabel(json)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    drawing = true
    const pt = getPoint(e)
    current = { points: [pt], color: penColor, width: penWidth }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const ctx = canvasEl?.getContext('2d')
    if (ctx) {
      ctx.fillStyle = penColor
      ctx.beginPath()
      ctx.arc(pt[0] * canvasEl.width, pt[1] * canvasEl.height, penWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing || !current) return
    const pt = getPoint(e)
    const pts = current.points
    const prev = pts[pts.length - 1]
    pts.push(pt)
    const ctx = canvasEl?.getContext('2d')
    if (ctx) {
      ctx.strokeStyle = current.color
      ctx.lineWidth = current.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(prev[0] * canvasEl.width, prev[1] * canvasEl.height)
      ctx.lineTo(pt[0] * canvasEl.width, pt[1] * canvasEl.height)
      ctx.stroke()
    }
  }

  function onPointerUp() {
    if (!drawing || !current) return
    drawing = false
    strokes = [...strokes, current]
    current = null
    saveStrokes()
  }

  function undoStroke() {
    if (strokes.length === 0) return
    strokes = strokes.slice(0, -1)
    saveStrokes()
    redraw()
  }

  function clearAll() {
    strokes = []
    current = null
    saveStrokes()
    redraw()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="&#9997;" label="Sketchpad" />

  <!-- Toolbar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    onpointerdown={(e) => e.stopPropagation()}
    style="flex-shrink:0;display:flex;align-items:center;gap:6px;padding:4px 8px;background:#131313;border-bottom:1px solid #2a2a2a;user-select:none;"
  >
    {#each COLORS as c}
      <button
        onclick={() => penColor = c}
        style="width:16px;height:16px;border-radius:50%;border:{penColor === c ? '2px solid #7c8fff' : '1px solid #444'};background:{c};cursor:pointer;padding:0;flex-shrink:0;"
      ></button>
    {/each}
    <div style="width:1px;height:16px;background:#333;flex-shrink:0;"></div>
    {#each WIDTHS as w}
      <button
        onclick={() => penWidth = w}
        style="width:24px;height:24px;border-radius:4px;border:{penWidth === w ? '1px solid #7c8fff' : '1px solid #333'};background:{penWidth === w ? '#2a2a4a' : 'transparent'};cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
      >
        <div style="width:{Math.max(4, w)}px;height:{Math.max(4, w)}px;border-radius:50%;background:#888;"></div>
      </button>
    {/each}
    <div style="flex:1"></div>
    <button onclick={undoStroke} style="padding:2px 8px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#888;font-size:10px;cursor:pointer;font-family:'JetBrains Mono',monospace;">Undo</button>
    <button onclick={clearAll} style="padding:2px 8px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#888;font-size:10px;cursor:pointer;font-family:'JetBrains Mono',monospace;">Clear</button>
  </div>

  <!-- Drawing area -->
  <div bind:this={containerEl} style="flex:1;overflow:hidden;">
    <canvas
      bind:this={canvasEl}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      style="display:block;width:100%;height:100%;cursor:crosshair;touch-action:none;"
    ></canvas>
  </div>
</div>
