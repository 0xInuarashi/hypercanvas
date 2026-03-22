import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync, existsSync } from 'node:fs'

const ptyPort = process.env.PORT || '7888'
const ptyTarget = `http://localhost:${ptyPort}`
const wsTarget = `ws://localhost:${ptyPort}`

const appVersion = existsSync('VERSION')
  ? readFileSync('VERSION', 'utf-8').trim()
  : 'dev'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  define: {
    '__APP_VERSION__': JSON.stringify(appVersion),
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
      '/ws': {
        target: wsTarget,
        ws: true,
      },
    },
  },
})
