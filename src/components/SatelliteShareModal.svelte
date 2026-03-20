<script lang="ts">
  import { onMount } from 'svelte'
  import QRCode from 'qrcode'
  import { portal } from '../lib/portal'
  import { clipboardWrite } from '../config'

  let { url, anchorRect, onClose }: {
    url: string
    anchorRect: DOMRect
    onClose: () => void
  } = $props()

  let panelEl: HTMLDivElement
  let qrDataUrl = $state('')

  onMount(async () => {
    try {
      qrDataUrl = await QRCode.toDataURL(url, { width: 140, margin: 1 })
    } catch { /* ignore */ }
  })

  // Close on click-outside
  $effect(() => {
    const handler = (e: PointerEvent) => {
      if (panelEl && !panelEl.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  })

  // Close on Escape
  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  let top = $derived(anchorRect.bottom + 6)
  let left = $derived(anchorRect.left)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div use:portal>
  <div
    bind:this={panelEl}
    onpointerdown={(e) => e.stopPropagation()}
    style="position:fixed;top:{top}px;left:{left}px;width:260px;background:rgba(12,12,12,0.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid #5a5a8a;border-radius:6px;font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;z-index:99999;box-shadow:0 0 20px rgba(90,90,138,0.15),0 0 2px #5a5a8a;overflow:hidden;"
  >
    <!-- Scanline overlay -->
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(124,143,255,0.015) 2px,rgba(124,143,255,0.015) 4px);pointer-events:none;z-index:1;"></div>

    <!-- Header -->
    <div style="padding:3px 8px;border-bottom:1px solid #2a2a2a;background:rgba(22,22,22,0.6);color:#7c8fff;font-size:10px;display:flex;align-items:center;gap:6px;">
      <span style="opacity:0.4;font-size:9px">&#x1F517;</span>
      <span style="color:#aaa;flex:1">satellite link</span>
    </div>

    <!-- Content -->
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;">
      <div style="background:#fff;border-radius:6px;padding:10px;display:flex;align-items:center;justify-content:center;">
        {#if qrDataUrl}
          <img src={qrDataUrl} alt="QR Code" width="140" height="140" />
        {:else}
          <div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;">Loading...</div>
        {/if}
      </div>

      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        style="background:rgba(0,0,0,0.3);border:1px solid #333;border-radius:4px;padding:5px 8px;width:100%;box-sizing:border-box;color:#7c8fff;font-size:10px;word-break:break-all;cursor:pointer;user-select:all;line-height:15px;"
        title="Click to copy"
        onclick={() => clipboardWrite(url)}
      >{url}</div>

      <button
        onclick={() => window.open(url, '_blank')}
        style="background:rgba(26,26,58,0.6);border:1px solid #3a3a6a;border-radius:4px;color:#7c8fff;padding:5px 10px;font-size:11px;cursor:pointer;font-family:'JetBrains Mono','Fira Code',monospace;width:100%;"
      >Open in a new tab</button>
    </div>
  </div>
</div>
