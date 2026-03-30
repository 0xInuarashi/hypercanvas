/** Typed WebSocket message structures from the PTY server. */

export interface WsOutputMsg {
  type: 'output'
  data: string
}

export type DaemonStatus = 'running' | 'stopped' | 'error'

export interface WsDaemonCreatedMsg {
  type: 'daemon:created'
  sessionId: string
  status: DaemonStatus
  restoredSatPassword?: string | null
  restoredFishPassword?: string | null
}

export interface WsDaemonAttachedMsg {
  type: 'daemon:attached'
  sessionId?: string
  status: DaemonStatus
  exitCode?: number
}

export interface WsDaemonStatusMsg {
  type: 'daemon:status'
  status: DaemonStatus
}

export interface WsDaemonErrorMsg {
  type: 'daemon:error'
  message: string
}

export type WsServerMsg =
  | WsOutputMsg
  | WsDaemonCreatedMsg
  | WsDaemonAttachedMsg
  | WsDaemonStatusMsg
  | WsDaemonErrorMsg

/** Parse and validate a WebSocket message. Returns null for malformed data. */
export function parseWsMessage(data: unknown): WsServerMsg | null {
  if (typeof data !== 'string') return null
  try {
    const msg = JSON.parse(data)
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') return null
    return msg as WsServerMsg
  } catch {
    return null
  }
}
