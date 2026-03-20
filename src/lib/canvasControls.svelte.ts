import type { NodeType, ViewportState } from '../types'

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_SENSITIVITY = 0.0064
const PAN_SENSITIVITY = 1.6
const LINE_DELTA_MULTIPLIER = 16
const GRID_SPACING = 24
const MIN_DRAW_SIZE = 20

interface DrawResult {
  x: number
  y: number
  width: number
  height: number
}

interface Options {
  getActiveTool: () => NodeType | null
  onDrawComplete: (bounds: DrawResult) => void
  onSelectionComplete?: (bounds: DrawResult) => void
}

export function createCanvasControls({ getActiveTool, onDrawComplete, onSelectionComplete }: Options) {
  const offset = { x: 0, y: 0 }
  let currentScale = 1
  let scaleValue = $state(1)

  let viewportEl: HTMLDivElement | null = null
  let worldEl: HTMLDivElement | null = null
  let previewEl: HTMLDivElement | null = null
  let selectionEl: HTMLDivElement | null = null

  const isPanning = { current: false }
  const isDrawing = { current: false }
  const isSelecting = { current: false }
  const drawStart = { x: 0, y: 0 }
  const selectStart = { x: 0, y: 0 }
  const panStart = { x: 0, y: 0 }
  const panOffsetStart = { x: 0, y: 0 }
  const spaceHeld = { current: false }
  const justSelected = { current: false }
  let viewportRect: DOMRect | null = null

  function screenToWorld(screenX: number, screenY: number) {
    const rect = viewportRect ?? viewportEl?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (screenX - rect.left - offset.x) / currentScale,
      y: (screenY - rect.top - offset.y) / currentScale,
    }
  }

  function applyTransform() {
    if (!worldEl || !viewportEl) return
    worldEl.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${currentScale})`
    const gridSize = GRID_SPACING * currentScale
    viewportEl.style.backgroundSize = `${gridSize}px ${gridSize}px`
    viewportEl.style.backgroundPosition = `${offset.x}px ${offset.y}px`
    scaleValue = currentScale
  }

  function updatePreview(startWorld: { x: number; y: number }, endWorld: { x: number; y: number }) {
    if (!previewEl) return
    const x = Math.min(startWorld.x, endWorld.x)
    const y = Math.min(startWorld.y, endWorld.y)
    const w = Math.abs(endWorld.x - startWorld.x)
    const h = Math.abs(endWorld.y - startWorld.y)
    previewEl.style.display = 'block'
    previewEl.style.left = `${x}px`
    previewEl.style.top = `${y}px`
    previewEl.style.width = `${w}px`
    previewEl.style.height = `${h}px`
  }

  function hidePreview() {
    if (previewEl) previewEl.style.display = 'none'
  }

  function updateSelection(startWorld: { x: number; y: number }, endWorld: { x: number; y: number }) {
    if (!selectionEl) return
    const x = Math.min(startWorld.x, endWorld.x)
    const y = Math.min(startWorld.y, endWorld.y)
    const w = Math.abs(endWorld.x - startWorld.x)
    const h = Math.abs(endWorld.y - startWorld.y)
    selectionEl.style.display = 'block'
    selectionEl.style.left = `${x}px`
    selectionEl.style.top = `${y}px`
    selectionEl.style.width = `${w}px`
    selectionEl.style.height = `${h}px`
  }

  function hideSelection() {
    if (selectionEl) selectionEl.style.display = 'none'
  }

  function setScale(newScale: number) {
    if (!viewportEl) return
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale))
    const rect = viewportEl.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const ratio = clamped / currentScale
    offset.x = cx - (cx - offset.x) * ratio
    offset.y = cy - (cy - offset.y) * ratio
    currentScale = clamped
    applyTransform()
  }

  function resetView() {
    offset.x = 0
    offset.y = 0
    currentScale = 1
    applyTransform()
  }

  function getViewport(): ViewportState {
    return { offsetX: offset.x, offsetY: offset.y, scale: currentScale }
  }

  function setViewport(v: ViewportState) {
    offset.x = v.offsetX
    offset.y = v.offsetY
    currentScale = v.scale
    applyTransform()
  }

  /** Svelte `use:` action for the viewport element */
  function action(viewport: HTMLDivElement) {
    viewportEl = viewport

    // Apply grid immediately (worldEl may not be set yet)
    const gridSize = GRID_SPACING * currentScale
    viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`
    viewport.style.backgroundPosition = `${offset.x}px ${offset.y}px`

    applyTransform()

    viewportRect = viewport.getBoundingClientRect()
    const ro = new ResizeObserver(() => {
      viewportRect = viewport.getBoundingClientRect()
    })
    ro.observe(viewport)

    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') spaceHeld.current = true
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') spaceHeld.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    function onWheel(e: WheelEvent) {
      const target = e.target as HTMLElement
      const node = target.closest('.canvas-node') as HTMLElement | null
      if (node && node.matches(':focus-within')) return
      e.preventDefault()

      const lineMul = e.deltaMode === 1 ? LINE_DELTA_MULTIPLIER : 1
      const dx = e.deltaX * lineMul
      const dy = e.deltaY * lineMul

      if (e.ctrlKey || e.metaKey) {
        const rect = viewportRect!
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top
        const oldScale = currentScale
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * Math.exp(-dy * ZOOM_SENSITIVITY)))
        const ratio = newScale / oldScale
        offset.x = cursorX - (cursorX - offset.x) * ratio
        offset.y = cursorY - (cursorY - offset.y) * ratio
        currentScale = newScale
      } else {
        offset.x -= dx * PAN_SENSITIVITY
        offset.y -= dy * PAN_SENSITIVITY
      }
      applyTransform()
    }

    function isEmptyCanvas(e: PointerEvent) {
      const target = e.target as HTMLElement
      return target === viewport || target === worldEl
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0 && e.button !== 1) return

      if (e.button === 1) {
        e.preventDefault()
        viewport.setPointerCapture(e.pointerId)
        isPanning.current = true
        panStart.x = e.clientX; panStart.y = e.clientY
        panOffsetStart.x = offset.x; panOffsetStart.y = offset.y
        viewport.classList.add('panning')
        return
      }

      if (!isEmptyCanvas(e)) return
      viewport.setPointerCapture(e.pointerId)

      if (getActiveTool() && e.button === 0) {
        isDrawing.current = true
        const start = screenToWorld(e.clientX, e.clientY)
        drawStart.x = start.x; drawStart.y = start.y
        updatePreview(drawStart, drawStart)
        viewport.classList.add('drawing')
      } else if (e.button === 0 && e.shiftKey) {
        isSelecting.current = true
        const start = screenToWorld(e.clientX, e.clientY)
        selectStart.x = start.x; selectStart.y = start.y
        updateSelection(selectStart, selectStart)
      } else if (e.button === 0 || spaceHeld.current) {
        isPanning.current = true
        panStart.x = e.clientX; panStart.y = e.clientY
        panOffsetStart.x = offset.x; panOffsetStart.y = offset.y
        viewport.classList.add('panning')
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (isDrawing.current) {
        updatePreview(drawStart, screenToWorld(e.clientX, e.clientY))
        return
      }
      if (isSelecting.current) {
        updateSelection(selectStart, screenToWorld(e.clientX, e.clientY))
        return
      }
      if (!isPanning.current) return
      offset.x = panOffsetStart.x + (e.clientX - panStart.x)
      offset.y = panOffsetStart.y + (e.clientY - panStart.y)
      applyTransform()
    }

    function onPointerUp(e: PointerEvent) {
      viewport.releasePointerCapture(e.pointerId)

      if (isDrawing.current) {
        isDrawing.current = false
        hidePreview()
        viewport.classList.remove('drawing')
        const end = screenToWorld(e.clientX, e.clientY)
        const x = Math.min(drawStart.x, end.x)
        const y = Math.min(drawStart.y, end.y)
        const w = Math.abs(end.x - drawStart.x)
        const h = Math.abs(end.y - drawStart.y)
        if (w >= MIN_DRAW_SIZE && h >= MIN_DRAW_SIZE) {
          onDrawComplete({ x, y, width: w, height: h })
        }
        return
      }

      if (isSelecting.current) {
        isSelecting.current = false
        hideSelection()
        const end = screenToWorld(e.clientX, e.clientY)
        const x = Math.min(selectStart.x, end.x)
        const y = Math.min(selectStart.y, end.y)
        const w = Math.abs(end.x - selectStart.x)
        const h = Math.abs(end.y - selectStart.y)
        if (w > 5 || h > 5) {
          justSelected.current = true
          setTimeout(() => { justSelected.current = false }, 0)
          onSelectionComplete?.({ x, y, width: w, height: h })
        }
        return
      }

      if (!isPanning.current) return
      isPanning.current = false
      viewport.classList.remove('panning')
    }

    let gestureStartScale = 1
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number }

    function onGestureStart(e: Event) {
      e.preventDefault()
      gestureStartScale = currentScale
    }

    function onGestureChange(e: Event) {
      e.preventDefault()
      const ge = e as GestureEvent
      const rect = viewportRect!
      const cursorX = ge.clientX - rect.left
      const cursorY = ge.clientY - rect.top
      const oldScale = currentScale
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, gestureStartScale * ge.scale))
      const ratio = newScale / oldScale
      offset.x = cursorX - (cursorX - offset.x) * ratio
      offset.y = cursorY - (cursorY - offset.y) * ratio
      currentScale = newScale
      applyTransform()
    }

    function onGestureEnd(e: Event) {
      e.preventDefault()
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('pointerdown', onPointerDown)
    viewport.addEventListener('pointermove', onPointerMove)
    viewport.addEventListener('pointerup', onPointerUp)
    viewport.addEventListener('gesturestart', onGestureStart)
    viewport.addEventListener('gesturechange', onGestureChange)
    viewport.addEventListener('gestureend', onGestureEnd)

    return {
      destroy() {
        ro.disconnect()
        viewport.removeEventListener('wheel', onWheel)
        viewport.removeEventListener('pointerdown', onPointerDown)
        viewport.removeEventListener('pointermove', onPointerMove)
        viewport.removeEventListener('pointerup', onPointerUp)
        viewport.removeEventListener('gesturestart', onGestureStart)
        viewport.removeEventListener('gesturechange', onGestureChange)
        viewport.removeEventListener('gestureend', onGestureEnd)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
      }
    }
  }

  return {
    action,
    get scaleValue() { return scaleValue },
    screenToWorld,
    setScale,
    resetView,
    justSelected,
    getViewport,
    setViewport,
    setWorldEl(el: HTMLDivElement) { worldEl = el; applyTransform() },
    setPreviewEl(el: HTMLDivElement) { previewEl = el },
    setSelectionEl(el: HTMLDivElement) { selectionEl = el },
  }
}
