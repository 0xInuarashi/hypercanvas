import { HTTP_URL, authHeaders } from '../config'

export async function executeTree(args: { path?: string; depth?: number }, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams()
  if (args.path) params.set('path', args.path)
  if (args.depth) params.set('depth', String(args.depth))
  const url = `${HTTP_URL}/tree${params.toString() ? '?' + params : ''}`
  try {
    const res = await fetch(url, { headers: authHeaders(), signal })
    return res.ok ? await res.text() : `Error: ${res.statusText}`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'fetch failed'}`
  }
}

export async function executeFindDir(args: { name: string }, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({ name: args.name })
  try {
    const res = await fetch(`${HTTP_URL}/find-dir?${params}`, { headers: authHeaders(), signal })
    return res.ok ? await res.text() : `Error: ${res.statusText}`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'fetch failed'}`
  }
}
