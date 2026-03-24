import type { ChatMessage, ToolDefinition } from '../services/openrouter'
import { streamChatCompletion } from '../services/openrouter'
import { executeTree } from '../services/ptyApi'
import { HTTP_URL, authHeaders, getWsUrl } from '../config'
import { stripAnsi } from './stripAnsi'
import type { FlowGraph, FlowNode, FlowLink } from './autoflowStore.svelte'

export interface FlowCallbacks {
  onNodeStart: (nodeId: string) => void
  onNodeDone: (nodeId: string) => void
  onNodeError: (nodeId: string, error: string) => void
  onLog: (entry: string) => void
}

const TOOLS: ToolDefinition[] = [
  { type: 'function', function: { name: 'bash', description: 'Execute a shell command. Set timeout (seconds) for long-running commands.', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number', description: 'Timeout in seconds (default: 600)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'tree', description: 'List directory structure.', parameters: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'number' } }, required: [] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read file contents.', parameters: { type: 'object', properties: { path: { type: 'string' }, maxLines: { type: 'number' } }, required: ['path'] } } },
]

const DEFAULT_BASH_TIMEOUT = 600_000

async function executeBash(args: { command: string; timeout?: number }, signal?: AbortSignal, onChunk?: (chunk: string) => void): Promise<string> {
  return new Promise<string>((resolve) => {
    let output = ''
    let resolved = false
    const done = (result: string) => { if (resolved) return; resolved = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(result) }
    const ws = new WebSocket(getWsUrl())
    const timeout = args.timeout ? args.timeout * 1000 : DEFAULT_BASH_TIMEOUT
    const timer = setTimeout(() => { ws.close(); done(output + '\n[timed out]') }, timeout)
    const onAbort = () => { ws.close(); done(output + '\n[cancelled]') }
    signal?.addEventListener('abort', onAbort)
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'input', data: args.command + '\nexit\n' })) }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'output') { const clean = stripAnsi(msg.data); output += clean; onChunk?.(clean) }
      } catch {}
    }
    ws.onclose = () => { done(output || '[no output]') }
    ws.onerror = () => { done('Error: WebSocket connection failed') }
  })
}

async function executeReadFile(args: { path: string; maxLines?: number }, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`${HTTP_URL}/read-file`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(args), signal })
    const data = await res.json()
    if (data.error) return `Error: ${data.error}`
    let out = data.content || ''; if (data.truncated) out += '\n[truncated]'
    return out || '[empty file]'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : 'read failed'}` }
}

async function executeTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, onChunk?: (chunk: string) => void): Promise<string> {
  switch (name) {
    case 'bash': return executeBash(args as { command: string; timeout?: number }, signal, onChunk)
    case 'tree': return executeTree(args as { path?: string; depth?: number }, signal)
    case 'read_file': return executeReadFile(args as { path: string; maxLines?: number }, signal)
    default: return `Unknown tool: ${name}`
  }
}

async function runLLMWithTools(
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  signal: AbortSignal,
  onLog: (entry: string) => void,
  maxRounds = 50,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]
  let lastContent = ''

  for (let round = 0; round < maxRounds; round++) {
    let streamedContent = ''
    let streamedReasoning = ''

    const reply = await streamChatCompletion(
      messages, TOOLS, apiKey,
      {
        onReasoning(delta) {
          streamedReasoning += delta
          onLog(`[thinking] ${delta}`)
        },
        onContent(delta) {
          streamedContent += delta
          onLog(`[llm] ${delta}`)
        },
        onToolCall() {},
      },
      signal,
    )
    messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls })
    lastContent = reply.content || ''

    if (!reply.tool_calls?.length) break

    for (const tc of reply.tool_calls) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.function.arguments) } catch {}

      // Log the full tool call
      onLog(`[tool] ${tc.function.name}: ${tc.function.arguments}`)

      // Execute with streaming bash output
      const result = await executeTool(tc.function.name, args, signal, (chunk) => {
        onLog(`[output] ${chunk}`)
      })

      // Log full result for non-bash tools (bash already streamed)
      if (tc.function.name !== 'bash') {
        onLog(`[result] ${result}`)
      }

      messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
    }
  }
  return lastContent
}

async function executeFlowNode(node: FlowNode, input: string, apiKey: string, signal: AbortSignal, onLog: (s: string) => void): Promise<string> {
  switch (node.type) {
    case 'prompt':
      return node.config.text || ''

    case 'execute': {
      const bin = node.config.text || 'echo'
      const system = `You are an orchestrator that invokes command-line tools via bash. Run the binary "${bin}" with the given input as its task/prompt. Figure out the correct CLI invocation (try "${bin} --help" if unsure). Set timeout to 1800 for long-running agent commands. After running, summarize what happened concisely.`
      return runLLMWithTools(system, input || 'Run the tool.', apiKey, signal, onLog)
    }

    case 'eval': {
      const criteria = node.config.text || 'Check if everything works correctly.'
      const system = `You are an evaluator agent. Your job is to assess whether work meets the given criteria. Use your tools to investigate: run bash commands to test, read files, check directory structure, verify running services/ports, etc.

