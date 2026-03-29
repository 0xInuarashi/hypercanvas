import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync, existsSync } from 'node:fs'

const ptyPort = process.env.PORT || '7888'
const fishtankPort = String(parseInt(ptyPort, 10) + 1)
const ptyTarget = `http://localhost:${ptyPort}`
const fishtankTarget = `http://localhost:${fishtankPort}`

const appVersion = existsSync('VERSION')
  ? readFileSync('VERSION', 'utf-8').trim()
  : 'dev'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte({ prebundleSvelteLibraries: false })],
  define: {
    '__APP_VERSION__': JSON.stringify(appVersion),
    // Injected so the frontend can build WebSocket URLs pointing directly at the
    // PTY server port. Bun's node:http compat layer doesn't fire 'upgrade' events
    // on outgoing requests, which breaks Vite's http-proxy-3 WS proxy silently.
    // Connecting directly bypasses the proxy entirely and works in all modes.
    '__PTY_PORT__': JSON.stringify(ptyPort),
    '__FISHTANK_PORT__': JSON.stringify(fishtankPort),
  },
  build: {
    rolldownOptions: {
      output: {
        // Force CM6 into its own chunk to work around Rolldown hash_placeholder
        // panic with multi-byte unicode chars (ͼ from @codemirror/view style module)
        manualChunks(id: string) {
          if (id.includes('@codemirror') || id.includes('@lezer')) return 'codemirror'
        },
      },
    },
  },
  server: {
    host: process.env.HOST || 'localhost',
    allowedHosts: true,
    proxy: {
      '/cloud': ptyTarget,
      '/auth': ptyTarget,
      '/tree': ptyTarget,
      '/find-dir': ptyTarget,
      '/ls': ptyTarget,
      '/exec': ptyTarget,
      '/fetch': ptyTarget,
      '/read-file': ptyTarget,
      '/write-file': ptyTarget,
      '/mkdir': ptyTarget,
      '/daemon': ptyTarget,
      '/satellite': ptyTarget,
      '/fishtank': ptyTarget,
      '/browse-proxy': ptyTarget,
      '/update': ptyTarget,
      '/lsp': ptyTarget,
      '/__llm__': {
        target: 'https://claude-oauth-api-production.up.railway.app',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/__llm__/, ''),
      },
    },
  },
})
