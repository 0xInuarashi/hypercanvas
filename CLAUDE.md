# Hypercanvas — Project Semantics

## Terminology

### Node
A `CanvasNode` instance. A draggable, resizable box on the 2D canvas representing a tool (console, memo, files, genie, sketchpad, browser, macro). The fundamental unit of the canvas.

### Node (focused / in focus)
A node where a child DOM element currently has keyboard focus (e.g. typing in a terminal or textarea). Detected via CSS `:focus-within`. There is no explicit "focused node" state variable — focus is a DOM-level concept here.

### Node (selected)
A node whose ID is present in the `selectedNodeIds` Set in `Canvas.svelte`. Multiple nodes can be selected simultaneously via shift+drag marquee. Selection is a canvas-level concept, distinct from DOM focus.

### Node Header
The `WidgetHeader.svelte` component rendered at the top of every node. Contains the node icon, label, and optional action buttons. Fixed height, raised background, separated from the body by a border.

### Node Body
The content area below the node header. A `flex:1` container that fills the remaining height of the node and renders the widget-specific UI (terminal, text editor, file browser, etc.). Typically scrollable.

### Node (active / inactive)
Only relevant for `console` and `browser` nodes. Active = the terminal/iframe is running and connected (xterm instance created, WebSocket open). Inactive = disposed and not rendered. All other node types ignore this concept. Toggled via double-click, Alt+Click, or context menu.

### Link
An SVG Bezier curve connecting two node ports, rendered in a separate `LinkLayer` overlay. Ports are on the top/right/bottom/left edges of a node. Links can be selected and deleted.

### Snap
A saved viewport state (pan offset + zoom scale). Saved with Ctrl+Shift+[0-9], recalled with Ctrl+[0-9]. Displayed as numbered buttons in the toolbar.

### Workspace
A self-contained canvas environment with its own nodes, links, viewport (pan+zoom), background color, and snap slots. Multiple workspaces exist in a list; one is active at a time. State is persisted to `localStorage`.

### Ephemeral Console
A temporary floating output bubble that appears near a node when a command is running (e.g. macro execution, Genie bash tool). Animates in, streams output, lingers briefly after completion, then animates out and removes itself. Not a node — has no position on the canvas world, does not persist.

---

## Canvas Interactions

### Panning
Middle mouse button, or Space+left-drag on empty canvas. Moves the viewport offset. Applies a CSS `translate` to the world element.

### Zooming
Ctrl/Cmd+scroll. Exponential scale, range 0.1–5.0. Zooms toward the cursor position (zoom-to-cursor). Also supports Safari pinch-zoom via gesture events.

### Marquee Select
Shift+left-drag on empty canvas. Draws a dashed blue selection box. On release, performs an AABB overlap test against all nodes and adds matches to `selectedNodeIds`. Requires a minimum drag size (5px) to activate.

### Node Dragging
Pointer capture on the node element. Delta is converted from screen pixels to world coordinates by dividing by the current canvas scale. When multiple nodes are selected, dragging any one of them moves all selected nodes together. Supports undo via snapshot.

### Node Resizing
8 handles (4 corners + 4 edges). Same screen-to-world coordinate conversion as dragging. Minimum node size is 40px. Supports undo via snapshot.

---

## UI Structure

### Toolbar
Fixed to the viewport (not the canvas world), positioned bottom-right. Contains zoom controls (−/+, slider, percentage reset, home/reset-view) and snap slot buttons. Settings and history (undo/redo) buttons are bottom-left.

---

## Widget Types

### Console
xterm terminal emulator with a WebSocket daemon connection. Supports persistent sessions, auto-reconnect, and ephemeral output. Ctrl+Click on localhost URLs opens them in a browser widget.

### Memo
Markdown text editor with a toggle between edit and preview modes. Content is stored in the node `label` field.

### Files
File browser with directory navigation. Calls the `/ls` API endpoint. Supports copying paths and setting a default folder.

### Genie
AI-powered task agent using the OpenRouter API. Has tools for bash, web fetch, file read/write, tree, and spawning terminals. Supports multi-turn chat with streaming output and cancellation.

### Sketchpad
Canvas-based drawing app. Strokes are stored as normalized [0–1] coordinates in the node `label` field (JSON). Supports multiple colors, pen widths, undo, and clear.

### Browser
iframe-based web browser. Proxies localhost ports via a `/__browse__/PORT/PATH` URL format. Supports viewport presets (4K, 1080p, mobile, etc.).

### Macro
A button that executes a stored bash script. Shows ephemeral terminal output inline. Status is color-coded: idle / running / done / error.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Middle mouse / Space+drag | Pan canvas |
| Ctrl/Cmd+Scroll | Zoom canvas |
| Shift+drag (empty canvas) | Marquee select |
| Del / Backspace | Delete selected nodes or link (with confirmation) |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Y / Ctrl/Cmd+Shift+Z | Redo |
| Ctrl/Cmd+[0-9] | Recall snap slot |
| Ctrl/Cmd+Shift+[0-9] | Save snap slot |
| Double-click (console/browser) | Activate node |
| Alt+Click (console/browser) | Activate node |

Shortcuts that conflict with text input (Del, Ctrl+Z, etc.) are suppressed when focus is inside an INPUT or TEXTAREA.
