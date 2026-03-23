<script lang="ts">
  let { command, output, done, exitCode, onRemove }: {
    command: string
    output: string
    done: boolean
    exitCode?: number
    onRemove: () => void
  } = $props()

  type Phase = 'materialize' | 'streaming' | 'linger' | 'dematerialize'
  let phase = $state<Phase>('materialize')
  let scrollEl: HTMLDivElement

  // materialize → streaming
  $effect(() => {
    if (phase !== 'materialize') return
    const t = setTimeout(() => phase = 'streaming', 350)
    return () => clearTimeout(t)
  })

  // Auto-scroll
  $effect(() => {
    void output
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
  })

  // Safety net: force-dismiss if done never becomes true
  $effect(() => {
    if (done || phase === 'linger' || phase === 'dematerialize') return
    const t = setTimeout(() => phase = 'linger', 120_000)
    return () => clearTimeout(t)
  })

  // done → linger
  $effect(() => {
    if (!done || phase === 'linger' || phase === 'dematerialize') return
    const delay = exitCode !== undefined && exitCode !== 0 ? 2500 : 1000
    const t = setTimeout(() => phase = 'linger', delay)
    return () => clearTimeout(t)
  })

  // linger → dematerialize
  $effect(() => {
    if (phase !== 'linger') return
    const t = setTimeout(() => phase = 'dematerialize', 350)
    return () => clearTimeout(t)
  })

  // dematerialize → remove
  $effect(() => {
    if (phase !== 'dematerialize') return
    const t = setTimeout(onRemove, 350)
    return () => clearTimeout(t)
  })

  let isError = $derived(exitCode !== undefined && exitCode !== 0)
  let borderColor = $derived(
    phase === 'dematerialize' ? '#1a1a2a'
    : isError ? '#ff6b6b'
    : '#5a5a8a'
  )
  let textColor = $derived(isError ? '#ff6b6b' : '#bbb')

  let opacity = $derived(phase === 'materialize' ? 0 : phase === 'dematerialize' ? 0 : 1)
  let transform = $derived(
    phase === 'materialize' ? 'scaleY(0.05) scaleX(0.7)'
    : phase === 'dematerialize' ? 'scale(0.3)'
    : 'scaleY(1) scaleX(1)'
  )
  let transition = $derived(
    phase === 'materialize'
      ? 'opacity 0.15s ease-out, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)'
      : phase === 'dematerialize'
        ? 'opacity 0.25s ease-in, transform 0.3s cubic-bezier(0.55, 0, 1, 0.45)'
        : 'border-color 0.3s'
  )
  let boxShadow = $derived(
    phase === 'dematerialize' ? 'none'
    : `0 0 20px rgba(90, 90, 138, 0.15), 0 0 2px ${borderColor}`
  )
</script>

<div
  style="position:relative;width:420px;max-height:280px;background:rgba(12,12,12,0.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid {borderColor};border-radius:6px;overflow:hidden;font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;line-height:16px;pointer-events:none;transform-origin:left bottom;"
  style:opacity
  style:transform
  style:transition
  style:box-shadow={boxShadow}
>
  <!-- Scanline overlay -->
  <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(124,143,255,0.015) 2px,rgba(124,143,255,0.015) 4px);pointer-events:none;z-index:1;"></div>

  <!-- Header -->
  <div style="padding:3px 8px;border-bottom:1px solid #2a2a2a;background:rgba(22,22,22,0.6);color:#7c8fff;font-size:10px;display:flex;align-items:center;gap:6px;">
    <span style="opacity:0.4;font-size:9px">$</span>
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#aaa;">
      {command}
    </span>
    {#if !done}
      <span class="eph-blink" style="color:#7c8fff;font-size:8px;">●</span>
    {/if}
    {#if done && exitCode !== undefined}
      <span style="color:{isError ? '#ff6b6b' : '#69db7c'};font-size:9px;">
        exit {exitCode}
      </span>
    {/if}
  </div>

  <!-- Output -->
  <div
    bind:this={scrollEl}
    style="padding:4px 8px;max-height:240px;overflow:hidden;white-space:pre-wrap;word-break:break-all;"
    style:color={textColor}
  >
    {#if output}
      {output}
    {:else if !done}
      <span style="color:#555">...</span>
    {/if}
  </div>
</div>
