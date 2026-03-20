<script lang="ts">
  import type { Snippet } from 'svelte'

  let { icon, label, iconColor, children }: {
    icon: string
    label: string | Snippet
    iconColor?: string
    children?: Snippet
  } = $props()
</script>

<div
  style="flex-shrink:0;display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--color-surface-raised);border-bottom:1px solid var(--color-border);font-family:var(--font-mono);font-size:11px;color:var(--color-text-dim);user-select:none;cursor:default;"
>
  <span style:color={iconColor} style="font-size:10px">{icon}</span>
  {#if typeof label === 'string'}
    {label}
  {:else}
    {@render label()}
  {/if}
  {#if children}
    {@render children()}
  {/if}
</div>
