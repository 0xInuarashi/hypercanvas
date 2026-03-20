# Hypercanvas

An infinite canvas for multi-agent hierarchical orchestration. Drag, link, and control terminals, daemons, LLM agents, and more from a single visual workspace.

## Quick Start

```bash
bun install
bun run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start PTY server + Vite dev server with HMR |
| `bun run dev:public` | Same as `dev`, but bound to `0.0.0.0` for network access |
| `bun run dev:ui` | Vite frontend only (no PTY server) |
| `bun run dev:pty` | PTY server only |
| `bun run build` | Type-check + production build |
| `bun run build:bin` | Compile PTY server to standalone binary |
| `bun run build:all` | `build` + `build:bin` |
| `bun run start` | Run PTY server (serves built frontend from `dist/`) |
| `bun run preview` | Preview production build via Vite |
| `bun run lint` | ESLint |
| `bun run typecheck` | `svelte-check` |
| `bun run clean` | Remove build artifacts |

## Node Types

| Type | Description |
|------|-------------|
| **Console** | Interactive terminal (xterm.js over WebSocket PTY) |
| **Daemon** | Persistent background process with 512KB scrollback |
| **Macro** | One-click bash script button |
| **Memo** | Markdown note with live preview |
| **Files** | File browser rooted at `$HOME` |
| **Sketchpad** | Freeform drawing canvas |
| **Browser** | Reverse-proxy web viewer with viewport presets |
| **AIFIO** | LLM assistant that creates/configures nodes via natural language |
| **Genie** | Autonomous LLM agent with bash, file I/O, and terminal tools |

## Usage

### Canvas

- **Pan** -- drag on empty space
- **Zoom** -- scroll wheel (zooms toward cursor, 0.1x--5x)
- **Draw** -- select a tool from the sidebar, then drag on the canvas to place it

### Nodes

- **Move** -- drag the node body
- **Resize** -- drag any corner or edge handle
- **Delete** -- right-click > Delete
- **Focus** -- double-click to isolate (Escape to exit)

### Links

- Hover a node to reveal connection ports (top/right/bottom/left)
- Drag from a port to another node to create a curved Bezier link
- Right-click a link to delete it

### Workspaces

- Tabs at the top for multiple isolated canvases
- Each workspace saves its own nodes, links, background, and viewport
- State persists to `localStorage`

### Undo / Redo

`Ctrl+Z` / `Ctrl+Y` (up to 100 history entries)

## Tech Stack

- **Svelte 5** with runes (`$state`, `$effect`, `$props`)
- **Vite** for dev/build
- **Bun** runtime -- PTY server compiles to a standalone binary
- **xterm.js** for terminal emulation
- **OpenRouter** for LLM streaming + tool calling
- CSS transforms for pan/zoom (no canvas API)

## Architecture

```
src/
  main.ts                           # Svelte mount
  App.svelte                        # Auth gate + satellite routing
  types.ts                          # CanvasNode, Link, NodeType, etc.
  config.ts                         # Server URL, auth, clipboard helpers
  toolPalette.ts                    # Tool definitions + icons
  theme.ts / theme.css              # Color themes

  components/
    AppMain.svelte                  # Root canvas app
    Canvas.svelte                   # Viewport, nodes, links, draw-to-create
    CanvasNode.svelte               # Node renderer (drag, resize, ports)
    LinkLayer.svelte                # SVG Bezier link curves
    Sidebar.svelte                  # Tool palette + bg color picker
    WorkspaceTabs.svelte            # Workspace tab bar
    ContextMenu.svelte              # Right-click menu
    HistoryPanel.svelte             # Undo/redo controls
    SettingsPanel.svelte            # User settings modal
    LoginGate.svelte                # Password auth screen
    WidgetHeader.svelte             # Node title bar
    EphemeralConsole.svelte         # Inline command output overlay
    SatelliteShareModal.svelte      # QR code sharing dialog
    ScriptApprovalModal.svelte      # URL script confirmation

  widgets/
    ConsoleWidget.svelte            # Interactive PTY terminal
    DaemonWidget.svelte             # Persistent background process
    MacroWidget.svelte              # Bash script button
    MemoWidget.svelte               # Markdown editor
    FileBrowserWidget.svelte        # File explorer
    SketchpadWidget.svelte          # Drawing canvas
    BrowserWidget.svelte            # Reverse-proxy web viewer
    AifioWidget.svelte              # LLM node-creation assistant
    GenieWidget.svelte              # Autonomous LLM agent

  lib/
    canvasState.svelte.ts           # Primary state (nodes, links, workspaces)
    canvasControls.svelte.ts        # Pan, zoom, selection, draw-to-create
    historyManager.svelte.ts        # Undo/redo snapshots
    settingsState.svelte.ts         # User preferences + API keys
    llmChat.svelte.ts               # LLM streaming state
    aifioStores.svelte.ts           # AIFIO per-node state
    genieStores.svelte.ts           # Genie per-node state
    urlScript.ts                    # URL-based canvas scripting
    stripAnsi.ts                    # ANSI escape stripping
    portal.ts                       # DOM portal utility

  services/
    openrouter.ts                   # OpenRouter chat completion client
    ptyApi.ts                       # HTTP calls to PTY server
    security.ts                     # Bash command risk analysis

  satellite/
    SatelliteView.svelte            # Read-only shared daemon viewer

server/
  pty-server.ts                     # Bun HTTP + WebSocket server, PTY management

scripts/
  start.sh                         # Build + run
  install-service.sh               # Install as systemd service
  release.sh                       # Build binary + upload GitHub release
```

## Server

The PTY server (`server/pty-server.ts`) runs on Bun and provides:

- **Terminal sessions** -- ephemeral and persistent (daemon) PTY spawning
- **HTTP API** -- `/tree`, `/ls`, `/read-file`, `/write-file`, `/exec`, `/find-dir`, `/fetch`
- **WebSocket** -- real-time PTY I/O with multi-client broadcast for daemons
- **Browse proxy** -- per-port reverse proxy for the Browser widget
- **Satellite sharing** -- password-protected, rate-limited daemon session sharing with QR codes
- **Auth** -- optional `AUTH_TOKEN` env var with timing-safe comparison
- **Static serving** -- serves `dist/` with SPA fallback in production

## Deployment

A standalone binary can be built with `bun run build:bin`. See `scripts/install-service.sh` for systemd setup or `cloud-deploy.yaml` for cloud-init provisioning.
