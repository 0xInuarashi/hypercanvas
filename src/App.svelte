<script lang="ts">
  import { HTTP_URL, getAuthToken } from './config'
  import LoginGate from './components/LoginGate.svelte'
  import AppMain from './components/AppMain.svelte'
  import SatelliteView from './satellite/SatelliteView.svelte'
  import FishtankView from './satellite/FishtankView.svelte'

  // Parsed once at module level
  const satParams = new URLSearchParams(window.location.search)
  const satSessionId = satParams.get('satellite')
  const satPassword = satParams.get('password') || undefined
  const fishtankSessionId = satParams.get('fishtank')
  const fishtankPassword = satParams.get('password') || undefined

  console.log('[DBG] App.svelte URL parse:', { satSessionId, satPassword: satPassword ? 'SET' : 'none', fishtankSessionId, fishtankPassword: fishtankPassword ? 'SET' : 'none', rawSearch: window.location.search })

  let authed = $state(false)
  let authChecked = $state(false)

  // Verify token with server on mount
  $effect(() => {
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch(`${HTTP_URL}/auth/check`, { method: 'POST', headers })
      .then((res) => { if (res.ok) authed = true })
      .catch((err) => console.warn('auth check failed:', err))
      .finally(() => authChecked = true)
  })
</script>

{#if fishtankSessionId}
  <FishtankView sessionId={fishtankSessionId} initialPassword={fishtankPassword} />
{:else if satSessionId}
  <SatelliteView sessionId={satSessionId} initialPassword={satPassword} />
{:else if !authChecked}
  <!-- loading -->
{:else if !authed}
  <LoginGate onAuth={() => authed = true} />
{:else}
  <AppMain />
{/if}
