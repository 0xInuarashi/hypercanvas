<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { getWsUrl, clipboardWrite } from '../config'
  import { TERMINAL_THEME } from '../canvas/terminalTheme'
  import { parseWsMessage } from '../canvas/wsTypes'
  import WidgetHeader from '../components/WidgetHeader.svelte'

  let { command, sessionId, daemonStatus, onSessionCreated, onStatusChange }: {
    command: string
    sessionId: string | undefined
    daemonStatus: 'running' | 'stopped' | 'error' | 'disconnected' | undefined
    onSessionCreated: (sessionId: string) => void
    onStatusChange: (status: 'running' | 'stopped' | 'error' | 'disconnected') => void
  } = $props()

  let containerEl: HTMLDivElement
  let term: Terminal | null = null
  let ws: WebSocket | null = null
  let observer: ResizeObserver | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000

  function connect() {
    if (ws) return
    if (!command && !sessionId) return
    if (!term) return

    const socket = new WebSocket(getWsUrl())
    ws = socket

    socket.onopen = () => {
      reconnectDelay = 1000
      if (sessionId) {
        socket.send(JSON.stringify({ type: 'daemon:attach', sessionId }))
      } else {
        socket.send(JSON.stringify({ type: 'daemon:create', command }))
      }
      socket.send(JSON.stringify({ type: 'resize', cols: term!.cols, rows: term!.rows }))
    }

    socket.onmessage = (ev) => {
      const msg = parseWsMessage(ev.data)
      if (!msg) return
      if (msg.type === 'output') {
        term!.write(msg.data)
      } else if (msg.type === 'daemon:created') {
        onSessionCreated(msg.sessionId)
        onStatusChange(msg.status)
      } else if (msg.type === 'daemon:attached') {
        onStatusChange(msg.status)
      } else if (msg.type === 'daemon:status') {
        onStatusChange(msg.status)
      } else if (msg.type === 'daemon:error') {
        term!.write(`\x1b[31m[${msg.message}]\x1b[0m\r\n`)
        onStatusChange('disconnected')
      }
    }

    socket.onclose = () => {
      ws = null
      if (sessionId) {
        onStatusChange('disconnected')
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
          reconnectDelay = Math.min(reconnectDelay * 2, 10000)
        }, reconnectDelay)
      }
    }

    socket.onerror = () => {}

    term!.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })
  }

  onMount(() => {
    if (!containerEl) return

    const t = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 12,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Courier New", monospace',
      scrollback: 10000,
      theme: { ...TERMINAL_THEME, cursor: '#0c0c0c' },
      allowProposedApi: true,
    })

    const f = new FitAddon()
    t.loadAddon(f)
    t.open(containerEl)
    f.fit()

    term = t

    t.onSelectionChange(() => {
      const sel = t.getSelection()
      if (sel) clipboardWrite(sel)
    })

    observer = new ResizeObserver(() => f.fit())
    observer.observe(containerEl)

    if (command || sessionId) connect()
  })

  // React to command/sessionId changes
  $effect(() => {
    if (!command && !sessionId) return

    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (!sessionId && ws) {
      ws.close()
      ws = null
    }

    if (!ws) {
      if (!sessionId) term?.clear()
      connect()
    }
  })

  onDestroy(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    observer?.disconnect()
    ws?.close()
    ws = null
    term?.dispose()
    term = null
  })

  let status = $derived(daemonStatus || 'stopped')
  const statusColorMap: Record<string, string> = {
    running: '#69db7c',
    stopped: '#5a5a8a',
    error: '#ff6b6b',
    disconnected: '#ffd43b',
  }
  let statusColor = $derived(statusColorMap[status] || '#5a5a8a')
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="⟳" iconColor="#69db7c">
    {#snippet label()}
      <span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">{command || '(no command)'}</span>
    {/snippet}
    {#snippet children()}
      <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;" style:background={statusColor}></span>
      <span style="font-size:10px;" style:color={statusColor}>{status}</span>
    {/snippet}
  </WidgetHeader>

  <div style="flex:1;overflow:hidden;position:relative;">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={containerEl}
      style="width:100%;height:100%;"
      style:visibility={command ? 'visible' : 'hidden'}
      onpointerdown={(e) => e.stopPropagation()}
    ></div>
    {#if !command}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555;font-size:12px;font-family:monospace;">
        No command set — right-click to configure
      </div>
    {/if}
  </div>
</div>
