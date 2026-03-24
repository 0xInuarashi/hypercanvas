<script lang="ts">
  import { untrack } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { WebLinksAddon } from '@xterm/addon-web-links'
  import '@xterm/xterm/css/xterm.css'
  import { getWsUrl, clipboardWrite, clipboardRead } from '../config'
  import { TERMINAL_THEME } from '../canvas/terminalTheme'
  import { parseWsMessage } from '../canvas/wsTypes'
  import WidgetHeader from '../components/WidgetHeader.svelte'
  import SatelliteShareModal from '../components/SatelliteShareModal.svelte'

  let { active, defaultCommand, persistent = false, sessionId, satellitePassword, onSessionCreated, onOpenBrowser, onTextContextMenu }: {
    active: boolean
    defaultCommand: string
    persistent?: boolean
    sessionId?: string
    satellitePassword?: string | null
    onSessionCreated?: (sessionId: string) => void
    onOpenBrowser?: (url: string) => void
    onTextContextMenu?: (text: string, e: MouseEvent) => void
  } = $props()

  let containerEl = $state<HTMLDivElement | undefined>()
  let wrapperEl: HTMLDivElement
  let term: Terminal | null = null
  let ws: WebSocket | null = null
  let observer: ResizeObserver | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000

  let status = $state<'connected' | 'disconnected' | 'stopped' | null>(null)
  let focused = $state(false)
  let satelliteAnchor = $state<DOMRect | null>(null)

  let wasActive = false

  // Auto-focus when activated
  $effect(() => {
    if (active && !wasActive) {
      focused = true
      setTimeout(() => term?.focus(), 0)
    }
    if (!active) {
      focused = false
    }
    wasActive = active
  })

  // Click-outside unfocus
  $effect(() => {
    if (!focused) return
    const handler = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (wrapperEl && !wrapperEl.contains(e.target as Node)) {
        term?.blur()
        focused = false
      }
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  })

  // Ensure terminal focus
  $effect(() => {
    if (focused && term) {
      const id = requestAnimationFrame(() => term?.focus())
      return () => cancelAnimationFrame(id)
    }
  })

  function connect() {
    if (ws) return
    if (!term) return

    const socket = new WebSocket(getWsUrl())
    ws = socket

    socket.onopen = () => {
      reconnectDelay = 1000
      status = 'connected'

      if (sessionId) {
        socket.send(JSON.stringify({ type: 'daemon:attach', sessionId }))
      } else {
        socket.send(JSON.stringify({ type: 'daemon:create', command: '' }))
      }
      if (term) socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    socket.onmessage = (ev) => {
      const msg = parseWsMessage(ev.data)
      if (!msg) {
        if (typeof ev.data === 'string') term?.write(ev.data)
        return
      }
      if (msg.type === 'output') {
        term?.write(msg.data)
      } else if (msg.type === 'daemon:created') {
        onSessionCreated?.(msg.sessionId)
        if (defaultCommand) {
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'input', data: defaultCommand + '\n' }))
            }
          }, 200)
        }
      } else if (msg.type === 'daemon:attached') {
        if (msg.status === 'stopped' || msg.status === 'error') {
          socket.send(JSON.stringify({ type: 'daemon:create', command: '' }))
        }
      } else if (msg.type === 'daemon:status') {
        if (msg.status === 'stopped' || msg.status === 'error') {
          status = 'stopped'
          term?.write('\r\n\x1b[33m[shell exited]\x1b[0m\r\n')
        } else if (msg.status === 'running') {
          status = 'connected'
        }
      } else if (msg.type === 'daemon:error') {
        if (msg.message === 'Session not found') {
          socket.send(JSON.stringify({ type: 'daemon:create', command: '' }))
        } else {
          term?.write(`\x1b[31m[${msg.message}]\x1b[0m\r\n`)
        }
      }
    }

    socket.onclose = () => {
      ws = null
      if (sessionId) {
        status = 'disconnected'
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
          reconnectDelay = Math.min(reconnectDelay * 2, 10000)
        }, reconnectDelay)
      } else {
        term?.write('\r\n\x1b[31m[session ended]\x1b[0m\r\n')
        status = null
      }
    }

    socket.onerror = () => {
      term?.write('\x1b[31m[connection failed — is the PTY server running?]\x1b[0m\r\n')
    }
  }

  // Setup xterm terminal
  $effect(() => {
    if (!containerEl || !active) {
      observer?.disconnect()
      term?.dispose()
      term = null

      observer = null
      return
    }

    const handleLink = (e: MouseEvent, text: string) => {
      if (!(e.ctrlKey || e.metaKey)) return
      try {
        const url = new URL(text)
        if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && onOpenBrowser) {
          onOpenBrowser(text)
          return
        }
      } catch { /* not a valid URL */ }
      if (window.confirm(`You are about to open\n${text}`)) {
        window.open(text, '_blank')
      }
    }

    const t = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Courier New", monospace',
      theme: TERMINAL_THEME,
      allowProposedApi: true,
      linkHandler: { activate: handleLink },
    })

    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon(handleLink))
    t.open(containerEl)
    requestAnimationFrame(() => f.fit())
    if (untrack(() => focused)) t.focus()

    term = t

    // Connect WebSocket now that terminal is ready
    connect()

    t.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    t.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    t.onSelectionChange(() => {
      const sel = t.getSelection()
      if (sel) clipboardWrite(sel)
    })

    const onCtxMenu = (e: Event) => {
      const sel = t.getSelection()
      if (sel && onTextContextMenu) {
        e.preventDefault()
        e.stopPropagation()
        onTextContextMenu(sel, e as MouseEvent)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      clipboardRead().then((text) => {
        if (text && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: text }))
        }
      })
    }
    containerEl.addEventListener('contextmenu', onCtxMenu)

    const obs = new ResizeObserver(() => f.fit())
    obs.observe(containerEl)
    observer = obs

    return () => {
      containerEl?.removeEventListener('contextmenu', onCtxMenu)
      obs.disconnect()
      t.dispose()
      term = null

      observer = null
    }
  })

  // Manage WS lifecycle
  $effect(() => {
    if (!active) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      ws?.close()
      ws = null
      status = null
      return
    }
    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      const socket = ws
      if (socket) {
        socket.onclose = null
        socket.onmessage = null
        socket.onerror = null
        socket.close()
      }
      ws = null
    }
  })

  let statusColor = $derived(
    status === 'connected' ? '#69db7c'
    : status === 'disconnected' ? '#ffd43b'
    : status === 'stopped' ? '#5a5a8a'
    : undefined
  )

  let satUrl = $derived(
    sessionId && satellitePassword
      ? `${window.location.origin}/?satellite=${encodeURIComponent(sessionId)}&password=${encodeURIComponent(satellitePassword)}`
      : ''
  )
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={wrapperEl}
  style="display:flex;flex-direction:column;width:100%;height:100%;"
  onkeydown={(e) => e.stopPropagation()}
