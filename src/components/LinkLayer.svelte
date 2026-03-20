<script lang="ts">
  import type { CanvasNode, Link, PortSide } from '../types'

  let { links, nodes, pendingLink, selectedLinkId, onSelectLink, onContextMenu }: {
    links: Link[]
    nodes: CanvasNode[]
    pendingLink: { fromNodeId: string; fromSide: PortSide; toX: number; toY: number } | null
    selectedLinkId: string | null
    onSelectLink: (id: string | null) => void
    onContextMenu: (linkId: string, e: MouseEvent) => void
  } = $props()

  let nodeMap = $derived(new Map(nodes.map((n) => [n.id, n])))

  function getPortPosition(node: CanvasNode, side: PortSide): { x: number; y: number } {
    switch (side) {
      case 'top': return { x: node.x + node.width / 2, y: node.y }
      case 'right': return { x: node.x + node.width, y: node.y + node.height / 2 }
      case 'bottom': return { x: node.x + node.width / 2, y: node.y + node.height }
      case 'left': return { x: node.x, y: node.y + node.height / 2 }
    }
  }

  function makePath(from: { x: number; y: number }, to: { x: number; y: number }, fromSide: PortSide, toSide: PortSide) {
    const dist = Math.max(40, Math.abs(to.x - from.x) * 0.4, Math.abs(to.y - from.y) * 0.4)
    const offsets: Record<PortSide, { dx: number; dy: number }> = {
      top: { dx: 0, dy: -dist },
      right: { dx: dist, dy: 0 },
      bottom: { dx: 0, dy: dist },
      left: { dx: -dist, dy: 0 },
    }
    const c1 = offsets[fromSide]
    const c2 = offsets[toSide]
    return `M ${from.x} ${from.y} C ${from.x + c1.dx} ${from.y + c1.dy}, ${to.x + c2.dx} ${to.y + c2.dy}, ${to.x} ${to.y}`
  }
</script>

<svg class="link-layer" width="1" height="1">
  {#each links as link (link.id)}
    {@const fromNode = nodeMap.get(link.fromNodeId)}
    {@const toNode = nodeMap.get(link.toNodeId)}
    {#if fromNode && toNode}
      {@const from = getPortPosition(fromNode, link.fromSide)}
      {@const to = getPortPosition(toNode, link.toSide)}
      {@const d = makePath(from, to, link.fromSide, link.toSide)}
      {@const selected = link.id === selectedLinkId}
      <g>
        <path
          {d}
          fill="none"
          stroke="transparent"
          stroke-width="14"
          style="pointer-events:stroke;cursor:pointer;"
          onclick={(e) => { e.stopPropagation(); onSelectLink(link.id) }}
          oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(link.id, e) }}
        />
        <path
          {d}
          fill="none"
          stroke={selected ? '#7c8fff' : '#5a5a8a'}
          stroke-width={selected ? 2.5 : 2}
          style="pointer-events:none;"
        />
      </g>
    {/if}
  {/each}

  {#if pendingLink}
    {@const fromNode = nodeMap.get(pendingLink.fromNodeId)}
    {#if fromNode}
      {@const from = getPortPosition(fromNode, pendingLink.fromSide)}
      {@const to = { x: pendingLink.toX, y: pendingLink.toY }}
      {@const d = makePath(from, to, pendingLink.fromSide, 'left')}
      <path
        {d}
        fill="none"
        stroke="#5a5a8a"
        stroke-width="2"
        stroke-dasharray="6 4"
        opacity="0.6"
        style="pointer-events:none;"
      />
    {/if}
  {/if}
</svg>
