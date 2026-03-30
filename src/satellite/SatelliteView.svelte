<script lang="ts">
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { HTTP_URL, getSatelliteWsUrl } from '../config'
  import { THEME } from '../theme'
  import '@xterm/xterm/css/xterm.css'
  import './SatelliteView.css'

  let { sessionId, initialPassword }: {
    sessionId: string
    initialPassword?: string
  } = $props()

  const KEYS: { label: string; data: string }[] = [
    { label: 'Esc', data: '\x1b' },
    { label: 'Tab', data: '\t' },
    { label: 'Ctrl+C', data: '\x03' },
    { label: 'Ctrl+D', data: '\x04' },
    { label: 'Ctrl+Z', data: '\x1a' },
    { label: 'Ctrl+L', data: '\x0c' },
    { label: 'Up', data: '\x1b[A' },
    { label: 'Down', data: '\x1b[B' },
    { label: 'Left', data: '\x1b[D' },
    { label: 'Right', data: '\x1b[C' },
    { label: '|', data: '|' },
    { label: '~', data: '~' },
  ]

  type Status = 'connecting' | 'connected' | 'disconnected'

  let authedPassword = $state<string | null>(null)
  let fatalError = $state<string | null>(null)

  // Login sub-state
  let loginPassword = $state('')
  let loginError = $state<string | null>(null)
  let loginChecking = $state(false)
  let loginTried = false

  // Terminal sub-state
  let termStatus = $state<Status>('connecting')
  let revoked = $state(false)
  let containerEl: HTMLDivElement
  let wsRef: WebSocket | null = null

  async function validate(pwd: string) {
    console.log(`[DBG] SatelliteView.validate sessionId=${sessionId} pwd=${pwd.slice(0, 8)}...`)
    loginChecking = true
    loginError = null
    try {
      const res = await fetch(`${HTTP_URL}/satellite/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, password: pwd }),
      })
      console.log(`[DBG] SatelliteView.validate response: ${res.status}`)
      if (res.ok) {
        console.log('[DBG] SatelliteView.validate SUCCESS — authed')
        authedPassword = pwd
      } else {
        const body = await res.text()
        console.log(`[DBG] SatelliteView.validate FAILED: ${res.status} body=${body}`)
        loginError = 'Wrong password'
        loginPassword = ''
      }
    } catch (err) {
      console.log('[DBG] SatelliteView.validate FETCH ERROR:', err)
      fatalError = 'Cannot reach server'
    } finally {
      loginChecking = false
    }
  }

  // Auto-validate if initialPassword provided
  $effect(() => {
    if (initialPassword && !loginTried) {
      console.log(`[DBG] SatelliteView auto-validate triggered sessionId=${sessionId}`)
      loginTried = true
      validate(initialPassword)
    }
  })

  function loginSubmit() {
    if (!loginPassword.trim() || loginChecking) return
    validate(loginPassword.trim())
  }

  // Terminal setup
  $effect(() => {
    if (!authedPassword || !containerEl) return

    // Set viewport meta for mobile
    let metaTag = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
    const origContent = metaTag?.content || ''
    if (metaTag) {
      metaTag.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    }

    const term = new Terminal({
      theme: THEME,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      cursorBlink: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerEl)
    fit.fit()

    let reconnectDelay = 1000
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0

    function connect() {
      console.log(`[DBG] SatelliteView.connect() sessionId=${sessionId} attempt=${reconnectAttempts}`)
      termStatus = 'connecting'
      const ws = new WebSocket(getSatelliteWsUrl(sessionId, authedPassword!))
      wsRef = ws

      ws.onopen = () => { console.log('[DBG] SatelliteView WS open'); termStatus = 'connected'; reconnectDelay = 1000; reconnectAttempts = 0 }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'output') term.write(msg.data)
          else if (msg.type === 'daemon:attached') { console.log(`[DBG] SatelliteView daemon:attached status=${msg.status}`); termStatus = 'connected' }
        } catch {}
      }
      ws.onclose = (e) => {
        console.log(`[DBG] SatelliteView WS close code=${e.code} reason=${e.reason} attempts=${reconnectAttempts}`)
        wsRef = null; reconnectAttempts++
        if (reconnectAttempts >= 10) { console.log('[DBG] SatelliteView REVOKED after 10 attempts'); revoked = true; return }
        termStatus = 'disconnected'
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null; connect()
          reconnectDelay = Math.min(reconnectDelay * 2, 10000)
        }, reconnectDelay)
      }
      ws.onerror = () => { console.log('[DBG] SatelliteView WS error') }
    }

    connect()

    const inputDisposable = term.onData((data) => {
      if (wsRef?.readyState === WebSocket.OPEN) wsRef.send(JSON.stringify({ type: 'input', data }))
    })
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (wsRef?.readyState === WebSocket.OPEN) wsRef.send(JSON.stringify({ type: 'resize', cols, rows }))
    })

    let prevTouchY = 0
    function onContainerTouchMove(e: TouchEvent) {
      if (e.touches.length === 1) {
        e.preventDefault()
        const delta = prevTouchY - e.touches[0].clientY
        term.scrollLines(delta > 0 ? 1 : delta < 0 ? -1 : 0)
      }
      prevTouchY = e.touches[0]?.clientY ?? prevTouchY
    }
    function onContainerTouchStart(e: TouchEvent) {
      prevTouchY = e.touches[0]?.clientY ?? 0
    }

    function onViewportResize() {
      if (window.visualViewport && containerEl) {
        const root = containerEl.closest('.satellite-root') as HTMLElement | null
        if (root) root.style.height = `${window.visualViewport.height}px`
        fit.fit()
      }
    }
    const onWindowResize = () => fit.fit()
    window.visualViewport?.addEventListener('resize', onViewportResize)
    window.addEventListener('resize', onWindowResize)
    containerEl.addEventListener('touchmove', onContainerTouchMove, { passive: false })
    containerEl.addEventListener('touchstart', onContainerTouchStart, { passive: true })

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      inputDisposable.dispose(); resizeDisposable.dispose()
      if (wsRef) wsRef.close()
      term.dispose()
      window.visualViewport?.removeEventListener('resize', onViewportResize)
      window.removeEventListener('resize', onWindowResize)
      containerEl.removeEventListener('touchmove', onContainerTouchMove)
      containerEl.removeEventListener('touchstart', onContainerTouchStart)
      const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
      if (meta) meta.content = origContent
    }
  })

  function sendKey(data: string) {
    if (wsRef?.readyState === WebSocket.OPEN) wsRef.send(JSON.stringify({ type: 'input', data }))
  }
</script>

{#if fatalError}
  <div class="satellite-overlay">
    <div class="satellite-overlay-box">
      <div class="icon">&#x26A0;</div>
      <div class="message">{fatalError}</div>
      <div class="detail">This satellite session may have been revoked or no longer exists.</div>
    </div>
  </div>
{:else if !authedPassword}
  {#if initialPassword && !loginError}
    <div class="satellite-overlay">
      <div class="satellite-overlay-box">
        <div style="color:#888;font-size:14px;">Connecting...</div>
      </div>
    </div>
  {:else}
    <div class="satellite-overlay">
      <div class="satellite-overlay-box">
        <div style="color:#888;font-size:14px;margin-bottom:16px;">satellite</div>
        <input
          type="password"
          bind:value={loginPassword}
          onkeydown={(e) => e.key === 'Enter' && loginSubmit()}
          placeholder="Password"
          autofocus
          style="background:#1a1a1a;border:1px solid #333;border-radius:6px;color:#eee;padding:10px 16px;font-size:14px;width:240px;outline:none;font-family:monospace;"
        />
        <button
          onclick={loginSubmit}
          disabled={loginChecking}
          style="background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#ccc;padding:8px 24px;font-size:13px;cursor:pointer;font-family:monospace;margin-top:12px;"
        >{loginChecking ? '...' : 'Connect'}</button>
        {#if loginError}
          <div style="color:#e55;font-size:13px;margin-top:10px;">{loginError}</div>
        {/if}
      </div>
    </div>
  {/if}
{:else if revoked}
  <div class="satellite-overlay">
    <div class="satellite-overlay-box">
      <div class="icon">&#x26A0;</div>
      <div class="message">Session lost</div>
      <div class="detail">This satellite session may have been revoked or is no longer reachable.</div>
    </div>
  </div>
{:else}
  <div class="satellite-root">
    <div class="satellite-status">
      <span class="satellite-status-dot {termStatus}"></span>
      <span>{termStatus === 'connected' ? 'Connected' : termStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}</span>
      <span style="opacity:0.5;margin-left:auto;font-size:11px;">satellite</span>
    </div>
    <div class="satellite-terminal" bind:this={containerEl}></div>
    <div class="satellite-toolbar">
      {#each KEYS as k}
        <button class="satellite-key" onpointerdown={(e) => { e.preventDefault(); sendKey(k.data) }}>{k.label}</button>
      {/each}
    </div>
  </div>
{/if}
