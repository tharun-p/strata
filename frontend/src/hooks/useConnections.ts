import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { clearLegacyConnections, colorKey, loadLegacyConnectionProfiles, pickConnectionColor } from '../lib/connectionMeta'
import type { ConnectionInput, ConnectionProfile, ConnectionSummary, ToastTone } from '../types'

type Notify = (message: string, tone?: ToastTone) => void

export function useConnections(notify: Notify) {
  const [connections, setConnections] = useState<ConnectionSummary[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [colorMap, setColorMap] = useState<Record<string, string>>({})
  const [booting, setBooting] = useState(true)
  const [connectionModal, setConnectionModal] = useState(false)
  const [modalDefaults, setModalDefaults] = useState<Partial<ConnectionInput> | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const colorMapRef = useRef(colorMap)
  colorMapRef.current = colorMap

  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeConnectionId) ?? connections[0] ?? null,
    [activeConnectionId, connections],
  )

  const ensureColor = useCallback((connection: ConnectionSummary) => {
    const key = colorKey(connection)
    const current = colorMapRef.current
    if (current[key]) return current[key]
    const color = pickConnectionColor(Object.values(current))
    const next = { ...current, [key]: color }
    colorMapRef.current = next
    setColorMap(next)
    return color
  }, [])

  const connectionColor = useCallback((connection: ConnectionSummary | null) => {
    if (!connection) return '#6955ee'
    return colorMap[colorKey(connection)] ?? ensureColor(connection)
  }, [colorMap, ensureColor])

  const refreshConnections = useCallback(async (preferId?: string | null) => {
    const items = await api.listConnections()
    items.forEach(ensureColor)
    setConnections(items)
    setActiveConnectionId((current) => {
      if (preferId && items.some((item) => item.id === preferId)) return preferId
      if (current && items.some((item) => item.id === current)) return current
      return items[0]?.id ?? null
    })
    return items
  }, [ensureColor])

  const refreshProfiles = useCallback(async () => {
    const items = await api.listConnectionProfiles()
    setProfiles(items)
    const nextColors = { ...colorMapRef.current }
    for (const profile of items) {
      const key = `${profile.host}:${profile.port}/${profile.database}@${profile.username}`
      nextColors[key] = profile.color
    }
    colorMapRef.current = nextColors
    setColorMap(nextColors)
    return items
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [status, items] = await Promise.all([api.getStartupStatus(), api.listConnections()])
        let saved: ConnectionProfile[] = []
        if (status.persistenceReady) {
          const legacyProfiles = loadLegacyConnectionProfiles()
          if (legacyProfiles.length > 0) {
            await api.importConnectionProfiles(legacyProfiles)
            clearLegacyConnections()
          }
          saved = await refreshProfiles()
        }
        items.forEach(ensureColor)
        setConnections(items)
        if (items.length > 0) {
          setActiveConnectionId(items[0].id)
        } else {
          setConnectionModal(true)
          setModalDefaults(saved[0] ? profileDefaults(saved[0]) : null)
        }
        if (status.error) notify(`Automatic PostgreSQL connection failed: ${status.error}`, 'error')
        if (status.persistenceError) notify(`Local workspace persistence is unavailable: ${status.persistenceError}`, 'error')
      } catch (error) {
        setConnectionModal(true)
        notify(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setBooting(false)
      }
    })()
  }, [ensureColor, notify, refreshProfiles])

  const openConnectModal = useCallback((defaults?: Partial<ConnectionInput> | null) => {
    setModalDefaults(defaults ?? null)
    setConnectionModal(true)
    setSwitcherOpen(false)
  }, [])

  const openProfile = useCallback((profile: ConnectionProfile) => {
    openConnectModal(profileDefaults(profile))
  }, [openConnectModal])

  const handleConnected = useCallback((connection: ConnectionSummary) => {
    ensureColor(connection)
    setConnections((current) => {
      const without = current.filter((item) => item.id !== connection.id)
      return [...without, connection]
    })
    setActiveConnectionId(connection.id)
    setConnectionModal(false)
    notify(`Connected to ${connection.database}`, 'success')
    if (connection.persistenceWarning) notify(connection.persistenceWarning, 'error')
    void refreshProfiles()
  }, [ensureColor, notify, refreshProfiles])

  const switchConnection = useCallback((connectionId: string) => {
    setActiveConnectionId(connectionId)
    setSwitcherOpen(false)
  }, [])

  const upsertConnection = useCallback((connection: ConnectionSummary) => {
    ensureColor(connection)
    setConnections((current) => {
      if (current.some((item) => item.id === connection.id)) {
        return current.map((item) => item.id === connection.id ? connection : item)
      }
      return [...current, connection]
    })
  }, [ensureColor])

  const disconnect = useCallback(async (connectionId: string) => {
    setSwitcherOpen(false)
    try {
      await api.disconnect(connectionId)
      const remaining = await refreshConnections()
      if (remaining.length === 0) {
        setConnectionModal(true)
        setModalDefaults(null)
      }
      notify('Disconnected', 'info')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [notify, refreshConnections])

  return {
    connections,
    profiles,
    activeConnection,
    activeConnectionId,
    booting,
    connectionModal,
    modalDefaults,
    switcherOpen,
    setSwitcherOpen,
    setConnectionModal,
    openConnectModal,
    openProfile,
    handleConnected,
    switchConnection,
    upsertConnection,
    disconnect,
    connectionColor,
    refreshConnections,
    refreshProfiles,
  }
}

function profileDefaults(profile: ConnectionProfile): Partial<ConnectionInput> {
  return {
    profileId: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    database: profile.database,
    username: profile.username,
    password: '',
    sslMode: profile.sslMode,
    connectTimeoutMs: profile.connectTimeoutMs,
    color: profile.color,
    rememberPassword: profile.credentialStatus === 'available',
    privateMode: profile.privateMode,
    autoConnect: profile.autoConnect,
  }
}