Be thorough — actually run the checks, don't just guess.

Validation criteria: ${criteria}

After investigating, your final message MUST end with exactly one of:
EVAL:PASS — if all criteria are met
EVAL:FAIL:<what needs fixing> — if something is wrong`
      return runLLMWithTools(system, input || 'Evaluate the current state.', apiKey, signal, onLog)
    }
  }
}

// DFS edge classification: back-edges point to an ancestor (create cycles)
function classifyEdges(graph: FlowGraph): { forward: FlowLink[], back: FlowLink[] } {
  const adj = new Map<string, FlowLink[]>()
  for (const node of graph.nodes) adj.set(node.id, [])
  for (const link of graph.links) adj.get(link.from)?.push(link)

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const node of graph.nodes) color.set(node.id, WHITE)

  const forward: FlowLink[] = []
  const back: FlowLink[] = []

  function dfs(id: string) {
    color.set(id, GRAY)
    for (const link of adj.get(id) || []) {
      if (color.get(link.to) === GRAY) {
        back.push(link)
      } else {
        forward.push(link)
        if (color.get(link.to) === WHITE) dfs(link.to)
      }
    }
    color.set(id, BLACK)
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) dfs(node.id)
  }
  return { forward, back }
}

export async function executeFlow(
  graph: FlowGraph,
  apiKey: string,
  signal: AbortSignal,
  callbacks: FlowCallbacks,
): Promise<void> {
  const MAX_RETRIES = 20

  // Separate forward edges (DAG) from back edges (retry loops)
  const { forward, back } = classifyEdges(graph)

  // Build adjacency from forward edges only
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const node of graph.nodes) { incoming.set(node.id, []); outgoing.set(node.id, []) }
  for (const link of forward) {
    incoming.get(link.to)?.push(link.from)
    outgoing.get(link.from)?.push(link.to)
  }

  // Topological sort (Kahn's) on forward edges
  const order: string[] = []
  const deg = new Map<string, number>()
  for (const node of graph.nodes) deg.set(node.id, incoming.get(node.id)?.length ?? 0)
  const q: string[] = []
  for (const [id, d] of deg) if (d === 0) q.push(id)
  while (q.length > 0) {
    const id = q.shift()!
    order.push(id)
    for (const t of outgoing.get(id) || []) {
      const d = deg.get(t)! - 1
      deg.set(t, d)
      if (d === 0) q.push(t)
    }
  }

  // Execute with retry support
  const outputs = new Map<string, string>()
  const feedbacks = new Map<string, string>()
  let retryCount = 0
  let startIdx = 0

  outer: while (startIdx < order.length) {
    // Execute nodes from startIdx forward
    for (let i = startIdx; i < order.length; i++) {
      if (signal.aborted) throw new Error('Cancelled')

      const nodeId = order[i]
      const node = graph.nodes.find(n => n.id === nodeId)
      if (!node) continue

      // Collect forward inputs
      const forwardInputs = (incoming.get(nodeId) || [])
        .map(srcId => outputs.get(srcId) || '').filter(Boolean)

      // Add retry feedback if present
      const feedback = feedbacks.get(nodeId)
      if (feedback) feedbacks.delete(nodeId)

      const allInputs = [...forwardInputs]
      if (feedback) allInputs.push(feedback)
      const input = allInputs.join('\n\n')

      callbacks.onNodeStart(nodeId)
      callbacks.onLog(`--- [${node.type}] ${node.config.text || '(empty)'} ---`)
      if (input) callbacks.onLog(`[input] ${input}`)

      try {
        const output = await executeFlowNode(node, input, apiKey, signal, callbacks.onLog)
        outputs.set(nodeId, output)
        callbacks.onLog(`[node done] ${node.type}:${nodeId}`)
        if (output) callbacks.onLog(`[output] ${output}`)
        callbacks.onNodeDone(nodeId)
      } catch (err) {
        callbacks.onNodeError(nodeId, err instanceof Error ? err.message : 'Failed')
        throw err
      }
    }

    // Check for failed evals with back-edges
    for (const be of back) {
      const evalOutput = outputs.get(be.from) || ''
      if (evalOutput.includes('EVAL:FAIL')) {
        retryCount++
        if (retryCount > MAX_RETRIES) {
          callbacks.onLog(`[retry] Max retries (${MAX_RETRIES}) reached. Stopping.`)
          return
        }
        // Extract feedback
        const failMatch = evalOutput.match(/EVAL:FAIL:?(.+)/s)
        const reason = failMatch ? failMatch[1].trim() : 'Validation failed.'
        callbacks.onLog(`[retry] ${retryCount}/${MAX_RETRIES} — ${reason}`)
        feedbacks.set(be.to, `Previous attempt failed validation. Issues to fix:\n${reason}`)

        // Restart from the back-edge target
        startIdx = order.indexOf(be.to)
        continue outer
      }
    }

    // All evals passed (or no back-edges) — done
    break
  }

  if (order.length < graph.nodes.length) {
    callbacks.onLog('Warning: some nodes were not reached.')
  }
}
