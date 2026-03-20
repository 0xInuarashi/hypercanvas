<script lang="ts">
  import { TOOL_PALETTE } from '../toolPalette'
  import { cs, selectTool, changeBgColor } from '../lib/canvasState.svelte'
  import { pushUndo } from '../lib/historyManager.svelte'
  import '../sidebar/Sidebar.css'

  const BG_COLORS = [
    '#0a0a0a', '#1e1e1e', '#0d1117', '#1a1a2e', '#1a0a0a',
  ]

  let collapsed = $state(false)

  function handleBgChange(color: string) {
    pushUndo('Change background')
    changeBgColor(color)
  }
</script>

<div class="sidebar" class:collapsed>
  <button
    class="sidebar-collapse-btn"
    onclick={() => collapsed = !collapsed}
    title={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
  >{collapsed ? '▸' : '◂'}</button>

  {#if !collapsed}
    <div class="sidebar-title">Tools</div>
    {#each TOOL_PALETTE as el}
      <button
        class="sidebar-item"
        class:active={cs.activeTool === el.type}
        onclick={() => selectTool(el.type)}
      >
        <span class="sidebar-icon">{el.icon}</span>
        {el.label}
      </button>
    {/each}

    <div class="sidebar-divider"></div>
    <div class="sidebar-title">Background</div>
    <div class="color-grid">
      {#each BG_COLORS as c}
        <button
          class="color-swatch"
          class:active={cs.bgColor === c}
          style:background-color={c}
          onclick={() => handleBgChange(c)}
        ></button>
      {/each}
    </div>
  {/if}
</div>
