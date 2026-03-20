/** Strip ANSI escapes, OSC sequences (terminal title), and spinner redraws from PTY output. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences (e.g. terminal title)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')              // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\[?[0-9;]*[^0-9;a-zA-Z\x1b]/g, '')   // other escape fragments
    .replace(/\r(?!\n)/g, '')                            // bare carriage returns (spinner redraws)
}
