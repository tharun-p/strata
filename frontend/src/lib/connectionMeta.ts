import type { ConnectionInput, ConnectionProfile, ConnectionSummary, WorkspaceSettings } from '../types'

const LEGACY_STORAGE_KEYS = [
  'strata.connectionMeta',
  'strata.connectionColors',
  'strata.panelWidths',
  'strata.panelVisibility',
  'strata.queryTabs',
]

export const CONNECTION_COLORS = ['#6955ee', '#18a77c', '#2563eb', '#d45b64', '#a77413', '#db2777', '#0f766e', '#7c3aed']

export const PANEL_WIDTH_LIMITS = {
  explorer: { min: 220, max: 460, default: 270 },
  context: { min: 220, max: 420, default: 292 },
} as const

function readLegacy<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

export function loadLegacyConnectionProfiles(): ConnectionProfile[] {
  const items = readLegacy<Array<Partial<ConnectionProfile>>>('strata.connectionMeta')
  const colors = readLegacy<Record<string, string>>('strata.connectionColors') ?? {}
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (!item.host || !item.database || !item.username) return []
    const port = Number(item.port) || 5432
    const key = `${item.host}:${port}/${item.database}@${item.username}`
    return [{
      id: '',
      name: item.name || item.database,
      host: item.host,
      port,
      database: item.database,
      username: item.username,
      sslMode: item.sslMode || 'prefer',
      connectTimeoutMs: item.connectTimeoutMs || 10_000,
      color: item.color || colors[key] || CONNECTION_COLORS[0],
      readOnlyDefault: true,
      autoConnect: false,
      privateMode: false,
      credentialStatus: 'missing',
      createdAt: '',
      updatedAt: '',
    }]
  })
}

export function clearLegacyConnections() {
  localStorage.removeItem('strata.connectionMeta')
  localStorage.removeItem('strata.connectionColors')
}

export function loadLegacyWorkspaceSettings(): Partial<WorkspaceSettings> | null {
  const widths = readLegacy<{ explorer?: number; context?: number }>('strata.panelWidths')
  const visibility = readLegacy<{ explorerCollapsed?: boolean; contextCollapsed?: boolean }>('strata.panelVisibility')
  if (!widths && !visibility) return null
  return {
    ...(typeof widths?.explorer === 'number' ? { explorerWidth: widths.explorer } : {}),
    ...(typeof widths?.context === 'number' ? { contextWidth: widths.context } : {}),
    ...(typeof visibility?.explorerCollapsed === 'boolean' ? { explorerCollapsed: visibility.explorerCollapsed } : {}),
    ...(typeof visibility?.contextCollapsed === 'boolean' ? { contextCollapsed: visibility.contextCollapsed } : {}),
  }
}

export function clearLegacyWorkspaceSettings() {
  localStorage.removeItem('strata.panelWidths')
  localStorage.removeItem('strata.panelVisibility')
}

export type LegacyQueryTab = {
  id?: string
  title?: string
  sql?: string
  question?: string
}

export function loadLegacyQueryTabs(): { tabs: LegacyQueryTab[]; activeId?: string } | null {
  const value = readLegacy<unknown>('strata.queryTabs')
  if (Array.isArray(value)) return { tabs: value as LegacyQueryTab[] }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const tabs = Array.isArray(record.tabs) ? record.tabs : Array.isArray(record.queryTabs) ? record.queryTabs : null
  if (!tabs) return null
  const activeId = typeof record.activeQueryId === 'string' ? record.activeQueryId : typeof record.activeId === 'string' ? record.activeId : undefined
  return { tabs: tabs as LegacyQueryTab[], activeId }
}

export function clearLegacyQueryTabs() {
  localStorage.removeItem('strata.queryTabs')
}

export function hasLegacyPersistence() {
  return LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null)
}

export function colorKey(connection: Pick<ConnectionSummary, 'host' | 'port' | 'database' | 'username'>) {
  return `${connection.host}:${connection.port}/${connection.database}@${connection.username}`
}

export function pickConnectionColor(used: string[]) {
  return CONNECTION_COLORS.find((color) => !used.includes(color)) ?? CONNECTION_COLORS[used.length % CONNECTION_COLORS.length]
}

export function emptyConnectionForm(): ConnectionInput {
  return {
    name: '',
    host: '',
    port: 5432,
    database: '',
    username: '',
    password: '',
    sslMode: 'prefer',
    connectTimeoutMs: 10_000,
    rememberPassword: false,
    privateMode: false,
    autoConnect: false,
  }
}
