import { DEFAULT_SIZES } from './canvasState.svelte'
import { getPrimaryModel, getFallbackModel } from '../services/openrouter'
import type { NodeType } from '../types'

export interface UserSettings {
  nodeSizes: Partial<Record<NodeType, { w: number; h: number }>>
  ephemeralConsolesGenie?: boolean
  ephemeralConsolesMacro?: boolean
}

const SETTINGS_KEY = 'hypercanvas-settings'

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { nodeSizes: {} }
    return JSON.parse(raw) as UserSettings
  } catch { return { nodeSizes: {} } }
}

export function saveSettings(settings: UserSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function getEffectiveSizes(settings: UserSettings): Record<NodeType, { w: number; h: number }> {
  const result = { ...DEFAULT_SIZES }
  for (const [type, size] of Object.entries(settings.nodeSizes)) {
    if (!size) continue
    const def = DEFAULT_SIZES[type as NodeType]
    result[type as NodeType] = { w: size.w > 0 ? size.w : def.w, h: size.h > 0 ? size.h : def.h }
  }
  return result
}

export const ss = $state({
  userSettings: loadSettings() as UserSettings,
  showSettings: false,
  openrouterKey: localStorage.getItem('openrouter-api-key') ?? '',
  primaryModel: getPrimaryModel(),
  fallbackModel: getFallbackModel(),
})

export function getNodeSizes(): Record<NodeType, { w: number; h: number }> {
  return getEffectiveSizes(ss.userSettings)
}

export function setShowSettings(v: boolean) { ss.showSettings = v }

export function updateSettings(s: UserSettings) { ss.userSettings = s; saveSettings(s) }

export function saveOpenrouterKey(val: string) {
  const trimmed = val.trim(); ss.openrouterKey = trimmed
  if (trimmed) localStorage.setItem('openrouter-api-key', trimmed)
  else localStorage.removeItem('openrouter-api-key')
}

export function savePrimaryModel(val: string) {
  const trimmed = val.trim(); ss.primaryModel = trimmed
  if (trimmed) localStorage.setItem('openrouter-primary-model', trimmed)
  else localStorage.removeItem('openrouter-primary-model')
}

export function saveFallbackModel(val: string) {
  const trimmed = val.trim(); ss.fallbackModel = trimmed
  if (trimmed) localStorage.setItem('openrouter-fallback-model', trimmed)
  else localStorage.removeItem('openrouter-fallback-model')
}
