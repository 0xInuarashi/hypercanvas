<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { ChatMessage, ToolDefinition } from '../services/openrouter'
  import { streamChatCompletion, AuthError } from '../services/openrouter'
  import { HTTP_URL, clipboardWrite, authHeaders, getWsUrl } from '../config'
  import { executeTree, executeFindDir } from '../services/ptyApi'
  import { stripAnsi } from '../lib/stripAnsi'
  import WidgetHeader from '../components/WidgetHeader.svelte'
  import { LLMChat } from '../lib/llmChat.svelte'
  import { getGenie, getGenieAbort, setGenieAbort, deleteGenieAbort } from '../lib/genieStores.svelte'

  let { nodeId, onSpawnTerminal, onBashStart, onBashOutput, onBashDone }: {
    nodeId: string
    onSpawnTerminal?: (command: string) => void
    onBashStart?: (command: string) => string
    onBashOutput?: (id: string, chunk: string) => void
    onBashDone?: (id: string, exitCode?: number) => void
  } = $props()

  const llm = new LLMChat()
  const genie = getGenie(nodeId)
  let input = $state('')
  let scrollEl: HTMLDivElement
  let userScrolledUp = false

  onDestroy(() => llm.destroy())

  function onScroll() {
    if (!scrollEl) return
    userScrolledUp = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight > 40
  }

  $effect(() => {
    void genie.messages; void genie.isRunning
    if (scrollEl && !userScrolledUp) scrollEl.scrollTop = scrollEl.scrollHeight
  })

  const BASE_SYSTEM = `You are Genie, a task-execution agent embedded in a canvas workspace. The user gives you a task and you complete it autonomously using your tools.

Your approach: 1. INVESTIGATE first. 2. PLAN briefly. 3. EXECUTE step by step. 4. VERIFY your work.

Tools: bash, web_fetch, read_file, write_file, tree, find_dir, spawn_terminal.
Rules: Commands run from $HOME. Don't run destructive commands without instruction. Keep responses brief.`

  const TOOLS: ToolDefinition[] = [
    { type: 'function', function: { name: 'bash', description: 'Execute a shell command.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'web_fetch', description: 'Fetch URL content.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read file contents.', parameters: { type: 'object', properties: { path: { type: 'string' }, maxLines: { type: 'number' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Write content to a file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'tree', description: 'List directory structure.', parameters: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'number' } }, required: [] } } },
    { type: 'function', function: { name: 'find_dir', description: 'Search for directory by name.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
    { type: 'function', function: { name: 'spawn_terminal', description: 'Open interactive terminal on canvas.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: [] } } },
  ]

  const BASH_TIMEOUT = 120_000 // 2 minutes

  async function executeBash(args: { command: string; timeout?: number }, signal?: AbortSignal, onChunk?: (chunk: string) => void): Promise<{ output: string; exitCode?: number }> {
    return new Promise<{ output: string; exitCode?: number }>((resolve) => {
      let output = ''
      let exitCode: number | undefined
      let resolved = false
      const done = (result: { output: string; exitCode?: number }) => { if (resolved) return; resolved = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(result) }
      const ws = new WebSocket(getWsUrl())
      const timeout = args.timeout ? args.timeout * 1000 : BASH_TIMEOUT
      const timer = setTimeout(() => { ws.close(); done({ output: output + '\n[timed out]', exitCode: undefined }) }, timeout)
      const onAbort = () => { ws.close(); done({ output: output + '\n[cancelled]', exitCode: undefined }) }
      signal?.addEventListener('abort', onAbort)
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'input', data: args.command + '\nexit\n' })) }
      ws.onmessage = (ev) => { try { const msg = JSON.parse(ev.data); if (msg.type === 'output') { const clean = stripAnsi(msg.data); output += clean; onChunk?.(clean) } else if (msg.type === 'exit') { exitCode = typeof msg.exitCode === 'number' ? msg.exitCode : undefined } } catch {} }
      ws.onclose = () => { done({ output: output || '[no output]', exitCode }) }
      ws.onerror = () => { done({ output: 'Error: WebSocket connection failed', exitCode: undefined }) }
    })
  }

  async function executeWebFetch(args: { url: string }, signal?: AbortSignal): Promise<string> {
    try {
      const res = await fetch(`${HTTP_URL}/fetch`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(args), signal })
      const data = await res.json()
      if (data.error) return `Error: ${data.error}`
      let out = data.body || ''; if (data.truncated) out += '\n[truncated]'
      return out || '[empty response]'
    } catch (err) { return `Error: ${err instanceof Error ? err.message : 'fetch failed'}` }
  }

  async function executeReadFile(args: { path: string; maxLines?: number }, signal?: AbortSignal): Promise<string> {
    try {
      const res = await fetch(`${HTTP_URL}/read-file`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(args), signal })
      const data = await res.json()
      if (data.error) return `Error: ${data.error}`
      let out = data.content || ''; if (data.truncated) out += `\n[truncated]`
      return out || '[empty file]'
    } catch (err) { return `Error: ${err instanceof Error ? err.message : 'read failed'}` }
  }

  async function executeWriteFile(args: { path: string; content: string }, signal?: AbortSignal): Promise<string> {
    try {
      const res = await fetch(`${HTTP_URL}/write-file`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(args), signal })
      const data = await res.json()
      if (data.error) return `Error: ${data.error}`
      return `Written ${data.bytesWritten} bytes to ${data.path}`
    } catch (err) { return `Error: ${err instanceof Error ? err.message : 'write failed'}` }
  }

  async function executeTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    switch (name) {
      case 'web_fetch': return executeWebFetch(args as { url: string }, signal)
      case 'read_file': return executeReadFile(args as { path: string; maxLines?: number }, signal)
      case 'write_file': return executeWriteFile(args as { path: string; content: string }, signal)
      case 'tree': return executeTree(args as { path?: string; depth?: number }, signal)
      case 'find_dir': return executeFindDir(args as { name: string }, signal)
      case 'spawn_terminal': {
        const cmd = (args.command as string) || ''
        if (onSpawnTerminal) { onSpawnTerminal(cmd); return cmd ? `Opened terminal: ${cmd}` : 'Opened terminal.' }
        return 'Error: spawn_terminal not available'
      }
      default: return `Unknown tool: ${name}`
    }
  }

  function toolLabel(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case 'bash': return `bash: ${args.command || '?'}`
      case 'web_fetch': return `fetch: ${args.url || '?'}`
      case 'read_file': return `read: ${args.path || '?'}`
      case 'write_file': return `write: ${args.path || '?'}`
      case 'tree': return `tree: ${args.path || '~'}`
      case 'find_dir': return `find: ${args.name || '?'}`
      case 'spawn_terminal': return `terminal: ${args.command || '(shell)'}`
      default: return name
    }
  }

  async function send() {
    if (!input.trim() || !llm.apiKey || genie.isRunning) return
    const userMsg = input.trim()
    input = ''

    const initialHistory: ChatMessage[] = [...genie.chatHistory, { role: 'user', content: userMsg }]
    genie.isRunning = true; genie.error = null
    genie.messages = [...genie.messages, { kind: 'text', role: 'user', content: userMsg }, { kind: 'text', role: 'assistant', content: '', reasoning: '' }]
    genie.chatHistory = initialHistory

    const controller = new AbortController()
    setGenieAbort(nodeId, controller)

    const systemContent = llm.fileTree ? `${BASE_SYSTEM}\n\nProject file tree:\n\`\`\`\n${llm.fileTree}\`\`\`` : BASE_SYSTEM
    const systemPrompt: ChatMessage = { role: 'system', content: systemContent }
    const apiKey = llm.apiKey
    const runningHistory = [...initialHistory]

    try {
      let rounds = 0
      while (rounds < 100) {
        rounds++
        let streamedReasoning = '', streamedContent = ''

        const reply = await streamChatCompletion(
          [systemPrompt, ...runningHistory], TOOLS, apiKey,
          {
            onReasoning(delta) {
              streamedReasoning += delta
              const msgs = [...genie.messages]; const last = msgs[msgs.length - 1]
              if (last?.kind === 'text') msgs[msgs.length - 1] = { ...last, reasoning: streamedReasoning }
              genie.messages = msgs
            },
            onContent(delta) {
              streamedContent += delta
              const msgs = [...genie.messages]; const last = msgs[msgs.length - 1]
              if (last?.kind === 'text') msgs[msgs.length - 1] = { ...last, content: streamedContent }
              genie.messages = msgs
            },
            onToolCall() {},
          },
          controller.signal,
        )

        runningHistory.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls })
        if (!reply.tool_calls?.length) break

        for (const tc of reply.tool_calls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          const lbl = toolLabel(tc.function.name, args)

          let ephId: string | undefined
          if (tc.function.name === 'bash' && onBashStart) ephId = onBashStart(String(args.command || ''))

          genie.messages = [...genie.messages, { kind: 'tool', label: lbl, result: '...' }]

          const onChunk = ephId && onBashOutput ? (chunk: string) => onBashOutput!(ephId!, chunk) : undefined
          let result: string
          let bashExitCode: number | undefined
          if (tc.function.name === 'bash') {
            const r = await executeBash(args as { command: string; timeout?: number }, controller.signal, onChunk)
            result = r.output; bashExitCode = r.exitCode
          } else {
            result = await executeTool(tc.function.name, args, controller.signal)
          }

          if (ephId && onBashDone) {
            onBashDone(ephId, bashExitCode)
          }

          const msgs = [...genie.messages]; const last = msgs[msgs.length - 1]
          if (last?.kind === 'tool') msgs[msgs.length - 1] = { ...last, result }
          genie.messages = msgs
          runningHistory.push({ role: 'tool', content: result, tool_call_id: tc.id })
        }
        genie.messages = [...genie.messages, { kind: 'text', role: 'assistant', content: '', reasoning: '' }]
      }
      genie.chatHistory = runningHistory
    } catch (err) {
      if (controller.signal.aborted) genie.messages = [...genie.messages, { kind: 'text', role: 'assistant', content: '[cancelled by user]' }]
      else if (err instanceof AuthError) { llm.clearApiKey(); genie.error = 'Invalid API key — please re-enter.' }
      else genie.error = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      genie.isRunning = false; deleteGenieAbort(nodeId)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  let lastGMsg = $derived(genie.messages[genie.messages.length - 1])
  let showThinking = $derived(genie.isRunning && lastGMsg?.kind === 'text' && !lastGMsg.content && !lastGMsg.reasoning)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="⚗" iconColor="#cc5de8">
    {#snippet label()}<span style="color:#aaa;flex:1">Genie</span>{/snippet}
    {#snippet children()}
      {#if genie.isRunning}
        <button onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); getGenieAbort(nodeId)?.abort() }} style="background:none;border:1px solid #5a5a5a;border-radius:3px;color:#ff6b6b;font-size:9px;font-family:'JetBrains Mono',monospace;cursor:pointer;padding:1px 6px;line-height:14px;">Stop</button>
        <span style="color:#ffd43b;font-size:10px;">working...</span>
      {/if}
      {#if genie.error}<span style="color:#ff6b6b;font-size:10px;">error</span>{/if}
    {/snippet}
  </WidgetHeader>

  {#if !llm.apiKey}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;" onpointerdown={(e) => e.stopPropagation()}>
      <span style="color:#888;font-size:12px;font-family:monospace;text-align:center;">Enter your OpenRouter API key</span>
      {#if llm.error}<span style="color:#ff6b6b;font-size:11px;font-family:monospace;">{llm.error}</span>{/if}
      <input type="password" bind:value={llm.keyInput} onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') llm.saveKey() }} placeholder="sk-or-..." style="width:100%;max-width:240px;padding:8px 10px;background:#1a1a2e;border:1px solid #3a3a5a;border-radius:6px;color:#e0e0e0;font-size:12px;font-family:monospace;outline:none;" />
      <button onclick={() => llm.saveKey()} style="padding:6px 20px;background:#1a1a2e;border:1px solid #5a5a8a;border-radius:6px;color:#e0e0e0;font-size:12px;font-family:monospace;cursor:pointer;">Save</button>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div bind:this={scrollEl} tabindex="-1" style="flex:1;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;user-select:text;outline:none;" onscroll={onScroll} onpointerdown={(e) => e.stopPropagation()} onmouseup={() => { const sel = window.getSelection()?.toString(); if (sel) clipboardWrite(sel) }}>
      {#if genie.messages.length === 0 && !genie.isRunning}
        <span style="color:#555;font-size:12px;font-family:monospace;text-align:center;margin-top:12px;">What should Genie do?</span>
      {/if}
      {#each genie.messages as msg}
        {#if msg.kind === 'tool'}
          <div style="border-left:2px solid #5a5a8a;margin-left:4px;padding-left:8px;margin-top:2px;margin-bottom:2px;">
            <div style="font-size:10px;font-family:'JetBrains Mono','Fira Code',monospace;color:#7c8fff;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{msg.label}</div>
            {#if msg.result.split('\n').length > 15}
              <details>
                <summary style="cursor:pointer;font-size:10px;color:#666;font-family:'JetBrains Mono',monospace;user-select:none;">{msg.result.split('\n').length} lines</summary>
                <pre style="margin:0;padding:4px 6px;background:#0a0a0a;border-radius:4px;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;color:#bbb;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;">{msg.result}</pre>
              </details>
            {:else}
              <pre style="margin:0;padding:4px 6px;background:#0a0a0a;border-radius:4px;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;color:#bbb;white-space:pre-wrap;word-break:break-word;">{msg.result}</pre>
            {/if}
          </div>
        {:else}
          <div style="align-self:{msg.role === 'user' ? 'flex-end' : 'flex-start'};max-width:85%;display:flex;flex-direction:column;gap:4px;">
            {#if msg.reasoning}
              <details open style="padding:4px 8px;border-radius:6px;background:#1a1a1a;border:1px solid #2a2a3a;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;color:#666;">
                <summary style="cursor:pointer;color:#ffd43b;font-size:10px;user-select:none;">thinking</summary>
                <div style="white-space:pre-wrap;word-break:break-word;margin-top:4px;">{msg.reasoning}</div>
              </details>
            {/if}
            {#if msg.content}
              <div style="padding:6px 10px;border-radius:8px;background:{msg.role === 'user' ? '#1a2a4a' : '#1e1e2e'};color:#e0e0e0;font-size:12px;font-family:'JetBrains Mono','Fira Code',monospace;white-space:pre-wrap;word-break:break-word;">{msg.content}</div>
            {/if}
          </div>
        {/if}
      {/each}
      {#if showThinking}
        <div style="align-self:flex-start;padding:6px 10px;border-radius:8px;background:#1e1e2e;color:#888;font-size:12px;font-family:monospace;">thinking...</div>
      {/if}
      {#if genie.error}
        <div style="align-self:center;padding:4px 8px;border-radius:6px;color:#ff6b6b;font-size:11px;font-family:monospace;">{genie.error}</div>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div style="flex-shrink:0;display:flex;gap:6px;padding:8px 10px;border-top:1px solid #2a2a2a;" onpointerdown={(e) => e.stopPropagation()}>
      <textarea bind:value={input} onkeydown={handleKeyDown} placeholder="What should Genie do?" rows="1" disabled={genie.isRunning} style="flex:1;resize:none;padding:8px 10px;background:#1a1a2e;border:1px solid #3a3a5a;border-radius:6px;color:#e0e0e0;font-size:12px;font-family:'JetBrains Mono','Fira Code',monospace;outline:none;max-height:60px;opacity:{genie.isRunning ? 0.5 : 1};"></textarea>
      <button onclick={send} disabled={genie.isRunning || !input.trim()} style="padding:0 12px;background:#1a1a2e;border:1px solid #5a5a8a;border-radius:6px;color:{genie.isRunning || !input.trim() ? '#555' : '#e0e0e0'};font-size:12px;font-family:monospace;cursor:{genie.isRunning || !input.trim() ? 'default' : 'pointer'};flex-shrink:0;">Go</button>
    </div>
  {/if}
</div>
