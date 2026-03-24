<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { HTTP_URL, authHeaders } from '../config'
  import WidgetHeader from '../components/WidgetHeader.svelte'
  import { langFromPath, lspKeyFromLang, LSP_SERVERS } from '../lib/readerLang'
  import { codeToHtml, type BundledLanguage } from 'shiki'
  import { getLspClient } from '../services/lspClient'
  import type { LspClient, Diagnostic } from '../services/lspClient'

  let { filePath, scrollLine, label: displayName, onGoToDefinition }: {
    filePath: string
    scrollLine?: number
    label: string
    onGoToDefinition?: (filePath: string, line: number) => void
  } = $props()

  let content = $state('')
  let totalLines = $state(0)
  let truncated = $state(false)
  let error = $state<string | null>(null)
  let loading = $state(true)
  let highlightedHtml = $state('')
  let codeEl = $state<HTMLDivElement>(undefined!)
  let scrollEl = $state<HTMLDivElement>(undefined!)
  let lang = $derived(langFromPath(filePath))

  // LSP state
  let lspClient: LspClient | null = null
  let hover = $state<{ x: number; y: number; text: string } | null>(null)
  let diagnostics = $state<Diagnostic[]>([])
  let hoverTimer: ReturnType<typeof setTimeout> | null = null

  async function loadFile() {
    loading = true
    error = null
    try {
      const res = await fetch(`${HTTP_URL}/read-file`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: filePath, maxLines: 50000 }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { error = data.error || 'Failed to read file'; return }
      content = data.content
      totalLines = data.totalLines
      truncated = data.truncated
      await highlight()
    } catch {
      error = 'Connection failed'
    } finally {
      loading = false
    }
  }

  async function highlight() {
    if (!content) { highlightedHtml = ''; return }
    try {
      const html = await codeToHtml(content, {
        lang: lang as BundledLanguage,
        theme: 'vitesse-dark',
      })
      highlightedHtml = html
    } catch {
      // Fallback for unsupported languages
      try {
        const html = await codeToHtml(content, { lang: 'plaintext', theme: 'vitesse-dark' })
        highlightedHtml = html
      } catch {
        highlightedHtml = `<pre style="margin:0;padding:0;"><code>${escHtml(content)}</code></pre>`
      }
    }
  }

  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function scrollToLine(line: number) {
    if (!scrollEl) return
    const lineEl = scrollEl.querySelector(`[data-line="${line}"]`) as HTMLElement
    if (lineEl) {
      lineEl.scrollIntoView({ block: 'center' })
      lineEl.style.background = 'rgba(124, 143, 255, 0.15)'
      setTimeout(() => { lineEl.style.background = '' }, 2000)
    } else {
      // Estimate scroll position
      const lineHeight = 19
      scrollEl.scrollTop = Math.max(0, (line - 10)) * lineHeight
    }
  }

  // Build line number + code HTML with data-line attributes
  let renderedHtml = $derived.by(() => {
    if (!highlightedHtml) return ''
    // Shiki wraps in <pre><code>...</code></pre>
    // Extract inner content and wrap each line with line numbers
    const parser = new DOMParser()
    const doc = parser.parseFromString(highlightedHtml, 'text/html')
    const codeEl = doc.querySelector('code')
    if (!codeEl) return highlightedHtml

    const lines = codeEl.innerHTML.split('\n')
    // Remove trailing empty line that Shiki adds
    if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

    const gutterWidth = String(lines.length).length
    const result = lines.map((lineHtml, i) => {
      const num = i + 1
      const gutter = `<span class="reader-gutter" style="display:inline-block;width:${gutterWidth}ch;text-align:right;color:#444;user-select:none;margin-right:16px;flex-shrink:0;">${num}</span>`
      return `<div class="reader-line" data-line="${num}" style="display:flex;min-height:19px;padding:0 12px;line-height:19px;">${gutter}<span class="reader-code" style="flex:1;min-width:0;white-space:pre-wrap;word-break:break-all;">${lineHtml}</span></div>`
    }).join('')

    return result
  })

  // LSP integration
  async function initLsp() {
    const lspKey = lspKeyFromLang(lang)
    if (!lspKey || !LSP_SERVERS[lspKey]) return
    try {
      lspClient = await getLspClient(lspKey, filePath)
      if (lspClient) {
        lspClient.didOpen(filePath, lang, content)
        lspClient.onDiagnostics(filePath, (diags) => { diagnostics = diags })
      }
    } catch {
      // LSP not available — fine, we're a reader first
    }
  }

  async function handleHover(e: MouseEvent) {
    if (!lspClient || !codeEl) return
    const target = e.target as HTMLElement
    const lineEl = target.closest('.reader-line') as HTMLElement
    if (!lineEl) { hover = null; return }
    const line = parseInt(lineEl.dataset.line || '0', 10)
    if (!line) return

    // Get character position from mouse X relative to code span
    const codeSpan = lineEl.querySelector('.reader-code') as HTMLElement
    if (!codeSpan) return

    const range = document.createRange()
    const textNodes = getTextNodes(codeSpan)
    let col = 0
    let found = false
    for (const textNode of textNodes) {
      for (let i = 0; i < textNode.textContent!.length; i++) {
        range.setStart(textNode, i)
        range.setEnd(textNode, i + 1)
        const rect = range.getBoundingClientRect()
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          col = getCharOffset(codeSpan, textNode, i)
          found = true
          break
        }
      }
      if (found) break
    }

    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = setTimeout(async () => {
      try {
        const result = await lspClient!.hover(filePath, line - 1, col)
        if (result && result.contents) {
          const text = typeof result.contents === 'string'
            ? result.contents
            : (result.contents as { value: string }).value || String(result.contents)
          hover = { x: e.clientX, y: e.clientY, text }
        } else {
          hover = null
        }
      } catch { hover = null }
    }, 300)
  }

  function getTextNodes(el: Node): Text[] {
    const nodes: Text[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let n: Text | null
    while ((n = walker.nextNode() as Text | null)) nodes.push(n)
    return nodes
  }

  function getCharOffset(container: HTMLElement, targetNode: Text, targetIdx: number): number {
    const textNodes = getTextNodes(container)
    let offset = 0
    for (const node of textNodes) {
      if (node === targetNode) return offset + targetIdx
      offset += node.textContent!.length
    }
    return offset
  }

  async function handleClick(e: MouseEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    if (!lspClient || !onGoToDefinition) return

    const target = e.target as HTMLElement
    const lineEl = target.closest('.reader-line') as HTMLElement
    if (!lineEl) return
    const line = parseInt(lineEl.dataset.line || '0', 10)
    if (!line) return

    const codeSpan = lineEl.querySelector('.reader-code') as HTMLElement
    if (!codeSpan) return

    const range = document.createRange()
    const textNodes = getTextNodes(codeSpan)
    let col = 0
    let found = false
    for (const textNode of textNodes) {
      for (let i = 0; i < textNode.textContent!.length; i++) {
        range.setStart(textNode, i)
        range.setEnd(textNode, i + 1)
        const rect = range.getBoundingClientRect()
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          col = getCharOffset(codeSpan, textNode, i)
          found = true
          break
        }
      }
      if (found) break
    }

    if (!found) return

    try {
      const result = await lspClient.definition(filePath, line - 1, col)
      if (result) {
        const loc = Array.isArray(result) ? result[0] : result
        if (loc?.uri && loc?.range) {
          const targetPath = loc.uri.replace('file://', '')
          const targetLine = loc.range.start.line + 1
          onGoToDefinition(targetPath, targetLine)
        }
      }
    } catch { /* ignore */ }
  }

  function handleMouseLeave() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
    hover = null
  }

  onMount(async () => {
    await loadFile()
    if (scrollLine && scrollLine > 0) {
      // Wait for render
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToLine(scrollLine!)))
    }
    initLsp()
  })

  onDestroy(() => {
    if (hoverTimer) clearTimeout(hoverTimer)
    if (lspClient) lspClient.didClose(filePath)
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon={`</>`} iconColor="#c792ea">
    {#snippet label()}
      <span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title={filePath}>
        {displayName}{scrollLine ? `:${scrollLine}` : ''}
      </span>
    {/snippet}
    {#snippet children()}
      <span style="color:#555;font-size:10px;flex-shrink:0;">{lang}</span>
      {#if diagnostics.length > 0}
        <span style="color:#ff6b6b;font-size:10px;flex-shrink:0;" title="{diagnostics.length} issue{diagnostics.length > 1 ? 's' : ''}">{diagnostics.length}!</span>
      {/if}
      {#if totalLines > 0}
        <span style="color:#444;font-size:10px;flex-shrink:0;">{totalLines}L</span>
      {/if}
    {/snippet}
  </WidgetHeader>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={scrollEl}
    tabindex="-1"
    style="flex:1;overflow:auto;font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;background:#121212;position:relative;outline:none;"
    onpointerdown={(e) => { e.stopPropagation(); scrollEl?.focus() }}
  >
    {#if loading}
      <div style="padding:16px;color:#555;font-size:11px;">Loading...</div>
    {:else if error}
      <div style="padding:16px;color:#ff6b6b;font-size:11px;">{error}</div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={codeEl}
        style="padding:4px 0;cursor:text;user-select:text;"
        onmousemove={handleHover}
        onmouseleave={handleMouseLeave}
        onclick={handleClick}
      >
        {@html renderedHtml}
      </div>
      {#if truncated}
        <div style="padding:8px 12px;color:#666;font-size:10px;border-top:1px solid #1a1a1a;background:#0e0e0e;">
          File truncated — showing first {content.split('\n').length} of {totalLines} lines
        </div>
      {/if}
    {/if}

    <!-- Hover tooltip -->
    {#if hover}
      <div style="position:fixed;left:{hover.x + 8}px;top:{hover.y - 40}px;max-width:500px;max-height:200px;overflow:auto;padding:6px 10px;background:#1a1a2e;border:1px solid #3a3a5a;border-radius:6px;color:#ccc;font-size:11px;font-family:'JetBrains Mono','Fira Code',monospace;white-space:pre-wrap;z-index:1000;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.5);">
        {hover.text}
      </div>
    {/if}
  </div>
</div>
