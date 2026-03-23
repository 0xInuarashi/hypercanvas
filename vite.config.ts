import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync, existsSync } from 'node:fs'

const ptyPort = process.env.PORT || '7888'
const ptyTarget = `http://localhost:${ptyPort}`

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
  },
  server: {
    host: process.env.HOST || 'localhost',
    allowedHosts: true,
    proxy: {
      '/auth': ptyTarget,
      '/tree': ptyTarget,
      '/find-dir': ptyTarget,
      '/ls': ptyTarget,
      '/exec': ptyTarget,
      '/fetch': ptyTarget,
      '/read-file': ptyTarget,
      '/write-file': ptyTarget,
      '/daemon': ptyTarget,
      '/satellite': ptyTarget,
      '/browse-proxy': ptyTarget,
      '/update': ptyTarget,
    },
  },
})
