<script lang="ts">
  import { onDestroy } from 'svelte'
  import { getWsUrl } from '../config'
  import { parseWsMessage } from '../canvas/wsTypes'
  import WidgetHeader from '../components/WidgetHeader.svelte'

  let { label, script, onBashStart, onBashOutput, onBashDone }: {
    label: string
    script: string
    onBashStart?: (command: string) => string
    onBashOutput?: (id: string, chunk: string) => void
    onBashDone?: (id: string, exitCode?: number) => void
  } = $props()

  let status = $state<'idle' | 'running' | 'done' | 'error'>('idle')
  let ws: WebSocket | null = null

  function run() {
    if (status === 'running') return

    if (!script) {
      status = 'error'
      setTimeout(() => { status = 'idle' }, 2000)
      return
    }

    status = 'running'

    let ephId: string | undefined
    if (onBashStart) {
      ephId = onBashStart(script)
    }

    const socket = new WebSocket(getWsUrl())
    ws = socket

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'input', data: script + '\nexit\n' }))
    }

    socket.onmessage = (ev) => {
      const msg = parseWsMessage(ev.data)
      if (msg?.type === 'output' && ephId && onBashOutput) {
        onBashOutput(ephId, msg.data)
      }
    }

    socket.onclose = (ev) => {
      ws = null
      const exitCode = ev.code === 1000 ? 0 : undefined
      if (ephId && onBashDone) {
        onBashDone(ephId, exitCode)

      }
      status = exitCode === 0 ? 'done' : 'error'
    }

    socket.onerror = () => {
      ws = null
      if (ephId && onBashDone) {
        onBashDone(ephId, 1)

      }
      status = 'error'
    }
  }

  onDestroy(() => {
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      ws.onerror = null
      ws.close()
      ws = null
    }
  })

  let statusColor = $derived({
    idle: '#5a5a8a',
    running: '#ffd43b',
    done: '#69db7c',
    error: '#ff6b6b',
  }[status])

  let statusLabel = $derived({
    idle: null as string | null,
    running: 'running…',
    done: 'done',
    error: 'error',
  }[status])
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="◆" iconColor="#cc5de8">
    {#snippet label()}
      <span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">{script || '(no script)'}</span>
    {/snippet}
    {#snippet children()}
      {#if statusLabel}
        <span style="font-size:10px;" style:color={statusColor}>{statusLabel}</span>
      {/if}
    {/snippet}
  </WidgetHeader>

  <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:8px 10px;">
    <button
      onclick={(e) => { e.stopPropagation(); run() }}
      onpointerdown={(e) => e.stopPropagation()}
      style="width:100%;padding:8px 16px;background:{status === 'running' ? '#2a2a3a' : '#1a1a2e'};border:1px solid {statusColor};border-radius:6px;color:#e0e0e0;font-size:12px;font-family:'JetBrains Mono','Fira Code',monospace;cursor:{status === 'running' ? 'wait' : 'pointer'};transition:border-color 0.15s ease;user-select:none;"
      disabled={status === 'running'}
    >
      {status === 'running' ? '⏳ ' : '▸ '}{label || 'Unnamed Macro'}
    </button>
  </div>
</div>
