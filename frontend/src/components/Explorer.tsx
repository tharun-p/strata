import {
  Braces,
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  Eye,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  PanelLeftClose,
  Play,
  Plus,
  RefreshCw,
  Search,
  Table2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ConnectionCatalog, ServerGroup } from '../hooks/useCatalog'
import type { ConnectionSummary, DatabaseSummary, RelationDetail, RelationSummary, SchemaSummary } from '../types'
import { formatCount } from '../lib/format'

type Props = {
  servers: ServerGroup[]
  activeConnectionId: string | null
  selectedConnectionId: string | null
  colorFor: (connection: ConnectionSummary) => string
  catalogFor: (connectionId: string) => ConnectionCatalog
  connectionForDatabase: (root: ConnectionSummary, databaseName: string) => ConnectionSummary | null
  selectedRelation: string
  activeSchema: string
  detail: RelationDetail | null
  detailLoading: boolean
  search: string
  onSearch: (value: string) => void
  onCollapse: () => void
  onActivateConnection: (connectionId: string) => void
  onEnsureDatabase: (root: ConnectionSummary, databaseName: string, activate?: boolean) => void
  onEnsureSchema: (connectionId: string, schema: string) => void
  onRelation: (connectionId: string, relation: RelationSummary) => void
  onAddConnection: () => void
  onRefreshServer: (root: ConnectionSummary) => void
  onOpenData: (connectionId: string, relation: RelationSummary) => void
  onInsertColumn: (columnName: string) => void
}

function schemaKey(connectionId: string, schema: string) {
  return `${connectionId}::${schema}`
}

function databaseKey(serverKey: string, databaseName: string) {
  return `${serverKey}::${databaseName}`
}

