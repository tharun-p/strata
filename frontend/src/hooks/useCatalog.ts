import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type {
  CompletionCatalog,
  ConnectionSummary,
  DatabaseSummary,
  RelationDetail,
  RelationSummary,
  SchemaSummary,
  ToastTone,
} from '../types'

type Notify = (message: string, tone?: ToastTone) => void

export type ConnectionCatalog = {
  schemas: SchemaSummary[]
  relationsBySchema: Record<string, RelationSummary[]>
  schemaLoading: Record<string, boolean>
  loading: boolean
}

export type ServerGroup = {
  key: string
  root: ConnectionSummary
  databases: DatabaseSummary[]
  databasesLoading: boolean
}

const emptyCatalog = (): ConnectionCatalog => ({
  schemas: [],
  relationsBySchema: {},
  schemaLoading: {},
  loading: false,
})

export function serverKey(connection: Pick<ConnectionSummary, 'host' | 'port' | 'username'>) {
  return `${connection.host}:${connection.port}@${connection.username}`
}

export function useCatalog(
  connections: ConnectionSummary[],
  activeConnection: ConnectionSummary | null,
  notify: Notify,
  onConnectionOpened?: (connection: ConnectionSummary) => void,
) {
  const [byConnection, setByConnection] = useState<Record<string, ConnectionCatalog>>({})
  const [databasesByServer, setDatabasesByServer] = useState<Record<string, DatabaseSummary[]>>({})
  const [databasesLoading, setDatabasesLoading] = useState<Record<string, boolean>>({})
  const [activeSchema, setActiveSchema] = useState('')
  const [selectedRelation, setSelectedRelation] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RelationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [completionCatalogs, setCompletionCatalogs] = useState<Record<string, CompletionCatalog>>({})
  const [completionLoading, setCompletionLoading] = useState<Record<string, boolean>>({})
  const [extraConnections, setExtraConnections] = useState<ConnectionSummary[]>([])
  const byConnectionRef = useRef(byConnection)
  byConnectionRef.current = byConnection
  const connectionsRef = useRef(connections)
  connectionsRef.current = connections
  const extraRef = useRef(extraConnections)
  extraRef.current = extraConnections
  const detailRequestRef = useRef(0)

  const servers = useMemo<ServerGroup[]>(() => {
    const map = new Map<string, ServerGroup>()
    // Stable root: earliest connection on the server (not Go map / refresh order).
    for (const connection of [...connections, ...extraConnections]) {
      const key = serverKey(connection)
      const existing = map.get(key)
      if (!existing) {
        map.set(key, {
          key,
          root: connection,
          databases: databasesByServer[key] ?? [],
          databasesLoading: Boolean(databasesLoading[key]),
        })
        continue
      }
      if (connection.connectedAt < existing.root.connectedAt) {
        existing.root = connection
      }
    }
    return [...map.values()]
  }, [connections, databasesByServer, databasesLoading, extraConnections])

  // Drop extras once the parent connections list includes them.
  useEffect(() => {
    if (extraConnections.length === 0) return
    const live = new Set(connections.map((item) => item.id))
    setExtraConnections((current) => {
      const next = current.filter((item) => !live.has(item.id))
      return next.length === current.length ? current : next
    })
  }, [connections, extraConnections.length])

  const activeCatalog = useMemo(
    () => (activeConnection ? byConnection[activeConnection.id] ?? emptyCatalog() : emptyCatalog()),
    [activeConnection, byConnection],
  )

  const relations = activeCatalog.relationsBySchema[activeSchema] ?? []

  const patchConnection = useCallback((connectionId: string, patch: Partial<ConnectionCatalog> | ((current: ConnectionCatalog) => ConnectionCatalog)) => {
    setByConnection((current) => {
      const previous = current[connectionId] ?? emptyCatalog()
      const next = typeof patch === 'function' ? patch(previous) : { ...previous, ...patch }
      return { ...current, [connectionId]: next }
    })
  }, [])

  const findConnectionForDatabase = useCallback((root: ConnectionSummary, databaseName: string) => {
    const pool = [...connectionsRef.current, ...extraRef.current]
    return pool.find((item) => (
      item.host === root.host
      && item.port === root.port
      && item.username === root.username
      && item.database === databaseName
    )) ?? null
  }, [])

  const loadCompletionCatalog = useCallback(async (connectionId: string, force = false) => {
    if (!force && completionCatalogs[connectionId]) return completionCatalogs[connectionId]
    setCompletionLoading((current) => ({ ...current, [connectionId]: true }))
    try {
      const catalog = await api.getCompletionCatalog(connectionId)
      setCompletionCatalogs((current) => ({ ...current, [connectionId]: catalog }))
      return catalog
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
      return null
    } finally {
      setCompletionLoading((current) => ({ ...current, [connectionId]: false }))
    }
  }, [completionCatalogs, notify])

  const loadRelationsForSchema = useCallback(async (connectionId: string, schema: string, force = false) => {
    const existing = byConnectionRef.current[connectionId]?.relationsBySchema[schema]
    if (!force && existing) return existing
    patchConnection(connectionId, (current) => ({
      ...current,
      schemaLoading: { ...current.schemaLoading, [schema]: true },
    }))
    try {
      const items = await api.listRelations(connectionId, schema)
      patchConnection(connectionId, (current) => ({
        ...current,
        relationsBySchema: { ...current.relationsBySchema, [schema]: items },
        schemaLoading: { ...current.schemaLoading, [schema]: false },
      }))
      return items
    } catch (error) {
      patchConnection(connectionId, (current) => ({
        ...current,
        schemaLoading: { ...current.schemaLoading, [schema]: false },
      }))
      notify(error instanceof Error ? error.message : String(error), 'error')
      return []
    }
  }, [notify, patchConnection])

  const loadSchemas = useCallback(async (connection: ConnectionSummary, preferredSchema?: string) => {
    patchConnection(connection.id, { loading: true })
    try {
      const nextSchemas = await api.listSchemas(connection.id)
      const preferred = preferredSchema
        ?? (selectedConnectionId === connection.id ? activeSchema : '')
        ?? ''
      const resolvedSchema = nextSchemas.some((item) => item.name === preferred)
        ? preferred
        : nextSchemas.find((item) => item.name === 'public')?.name
          ?? nextSchemas[0]?.name
          ?? ''

      patchConnection(connection.id, {
        schemas: nextSchemas,
        relationsBySchema: {},
        schemaLoading: {},
        loading: false,
      })

      if (connection.id === activeConnection?.id || selectedConnectionId === connection.id) {
        setActiveSchema(resolvedSchema)
      }

      if (resolvedSchema) {
        await loadRelationsForSchema(connection.id, resolvedSchema, true)
      }

      void loadCompletionCatalog(connection.id, true)
    } catch (error) {
      patchConnection(connection.id, { loading: false })
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [
    activeConnection?.id,
    activeSchema,
    loadCompletionCatalog,
    loadRelationsForSchema,
    notify,
    patchConnection,
    selectedConnectionId,
  ])

  const loadDatabases = useCallback(async (root: ConnectionSummary, force = false) => {
    const key = serverKey(root)
    if (!force && databasesByServer[key]?.length) return databasesByServer[key]
    setDatabasesLoading((current) => ({ ...current, [key]: true }))
    try {
      const items = await api.listDatabases(root.id)
      setDatabasesByServer((current) => ({ ...current, [key]: items }))
      return items
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
      return []
    } finally {
      setDatabasesLoading((current) => ({ ...current, [key]: false }))
    }
  }, [databasesByServer, notify])

  const ensureDatabase = useCallback(async (root: ConnectionSummary, databaseName: string) => {
    const existing = findConnectionForDatabase(root, databaseName)
    if (existing) {
      const catalog = byConnectionRef.current[existing.id]
      if (!catalog || catalog.schemas.length === 0) {
        await loadSchemas(existing)
      }
      return existing
    }
    try {
      const opened = await api.ensureDatabase(root.id, databaseName)
      setExtraConnections((current) => (
        current.some((item) => item.id === opened.id) ? current : [...current, opened]
      ))
      onConnectionOpened?.(opened)
      await loadSchemas(opened)
      return opened
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
      return null
    }
  }, [findConnectionForDatabase, loadSchemas, notify, onConnectionOpened])

  // Keep database lists for live servers; drop disconnected ones.
  useEffect(() => {
    const liveKeys = new Set(connections.map(serverKey))
    setDatabasesByServer((current) => {
      let changed = false
      const next: Record<string, DatabaseSummary[]> = {}
      for (const [key, value] of Object.entries(current)) {
        if (liveKeys.has(key)) next[key] = value
        else changed = true
      }
      return changed ? next : current
    })

    const liveIds = new Set(connections.map((item) => item.id))
    setByConnection((current) => {
      let changed = false
      const next: Record<string, ConnectionCatalog> = {}
      for (const [id, catalog] of Object.entries(current)) {
        if (liveIds.has(id)) next[id] = catalog
        else changed = true
      }
      return changed ? next : current
    })

    for (const server of [...new Map(connections.map((item) => [serverKey(item), item])).values()]) {
      const key = serverKey(server)
      if (!databasesByServer[key] && !databasesLoading[key]) {
        void loadDatabases(server)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections])

  useEffect(() => {
    if (!activeConnection) {
      detailRequestRef.current++
      setActiveSchema('')
      setSelectedRelation('')
      setSelectedConnectionId(null)
      setDetail(null)
      return
    }
    setSelectedConnectionId((current) => current ?? activeConnection.id)
    const existing = byConnectionRef.current[activeConnection.id]
    if (!existing || existing.schemas.length === 0) {
      void loadSchemas(activeConnection)
    }
    // List databases once per server — do not re-query when switching sibling DBs.
    const key = serverKey(activeConnection)
    if (!databasesByServer[key]?.length && !databasesLoading[key]) {
      void loadDatabases(activeConnection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id])

  const ensureSchema = useCallback(async (connectionId: string, schema: string) => {
    setSelectedConnectionId(connectionId)
    setActiveSchema(schema)
    await loadRelationsForSchema(connectionId, schema)
  }, [loadRelationsForSchema])

  const selectRelation = useCallback(async (connectionId: string, relation: RelationSummary) => {
    const request = ++detailRequestRef.current
    setSelectedConnectionId(connectionId)
    setActiveSchema(relation.schema)
    setSelectedRelation(relation.name)
    setDetail(null)
    setDetailLoading(true)
    try {
      const nextDetail = await api.describeRelation(connectionId, relation.schema, relation.name)
      if (request === detailRequestRef.current) setDetail(nextDetail)
    } catch (error) {
      if (request === detailRequestRef.current) notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      if (request === detailRequestRef.current) setDetailLoading(false)
    }
  }, [notify])

  const selectSchema = useCallback(async (connectionId: string, schema: string) => {
    detailRequestRef.current++
    setSelectedConnectionId(connectionId)
    setActiveSchema(schema)
    setSelectedRelation('')
    setDetail(null)
    setDetailLoading(false)
    const items = await loadRelationsForSchema(connectionId, schema)
    if (items.length > 0) await selectRelation(connectionId, items[0])
    else {
      setSelectedRelation('')
      setDetail(null)
    }
  }, [loadRelationsForSchema, selectRelation])

  const completionFor = useCallback((connectionId: string | null) => {
    if (!connectionId) return { catalog: null as CompletionCatalog | null, loading: false }
    return {
      catalog: completionCatalogs[connectionId] ?? null,
      loading: Boolean(completionLoading[connectionId]),
    }
  }, [completionCatalogs, completionLoading])

  const catalogFor = useCallback((connectionId: string) => {
    return byConnection[connectionId] ?? emptyCatalog()
  }, [byConnection])

  const connectionForDatabase = useCallback((root: ConnectionSummary, databaseName: string) => {
    return findConnectionForDatabase(root, databaseName)
  }, [findConnectionForDatabase])

  return {
    servers,
    byConnection,
    catalogFor,
    connectionForDatabase,
    schemas: activeCatalog.schemas,
    activeSchema,
    relations,
    relationsBySchema: activeCatalog.relationsBySchema,
    schemaLoading: activeCatalog.schemaLoading,
    selectedRelation,
    selectedConnectionId,
    detail,
    catalogLoading: activeCatalog.loading,
    detailLoading,
    loadCatalog: loadSchemas,
    loadDatabases,
    ensureDatabase,
    selectRelation,
    selectSchema,
    ensureSchema,
    loadRelationsForSchema,
    loadCompletionCatalog,
    completionFor,
  }
}
