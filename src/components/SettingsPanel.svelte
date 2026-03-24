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
  import { cloudEnabled, setCloudCanvas, checkCloudState } from '../lib/canvasState.svelte'
  import { HTTP_URL, authHeaders } from '../config'
  import type { NodeType } from '../types'
  import '../SettingsPanel.css'

  type Category = 'general' | 'keys' | 'nodeSizes' | 'updates'
  let category = $state<Category>('general')

  let localOpenrouterKey = $state(ss.openrouterKey)
  let localPrimaryModel = $state(ss.primaryModel)
  let localFallbackModel = $state(ss.fallbackModel)

  // Update state
  const RELEASES_REPO = '0xInuarashi/ambiguous-melon-4556-releases'
  const currentVersion = __APP_VERSION__
  let latestVersion = $state<string | null>(null)
  let latestTarballUrl = $state<string | null>(null)
  let checking = $state(false)
  let updating = $state(false)
  let cloudSaving = $state(false)
  let cloudPrompt = $state(false)
  let updateStatus = $state<string | null>(null)

  $effect(() => {
    if (category === 'updates' && !latestVersion && !checking) {
      checkForUpdates()
    }
  })

  async function checkForUpdates() {
    checking = true
    updateStatus = null
    try {
      const resp = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`)
      if (!resp.ok) throw new Error(`GitHub API: ${resp.status}`)
      const data = await resp.json()
      latestVersion = data.tag_name
      latestTarballUrl = data.assets?.[0]?.browser_download_url || null
      if (currentVersion === 'dev') {
        updateStatus = `Latest release: ${latestVersion}`
      } else if (latestVersion === currentVersion) {
        updateStatus = 'Up to date'
      }
    } catch (err) {
      updateStatus = `Check failed: ${(err as Error).message}`
    } finally {
      checking = false
    }
  }

  async function installUpdate() {
    if (!latestVersion || !latestTarballUrl) return
    updating = true
    updateStatus = 'Starting update...'
    try {
      const resp = await fetch(`${HTTP_URL}/update`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ version: latestVersion, tarballUrl: latestTarballUrl }),
      })
      const data = await resp.json()
      if (data.ok) {
        pollUpdateStatus()
      } else {
        updateStatus = `Failed: ${data.error}`
        updating = false
      }
    } catch {
      updateStatus = 'Failed to start update'
      updating = false
    }
  }

  function pollUpdateStatus() {
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      if (attempts > 120) {
        clearInterval(poll)
        updateStatus = 'Update timed out. Check manually.'
        updating = false
        return
      }
      try {
        const resp = await fetch(`${HTTP_URL}/update/status`, { headers: authHeaders() })
        if (resp.ok) {
          const data = await resp.json()
          if (data.status === 'downloading') {
            updateStatus = 'Downloading...'
          } else if (data.status === 'installing') {
            updateStatus = data.detail || 'Installing...'
          } else if (data.status === 'restarting') {
            updateStatus = 'Restarting server...'
            clearInterval(poll)
            waitForRestart()
          } else if (data.status === 'error') {
            updateStatus = `Failed: ${data.error}`
            updating = false
            clearInterval(poll)
          }
        }
      } catch {
        // Server likely exited (restarting) — switch to restart polling
        clearInterval(poll)
        updateStatus = 'Restarting server...'
        waitForRestart()
      }
    }, 1000)
  }

  function waitForRestart() {
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      if (attempts > 30) {
        clearInterval(poll)
        updateStatus = 'Server did not come back. Check manually.'
        updating = false
        return
      }
      try {
        const resp = await fetch(`${HTTP_URL}/update/version`, {
          headers: authHeaders(),
        })
        if (resp.ok) {
          const data = await resp.json()
          clearInterval(poll)
          if (data.version === latestVersion) {
            updateStatus = `Running ${data.version}`
            setTimeout(() => location.reload(), 1000)
          } else {
            updateStatus = `Server restarted (${data.version}) but expected ${latestVersion}`
            updating = false
          }
        }
      } catch { /* server still restarting */ }
    }, 2000)
  }

  const updateAvailable = $derived(
    latestVersion != null &&
    currentVersion !== 'dev' &&
    latestVersion !== currentVersion
  )

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
      <button class="settings-cat" class:active={category === 'general'} onclick={() => category = 'general'}>General</button>
      <button class="settings-cat" class:active={category === 'keys'} onclick={() => category = 'keys'}>Keys</button>
      <button class="settings-cat" class:active={category === 'nodeSizes'} onclick={() => category = 'nodeSizes'}>Node Sizes</button>
      <button class="settings-cat" class:active={category === 'updates'} onclick={() => category = 'updates'}>Updates</button>
    </div>
    <div class="settings-content">
      {#if category === 'general'}
        <div class="settings-section-header">
          <span>General</span>
        </div>
        <div class="settings-keys-list">
          <label style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;cursor:pointer;color:#aaa;font-size:11px;">
            Genie ephemeral consoles
            <input
              type="checkbox"
              checked={ss.userSettings.ephemeralConsolesGenie !== false}
              onchange={(e) => updateSettings({ ...ss.userSettings, ephemeralConsolesGenie: (e.target as HTMLInputElement).checked })}
              style="accent-color:#5a5a8a;cursor:pointer;"
            />
          </label>
          <label style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;cursor:pointer;color:#aaa;font-size:11px;">
            Macro ephemeral consoles
            <input
              type="checkbox"
              checked={ss.userSettings.ephemeralConsolesMacro !== false}
              onchange={(e) => updateSettings({ ...ss.userSettings, ephemeralConsolesMacro: (e.target as HTMLInputElement).checked })}
              style="accent-color:#5a5a8a;cursor:pointer;"
            />
          </label>
          <label style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;cursor:pointer;color:#aaa;font-size:11px;">
            Cloud canvas
            <input
              type="checkbox"
              checked={cloudEnabled}
              onchange={async (e) => {
                const el = e.target as HTMLInputElement
                if (el.checked) {
                  cloudSaving = true
                  const existing = await checkCloudState()
                  cloudSaving = false
                  if (existing) {
                    cloudPrompt = true
                    el.checked = false
                    return
                  }
                  cloudSaving = true
                  const ok = await setCloudCanvas(true)
                  cloudSaving = false
                  if (!ok) el.checked = false
                } else {
                  cloudSaving = true
                  const ok = await setCloudCanvas(false)
                  cloudSaving = false
                  if (!ok) el.checked = true
                }
              }}
              disabled={cloudSaving || cloudPrompt}
              style="accent-color:#5a5a8a;cursor:pointer;"
            />
          </label>
          {#if cloudPrompt}
            <div style="background:#1a1520;border:1px solid #3a2a4a;border-radius:4px;padding:8px;margin-top:2px;">
              <div style="color:#aaa;font-size:10px;margin-bottom:6px;">A saved cloud canvas exists on this server.</div>
              <div style="display:flex;gap:6px;">
                <button
                  onclick={async () => {
                    cloudPrompt = false
                    cloudSaving = true
                    await setCloudCanvas(true, 'load')
                    cloudSaving = false
                  }}
                  disabled={cloudSaving}
                  style="flex:1;background:#2a1a3a;border:1px solid #4a3a5a;border-radius:3px;color:#c8a;cursor:pointer;padding:4px 8px;font-size:10px;font-family:'JetBrains Mono','Fira Code',monospace;"
                >Load saved canvas</button>
                <button
                  onclick={async () => {
                    cloudPrompt = false
                    cloudSaving = true
                    await setCloudCanvas(true, 'overwrite')
                    cloudSaving = false
                  }}
                  disabled={cloudSaving}
                  style="flex:1;background:#1a1a2e;border:1px solid #3a3a3a;border-radius:3px;color:#888;cursor:pointer;padding:4px 8px;font-size:10px;font-family:'JetBrains Mono','Fira Code',monospace;"
                >Overwrite with current</button>
                <button
                  onclick={() => { cloudPrompt = false }}
                  style="background:none;border:1px solid #3a3a3a;border-radius:3px;color:#666;cursor:pointer;padding:4px 6px;font-size:10px;font-family:'JetBrains Mono','Fira Code',monospace;"
                >Cancel</button>
              </div>
            </div>
          {/if}
          {#if cloudEnabled}
            <div style="color:#556;font-size:10px;">Canvas syncs to server across all browsers.</div>
          {/if}
        </div>
        <div class="settings-section-header" style="margin-top:12px;">
          <span>Console presets</span>
        </div>
        <div class="settings-keys-list">
          {#each ss.userSettings.consolePresets ?? [] as preset, i}
            <div style="display:flex;align-items:center;gap:6px;">
              <input
                type="text"
                value={preset}
                onblur={(e) => { const presets = [...(ss.userSettings.consolePresets ?? [])]; presets[i] = (e.currentTarget as HTMLInputElement).value; updateSettings({ ...ss.userSettings, consolePresets: presets }) }}
                onkeydown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                class="settings-key-input"
                style="flex:1;"
              />
              <button
                onclick={() => { const presets = (ss.userSettings.consolePresets ?? []).filter((_, j) => j !== i); updateSettings({ ...ss.userSettings, consolePresets: presets }) }}
                style="background:none;border:none;color:#666;cursor:pointer;font-size:12px;padding:2px 4px;"
                title="Remove"
              >x</button>
            </div>
          {/each}
          <button
            onclick={() => updateSettings({ ...ss.userSettings, consolePresets: [...(ss.userSettings.consolePresets ?? []), ''] })}
            style="background:#1a1a2e;border:1px solid #3a3a3a;border-radius:3px;color:#aaa;cursor:pointer;padding:4px 8px;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;width:100%;"
          >+ Add preset</button>
        </div>
      {/if}
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
      {#if category === 'updates'}
        <div class="settings-section-header">
          <span>Software updates</span>
        </div>
        <div class="settings-update">
          <div class="settings-update-row">
            <span class="settings-update-label">Current</span>
            <span class="settings-update-value">{currentVersion}</span>
          </div>
          {#if latestVersion}
            <div class="settings-update-row">
              <span class="settings-update-label">Latest</span>
              <span class="settings-update-value">{latestVersion}</span>
            </div>
          {/if}
          <div class="settings-update-actions">
            {#if updateAvailable && !updating}
              <button class="settings-update-btn install" onclick={installUpdate}>
                Update to {latestVersion}
              </button>
            {:else if !updating}
              <button class="settings-update-btn" onclick={checkForUpdates} disabled={checking}>
                {checking ? 'Checking...' : 'Check for updates'}
              </button>
            {/if}
          </div>
          {#if updateStatus}
            <div class="settings-update-status">{updateStatus}</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
