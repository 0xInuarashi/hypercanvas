<script lang="ts">
  import { TOOL_PALETTE } from '../toolPalette'
  import { DEFAULT_SIZES } from '../lib/canvasState.svelte'
  import {
    ss, getNodeSizes, updateSettings,
    saveOpenrouterKey,
    savePrimaryModel,
    saveFallbackModel,
    setShowSettings,
  } from '../lib/settingsState.svelte'
  import { getPrimaryModel, getFallbackModel } from '../services/openrouter'
  import type { NodeType } from '../types'
  import '../SettingsPanel.css'

  type Category = 'keys' | 'nodeSizes'
  let category = $state<Category>('keys')

  let localOpenrouterKey = $state(ss.openrouterKey)
  let localPrimaryModel = $state(ss.primaryModel)
  let localFallbackModel = $state(ss.fallbackModel)

  function close() { setShowSettings(false) }

  function updateSize(type: NodeType, field: 'w' | 'h', value: string) {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 50) return
    const current = getNodeSizes()[type]
    updateSettings({
      ...ss.userSettings,
      nodeSizes: {
        ...ss.userSettings.nodeSizes,
        [type]: { ...current, [field]: num },
      },
    })
  }

  function resetSize(type: NodeType) {
    const { [type]: _, ...rest } = ss.userSettings.nodeSizes
    updateSettings({ ...ss.userSettings, nodeSizes: rest })
  }

  function resetAll() {
    updateSettings({ ...ss.userSettings, nodeSizes: {} })
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="settings-backdrop" onclick={close}></div>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="settings-panel" onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()}>
  <div class="settings-header">
    <span class="settings-title">Settings</span>
    <button class="settings-close" onclick={close}>x</button>
  </div>
  <div class="settings-body">
    <div class="settings-categories">
      <button class="settings-cat" class:active={category === 'keys'} onclick={() => category = 'keys'}>Keys</button>
      <button class="settings-cat" class:active={category === 'nodeSizes'} onclick={() => category = 'nodeSizes'}>Node Sizes</button>
    </div>
    <div class="settings-content">
      {#if category === 'keys'}
        <div class="settings-section-header">
          <span>API keys &amp; tokens</span>
        </div>
        <div class="settings-keys-list">
          <label class="settings-key-row">
            <span class="settings-key-label">OpenRouter API Key</span>
            <input
              type="password"
              bind:value={localOpenrouterKey}
              onblur={(e) => saveOpenrouterKey(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder="sk-or-..."
              class="settings-key-input"
            />
            {#if localOpenrouterKey}
              <button class="settings-key-clear" onclick={() => { saveOpenrouterKey(''); localOpenrouterKey = '' }}>clear</button>
            {/if}
          </label>
          <label class="settings-key-row">
            <span class="settings-key-label">Primary Model</span>
            <input
              type="text"
              bind:value={localPrimaryModel}
              onblur={(e) => savePrimaryModel(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder="stepfun/step-3.5-flash:free"
              class="settings-key-input"
            />
            {#if localStorage.getItem('openrouter-primary-model')}
              <button class="settings-key-clear" onclick={() => { savePrimaryModel(''); localPrimaryModel = getPrimaryModel() }}>reset</button>
            {/if}
          </label>
          <label class="settings-key-row">
            <span class="settings-key-label">Fallback Model</span>
            <input
              type="text"
              bind:value={localFallbackModel}
              onblur={(e) => saveFallbackModel(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder="nvidia/nemotron-3-super-120b-a12b:free"
              class="settings-key-input"
            />
            {#if localStorage.getItem('openrouter-fallback-model')}
              <button class="settings-key-clear" onclick={() => { saveFallbackModel(''); localFallbackModel = getFallbackModel() }}>reset</button>
            {/if}
          </label>
        </div>
      {/if}
      {#if category === 'nodeSizes'}
        <div class="settings-section-header">
          <span>Default sizes for new nodes</span>
          <button class="settings-reset-all" onclick={resetAll}>Reset all</button>
        </div>
        <div class="settings-size-list">
          {#each TOOL_PALETTE as t}
            {@const def = DEFAULT_SIZES[t.type]}
            {@const cur = getNodeSizes()[t.type]}
            {@const overridden = ss.userSettings.nodeSizes[t.type] != null}
            <div class="settings-size-row">
              <span class="settings-size-icon">{t.icon}</span>
              <span class="settings-size-label">{t.label}</span>
              <label class="settings-size-field">
                <span class="settings-size-dim">W</span>
                <input
                  type="number"
                  min="50"
                  value={cur.w}
                  onblur={(e) => updateSize(t.type, 'w', e.currentTarget.value)}
                  onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
              </label>
              <label class="settings-size-field">
                <span class="settings-size-dim">H</span>
                <input
                  type="number"
                  min="50"
                  value={cur.h}
                  onblur={(e) => updateSize(t.type, 'h', e.currentTarget.value)}
                  onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
              </label>
              {#if overridden}
                <button
                  class="settings-size-reset"
                  onclick={() => resetSize(t.type)}
                  title="Reset to {def.w}x{def.h}"
                >reset</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
