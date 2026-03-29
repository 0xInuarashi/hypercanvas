<script module lang="ts">
  import type { NodeType } from '../types'

  export interface ContextMenuState {
    x: number
    y: number
    targetType: 'node' | 'link' | 'canvas'
    targetId: string
    nodeType?: NodeType
    nodeActive?: boolean
    nodePersistent?: boolean
    nodeShowEphemeral?: boolean
    nodeSessionId?: string
    nodeSatellitePassword?: string | null
    nodeFishtankPassword?: string | null
    worldX?: number
    worldY?: number
    selectedText?: string
  }
</script>

<script lang="ts">
  import { TOOL_PALETTE } from '../toolPalette'
  import '../canvas/ContextMenu.css'

  let { menu, onDelete, onSetCommand, onSetFolder, onToggleActive, onRestartConsole, onDuplicateConsole, onSpawnConsole, onTogglePersistent, onProgramMacro, onRenameMacro, onToggleEphemeral, onShareSatellite, onRevokeSatellite, onShareFishtank, onRevokeFishtank, onPlaceTool, onPlaceConsolePreset, onApplyPreset, onCopyToMemo, onRunInConsole, onOpenInReader, consolePresets, onClose }: {
    menu: ContextMenuState
    onDelete: (type: 'node' | 'link', id: string) => void
    onSetCommand: (id: string) => void
    onSetFolder: (id: string) => void
    onToggleActive: (id: string) => void
    onRestartConsole: (id: string) => void
    onDuplicateConsole: (id: string) => void
    onSpawnConsole: (id: string) => void
    onTogglePersistent: (id: string) => void
    onProgramMacro: (id: string) => void
    onRenameMacro: (id: string) => void
    onToggleEphemeral: (id: string) => void
    onShareSatellite: (id: string) => void
    onRevokeSatellite: (id: string) => void
    onShareFishtank: (id: string) => void
    onRevokeFishtank: (id: string) => void
    onPlaceTool: (type: NodeType, worldX: number, worldY: number) => void
    onPlaceConsolePreset: (worldX: number, worldY: number, command: string) => void
    onApplyPreset: (id: string, command: string) => void
    onCopyToMemo: (id: string, text: string) => void
    onRunInConsole: (id: string, text: string) => void
    onOpenInReader: (id: string, text: string) => void
    consolePresets: string[]
    onClose: () => void
  } = $props()
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="context-menu-backdrop" onclick={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose() }}></div>
<div class="context-menu" style="left:{menu.x}px;top:{menu.y}px;">
  {#if menu.targetType === 'canvas'}
    <div class="context-menu-label">Add node</div>
    {#each TOOL_PALETTE as t}
      {#if t.type === 'console' && consolePresets.length > 0}
        <div class="context-menu-submenu">
          <button class="context-menu-item"><span style="margin-right:6px;font-size:10px;opacity:0.7">{t.icon}</span>{t.label} <span style="float:right;opacity:0.5;">▸</span></button>
          <div class="context-submenu">
            <button class="context-menu-item" onclick={() => { onPlaceTool(t.type, menu.worldX!, menu.worldY!); onClose() }}>
              <span style="opacity:0.5">Default</span>
            </button>
            {#each consolePresets as preset}
              <button class="context-menu-item" onclick={() => { onPlaceConsolePreset(menu.worldX!, menu.worldY!, preset); onClose() }}>{preset}</button>
            {/each}
          </div>
        </div>
      {:else}
        <button class="context-menu-item" onclick={() => { onPlaceTool(t.type, menu.worldX!, menu.worldY!); onClose() }}>
          <span style="margin-right:6px;font-size:10px;opacity:0.7">{t.icon}</span>{t.label}
        </button>
      {/if}
    {/each}
  {/if}
  {#if menu.targetType === 'node' && menu.nodeType === 'console' && menu.selectedText}
    <div class="context-menu-label">Selection</div>
    <button class="context-menu-item" onclick={() => { onCopyToMemo(menu.targetId, menu.selectedText!); onClose() }}>Copy to memo</button>
    <button class="context-menu-item" onclick={() => { onRunInConsole(menu.targetId, menu.selectedText!); onClose() }}>Run in console</button>
    <button class="context-menu-item" onclick={() => { onOpenInReader(menu.targetId, menu.selectedText!); onClose() }}>Open in reader</button>
  {/if}
  {#if menu.targetType === 'node' && menu.nodeType === 'console'}
    <button class="context-menu-item" onclick={() => { onRestartConsole(menu.targetId); onClose() }}>Restart</button>
    <button class="context-menu-item" onclick={() => { onToggleActive(menu.targetId); onClose() }}>{menu.nodeActive ? 'Deactivate' : 'Activate'}</button>
    <button class="context-menu-item" onclick={() => { onTogglePersistent(menu.targetId); onClose() }}>{menu.nodePersistent ? 'Disable persistent' : 'Enable persistent'}</button>
    <button class="context-menu-item" onclick={() => { onSetCommand(menu.targetId); onClose() }}>Set default command</button>
    <button class="context-menu-item" onclick={() => { onSetFolder(menu.targetId); onClose() }}>Set default folder</button>
    {#if consolePresets.length > 0}
      <div class="context-menu-submenu">
        <button class="context-menu-item">Presets <span style="float:right;opacity:0.5;">▸</span></button>
        <div class="context-submenu">
          {#each consolePresets as preset}
            <button class="context-menu-item" onclick={() => { onApplyPreset(menu.targetId, preset); onClose() }}>{preset}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if menu.nodePersistent && menu.nodeSessionId}
      {@const _dbg = console.log(`[DBG] ContextMenu share section: persistent=${menu.nodePersistent} sessionId=${menu.nodeSessionId} satPwd=${menu.nodeSatellitePassword ? 'SET' : 'null'} fishPwd=${menu.nodeFishtankPassword ? 'SET' : 'null'} → showing: ${menu.nodeSatellitePassword ? 'REVOKE_SAT' : menu.nodeFishtankPassword ? 'REVOKE_FISH' : 'SHARE_BOTH'}`)}
      {#if menu.nodeSatellitePassword}
        <button class="context-menu-item" onclick={() => { onRevokeSatellite(menu.targetId); onClose() }}>Revoke Satellite</button>
      {:else if menu.nodeFishtankPassword}
        <button class="context-menu-item" onclick={() => { onRevokeFishtank(menu.targetId); onClose() }}>Revoke Fishtank</button>
      {:else}
        <button class="context-menu-item" onclick={() => { onShareSatellite(menu.targetId); onClose() }}>Share as Satellite</button>
        <button class="context-menu-item" onclick={() => { onShareFishtank(menu.targetId); onClose() }}>Share as Fishtank</button>
      {/if}
    {/if}
    <button class="context-menu-item" onclick={(e) => { onDuplicateConsole(menu.targetId); if (!e.shiftKey) onClose() }}>Duplicate</button>
    <button class="context-menu-item" onclick={(e) => { onSpawnConsole(menu.targetId); if (!e.shiftKey) onClose() }}>Spawn</button>
  {/if}
  {#if menu.targetType === 'node' && menu.nodeType === 'browser'}
    <button class="context-menu-item" onclick={() => { onToggleActive(menu.targetId); onClose() }}>{menu.nodeActive ? 'Deactivate' : 'Activate'}</button>
  {/if}
  {#if menu.targetType === 'node' && menu.nodeType === 'macro'}
    <button class="context-menu-item" onclick={() => { onProgramMacro(menu.targetId); onClose() }}>Program Macro</button>
    <button class="context-menu-item" onclick={() => { onRenameMacro(menu.targetId); onClose() }}>Rename</button>
  {/if}
  {#if menu.targetType === 'node' && menu.nodeType === 'genie'}
    <button class="context-menu-item" onclick={() => { onToggleEphemeral(menu.targetId); onClose() }}>{menu.nodeShowEphemeral !== false ? 'Disable bash preview' : 'Enable bash preview'}</button>
  {/if}
  {#if menu.targetType === 'node' || menu.targetType === 'link'}
    <button class="context-menu-item danger" onclick={() => { onDelete(menu.targetType as 'node' | 'link', menu.targetId); onClose() }}>Delete {menu.targetType}</button>
  {/if}
</div>
