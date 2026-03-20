// Derive server URLs from the current page location so the app works
// on any host/port without hardcoded values.
const loc = window.location
const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:'

export const HTTP_URL = `${loc.protocol}//${loc.host}`

// Auth token stored in localStorage so it persists across tabs/sessions
export function getAuthToken(): string | null {
  return localStorage.getItem('auth-token')
}

export function setAuthToken(token: string): void {
  localStorage.setItem('auth-token', token)
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export function getWsUrl(): string {
  const token = getAuthToken()
  return token
    ? `${wsProto}//${loc.host}/ws?token=${encodeURIComponent(token)}`
    : `${wsProto}//${loc.host}/ws`
}

export function getSatelliteWsUrl(sessionId: string, password: string): string {
  return `${wsProto}//${loc.host}/ws?satellite=${encodeURIComponent(sessionId)}&password=${encodeURIComponent(password)}`
}

// Clipboard helpers that fall back to execCommand for non-secure contexts (HTTP)
export function clipboardWrite(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}

export function clipboardRead(): Promise<string> {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText().catch(() => '')
  }
  return Promise.resolve('')
}

function fallbackCopy(text: string): void {
  const prev = document.activeElement as HTMLElement | null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
  prev?.focus()
}
