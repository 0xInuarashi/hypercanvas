<script lang="ts">
  import WidgetHeader from '../components/WidgetHeader.svelte'

  let { label, onUpdateLabel }: {
    label: string
    onUpdateLabel: (label: string) => void
  } = $props()

  let preview = $state(false)
  let textareaEl: HTMLTextAreaElement

  // Sync from external label changes (undo/redo)
  $effect(() => {
    if (textareaEl && textareaEl.value !== label) {
      textareaEl.value = label
    }
  })

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function inlineMd(text: string): string {
    return text
      .replace(/`([^`]+)`/g, '<code style="background:#1a1a1a;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_: string, text: string, url: string) => {
        if (/^https?:\/\//i.test(url)) {
          return `<a href="${url}" style="color:#7c8fff" target="_blank" rel="noopener">${text}</a>`
        }
        return `${text} (${url})`
      })
  }

  function renderMarkdown(src: string): string {
    const lines = src.split('\n')
    const out: string[] = []
    let inCode = false
    const codeBuf: string[] = []

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (inCode) {
          out.push(`<pre style="background:#1a1a1a;padding:8px 10px;border-radius:4px;overflow-x:auto;margin:4px 0;font-size:12px"><code>${esc(codeBuf.join('\n'))}</code></pre>`)
          codeBuf.length = 0
        }
        inCode = !inCode
        continue
      }
      if (inCode) { codeBuf.push(line); continue }

      const escaped = esc(line)

      if (escaped.startsWith('### '))
        out.push(`<div style="font-size:15px;font-weight:600;color:#e0e0e0;margin:6px 0 2px">${inlineMd(escaped.slice(4))}</div>`)
      else if (escaped.startsWith('## '))
        out.push(`<div style="font-size:17px;font-weight:600;color:#e0e0e0;margin:8px 0 2px">${inlineMd(escaped.slice(3))}</div>`)
      else if (escaped.startsWith('# '))
        out.push(`<div style="font-size:20px;font-weight:600;color:#e0e0e0;margin:10px 0 4px">${inlineMd(escaped.slice(2))}</div>`)
      else if (/^---+$/.test(escaped))
        out.push('<hr style="border:none;border-top:1px solid #333;margin:8px 0" />')
      else if (escaped.startsWith('- '))
        out.push(`<div style="padding-left:16px">\u2022 ${inlineMd(escaped.slice(2))}</div>`)
      else if (escaped.trim() === '')
        out.push('<div style="height:8px"></div>')
      else
        out.push(`<div>${inlineMd(escaped)}</div>`)
    }

    if (inCode && codeBuf.length > 0) {
      out.push(`<pre style="background:#1a1a1a;padding:8px 10px;border-radius:4px;overflow-x:auto;margin:4px 0;font-size:12px"><code>${esc(codeBuf.join('\n'))}</code></pre>`)
    }

    return out.join('')
  }

  let renderedHtml = $derived(renderMarkdown(label))
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div style="display:flex;flex-direction:column;width:100%;height:100%;" onkeydown={(e) => e.stopPropagation()}>
  <WidgetHeader icon="&#9998;" iconColor="#ffd43b" label="Memo">
    {#snippet children()}
      <button
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => preview = !preview}
        style="margin-left:auto;padding:1px 6px;border-radius:3px;border:1px solid {preview ? '#7c8fff' : '#333'};background:{preview ? '#2a2a4a' : 'transparent'};color:{preview ? '#7c8fff' : '#666'};font-size:10px;cursor:pointer;font-family:'JetBrains Mono',monospace;line-height:14px;"
      >Md</button>
    {/snippet}
  </WidgetHeader>
  {#if preview}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onpointerdown={(e) => e.stopPropagation()}
      style="flex:1;overflow:auto;background:#0c0c0c;color:#e0e0e0;font-family:'JetBrains Mono','Fira Code',monospace;font-size:13px;line-height:1.5;padding:10px 12px;"
    >{@html renderedHtml}</div>
  {:else}
    <textarea
      bind:this={textareaEl}
      value={label}
      oninput={(e) => onUpdateLabel(e.currentTarget.value)}
      onpointerdown={(e) => e.stopPropagation()}
      placeholder="Write something..."
      spellcheck="false"
      style="flex:1;resize:none;border:none;outline:none;background:#0c0c0c;color:#e0e0e0;font-family:'JetBrains Mono','Fira Code',monospace;font-size:13px;line-height:1.5;padding:10px 12px;overflow:auto;"
    ></textarea>
  {/if}
</div>
