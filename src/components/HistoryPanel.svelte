<script lang="ts">
  import { canUndo, canRedo, getUndoLabels, getRedoLabels, undo, redo } from '../lib/historyManager.svelte'

  let collapsed = $state(true)
</script>

<div
  style="font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;user-select:none;"
  onclick={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
>
  <div
    style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#161616;border:1px solid #2a2a2a;color:#888;"
    style:border-radius={collapsed ? '8px' : '8px 8px 0 0'}
  >
    <button
      onclick={undo}
      disabled={!canUndo()}
      title="Undo (Ctrl+Z)"
      style="background:none;border:1px solid #2a2a2a;border-radius:4px;font-size:11px;cursor:{canUndo() ? 'pointer' : 'default'};padding:1px 6px;line-height:1;"
      style:color={canUndo() ? '#aaa' : '#444'}
    >←</button>
    <button
      onclick={redo}
      disabled={!canRedo()}
      title="Redo (Ctrl+Y)"
      style="background:none;border:1px solid #2a2a2a;border-radius:4px;font-size:11px;cursor:{canRedo() ? 'pointer' : 'default'};padding:1px 6px;line-height:1;"
      style:color={canRedo() ? '#aaa' : '#444'}
    >→</button>
    <span style="color:#777;flex:1">History</span>
    <button
      onclick={() => collapsed = !collapsed}
      style="background:none;border:none;color:#666;font-size:10px;cursor:pointer;padding:0 2px;"
    >{collapsed ? '▸' : '▾'}</button>
  </div>

  {#if !collapsed}
    <div style="background:#161616;border:1px solid #2a2a2a;border-top:none;border-radius:0 0 8px 8px;max-height:200px;overflow:auto;min-width:160px;">
      {#if getUndoLabels().length === 0 && getRedoLabels().length === 0}
        <div style="padding:8px 10px;color:#444;text-align:center;">No history</div>
      {/if}
      {#each getUndoLabels() as label, i}
        <div style="padding:3px 10px;color:{i === getUndoLabels().length - 1 ? '#7c8fff' : '#888'};border-left:{i === getUndoLabels().length - 1 ? '2px solid #7c8fff' : '2px solid transparent'};">
          {label}
        </div>
      {/each}
      {#each getRedoLabels() as label}
        <div style="padding:3px 10px;color:#444;border-left:2px solid transparent;font-style:italic;">
          {label}
        </div>
      {/each}
    </div>
  {/if}
</div>