>
  <WidgetHeader
    icon={active ? '●' : '○'}
    iconColor={active ? '#69db7c' : '#555'}
  >
    {#snippet label()}
      <span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">{defaultCommand || '(no command)'}</span>
    {/snippet}
    {#snippet children()}
      <span style="color:{focused ? '#ffd43b' : '#333'};font-size:7px;line-height:10px;">●</span>
      {#if persistent}
        <span style="color:#7c8fff;font-size:9px;padding:0 4px;background:#1a1a3a;border-radius:3px;line-height:14px;">
          {satellitePassword ? 'satellite' : 'persist'}
        </span>
      {/if}
      {#if persistent && satellitePassword && sessionId}
        <button
          title="Open satellite link"
          style="display:inline-flex;align-items:center;gap:3px;color:#7c8fff;font-size:9px;background:#1a1a3a;border:none;border-radius:3px;padding:0 5px;cursor:pointer;flex-shrink:0;line-height:14px;font-family:inherit;"
          onpointerdown={(e) => { e.stopPropagation(); e.preventDefault() }}
          onclick={(e) => {
            e.stopPropagation()
            satelliteAnchor = (e.currentTarget as HTMLElement).getBoundingClientRect()
          }}
        >
          <span style="font-size:10px">&#x1F517;</span>
          open
        </button>
      {/if}
      {#if persistent && statusColor}
        <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;" style:background={statusColor}></span>
      {/if}
    {/snippet}
  </WidgetHeader>
  {#if active}
    <div style="flex:1;overflow:hidden;position:relative;">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={containerEl}
        style="width:100%;height:100%;"
        onpointerdown={(e) => e.stopPropagation()}
      ></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        style="position:absolute;inset:0;cursor:{focused ? 'default' : 'pointer'};pointer-events:{focused ? 'none' : 'auto'};"
        onpointerdown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          focused = true
        }}
      ></div>
    </div>
  {:else}
    <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#444;font-size:12px;font-family:'JetBrains Mono',monospace;">
      click to start
    </div>
  {/if}
  {#if satelliteAnchor && sessionId && satellitePassword}
    <SatelliteShareModal
      url={satUrl}
      anchorRect={satelliteAnchor}
      onClose={() => satelliteAnchor = null}
    />
  {/if}
</div>