function sortSchemas(schemas: SchemaSummary[]) {
  return [...schemas].sort((a, b) => {
    if (a.name === 'public') return -1
    if (b.name === 'public') return 1
    return a.name.localeCompare(b.name)
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function Explorer({
  servers,
  activeConnectionId,
  selectedConnectionId,
  colorFor,
  catalogFor,
  connectionForDatabase,
  selectedRelation,
  activeSchema,
  detail,
  detailLoading,
  search,
  onSearch,
  onCollapse,
  onActivateConnection,
  onEnsureDatabase,
  onEnsureSchema,
  onRelation,
  onAddConnection,
  onRefreshServer,
  onOpenData,
  onInsertColumn,
}: Props) {
  const [showAllColumns, setShowAllColumns] = useState(false)
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(() => new Set())
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(() => new Set())
  const [expandedGroups, setExpandedGroups] = useState<Record<string, Set<string>>>({})
  const [expandedRelation, setExpandedRelation] = useState<string | null>(null)
  const initialExpandDoneRef = useRef(false)
  const normalizedSearch = search.trim().toLowerCase()
  const searching = normalizedSearch.length > 0
  const showServerHeaders = servers.length > 1

  const totalDatabases = servers.reduce((sum, server) => sum + server.databases.length, 0)

  // Open the originally connected database once when the list first arrives.
  // Do not re-run when the active connection changes — that re-opened DB #1.
  useEffect(() => {
    if (initialExpandDoneRef.current) return
    const server = servers.find((item) => item.databases.length > 0)
    if (!server) return
    const initial = server.databases.find((database) => database.isCurrent) ?? server.databases[0]
    if (!initial) return
    const key = databaseKey(server.key, initial.name)
    initialExpandDoneRef.current = true
    setExpandedDatabases((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })
    onEnsureDatabase(server.root, initial.name, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.map((item) => `${item.key}:${item.databases.length}`).join('|')])

  useEffect(() => {
    if (!selectedConnectionId || !activeSchema) return
    const key = schemaKey(selectedConnectionId, activeSchema)
    setExpandedSchemas((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })
  }, [activeSchema, selectedConnectionId])

  useEffect(() => {
    if (!selectedConnectionId || !activeSchema || !selectedRelation) return
    setExpandedRelation(`${selectedConnectionId}::${activeSchema}.${selectedRelation}`)
  }, [activeSchema, selectedConnectionId, selectedRelation])

  useEffect(() => setShowAllColumns(false), [selectedRelation, selectedConnectionId])

  const groupsFor = (key: string) => expandedGroups[key] ?? new Set(['tables'])

  const toggleGroup = (key: string, group: string) => {
    setExpandedGroups((current) => {
      const existing = current[key] ?? new Set(['tables'])
      const next = new Set(existing)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return { ...current, [key]: next }
    })
  }

  // Each database expands independently. Opening B preserves A and all of its
  // expanded schemas/groups; only clicking the same database collapses it.
  const toggleDatabase = (server: ServerGroup, database: DatabaseSummary) => {
    const key = databaseKey(server.key, database.name)
    setExpandedDatabases((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        onEnsureDatabase(server.root, database.name, true)
      }
      return next
    })
  }

  const toggleSchema = (connectionId: string, schema: string) => {
    const key = schemaKey(connectionId, schema)
    setExpandedSchemas((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else {
        next.add(key)
        onEnsureSchema(connectionId, schema)
      }
      return next
    })
    onActivateConnection(connectionId)
  }

  const matchesRelation = (relation: RelationSummary) => {
    if (!searching) return true
    if (relation.name.toLowerCase().includes(normalizedSearch)) return true
    if (relation.schema.toLowerCase().includes(normalizedSearch)) return true
    return selectedRelation === relation.name
      && selectedConnectionId !== null
      && detail?.columns.some((column) => column.name.toLowerCase().includes(normalizedSearch))
  }

  const schemaVisible = (schema: SchemaSummary, catalog: ConnectionCatalog) => {
    if (!searching) return true
    if (schema.name.toLowerCase().includes(normalizedSearch)) return true
    return (catalog.relationsBySchema[schema.name] ?? []).some(matchesRelation)
  }

  const databaseVisible = (database: DatabaseSummary, catalog: ConnectionCatalog | null) => {
    if (!searching) return true
    if (database.name.toLowerCase().includes(normalizedSearch)) return true
    if (!catalog) return false
    return catalog.schemas.some((schema) => schemaVisible(schema, catalog))
  }

  const anyMatch = !searching || servers.some((server) => server.databases.some((database) => {
      const conn = connectionForDatabase(server.root, database.name)
      const catalog = conn ? catalogFor(conn.id) : null
      return databaseVisible(database, catalog)
    }))

  const relationRow = (connectionId: string, relation: RelationSummary) => {
    const selected = connectionId === selectedConnectionId
      && relation.schema === (detail?.relation.schema ?? activeSchema)
      && relation.name === selectedRelation
    const relationKey = `${connectionId}::${relation.schema}.${relation.name}`
    const expanded = selected && expandedRelation === relationKey
    return (
      <div className="catalog-relation" key={relationKey}>
        <div className={`relation-row ${selected ? 'selected' : ''}`}>
          <button
            className="relation-row-main"
            aria-expanded={expanded}
            onClick={() => {
              if (expanded) {
                setExpandedRelation(null)
                return
              }
              setExpandedRelation(relationKey)
              onActivateConnection(connectionId)
              onRelation(connectionId, relation)
            }}
            title={relation.description}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {relation.kind.includes('view') ? <Eye size={13} /> : <Table2 size={13} />}
            <span>{relation.name}</span>
            {relation.estimatedRows > 0 && <small>{formatCount(relation.estimatedRows)}</small>}
          </button>
          <button
            className="relation-open"
            aria-label={`Open data for ${relation.name}`}
            title="Open data"
            onClick={() => {
              onActivateConnection(connectionId)
              onOpenData(connectionId, relation)
            }}
          >
            <Play size={11} />
          </button>
        </div>
        {expanded && detailLoading && <div className="catalog-columns skeleton"><i /><i /><i /></div>}
        {expanded && !detailLoading && detail?.relation.schema === relation.schema && detail.relation.name === relation.name && (
          <div className="catalog-columns">
            {(searching
              ? detail.columns.filter((column) => column.name.toLowerCase().includes(normalizedSearch))
              : showAllColumns ? detail.columns : detail.columns.slice(0, 6)
            ).map((column) => (
              <button className="catalog-column" key={column.name} title={column.description || column.dataType} onClick={() => onInsertColumn(column.name)}>
                <span>{column.isPrimaryKey ? <KeyRound size={11} /> : <Circle size={7} />}</span>
                <strong>{column.name}</strong>
                <small>{column.dataType}</small>
              </button>
            ))}
            {!searching && detail.columns.length > 6 && (
              <button className="catalog-more" onClick={() => setShowAllColumns((value) => !value)}>
                {showAllColumns ? 'Show fewer fields' : `Show ${detail.columns.length - 6} more fields`}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside id="database-explorer" className="explorer-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <strong>Databases</strong>
        </div>
        <button className="icon-button" onClick={onAddConnection} aria-label="Add server connection"><Plus size={15} /></button>
        <button className="icon-button panel-collapse" onClick={onCollapse} aria-controls="database-explorer" aria-expanded="true" aria-label="Collapse database explorer" title="Collapse database explorer">
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div className="explorer-search">
        <Search size={14} />
        <input
          aria-label="Search databases, schemas, and tables"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Filter databases, schemas, tables…"
        />
        <kbd>/</kbd>
      </div>

      <div className="object-toolbar">
        <span>{totalDatabases || '—'} database{totalDatabases === 1 ? '' : 's'}</span>
        {servers[0] && (
          <button
            onClick={() => onRefreshServer(servers[0].root)}
            aria-label="Refresh databases"
            disabled={servers.some((item) => item.databasesLoading)}
          >
            {servers.some((item) => item.databasesLoading) ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
          </button>
        )}
      </div>

      <div className="schema-tree database-tree">
        {servers.length === 0 && <span className="tree-empty">No server connected</span>}

        {servers.map((server) => {
          const color = colorFor(server.root)
          const visibleDatabases = server.databases.filter((database) => {
            const conn = connectionForDatabase(server.root, database.name)
            return databaseVisible(database, conn ? catalogFor(conn.id) : null)
          })

          return (
            <div className="server-group" key={server.key}>
              {showServerHeaders && (
                <div className="server-row">
                  <span className="database-mark" style={{ color, background: `${color}18` }}><Database size={13} /></span>
                  <span className="database-copy">
                    <strong>{server.root.host}:{server.root.port}</strong>
                    <small>{server.root.username}</small>
                  </span>
                </div>
              )}

              {server.databasesLoading && server.databases.length === 0 && (
                <div className="tree-skeleton compact"><i /><i /><i /></div>
              )}

              {!server.databasesLoading && server.databases.length === 0 && (
                <span className="tree-empty">No databases visible for this role</span>
              )}

              {visibleDatabases.map((database) => {
                const dbKey = databaseKey(server.key, database.name)
                const isExpanded = searching
                  ? database.name.toLowerCase().includes(normalizedSearch) || expandedDatabases.has(dbKey)
                  : expandedDatabases.has(dbKey)
                const dbConnection = connectionForDatabase(server.root, database.name)
                const catalog = dbConnection ? catalogFor(dbConnection.id) : null
                const isActive = dbConnection?.id === activeConnectionId || (!dbConnection && database.isCurrent && server.root.id === activeConnectionId)
                const schemas = catalog ? sortSchemas(catalog.schemas).filter((schema) => schemaVisible(schema, catalog)) : []

                return (
                  <div className={`database-group ${isExpanded ? 'expanded' : ''} ${isActive ? 'active' : ''}`} key={dbKey}>
                    <button
                      className={`database-row-main flat ${isActive ? 'active' : ''}`}
                      aria-expanded={isExpanded}
                      onClick={() => toggleDatabase(server, database)}
                      title={`${database.name} · ${database.owner}`}
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span className="database-mark" style={{ color, background: `${color}18` }}>
                        <Database size={14} />
                      </span>
                      <span className="database-copy">
                        <strong>{database.name}</strong>
                        <small>{formatBytes(database.sizeBytes)} · {database.owner}</small>
                      </span>
                      {isActive && <i className="live-dot" style={{ background: color }} />}
                    </button>

                    {isExpanded && (
                      <div className="database-contents">
                        {catalog?.loading && schemas.length === 0 && (
                          <div className="tree-skeleton compact"><i /><i /></div>
                        )}
                        {!catalog?.loading && catalog && catalog.schemas.length === 0 && (
                          <span className="catalog-group-empty">No non-system schemas</span>
                        )}
                        {!catalog && (
                          <div className="tree-skeleton compact"><i /><i /></div>
                        )}
                        {schemas.map((schema) => {
                          if (!dbConnection) return null
                          const key = schemaKey(dbConnection.id, schema.name)
                          const schemaExpanded = searching || expandedSchemas.has(key)
                          const items = (catalog?.relationsBySchema[schema.name] ?? []).filter(matchesRelation)
                          const tables = items.filter((relation) => !relation.kind.includes('view'))
                          const views = items.filter((relation) => relation.kind.includes('view'))
                          const groups = groupsFor(key)
                          const busy = Boolean(catalog?.schemaLoading[schema.name])
                          const schemaActive = dbConnection.id === selectedConnectionId && schema.name === activeSchema

                          return (
                            <div className={`schema-group ${schemaExpanded ? 'expanded' : ''}`} key={key}>
                              <button
                                className={`schema-row ${schemaActive ? 'active' : ''}`}
                                aria-expanded={schemaExpanded}
                                onClick={() => toggleSchema(dbConnection.id, schema.name)}
                              >
                                {schemaExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                <Braces size={13} />
                                <span>{schema.name}</span>
                                <small>{schema.relationCount}</small>
                              </button>
                              {schemaExpanded && (
                                <div className="schema-contents">
                                  {busy && !catalog?.relationsBySchema[schema.name] && (
                                    <div className="tree-skeleton compact"><i /><i /></div>
                                  )}
                                  {(!busy || catalog?.relationsBySchema[schema.name]) && (
                                    <>
                                      <button className="catalog-group-row" aria-expanded={groups.has('tables')} onClick={() => toggleGroup(key, 'tables')}>
                                        {groups.has('tables') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        <Table2 size={13} />
                                        <strong>Tables</strong>
                                        <small>{tables.length}</small>
                                      </button>
                                      {groups.has('tables') && (
                                        <div className="relations-list">
                                          {tables.length ? tables.map((relation) => relationRow(dbConnection.id, relation)) : <span className="catalog-group-empty">No tables</span>}
                                        </div>
                                      )}
                                      <button className="catalog-group-row" aria-expanded={groups.has('views')} onClick={() => toggleGroup(key, 'views')}>
                                        {groups.has('views') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        <LayoutGrid size={13} />
                                        <strong>Views</strong>
                                        <small>{views.length}</small>
                                      </button>
                                      {groups.has('views') && (
                                        <div className="relations-list views-list">
                                          {views.length ? views.map((relation) => relationRow(dbConnection.id, relation)) : <span className="catalog-group-empty">No views</span>}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        {searching && !anyMatch && <span className="tree-empty">No matching databases or objects</span>}

        <button className="explorer-add-database" onClick={onAddConnection}>
          <Plus size={14} />
          Add server
        </button>
      </div>
    </aside>
  )
}
