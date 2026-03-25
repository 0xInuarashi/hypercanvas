/** Lazy-loading CodeMirror 6 editor factory — uses Shiki for syntax highlighting */

import { codeToTokens, type BundledLanguage } from 'shiki'

type EditorView = import('@codemirror/view').EditorView

/** Shiki-powered highlighting via CM6 decorations */
function shikiHighlighter(
  lang: string,
  ViewPlugin: typeof import('@codemirror/view').ViewPlugin,
  Decoration: typeof import('@codemirror/view').Decoration,
  RangeSetBuilder: typeof import('@codemirror/state').RangeSetBuilder,
) {
  let decorations: import('@codemirror/view').DecorationSet
  let pending = false

  async function tokenize(doc: string) {
    try {
      const result = await codeToTokens(doc, {
        lang: lang as BundledLanguage,
        theme: 'vitesse-dark',
      })
      return result.tokens
    } catch {
      try {
        const result = await codeToTokens(doc, {
          lang: 'plaintext' as BundledLanguage,
          theme: 'vitesse-dark',
        })
        return result.tokens
      } catch {
        return null
      }
    }
  }

  return ViewPlugin.define(
    (view) => {
      const builder = new RangeSetBuilder<import('@codemirror/view').Decoration>()
      decorations = builder.finish()

      // Initial highlight
      pending = true
      tokenize(view.state.doc.toString()).then((tokens) => {
        pending = false
        if (!tokens) return
        decorations = buildDecorations(tokens, view.state.doc, Decoration, RangeSetBuilder)
        view.dispatch() // trigger decoration update
      })

      return {
        update(update: import('@codemirror/view').ViewUpdate) {
          if (update.docChanged && !pending) {
            pending = true
            // Debounce re-highlighting
            setTimeout(() => {
              tokenize(update.state.doc.toString()).then((tokens) => {
                pending = false
                if (!tokens) return
                decorations = buildDecorations(tokens, update.state.doc, Decoration, RangeSetBuilder)
                update.view.dispatch() // trigger decoration update
              })
            }, 150)
          }
        },
      }
    },
    {
      decorations: () => decorations,
    },
  )
}

function buildDecorations(
  tokens: import('shiki').ThemedToken[][],
  doc: import('@codemirror/state').Text,
  Decoration: typeof import('@codemirror/view').Decoration,
  RangeSetBuilder: typeof import('@codemirror/state').RangeSetBuilder,
) {
  const builder = new RangeSetBuilder<import('@codemirror/view').Decoration>()
  for (let lineIdx = 0; lineIdx < tokens.length && lineIdx < doc.lines; lineIdx++) {
    const line = doc.line(lineIdx + 1)
    let offset = line.from
    for (const token of tokens[lineIdx]) {
      const start = offset
      const end = offset + token.content.length
      offset = end
      if (token.color && end <= line.to + 1) {
        const clampedEnd = Math.min(end, line.to)
        if (clampedEnd > start) {
          builder.add(start, clampedEnd, Decoration.mark({ attributes: { style: `color:${token.color}` } }))
        }
      }
    }
  }
  return builder.finish()
}

export async function createEditor(
  container: HTMLElement,
  content: string,
  lang: string,
  onChange: (doc: string) => void,
  onSave: () => void,
): Promise<EditorView> {
  const [
    { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, ViewPlugin, Decoration },
    { EditorState, RangeSetBuilder },
    { defaultKeymap, history, historyKeymap, indentWithTab },
  ] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/state'),
    import('@codemirror/commands'),
  ])

  const theme = EditorView.theme({
    '&': { height: '100%', fontSize: '12px', background: '#121212', color: '#ccc' },
    '.cm-content': { fontFamily: "'JetBrains Mono','Fira Code',monospace", caretColor: '#c792ea', padding: '4px 0' },
    '.cm-line': { padding: '0', lineHeight: '19px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#c792ea' },
    '.cm-gutters': { fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: '12px', background: 'transparent', color: '#444', border: 'none', lineHeight: '19px', paddingLeft: '12px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0', minWidth: 'unset', marginRight: '16px', textAlign: 'right' },
    '.cm-activeLineGutter': { background: 'transparent', color: '#666' },
    '.cm-activeLine': { background: '#1a1a2e' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: '#2a2a4a' },
    '.cm-matchingBracket': { background: '#3a3a5a', color: '#fff' },
    '.cm-scroller': { overflow: 'auto' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionMatch': { background: '#2a3a4a' },
    '.cm-searchMatch': { background: '#3a3a1a', outline: '1px solid #5a5a2a' },
  }, { dark: true })

  const view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: 'Mod-s', run: () => { onSave(); return true } },
        ]),
        theme,
        shikiHighlighter(lang, ViewPlugin, Decoration, RangeSetBuilder),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
        }),
      ],
    }),
    parent: container,
  })

  return view
}

/** Scroll a CM6 view to a given 1-based line number */
export async function scrollToLine(view: EditorView, line: number) {
  const { EditorView: EV } = await import('@codemirror/view')
  const clampedLine = Math.max(1, Math.min(line, view.state.doc.lines))
  const pos = view.state.doc.line(clampedLine).from
  view.dispatch({ effects: EV.scrollIntoView(pos, { y: 'start' }) })
}

/** Get the 1-based line number at the top of the CM6 viewport */
export function getTopLine(view: EditorView): number {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
  return view.state.doc.lineAt(block.from).number
}
