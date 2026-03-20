<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { ChatMessage, ToolDefinition } from '../services/openrouter'
  import { streamChatCompletion, AuthError } from '../services/openrouter'
  import type { CanvasNode } from '../types'
  import { executeTree, executeFindDir } from '../services/ptyApi'
  import WidgetHeader from '../components/WidgetHeader.svelte'
  import { LLMChat } from '../lib/llmChat.svelte'
  import { getAifio, setAifioAbort, deleteAifioAbort } from '../lib/aifioStores.svelte'

  let { nodeId, onReplaceSelf }: {
    nodeId: string
    onReplaceSelf: (id: string, newProps: Partial<CanvasNode>) => void
  } = $props()

  const llm = new LLMChat()
  const aifio = getAifio(nodeId)
  let input = $state('')
  let scrollEl: HTMLDivElement

  onDestroy(() => llm.destroy())

  $effect(() => {
    void aifio.messages; void aifio.isRunning
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
  })

  const BASE_SYSTEM = `You are AIFIO (AI, Figure It Out!), an assistant embedded in a canvas workspace app called Hypercanvas. You help users create and configure canvas nodes.

You have five tools:
1. tree — Explore the filesystem within $HOME.
2. find_dir — Search for a directory by name anywhere under $HOME.
3. replace_with_console — Replace this AIFIO widget with an interactive terminal node.
4. replace_with_macro — Replace this AIFIO widget with a macro button that runs a bash script on click.
5. replace_with_daemon — Replace this AIFIO widget with a persistent daemon node.

When the user asks you to create something, use one of the replace tools. If unsure about file paths, call find_dir or tree first.
Keep responses concise.`

  const TOOLS: ToolDefinition[] = [
    { type: 'function', function: { name: 'tree', description: 'List file/folder structure at a path within $HOME.', parameters: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'number' } }, required: [] } } },
    { type: 'function', function: { name: 'find_dir', description: 'Search for a directory by name within $HOME.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
    { type: 'function', function: { name: 'replace_with_console', description: 'Replace with interactive console.', parameters: { type: 'object', properties: { label: { type: 'string' }, activate: { type: 'boolean' } }, required: [] } } },
    { type: 'function', function: { name: 'replace_with_macro', description: 'Replace with macro button.', parameters: { type: 'object', properties: { label: { type: 'string' }, script: { type: 'string' } }, required: ['script'] } } },
    { type: 'function', function: { name: 'replace_with_daemon', description: 'Replace with daemon node.', parameters: { type: 'object', properties: { label: { type: 'string' }, command: { type: 'string' } }, required: ['command'] } } },
  ]

  async function send() {
    if (!input.trim() || !llm.apiKey || aifio.isRunning) return
    const userMsg = input.trim()
    input = ''

    const userChatMsg: ChatMessage = { role: 'user', content: userMsg }
    const initialHistory: ChatMessage[] = [...aifio.chatHistory, userChatMsg]

    aifio.isRunning = true
    aifio.error = null
    aifio.messages = [...aifio.messages, { role: 'user', content: userMsg }, { role: 'assistant', content: '', reasoning: '' }]
    aifio.chatHistory = initialHistory

    const controller = new AbortController()
    setAifioAbort(nodeId, controller)

    const systemContent = llm.fileTree
      ? `${BASE_SYSTEM}\n\nIMPORTANT: Terminals and macros start in $HOME, NOT in the project directory. Always prefix commands with \`cd <project-path> &&\`.\n\nProject file tree:\n\`\`\`\n${llm.fileTree}\`\`\``
      : BASE_SYSTEM
    const systemPrompt: ChatMessage = { role: 'system', content: systemContent }
    const apiKey = llm.apiKey
    const runningHistory = [...initialHistory]

    try {
      let rounds = 0
      let streamedContent = ''
      while (rounds < 20) {
        rounds++
        let streamedReasoning = ''
        streamedContent = ''

        const reply = await streamChatCompletion(
          [systemPrompt, ...runningHistory], TOOLS, apiKey,
          {
            onReasoning(delta) {
              streamedReasoning += delta
              const msgs = [...aifio.messages]
              const last = msgs[msgs.length - 1]
              aifio.messages = [...msgs.slice(0, -1), { ...last, reasoning: streamedReasoning }]
            },
            onContent(delta) {
              streamedContent += delta
              const msgs = [...aifio.messages]
              const last = msgs[msgs.length - 1]
              aifio.messages = [...msgs.slice(0, -1), { ...last, content: streamedContent }]
            },
            onToolCall() {},
          },
          controller.signal,
        )

        runningHistory.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls })
        if (!reply.tool_calls?.length) break

        let stopped = false
        for (const tc of reply.tool_calls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments) } catch { /* skip */ }

          if (tc.function.name === 'replace_with_console') {
            onReplaceSelf(nodeId, { type: 'console', label: (args.label as string) || '', active: args.activate !== false, script: undefined })
            runningHistory.push({ role: 'tool', content: 'replaced', tool_call_id: tc.id })
            stopped = true; break
          }
          if (tc.function.name === 'replace_with_macro') {
            onReplaceSelf(nodeId, { type: 'macro', label: (args.label as string) || '', script: (args.script as string) || '', active: false })
            runningHistory.push({ role: 'tool', content: 'replaced', tool_call_id: tc.id })
            stopped = true; break
          }
          if (tc.function.name === 'replace_with_daemon') {
            onReplaceSelf(nodeId, { type: 'daemon', label: (args.label as string) || '', command: (args.command as string) || '' })
            runningHistory.push({ role: 'tool', content: 'replaced', tool_call_id: tc.id })
            stopped = true; break
          }

          let result = '', lbl = ''
          if (tc.function.name === 'tree') {
            result = await executeTree(args as { path?: string; depth?: number })
            lbl = `[tree ${args.path || '~'}]\n${result}`
          } else if (tc.function.name === 'find_dir') {
            result = await executeFindDir(args as { name: string })
            lbl = `[find_dir "${args.name}"]\n${result}`
          }
          if (lbl) {
            streamedContent += (streamedContent ? '\n' : '') + lbl
            const msgs = [...aifio.messages]
            const last = msgs[msgs.length - 1]
            aifio.messages = [...msgs.slice(0, -1), { ...last, content: streamedContent }]
          }
          runningHistory.push({ role: 'tool', content: result, tool_call_id: tc.id })
        }
        if (stopped) break
        aifio.messages = [...aifio.messages, { role: 'assistant', content: '', reasoning: '' }]
      }

      const msgs = [...aifio.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant' && !last.content) msgs[msgs.length - 1] = { ...last, content: '(no response)' }
      aifio.chatHistory = runningHistory
      aifio.messages = msgs
    } catch (err) {
      if (err instanceof AuthError) { llm.clearApiKey(); aifio.error = 'Invalid API key — please re-enter.' }
      else if (!controller.signal.aborted) { aifio.error = err instanceof Error ? err.message : 'Something went wrong' }
    } finally {
      aifio.isRunning = false
      deleteAifioAbort(nodeId)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  let statusText = $derived(aifio.isRunning ? 'streaming...' : aifio.error ? 'error' : '')
  let statusColor = $derived(aifio.isRunning ? '#ffd43b' : aifio.error ? '#ff6b6b' : '#5a5a8a')
  let lastMsg = $derived(aifio.messages[aifio.messages.length - 1])
  let showConnecting = $derived(aifio.isRunning && lastMsg?.role === 'assistant' && !lastMsg?.content && !lastMsg?.reasoning)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="✦" iconColor="#ffd43b">
    {#snippet label()}<span style="color:#aaa;flex:1">AIFIO</span>{/snippet}
    {#snippet children()}{#if statusText}<span style="font-size:10px;" style:color={statusColor}>{statusText}</span>{/if}{/snippet}
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
    <div bind:this={scrollEl} tabindex="-1" style="flex:1;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;outline:none;" onpointerdown={(e) => e.stopPropagation()}>
      {#if aifio.messages.length === 0 && !aifio.isRunning}
        <span style="color:#555;font-size:12px;font-family:monospace;text-align:center;margin-top:12px;">Describe what you want to create</span>
      {/if}
      {#each aifio.messages as msg}
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
      {/each}
      {#if showConnecting}
        <div style="align-self:flex-start;padding:6px 10px;border-radius:8px;background:#1e1e2e;color:#888;font-size:12px;font-family:monospace;">connecting...</div>
      {/if}
      {#if aifio.error}
        <div style="align-self:center;padding:4px 8px;border-radius:6px;color:#ff6b6b;font-size:11px;font-family:monospace;">{aifio.error}</div>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div style="flex-shrink:0;display:flex;gap:6px;padding:8px 10px;border-top:1px solid #2a2a2a;" onpointerdown={(e) => e.stopPropagation()}>
      <textarea bind:value={input} onkeydown={handleKeyDown} placeholder="Ask AIFIO..." rows="1" style="flex:1;resize:none;padding:8px 10px;background:#1a1a2e;border:1px solid #3a3a5a;border-radius:6px;color:#e0e0e0;font-size:12px;font-family:'JetBrains Mono','Fira Code',monospace;outline:none;max-height:60px;"></textarea>
      <button onclick={send} disabled={aifio.isRunning || !input.trim()} style="padding:0 12px;background:#1a1a2e;border:1px solid #5a5a8a;border-radius:6px;color:{aifio.isRunning || !input.trim() ? '#555' : '#e0e0e0'};font-size:12px;font-family:monospace;cursor:{aifio.isRunning || !input.trim() ? 'default' : 'pointer'};flex-shrink:0;">Go</button>
    </div>
  {/if}
</div>
