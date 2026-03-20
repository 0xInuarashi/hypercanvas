<script lang="ts">
  import { cs, switchWorkspace, createWorkspace, deleteWorkspace } from '../lib/canvasState.svelte'

  let ctxMenu = $state<{ x: number; y: number; wsId: number; wsName: string } | null>(null)

  let workspaceTabData = $derived(cs.workspaces.map((w) => ({ id: w.id, name: w.name })))

  $effect(() => {
    if (!ctxMenu) return
    const close = () => { ctxMenu = null }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  })

  const tabStyle = "background:none;border:1px solid #2a2a2a;border-radius:4px;color:#888;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;cursor:pointer;padding:2px 8px;line-height:18px;min-width:24px;text-align:center;"
  const activeTabStyle = "background:#7c8fff0a;border:1px solid #7c8fff44;border-radius:4px;color:#aaa;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;cursor:pointer;padding:2px 8px;line-height:18px;min-width:24px;text-align:center;"
</script>

<div
  style="display:flex;align-items:center;gap:4px;padding:6px 8px;background:#161616;border:1px solid #2a2a2a;border-radius:8px;user-select:none;"
  onclick={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
>
  {#each workspaceTabData as ws}
    <button
      style={ws.id === cs.activeWorkspaceId ? activeTabStyle : tabStyle}
      onclick={() => { if (ws.id !== cs.activeWorkspaceId) switchWorkspace(ws.id) }}
      oncontextmenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (workspaceTabData.length > 1) {
          ctxMenu = { x: e.clientX, y: e.clientY, wsId: ws.id, wsName: ws.name }
        }
      }}
      title="Workspace {ws.name}{ws.id === cs.activeWorkspaceId ? ' (active)' : ''}"
    >{ws.name}</button>
  {/each}
  <button
    style="{tabStyle}color:#666;padding:2px 6px;"
    onclick={createWorkspace}
    title="New workspace"
  >+</button>

  {#if ctxMenu}
    <div class="context-menu-backdrop" onclick={() => ctxMenu = null} oncontextmenu={(e) => { e.preventDefault(); ctxMenu = null }}></div>
    <div class="context-menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px;">
      <button
        class="context-menu-item danger"
        onclick={() => {
          const { wsId, wsName } = ctxMenu!
          ctxMenu = null
          if (window.confirm(`Delete workspace ${wsName}?`)) {
            deleteWorkspace(wsId)
          }
        }}
      >Delete workspace</button>
    </div>
  {/if}
</div>
