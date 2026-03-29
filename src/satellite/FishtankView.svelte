<script lang="ts">
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { getFishtankWsUrl, getFishtankHttpUrl } from '../config'
  import { THEME } from '../theme'
  import '@xterm/xterm/css/xterm.css'
  import './FishtankView.css'

  let { sessionId, initialPassword }: {
    sessionId: string
    initialPassword?: string
  } = $props()

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
    console.log(`[DBG] FishtankView.validate sessionId=${sessionId} pwd=${pwd.slice(0, 8)}...`)
    loginChecking = true
    loginError = null
    try {
      const res = await fetch(`${getFishtankHttpUrl()}/fishtank/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, password: pwd }),
      })
      console.log(`[DBG] FishtankView.validate response: ${res.status}`)
      if (res.ok) {
        console.log('[DBG] FishtankView.validate SUCCESS — authed')
        authedPassword = pwd
      } else {
        const body = await res.text()
        console.log(`[DBG] FishtankView.validate FAILED: ${res.status} body=${body}`)
        loginError = 'Wrong password'
        loginPassword = ''
      }
    } catch (err) {
      console.log('[DBG] FishtankView.validate FETCH ERROR:', err)
      fatalError = 'Cannot reach server'
    } finally {
      loginChecking = false
    }
  }

  // Auto-validate if initialPassword provided
  $effect(() => {
    if (initialPassword && !loginTried) {
      console.log(`[DBG] FishtankView auto-validate triggered sessionId=${sessionId}`)
      loginTried = true
      validate(initialPassword)
    }
  })

  function loginSubmit() {
    if (!loginPassword.trim() || loginChecking) return
    validate(loginPassword.trim())
  }

  // Terminal setup — read-only, no input
  $effect(() => {
    if (!authedPassword || !containerEl) return

    let metaTag = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
    const origContent = metaTag?.content || ''
    if (metaTag) {
      metaTag.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    }

    const term = new Terminal({
      theme: THEME,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      cursorBlink: false,
      disableStdin: true,
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
      console.log(`[DBG] FishtankView.connect() sessionId=${sessionId} attempt=${reconnectAttempts}`)
      termStatus = 'connecting'
      const ws = new WebSocket(getFishtankWsUrl(sessionId, authedPassword!))
      wsRef = ws

      ws.onopen = () => { console.log('[DBG] FishtankView WS open'); termStatus = 'connected'; reconnectDelay = 1000; reconnectAttempts = 0 }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'output') term.write(msg.data)
          else if (msg.type === 'fishtank:connected') { console.log(`[DBG] FishtankView fishtank:connected`); termStatus = 'connected' }
        } catch {}
      }
      ws.onclose = (e) => {
        console.log(`[DBG] FishtankView WS close code=${e.code} reason=${e.reason} attempts=${reconnectAttempts}`)
        wsRef = null; reconnectAttempts++
        if (reconnectAttempts >= 10) { console.log('[DBG] FishtankView REVOKED after 10 attempts'); revoked = true; return }
        termStatus = 'disconnected'
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null; connect()
          reconnectDelay = Math.min(reconnectDelay * 2, 10000)
        }, reconnectDelay)
      }
      ws.onerror = () => { console.log('[DBG] FishtankView WS error') }
    }

    connect()

    // NO input listener — this is the whole point
    // NO resize sending — viewer doesn't control PTY dimensions

    const onWindowResize = () => fit.fit()
    function onViewportResize() {
      if (window.visualViewport && containerEl) {
        const root = containerEl.closest('.fishtank-root') as HTMLElement | null
        if (root) root.style.height = `${window.visualViewport.height}px`
        fit.fit()
      }
    }
    window.visualViewport?.addEventListener('resize', onViewportResize)
    window.addEventListener('resize', onWindowResize)

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (wsRef) wsRef.close()
      term.dispose()
      window.visualViewport?.removeEventListener('resize', onViewportResize)
      window.removeEventListener('resize', onWindowResize)
      const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
      if (meta) meta.content = origContent
    }
  })
</script>

{#if fatalError}
  <div class="fishtank-overlay">
    <div class="fishtank-overlay-box">
      <div class="icon">&#x26A0;</div>
      <div class="message">{fatalError}</div>
      <div class="detail">This fishtank session may have been revoked or no longer exists.</div>
    </div>
  </div>
{:else if !authedPassword}
  {#if initialPassword && !loginError}
    <div class="fishtank-overlay">
      <div class="fishtank-overlay-box">
        <div style="color:#888;font-size:14px;">Connecting...</div>
      </div>
    </div>
  {:else}
    <div class="fishtank-overlay">
      <div class="fishtank-overlay-box">
        <div style="color:#888;font-size:14px;margin-bottom:16px;">fishtank</div>
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
  <div class="fishtank-overlay">
    <div class="fishtank-overlay-box">
      <div class="icon">&#x26A0;</div>
      <div class="message">Session lost</div>
      <div class="detail">This fishtank session may have been revoked or is no longer reachable.</div>
    </div>
  </div>
{:else}
  <div class="fishtank-root">
    <div class="fishtank-status">
      <span class="fishtank-status-dot {termStatus}"></span>
      <span>{termStatus === 'connected' ? 'Connected' : termStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}</span>
      <span style="opacity:0.5;margin-left:auto;font-size:11px;">fishtank &middot; view only</span>
    </div>
    <div class="fishtank-terminal" bind:this={containerEl}></div>
  </div>
{/if}
