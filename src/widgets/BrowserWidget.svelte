<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { authHeaders } from '../config'
  import WidgetHeader from '../components/WidgetHeader.svelte'

  let { url, active, onUpdateUrl }: {
    url: string
    active: boolean
    onUpdateUrl: (url: string) => void
  } = $props()

  interface Viewport { label: string; w: number; h: number }

  const VIEWPORTS: Viewport[] = [
    { label: 'Auto', w: 0, h: 0 },
    { label: 'Custom', w: -1, h: -1 },
    { label: '3840×2160 (4K)', w: 3840, h: 2160 },
    { label: '3440×1440 (UW)', w: 3440, h: 1440 },
    { label: '2560×1440 (QHD)', w: 2560, h: 1440 },
    { label: '2560×1080 (UW)', w: 2560, h: 1080 },
    { label: '1920×1080 (FHD)', w: 1920, h: 1080 },
    { label: '1680×1050', w: 1680, h: 1050 },
    { label: '1440×900', w: 1440, h: 900 },
    { label: '1366×768', w: 1366, h: 768 },
    { label: '1280×720 (HD)', w: 1280, h: 720 },
    { label: '1024×768', w: 1024, h: 768 },
    { label: '768×1024', w: 768, h: 1024 },
    { label: '430×932', w: 430, h: 932 },
    { label: '390×844', w: 390, h: 844 },
    { label: '375×667', w: 375, h: 667 },
    { label: '360×800', w: 360, h: 800 },
  ]

  function parseUrl(raw: string): { port: string; path: string } {
    if (!raw) return { port: '', path: '/' }
    const match = raw.match(/^\/__browse__\/(\d+)(.*)/)
    if (match) return { port: match[1], path: match[2] || '/' }
    try {
      const u = new URL(raw)
      return { port: u.port || '', path: u.pathname || '/' }
    } catch {
      return { port: '', path: '/' }
    }
  }

  function serializeUrl(port: string, path: string): string {
    const p = path.startsWith('/') ? path : '/' + path
    return `/__browse__/${port}${p}`
  }

  const initial = parseUrl(url)
  let port = $state(initial.port)
  let path = $state(initial.path)
  let proxyPort = $state<number | null>(null)
  let iframeSrc = $state('')
  let refreshKey = $state(0)
  let loadingState = $state(false)
  let error = $state<string | null>(null)
  let diag = $state<{ appOrigin: string; proxyPort: number | null; targetPort: string; iframeSrc: string; fetchResult: string; isMixedContent: boolean } | null>(null)
  let viewport = $state<Viewport>(VIEWPORTS[0])
  let customW = $state('1920')
  let customH = $state('1080')
  let containerSize = $state({ w: 0, h: 0 })
  let iframeEl: HTMLIFrameElement
  let containerEl: HTMLDivElement
  let mounted = true

  onDestroy(() => { mounted = false })

  // Track container size
  $effect(() => {
    if (!containerEl) return
    const ro = new ResizeObserver(([entry]) => {
      containerSize = { w: entry.contentRect.width, h: entry.contentRect.height }
    })
    ro.observe(containerEl)
    return () => ro.disconnect()
  })

  let isAuto = $derived(viewport.w === 0)
  let isCustom = $derived(viewport.w === -1)
  let resolvedW = $derived(isAuto ? containerSize.w : isCustom ? (parseInt(customW) || 1920) : viewport.w)
  let resolvedH = $derived(isAuto ? containerSize.h : isCustom ? (parseInt(customH) || 1080) : viewport.h)
  let scale = $derived(isAuto ? 1 : Math.min(containerSize.w / resolvedW, containerSize.h / resolvedH, 1))

  async function navigate(p: string, pa: string) {
    if (!p.trim()) {
      error = null; iframeSrc = ''; proxyPort = null; onUpdateUrl(''); return
    }
    const portNum = parseInt(p.trim())
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      error = 'Invalid port (1-65535)'; return
    }
    error = null; diag = null; loadingState = true
    try {
      const res = await fetch('/browse-proxy', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ port: portNum }),
      })
      const data = await res.json()
      if (!mounted) return
      if (data.error) throw new Error(data.error)
      proxyPort = data.proxyPort
      const pathStr = pa.startsWith('/') ? pa : '/' + pa
      iframeSrc = `http://${window.location.hostname}:${data.proxyPort}${pathStr}`
      refreshKey++
      onUpdateUrl(serializeUrl(p.trim(), pa))
    } catch (err) {
      if (!mounted) return
      error = err instanceof Error ? err.message : 'Failed to create proxy'
      loadingState = false
    }
  }

  onMount(() => {
    if (initial.port) navigate(initial.port, initial.path)
  })

  async function runDiagnostic() {
    const result = {
      appOrigin: window.location.origin,
      proxyPort,
      targetPort: port.trim(),
      iframeSrc,
      fetchResult: 'pending',
      isMixedContent: window.location.protocol === 'https:',
    }
    if (proxyPort) {
      try {
        const testUrl = `http://${window.location.hostname}:${proxyPort}/`
        const res = await fetch(testUrl, { mode: 'no-cors' })
        result.fetchResult = `OK (status: ${res.status}, type: ${res.type})`
      } catch (e: unknown) {
        result.fetchResult = `FAILED: ${e instanceof Error ? e.message : String(e)}`
      }
    } else {
      result.fetchResult = 'No proxy active — click Go first'
    }
    diag = { ...result }
  }

  function refresh() {
    error = null; diag = null
    if (iframeSrc) { refreshKey++; loadingState = true }
    else if (port) navigate(port, path)
  }

  function goBack() {
    try { iframeEl?.contentWindow?.history.back() } catch { /* cross-origin */ }
  }

  function goForward() {
    try { iframeEl?.contentWindow?.history.forward() } catch { /* cross-origin */ }
  }

  const btnStyle = "background:#1a1a2e;border:1px solid #3a3a3a;border-radius:3px;color:#aaa;cursor:pointer;padding:2px 6px;font-size:12px;line-height:16px;display:flex;align-items:center;justify-content:center;min-width:24px;height:22px;"
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="⊞">
    {#snippet label()}
      <span style="color:{active ? '#aaa' : '#666'}">Browser</span>
    {/snippet}
    {#snippet children()}
      {#if !active}
        <span style="color:#444;font-size:9px;margin-left:4px;">inactive</span>
      {/if}
      {#if active && !isAuto}
        <span style="color:#555;font-size:9px;margin-left:4px;">
          {isCustom ? `${resolvedW}×${resolvedH}` : viewport.label} ({Math.round(scale * 100)}%)
        </span>
      {/if}
      {#if active && proxyPort}
        <span style="color:#444;font-size:9px;margin-left:4px;">:{proxyPort}</span>
      {/if}
      {#if active && loadingState}
        <span style="color:#7c8fff;font-size:9px;margin-left:auto;">loading...</span>
      {/if}
    {/snippet}
  </WidgetHeader>

  <!-- Toolbar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    onpointerdown={(e) => e.stopPropagation()}
    style="flex-shrink:0;display:flex;align-items:center;gap:4px;padding:4px 6px;background:#111;border-bottom:1px solid #2a2a2a;opacity:{active ? 1 : 0.5};pointer-events:{active ? 'auto' : 'none'};"
  >
    <button style={btnStyle} onclick={goBack} title="Back">◀</button>
    <button style={btnStyle} onclick={goForward} title="Forward">▶</button>
    <button style={btnStyle} onclick={refresh} title="Refresh">↻</button>

    <span style="color:#555;font-size:11px;margin-left:4px;font-family:'JetBrains Mono','Fira Code',monospace;user-select:none;">localhost:</span>

    <input
      bind:value={port}
      onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') navigate(port, path) }}
      onfocus={(e) => (e.target as HTMLInputElement).select()}
      placeholder="port"
      style="width:52px;background:#0c0c0c;border:1px solid #3a3a3a;border-radius:3px;color:#e0e0e0;padding:2px 6px;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;outline:none;height:22px;box-sizing:border-box;"
    />

    <span style="color:#555;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;user-select:none;">/</span>

    <input
      value={path.replace(/^\//, '')}
      oninput={(e) => { path = '/' + (e.currentTarget as HTMLInputElement).value }}
      onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') navigate(port, path) }}
      placeholder="path"
      style="flex:1;min-width:40px;background:#0c0c0c;border:1px solid #3a3a3a;border-radius:3px;color:#e0e0e0;padding:2px 6px;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;outline:none;height:22px;box-sizing:border-box;"
    />

    <select
      value={viewport.label}
      onchange={(e) => {
        const vp = VIEWPORTS.find(v => v.label === (e.target as HTMLSelectElement).value)
        if (vp) viewport = vp
      }}
      onpointerdown={(e) => e.stopPropagation()}
      style="background:#0c0c0c;border:1px solid #3a3a3a;border-radius:3px;color:#aaa;padding:2px 4px;font-size:9px;font-family:'JetBrains Mono','Fira Code',monospace;outline:none;height:22px;cursor:pointer;"
      title="Viewport size"
    >
      {#each VIEWPORTS as v}
        <option value={v.label}>{v.label}</option>
      {/each}
    </select>

    {#if isCustom}
      <input
        bind:value={customW}
        onkeydown={(e) => e.stopPropagation()}
        onfocus={(e) => (e.target as HTMLInputElement).select()}
        placeholder="w"
        style="width:40px;background:#0c0c0c;border:1px solid #3a3a3a;border-radius:3px;color:#e0e0e0;padding:2px 4px;font-size:9px;font-family:'JetBrains Mono','Fira Code',monospace;outline:none;height:22px;box-sizing:border-box;text-align:center;"
      />
      <span style="color:#555;font-size:9px;">×</span>
      <input
        bind:value={customH}
        onkeydown={(e) => e.stopPropagation()}
        onfocus={(e) => (e.target as HTMLInputElement).select()}
        placeholder="h"
        style="width:40px;background:#0c0c0c;border:1px solid #3a3a3a;border-radius:3px;color:#e0e0e0;padding:2px 4px;font-size:9px;font-family:'JetBrains Mono','Fira Code',monospace;outline:none;height:22px;box-sizing:border-box;text-align:center;"
      />
    {/if}

    <button style="{btnStyle}color:#7c8fff;" onclick={() => navigate(port, path)} title="Go">Go</button>
    <button style="{btnStyle}color:#ff6b6b;font-size:9px;" onclick={runDiagnostic} title="Run connection diagnostic">DBG</button>
  </div>

  {#if active && error}
    <div style="padding:4px 10px;background:#1a0a0a;border-bottom:1px solid #3a2a2a;color:#ff6b6b;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;">{error}</div>
  {/if}

  {#if active && diag}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onpointerdown={(e) => e.stopPropagation()}
      style="flex-shrink:0;padding:6px 10px;background:#0d0d1a;border-bottom:1px solid #2a2a3a;font-size:10px;line-height:16px;font-family:'JetBrains Mono','Fira Code',monospace;color:#aaa;max-height:160px;overflow:auto;user-select:text;"
    >
      <div style="color:#7c8fff;margin-bottom:4px;">-- Diagnostic --</div>
      <div>App origin: <span style="color:#e0e0e0">{diag.appOrigin}</span></div>
      <div>Target port: <span style="color:#e0e0e0">{diag.targetPort}</span></div>
      <div>Proxy port: <span style="color:#e0e0e0">{diag.proxyPort ?? 'none'}</span></div>
      <div>Iframe src: <span style="color:#e0e0e0">{diag.iframeSrc || 'none'}</span></div>
      <div>Mixed content: <span style="color:{diag.isMixedContent ? '#ff6b6b' : '#69db7c'}">{diag.isMixedContent ? 'YES (HTTPS app → HTTP proxy)' : 'No'}</span></div>
      <div>Fetch proxy: <span style="color:{diag.fetchResult.startsWith?.('OK') ? '#69db7c' : '#ff6b6b'}">{diag.fetchResult}</span></div>
      <button style="{btnStyle}margin-top:4px;font-size:9px;color:#555;" onclick={() => diag = null}>close</button>
    </div>
  {/if}

  <!-- Content area -->
  <div
    bind:this={containerEl}
    style="flex:1;overflow:hidden;position:relative;background:#0a0a0a;"
  >
    {#if !active}
      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#333;font-size:12px;font-family:'JetBrains Mono','Fira Code',monospace;">
        <span style="font-size:24px;opacity:0.2;">⊞</span>
      </div>
    {:else if iframeSrc}
      {#key refreshKey}
      <iframe
        bind:this={iframeEl}
        src={iframeSrc}
        onload={() => { loadingState = false }}
        onerror={() => { loadingState = false; error = 'Failed to load' }}
        title="Browser preview"
        style="border:none;background:#0a0a0a;transform-origin:0 0;{isAuto ? 'width:100%;height:100%;' : `width:${resolvedW}px;height:${resolvedH}px;transform:scale(${scale});`}"
      ></iframe>
      {/key}
    {:else}
      <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#555;font-size:12px;font-family:'JetBrains Mono','Fira Code',monospace;">
        <span style="font-size:24px;opacity:0.3;">⊞</span>
        <span>Enter a port to browse</span>
        <span style="font-size:10px;color:#444;">e.g. 3000, 8080, 5173</span>
      </div>
    {/if}
  </div>
</div>
