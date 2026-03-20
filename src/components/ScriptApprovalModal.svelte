<script lang="ts">
  import type { ScriptedNode } from '../types'
  import { analyzeCommandSecurity } from '../services/security'

  let { nodes, onApprove, onDeny }: {
    nodes: ScriptedNode[]
    onApprove: () => void
    onDeny: () => void
  } = $props()

  let analysis = $state('')
  let analyzing = $state(false)
  let noKey = $state(false)

  const commands = nodes.map((n) => n.cmd ?? n.label ?? '').filter(Boolean)

  let abortController: AbortController | null = null

  $effect(() => {
    const apiKey = localStorage.getItem('openrouter-api-key')
    if (!apiKey) {
      noKey = true
      return
    }

    const abort = new AbortController()
    abortController = abort
    analyzing = true

    analyzeCommandSecurity(commands, apiKey, {
      onContent: (delta) => { analysis += delta },
      onReasoning: () => {},
      onToolCall: () => {},
    }, abort.signal)
      .catch((err) => {
        if (!abort.signal.aborted) {
          analysis += '\n[Analysis failed: ' + err.message + ']'
        }
      })
      .finally(() => { analyzing = false })

    return () => abort.abort()
  })

  function handleCancel() {
    abortController?.abort()
    onDeny()
  }
</script>

<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,10,10,0.92);font-family:monospace;z-index:99999;">
  <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:24px;max-width:560px;width:90%;display:flex;flex-direction:column;gap:16px;">
    <div style="color:#eee;font-size:16px;font-weight:600;">Script Review</div>
    <div style="color:#999;font-size:13px;">The following was requested via URL:</div>

    <div style="background:#111;border:1px solid #333;border-radius:6px;padding:12px;max-height:120px;overflow-y:auto;">
      <div style="color:#666;font-size:11px;margin-bottom:6px;">Commands</div>
      {#each commands as cmd, i}
        <div style="color:#e8e8e8;font-size:13px;margin-bottom:4px;word-break:break-all;">
          {commands.length > 1 ? `${i + 1}. ` : ''}{cmd}
        </div>
      {/each}
    </div>

    <div style="background:#111;border:1px solid #333;border-radius:6px;padding:12px;max-height:200px;overflow-y:auto;">
      <div style="color:#666;font-size:11px;margin-bottom:6px;">Security Analysis</div>
      {#if noKey}
        <div style="color:#d4a017;font-size:13px;">LLM security review unavailable — no API key set. Review commands manually before approving.</div>
      {:else if analysis}
        <div style="color:#ccc;font-size:13px;white-space:pre-wrap;">{analysis}{analyzing ? '▊' : ''}</div>
      {:else if analyzing}
        <div style="color:#888;font-size:13px;">Analyzing...</div>
      {/if}
    </div>

    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px;">
      <button
        onclick={handleCancel}
        style="background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#ccc;padding:8px 20px;font-size:13px;cursor:pointer;font-family:monospace;"
      >Cancel</button>
      <button
        onclick={onApprove}
        style="background:#1a3a1a;border:1px solid #2a5a2a;border-radius:6px;color:#6c6;padding:8px 20px;font-size:13px;cursor:pointer;font-family:monospace;"
      >Approve &amp; Run</button>
    </div>
  </div>
</div>
