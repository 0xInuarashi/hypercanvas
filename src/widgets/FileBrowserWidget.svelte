<script lang="ts">
  import { onMount } from 'svelte'
  import { HTTP_URL, clipboardWrite, authHeaders } from '../config'
  import { portal } from '../lib/portal'
  import WidgetHeader from '../components/WidgetHeader.svelte'
  import '../canvas/ContextMenu.css'

  let { initialPath, onSetDefaultPath, onOpenInReader }: {
    initialPath?: string
    onSetDefaultPath?: (path: string) => void
    onOpenInReader?: (filePath: string) => void
  } = $props()

  interface Entry { name: string; isDir: boolean }
  interface CtxMenu { x: number; y: number; path: string; isDir: boolean }

  let cwd = $state(initialPath || '~')
  let entries = $state<Entry[]>([])
  let resolvedPath = $state('')
  let error = $state<string | null>(null)
  let loading = $state(false)
  let copied = $state<string | null>(null)
  let ctxMenu = $state<CtxMenu | null>(null)
  let listEl = $state<HTMLDivElement>(undefined!)

  async function fetchDir(path: string) {
    loading = true
    error = null
    try {
      const res = await fetch(`${HTTP_URL}/ls?path=${encodeURIComponent(path)}`, { headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) {
        error = data.error || 'Failed to list directory'
        return
      }
      resolvedPath = data.path
      entries = data.entries
      cwd = data.path
      if (listEl) listEl.scrollTop = 0
      if (onSetDefaultPath) onSetDefaultPath(data.path)
    } catch {
      error = 'Connection failed'
    } finally {
      loading = false
    }
  }

  onMount(() => { fetchDir(cwd) })

  function navigate(name: string) {
    fetchDir(resolvedPath + '/' + name)
  }

  function goUp() {
    const parent = resolvedPath.replace(/\/[^/]+$/, '') || '/'
    fetchDir(parent)
  }

  function copyPath(entryName?: string) {
    const path = entryName ? resolvedPath + '/' + entryName : resolvedPath
    clipboardWrite(path)
    copied = path
    setTimeout(() => { copied = null }, 1500)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="☰" iconColor="#69db7c">
    {#snippet label()}
      <span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title={resolvedPath}>{resolvedPath || 'Files'}</span>
    {/snippet}
    {#snippet children()}
      {#if loading}
        <span style="color:#ffd43b;font-size:10px;flex-shrink:0;">loading...</span>
      {/if}
    {/snippet}
  </WidgetHeader>

  <!-- Path bar -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="flex-shrink:0;display:flex;align-items:center;gap:6px;padding:4px 8px;background:#111;border-bottom:1px solid #2a2a2a;font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;min-height:28px;"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <button
      onclick={goUp}
      style="background:none;border:1px solid #3a3a3a;border-radius:4px;color:#aaa;font-size:11px;cursor:pointer;padding:2px 6px;flex-shrink:0;"
      title="Go up"
    >..</button>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      style="color:#7c8fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;direction:rtl;text-align:left;"
      title={resolvedPath}
      oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); copyPath() }}
    >{resolvedPath}</span>
  </div>

  <!-- Copied toast -->
  {#if copied}
    <div style="position:absolute;top:60px;left:50%;transform:translateX(-50%);padding:4px 10px;background:#1a2a4a;border:1px solid #3a5a8a;border-radius:6px;color:#7c8fff;font-size:10px;font-family:'JetBrains Mono',monospace;z-index:10;pointer-events:none;white-space:nowrap;">
      Copied
    </div>
  {/if}

  {#if error}
    <div style="padding:8px 10px;color:#ff6b6b;font-size:11px;font-family:'JetBrains Mono',monospace;">{error}</div>
  {/if}

  <!-- File list -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={listEl}
    tabindex="-1"
    style="flex:1;overflow:auto;font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;outline:none;"
    onpointerdown={(e) => { e.stopPropagation(); listEl?.focus() }}
  >
    {#each entries as entry}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        ondblclick={entry.isDir ? () => navigate(entry.name) : undefined}
        oncontextmenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          ctxMenu = { x: e.clientX, y: e.clientY, path: resolvedPath + '/' + entry.name, isDir: entry.isDir }
        }}
        onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.background = '#1a1a2e' }}
        onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        style="display:flex;align-items:center;gap:8px;padding:4px 12px;cursor:{entry.isDir ? 'pointer' : 'default'};color:{entry.isDir ? '#7c8fff' : '#888'};border-bottom:1px solid #1a1a1a;"
      >
        <span style="font-size:10px;width:14px;text-align:center;flex-shrink:0;">
          {entry.isDir ? '📁' : '📄'}
        </span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{entry.name}</span>
      </div>
    {/each}
  </div>

  <!-- Context menu — portaled to body -->
  {#if ctxMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div use:portal onpointerdown={(e) => e.stopPropagation()}>
      <div
        class="context-menu-backdrop"
        onclick={() => ctxMenu = null}
        oncontextmenu={(e) => { e.preventDefault(); ctxMenu = null }}
        role="presentation"
      ></div>
      <div class="context-menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px;">
        <button
          class="context-menu-item"
          onclick={() => { clipboardWrite(ctxMenu!.path); copied = ctxMenu!.path; setTimeout(() => { copied = null }, 1500); ctxMenu = null }}
        >Copy path</button>
        {#if ctxMenu.isDir && onSetDefaultPath}
          <button
            class="context-menu-item"
            onclick={() => {
              const path = ctxMenu!.path
              ctxMenu = null
              onSetDefaultPath!(path)
              fetchDir(path)
            }}
          >Set as default folder</button>
        {/if}
        {#if !ctxMenu.isDir && onOpenInReader}
          <button
            class="context-menu-item"
            onclick={() => { onOpenInReader!(ctxMenu!.path); ctxMenu = null }}
          >Open in reader</button>
        {/if}
      </div>
    </div>
  {/if}
</div>
