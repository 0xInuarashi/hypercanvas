<script lang="ts">
  import { HTTP_URL, setAuthToken } from '../config'

  let { onAuth }: { onAuth: () => void } = $props()

  let password = $state('')
  let error = $state<string | null>(null)
  let checking = $state(false)

  async function submit() {
    if (!password.trim() || checking) return
    checking = true
    error = null
    try {
      const res = await fetch(`${HTTP_URL}/auth/check`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${password.trim()}` },
      })
      if (res.ok) {
        setAuthToken(password.trim())
        onAuth()
      } else {
        error = 'Wrong password'
        password = ''
      }
    } catch {
      error = 'Connection failed'
    } finally {
      checking = false
    }
  }
</script>

<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0a0a;font-family:monospace;">
  <div style="display:flex;flex-direction:column;gap:12px;align-items:center;">
    <div style="color:#888;font-size:14px;margin-bottom:8px;">hypercanvas</div>
    <input
      type="password"
      bind:value={password}
      onkeydown={(e) => e.key === 'Enter' && submit()}
      placeholder="Password"
      autofocus
      style="background:#1a1a1a;border:1px solid #333;border-radius:6px;color:#eee;padding:10px 16px;font-size:14px;width:260px;outline:none;font-family:monospace;"
    />
    <button
      onclick={submit}
      disabled={checking}
      style="background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#ccc;padding:8px 24px;font-size:13px;cursor:pointer;font-family:monospace;"
    >{checking ? '...' : 'Enter'}</button>
    {#if error}
      <div style="color:#e55;font-size:13px;">{error}</div>
    {/if}
  </div>
</div>
