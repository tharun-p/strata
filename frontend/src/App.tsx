import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AlertCircle, Braces, Check, Copy, Database, Download, Files, Filter, GitBranch,
  GripHorizontal, HelpCircle, Layers3, LoaderCircle, LockKeyhole, MoreHorizontal,
  PanelLeftClose, Play, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Table2,
  X,
} from 'lucide-react'
import { format as formatSqlDialect } from 'sql-formatter'
import { api } from './lib/api'
import { catalogLabel } from './lib/completionCatalog'
import { clearLegacyWorkspaceSettings, loadLegacyWorkspaceSettings, PANEL_WIDTH_LIMITS } from './lib/connectionMeta'
import { downloadText, resultToCsv, resultToJson } from './lib/export'
import { formatCell } from './lib/format'
import type { ContextMode, ConnectionSummary, LeftPanelMode, RelationSummary, SQLExecutionRequest } from './types'
import { Explorer } from './components/Explorer'
import { DataGrid } from './components/DataGrid'
import { ConnectionModal } from './components/ConnectionModal'
import { ConnectionSwitcher } from './components/ConnectionSwitcher'
import { CommandPalette } from './components/CommandPalette'
import { PlanView } from './components/PlanView'
import { ContextPanel } from './components/ContextPanel'
import { WorkspaceShell } from './components/WorkspaceShell'
import { WorksheetExplorer } from './components/WorksheetExplorer'
import { useToast } from './hooks/useToast'
import { useConnections } from './hooks/useConnections'
import { useCatalog } from './hooks/useCatalog'
import { useDismissableLayer } from './hooks/useDismissableLayer'
import { useQueryTabs } from './hooks/useQueryTabs'
import { useQueryScheduler } from './hooks/useQueryScheduler'
import { QueryCancelledError } from './lib/queryScheduler'
import { hashSQL, isSQLResultFresh } from './lib/sqlHash'
import type { SQLEditorHandle } from './components/SQLEditor'
import { EventsOn, Quit, WindowMinimise } from '../wailsjs/runtime/runtime'

const SQLEditor = lazy(() => import('./components/SQLEditor').then((module) => ({ default: module.SQLEditor })))

function App() {
  const { toast, notify } = useToast()
  const connections = useConnections(notify)
  const registerOpenedConnection = useCallback((connection: ConnectionSummary) => {
    connections.upsertConnection(connection)
  }, [connections])
  const catalog = useCatalog(connections.connections, connections.activeConnection, notify, registerOpenedConnection)
  const tabs = useQueryTabs(connections.activeConnectionId, connections.connections)
  const [readOnly, setReadOnly] = useState(true)
  const [writeConfirmation, setWriteConfirmation] = useState(false)
  const [maxRows, setMaxRows] = useState(1000)
  const [editorPreferences, setEditorPreferences] = useState({ undoDepth: 200, inactiveCacheMB: 512 })
  const [filter, setFilter] = useState('')
  const [objectSearch, setObjectSearch] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [queryPanePercent, setQueryPanePercent] = useState(48)
  const [panelWidths, setPanelWidths] = useState<{ explorer: number; context: number }>({
    explorer: PANEL_WIDTH_LIMITS.explorer.default,
    context: PANEL_WIDTH_LIMITS.context.default,
  })
  const [panelVisibility, setPanelVisibility] = useState({
    explorerCollapsed: false,
    contextCollapsed: false,
  })
  const [contextMode, setContextMode] = useState<ContextMode>('object')
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>('database')
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [editorFocusToken, setEditorFocusToken] = useState(0)
  const [maximised, setMaximised] = useState(false)
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const lastPersistenceErrorRef = useRef<string | null>(null)
  const safetyLayerRef = useDismissableLayer<HTMLDivElement>(writeConfirmation, () => setWriteConfirmation(false))
  const resultMenusRef = useDismissableLayer<HTMLDivElement>(columnsOpen || exportOpen, () => {
    setColumnsOpen(false)
    setExportOpen(false)
  })
  const workbenchRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef<HTMLElement>(null)
  const editorRef = useRef<SQLEditorHandle>(null)
  const cursorLabelRef = useRef<HTMLSpanElement>(null)
  const executionLabelRef = useRef<HTMLSpanElement>(null)
  const scheduler = useQueryScheduler()
  const latestRequestRef = useRef(new Map<string, string>())
  const closingRef = useRef(false)

  const activeQuery = tabs.activeQuery
  const activeActivity = scheduler.activities.find((activity) => activity.documentId === activeQuery.id)
  const running = activeActivity?.kind === 'query'
  const explaining = activeActivity?.kind === 'explain'
  const activeDocumentBusy = Boolean(activeActivity)
  const tabConnection = useMemo(
    () => connections.connections.find((item) => item.id === activeQuery.connectionId) ?? connections.activeConnection,
    [activeQuery.connectionId, connections.activeConnection, connections.connections],
  )
  const tabCompletion = catalog.completionFor(tabConnection?.id ?? null)
  const contextCollapsed = panelVisibility.contextCollapsed
  const explorerCollapsed = panelVisibility.explorerCollapsed
  const resultFresh = Boolean(
    activeQuery.result
    && isSQLResultFresh(activeQuery.revision, activeQuery.sql, activeQuery.resultRevision, activeQuery.resultSQLHash),
  )

  useEffect(() => {
    setColumnsOpen(false)
    setExportOpen(false)
  }, [activeQuery.id, activeQuery.resultView])

  useEffect(() => {
    let cancelled = false
    void api.loadWorkspaceSettings().then(async (storedSettings) => {
      if (cancelled) return
      const legacy = loadLegacyWorkspaceSettings()
      const settings = legacy ? { ...storedSettings, ...legacy } : storedSettings
      if (legacy) {
        await api.saveWorkspaceSettings(settings)
        clearLegacyWorkspaceSettings()
      }
      setPanelWidths({ explorer: settings.explorerWidth, context: settings.contextWidth })
      setPanelVisibility({ explorerCollapsed: settings.explorerCollapsed, contextCollapsed: settings.contextCollapsed })
      setQueryPanePercent(settings.queryPanePercent)
      setMaxRows(settings.maxRows)
      setContextMode(settings.contextMode)
      setLeftPanelMode(settings.leftPanelMode ?? 'database')
      setEditorPreferences({
        undoDepth: settings.editorUndoDepth ?? 200,
        inactiveCacheMB: settings.inactiveEditorCacheMB ?? 512,
      })
    }).catch((error) => {
      if (!cancelled) notify(error instanceof Error ? error.message : String(error), 'error')
    }).finally(() => {
      if (!cancelled) setSettingsHydrated(true)
    })
    return () => { cancelled = true }
  }, [notify])

  useEffect(() => {
    if (!settingsHydrated) return
    const timer = window.setTimeout(() => {
      void api.saveWorkspaceSettings({
        explorerWidth: panelWidths.explorer,
        contextWidth: panelWidths.context,
        explorerCollapsed: panelVisibility.explorerCollapsed,
        contextCollapsed: panelVisibility.contextCollapsed,
        queryPanePercent,
        maxRows,
        contextMode,
        leftPanelMode,
        editorUndoDepth: editorPreferences.undoDepth,
        inactiveEditorCacheMB: editorPreferences.inactiveCacheMB,
      }).catch((error) => notify(error instanceof Error ? error.message : String(error), 'error'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [contextMode, editorPreferences, leftPanelMode, maxRows, notify, panelVisibility, panelWidths, queryPanePercent, settingsHydrated])

  useEffect(() => {
    if (!tabs.persistenceError || tabs.persistenceError === lastPersistenceErrorRef.current) return
    lastPersistenceErrorRef.current = tabs.persistenceError
    notify(`Worksheet persistence failed: ${tabs.persistenceError}`, 'error')
  }, [notify, tabs.persistenceError])

  const syncMaximised = useCallback(() => {
    void api.windowIsZoomed().then((value) => {
      setMaximised(value)
      document.body.classList.toggle('is-maximised', value)
    }).catch(() => {
      /* runtime may be unavailable in browser preview */
    })
  }, [])

  useEffect(() => {
    // Corner radius is applied natively on DomReady; avoid re-applying from JS.
    syncMaximised()
    let resizeTimer = 0
    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(syncMaximised, 280)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
    }
  }, [syncMaximised])

  const requestQuit = useCallback(async () => {
    if (closingRef.current) return
    closingRef.current = true
    try {
      editorRef.current?.flushState()
      const saved = await tabs.flushPendingSaves()
      if (tabs.workbook && !saved) {
        closingRef.current = false
        notify('Strata stayed open because the latest worksheet changes could not be saved.', 'error')
        return
      }
      await scheduler.cancelDocuments(tabs.queryTabs.map((tab) => tab.id))
      await api.allowWindowClose()
      Quit()
    } catch (error) {
      closingRef.current = false
      notify(`Strata stayed open: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [notify, scheduler, tabs])

  useEffect(() => {
    const runtimeAvailable = Boolean((window as Window & { runtime?: { EventsOnMultiple?: unknown } }).runtime?.EventsOnMultiple)
    if (!runtimeAvailable) return
    return EventsOn('strata:close-requested', () => { void requestQuit() })
  }, [requestQuit])

  const toggleMaximise = useCallback(() => {
    void api.toggleWindowZoom()
    window.setTimeout(syncMaximised, 320)
  }, [syncMaximised])

  useEffect(() => {
    if (!activeQuery.connectionId && connections.activeConnectionId) {
      tabs.updateActiveQuery({ connectionId: connections.activeConnectionId })
    }
  }, [activeQuery.connectionId, connections.activeConnectionId, tabs])

  useEffect(() => {
    setHiddenColumns(new Set())
    setFilter('')
  }, [activeQuery.id, activeQuery.result?.queryId])

  const runQuery = useCallback(async (request: SQLExecutionRequest) => {
    const requestedTab = tabs.queryTabs.find((tab) => tab.id === request.documentId) ?? activeQuery
    const connectionId = requestedTab.connectionId ?? connections.activeConnectionId
    if (!connectionId) {
      connections.openConnectModal()
      return
    }
    const sql = request.sql.trim()
    if (!sql || scheduler.activities.some((activity) => activity.documentId === requestedTab.id)) return
    const tabId = requestedTab.id
    const queryId = `query_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const revision = request.revision
    latestRequestRef.current.set(tabId, queryId)
    tabs.updateQueryTab(tabId, { resultView: 'data', error: null })
    const scheduled = scheduler.submit({
      requestId: queryId,
      documentId: tabId,
      connectionId,
      kind: 'query',
      run: () => api.executeQuery({
        connectionId,
        documentId: tabId,
        queryId,
        sql,
        maxRows,
        timeoutMs: 30_000,
        readOnly,
      }),
      cancel: () => api.cancelQuery(queryId),
    })
    try {
      const nextResult = await scheduled.promise
      if (latestRequestRef.current.get(tabId) !== queryId) return
      tabs.setDocumentResult(tabId, nextResult, revision, hashSQL(sql))
      notify(`Query complete · ${nextResult.rowCount.toLocaleString()} rows in ${nextResult.durationMs.toFixed(1)} ms`, 'success')
    } catch (error) {
      if (error instanceof QueryCancelledError || latestRequestRef.current.get(tabId) !== queryId) return
      const message = error instanceof Error ? error.message : String(error)
      tabs.updateQueryTab(tabId, { error: message, result: null })
      notify(message, 'error')
    } finally {
      if (latestRequestRef.current.get(tabId) === queryId) latestRequestRef.current.delete(tabId)
    }
  }, [activeQuery, connections, maxRows, notify, readOnly, scheduler, tabs])

  const explainQuery = useCallback(async (request: SQLExecutionRequest) => {
    const requestedTab = tabs.queryTabs.find((tab) => tab.id === request.documentId) ?? activeQuery
    const connectionId = requestedTab.connectionId ?? connections.activeConnectionId
    if (!connectionId) {
      connections.openConnectModal()
      return
    }
    const sql = request.sql.trim()
    if (!sql || scheduler.activities.some((activity) => activity.documentId === requestedTab.id)) return
    const tabId = requestedTab.id
    const queryId = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const revision = request.revision
    latestRequestRef.current.set(tabId, queryId)
    tabs.updateQueryTab(tabId, { resultView: 'plan', error: null })
    const scheduled = scheduler.submit({
      requestId: queryId,
      documentId: tabId,
      connectionId,
      kind: 'explain',
      run: () => api.explainQuery({
        connectionId,
        documentId: tabId,
        queryId,
        sql,
        maxRows,
        timeoutMs: 30_000,
        readOnly: true,
      }),
      cancel: () => api.cancelQuery(queryId),
    })
    try {
      const explain = await scheduled.promise
      if (latestRequestRef.current.get(tabId) !== queryId) return
      tabs.setDocumentExplain(tabId, explain, revision)
    } catch (error) {
      if (error instanceof QueryCancelledError || latestRequestRef.current.get(tabId) !== queryId) return
      const message = error instanceof Error ? error.message : String(error)
      tabs.updateQueryTab(tabId, { error: message })
      notify(message, 'error')
    } finally {
      if (latestRequestRef.current.get(tabId) === queryId) latestRequestRef.current.delete(tabId)
    }
  }, [activeQuery, connections, maxRows, notify, scheduler, tabs])

  const cancelActive = useCallback(async () => {
    if (!activeActivity) return
    const cancelled = await scheduler.cancel(activeActivity.requestId)
    notify(cancelled ? 'Query cancellation requested' : 'No running query to cancel', cancelled ? 'info' : 'error')
  }, [activeActivity, notify, scheduler])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const command = event.metaKey || event.ctrlKey
      const target = event.target as HTMLElement | null
      const editingOutsideSQL = Boolean(
        target
        && !target.closest('.cm-editor')
        && (target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement
          || target instanceof HTMLSelectElement
          || target.isContentEditable),
      )
      const modalOpen = connections.connectionModal || paletteOpen || settingsOpen

      if (command && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (connections.connectionModal) return
        setWriteConfirmation(false)
        setColumnsOpen(false)
        setExportOpen(false)
        setSettingsOpen(false)
        connections.setSwitcherOpen(false)
        setPaletteOpen((value) => !value)
        return
      }
      if (command && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        if (modalOpen || writeConfirmation) return
        if (explorerCollapsed) {
          setPanelVisibility((current) => ({ ...current, explorerCollapsed: false }))
        }
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>('#database-explorer .explorer-search input')?.focus()
        })
        return
      }
      if (command && event.key === 'Enter') {
        event.preventDefault()
        if (modalOpen || writeConfirmation || editingOutsideSQL) return
        editorRef.current?.requestExecution('query')
        return
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false)
        setWriteConfirmation(false)
        setColumnsOpen(false)
        setExportOpen(false)
        connections.setSwitcherOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [connections, explorerCollapsed, paletteOpen, runQuery, settingsOpen, writeConfirmation])

  const resizeWorkbench = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = workbenchRef.current?.getBoundingClientRect()
    if (!bounds) return
    event.preventDefault()
    const update = (pointer: PointerEvent) => {
      const next = ((pointer.clientY - bounds.top) / bounds.height) * 100
      setQueryPanePercent(Math.min(68, Math.max(30, next)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', stop)
  }, [])

  const setExplorerWidth = (width: number) => {
    const next = {
      ...panelWidths,
      explorer: Math.min(PANEL_WIDTH_LIMITS.explorer.max, Math.max(PANEL_WIDTH_LIMITS.explorer.min, width)),
    }
    setPanelWidths(next)
  }

  const setContextWidth = (width: number) => {
    const next = {
      ...panelWidths,
      context: Math.min(PANEL_WIDTH_LIMITS.context.max, Math.max(PANEL_WIDTH_LIMITS.context.min, width)),
    }
    setPanelWidths(next)
  }

  const openRelationData = (connectionId: string, relation: RelationSummary) => {
    connections.switchConnection(connectionId)
    const sql = `SELECT *\nFROM ${relation.schema}.${relation.name}\nLIMIT 100;`
    tabs.newQuery(sql, connectionId, `${relation.schema}.${relation.name}`)
    setEditorFocusToken((value) => value + 1)
  }

  const insertColumn = (columnName: string) => {
    const sql = editorRef.current?.getContent() ?? activeQuery.sql
    const needsSpace = sql.length > 0 && !/\s$/.test(sql)
    editorRef.current?.insertText(`${needsSpace ? ' ' : ''}${columnName}`)
    setEditorFocusToken((value) => value + 1)
  }

  const newQuery = () => {
    tabs.newQuery('', connections.activeConnectionId)
    setEditorFocusToken((value) => value + 1)
  }

  const closeQuery = (id: string) => {
    latestRequestRef.current.delete(id)
    void scheduler.cancelDocument(id)
    tabs.closeQuery(id, '', connections.activeConnectionId)
  }

  const openWorkbook = async (id: string) => {
    await scheduler.cancelDocuments(tabs.queryTabs.map((tab) => tab.id))
    await tabs.openWorkbook(id)
  }

  const createWorkbook = async () => {
    await scheduler.cancelDocuments(tabs.queryTabs.map((tab) => tab.id))
    return tabs.createWorkbook()
  }

  const copySQL = async () => {
    try {
      await navigator.clipboard.writeText(editorRef.current?.getContent() ?? activeQuery.sql)
      notify('SQL copied to clipboard', 'success')
    } catch {
      notify('Clipboard access is unavailable', 'error')
    }
  }

  const formatSQL = () => {
    const currentSQL = editorRef.current?.getContent() ?? activeQuery.sql
    try {
      editorRef.current?.replaceContent(formatSqlDialect(currentSQL, { language: 'postgresql' }))
      notify('SQL formatted', 'success')
    } catch {
      editorRef.current?.replaceContent(currentSQL.split('\n').map((line) => line.trimEnd()).join('\n').trim())
      notify('SQL whitespace normalized', 'info')
    }
  }

  const visibleCount = useMemo(() => {
    if (!activeQuery.result) return 0
    if (!filter.trim()) return activeQuery.result.rowCount
    const needle = filter.trim().toLowerCase()
    return activeQuery.result.rows.filter((row) => row.some((value) => formatCell(value).toLowerCase().includes(needle))).length
  }, [activeQuery.result, filter])

  const handleSourceClick = (source: string) => {
    const connectionId = connections.activeConnectionId
    if (!connectionId) return
    const [schema, name] = source.includes('.') ? source.split('.') : [catalog.activeSchema, source]
    const relation = catalog.relations.find((item) => item.schema === schema && item.name === name)
      ?? catalog.relations.find((item) => item.name === name)
    if (relation) {
      void catalog.selectRelation(connectionId, relation)
      setContextMode('object')
    }
  }

  const exportResult = (kind: 'csv' | 'json') => {
    if (!activeQuery.result) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    if (kind === 'csv') {
      downloadText(`strata-result-${stamp}.csv`, resultToCsv(activeQuery.result.columns, activeQuery.result.rows), 'text/csv')
    } else {
      downloadText(`strata-result-${stamp}.json`, resultToJson(activeQuery.result.columns, activeQuery.result.rows), 'application/json')
    }
    setExportOpen(false)
    notify(`Exported ${kind.toUpperCase()}`, 'success')
  }

  useEffect(() => {
    if (editorFocusToken === 0) return
    editorRef.current?.focus()
  }, [editorFocusToken])

  // Frameless windows need a custom title-bar drag. Wails' data-wails-drag on the
  // whole bar starts dragging on the first click of a double-click (tiny move),
  // which fights native zoom. Threshold-drag keeps zoom native and drag usable.
  const onTopbarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('[data-wails-no-drag]')) return
    if (event.detail > 1) return

    const startX = event.screenX
    const startY = event.screenY
    let started = false

    const onMove = (moveEvent: MouseEvent) => {
      if (started) return
      if (Math.abs(moveEvent.screenX - startX) < 6 && Math.abs(moveEvent.screenY - startY) < 6) return
      started = true
      cleanup()
      const invoke = (window as Window & { WailsInvoke?: (msg: string) => void }).WailsInvoke
      invoke?.('drag')
    }

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', cleanup)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', cleanup)
  }, [])

  return (
    <div className={`strata-app ${maximised ? 'is-maximised' : ''}`}>
      <header
        className="strata-topbar"
        onMouseDown={onTopbarMouseDown}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('[data-wails-no-drag]')) return
          event.preventDefault()
          toggleMaximise()
        }}
      >
        <div className="window-controls" data-wails-no-drag aria-label="Window controls">
          <button className="window-close" onClick={() => void requestQuit()} aria-label="Close Strata" />
          <button className="window-minimise" onClick={WindowMinimise} aria-label="Minimise Strata" />
          <button className="window-maximise" onClick={toggleMaximise} aria-label="Zoom window" />
        </div>
        <div className="strata-brand"><span><Layers3 size={17} /></span><strong>Strata</strong></div>
        <div className="topbar-divider" />
        <div data-wails-no-drag>
          <ConnectionSwitcher
            open={connections.switcherOpen}
            connections={connections.connections}
            profiles={connections.profiles}
            activeId={connections.activeConnectionId}
            colorFor={connections.connectionColor}
            onToggle={() => connections.setSwitcherOpen((value) => !value)}
            onSwitch={(connectionId) => {
              connections.switchConnection(connectionId)
              tabs.rebindActiveConnection(connectionId)
            }}
            onAdd={() => connections.openConnectModal(connections.connections.length ? {} : null)}
            onDisconnect={(id) => void connections.disconnect(id)}
            onConnectProfile={connections.openProfile}
            onClose={() => connections.setSwitcherOpen(false)}
          />
        </div>
        <button className="global-command" onClick={() => setPaletteOpen(true)} data-wails-no-drag><Search size={15} /><span>Search or run a command</span><kbd>⌘ K</kbd></button>
        <div className="topbar-spacer" />
        <span className="sync-state">
          <i className={connections.activeConnection ? 'online' : ''} style={connections.activeConnection ? { background: connections.connectionColor(connections.activeConnection) } : undefined} />
          {connections.activeConnection
            ? `Connected · ${connections.activeConnection.latencyMs} ms`
            : connections.booting ? 'Connecting' : 'Offline'}
        </span>
        <div ref={safetyLayerRef} className="header-safety-wrap" data-wails-no-drag>
          <button
            className={`header-safety ${readOnly ? 'safe' : 'writes'}`}
            onClick={() => readOnly ? setWriteConfirmation((value) => !value) : setReadOnly(true)}
            aria-expanded={readOnly ? writeConfirmation : undefined}
            aria-controls={writeConfirmation ? 'write-confirmation' : undefined}
            aria-haspopup={readOnly ? 'dialog' : undefined}
          >
            {readOnly ? <ShieldCheck size={14} /> : <LockKeyhole size={14} />}
            {readOnly ? 'Read-only' : 'Writes on'}
          </button>
          {writeConfirmation && (
            <div id="write-confirmation" className="write-popover" role="dialog" aria-label="Enable database writes">
              <strong>Enable writes for this session?</strong>
              <p>Queries will be allowed to modify the connected database.</p>
              <div>
                <button onClick={() => setWriteConfirmation(false)}>Cancel</button>
                <button className="danger" onClick={() => { setReadOnly(false); setWriteConfirmation(false); notify('Writes enabled for this session', 'info') }}>Enable writes</button>
              </div>
            </div>
          )}
        </div>
      </header>

      <WorkspaceShell
        explorerWidth={panelWidths.explorer}
        contextWidth={panelWidths.context}
        explorerCollapsed={explorerCollapsed}
        contextCollapsed={contextCollapsed}
        explorerLabel={leftPanelMode === 'worksheets' ? 'Worksheets' : 'Databases'}
        explorerControls={leftPanelMode === 'worksheets' ? 'worksheet-explorer' : 'database-explorer'}
        onResizeExplorer={setExplorerWidth}
        onResizeContext={setContextWidth}
        onExpandExplorer={() => setPanelVisibility((current) => ({ ...current, explorerCollapsed: false }))}
        onExpandContext={() => setPanelVisibility((current) => ({ ...current, contextCollapsed: false }))}
        rail={(
          <nav className="activity-rail" aria-label="Workspace tools">
            <div className="rail-group">
              <button
                className={leftPanelMode === 'database' ? 'active' : ''}
                aria-label={explorerCollapsed ? 'Show data explorer' : 'Focus data explorer'}
                title={explorerCollapsed ? 'Show data explorer' : 'Data explorer'}
                onClick={() => {
                  setLeftPanelMode('database')
                  setPanelVisibility((current) => ({ ...current, explorerCollapsed: false }))
                  window.setTimeout(() => document.querySelector<HTMLInputElement>('.explorer-search input')?.focus(), 0)
                }}
              >
                <Database size={17} />
              </button>
              <button
                className={leftPanelMode === 'worksheets' ? 'active' : ''}
                aria-label={explorerCollapsed ? 'Show worksheets' : 'Show all worksheets'}
                title="Worksheets"
                onClick={() => {
                  setLeftPanelMode('worksheets')
                  setPanelVisibility((current) => ({ ...current, explorerCollapsed: false }))
                }}
              ><Files size={17} /></button>
              <button aria-label="Explain current query" onClick={() => editorRef.current?.requestExecution('explain')}><GitBranch size={17} /></button>
              {activeDocumentBusy && (
                <button className="cancel-rail" aria-label="Cancel running query" onClick={() => void cancelActive()}><Square size={14} /></button>
              )}
              <button aria-label="Command palette" onClick={() => setPaletteOpen(true)}><Search size={17} /></button>
            </div>
            <div className="rail-group">
              <button aria-label="Help" onClick={() => notify('Keyboard: ⌘K commands · ⌘P / objects · ⌘Enter run', 'info')}><HelpCircle size={17} /></button>
              <button aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>
            </div>
          </nav>
        )}
        explorer={leftPanelMode === 'worksheets' ? (
          <WorksheetExplorer
            workbooks={tabs.workbooks}
            activeWorkbook={tabs.workbook}
            saving={tabs.saving}
            openingWorkbookId={tabs.openingWorkbookId}
            savedAt={tabs.savedAt}
            onOpen={openWorkbook}
            onCreate={async () => {
              const created = await createWorkbook()
              if (created) notify('New worksheet created', 'success')
              return created
            }}
            onSave={async (title) => {
              const saved = await tabs.saveWorkbook(title)
              if (saved) notify(`Saved “${saved.title}”`, 'success')
              return saved
            }}
            onRefresh={tabs.refreshWorkbooks}
            onCollapse={() => setPanelVisibility((current) => ({ ...current, explorerCollapsed: true }))}
          />
        ) : connections.connections.length > 0 ? (
          <Explorer
            servers={catalog.servers}
            activeConnectionId={connections.activeConnectionId}
            selectedConnectionId={catalog.selectedConnectionId}
            colorFor={connections.connectionColor}
            catalogFor={catalog.catalogFor}
            connectionForDatabase={catalog.connectionForDatabase}
            selectedRelation={catalog.selectedRelation}
            activeSchema={catalog.activeSchema}
            detail={catalog.detail}
            detailLoading={catalog.detailLoading}
            search={objectSearch}
            onSearch={setObjectSearch}
            onCollapse={() => setPanelVisibility((current) => ({ ...current, explorerCollapsed: true }))}
            onActivateConnection={connections.switchConnection}
            onEnsureDatabase={(root, databaseName, activate = true) => {
              void catalog.ensureDatabase(root, databaseName).then((opened) => {
                if (opened && activate) connections.switchConnection(opened.id)
              })
            }}
            onEnsureSchema={(connectionId, schema) => void catalog.ensureSchema(connectionId, schema)}
            onRelation={(connectionId, relation) => {
              connections.switchConnection(connectionId)
              void catalog.selectRelation(connectionId, relation)
              setContextMode('object')
            }}
            onAddConnection={() => connections.openConnectModal(connections.connections.length ? {} : null)}
            onRefreshServer={(root) => void catalog.loadDatabases(root, true)}
            onOpenData={openRelationData}
            onInsertColumn={insertColumn}
          />
        ) : (
          <aside id="database-explorer" className="explorer-panel disconnected">
            <button
              className="icon-button panel-collapse disconnected-collapse"
              onClick={() => setPanelVisibility((current) => ({ ...current, explorerCollapsed: true }))}
              aria-controls="database-explorer"
              aria-expanded="true"
              aria-label="Collapse database explorer"
              title="Collapse database explorer"
            >
              <PanelLeftClose size={15} />
            </button>
            <div><Database size={22} /><strong>No databases connected</strong><button onClick={() => connections.openConnectModal()}>Connect database</button></div>
          </aside>
        )}
        workspace={(
          <main className="query-workspace">
            <div className="query-tabs" role="tablist" aria-label="Open queries">
              <div className="query-tabs-scroll">
                {tabs.queryTabs.map((tab) => {
                  const active = tab.id === tabs.activeQueryId
                  const bound = connections.connections.find((item) => item.id === tab.connectionId)
                  const color = bound ? connections.connectionColor(bound) : undefined
                  return (
                    <div
                      className={`query-tab ${active ? 'active' : ''} ${tab.result ? 'has-result' : ''} ${tab.error ? 'has-error' : ''}`}
                      key={tab.id}
                      role="tab"
                      tabIndex={active ? 0 : -1}
                      aria-selected={active}
                      style={color ? { ['--tab-accent' as string]: color } : undefined}
                      onClick={() => tabs.selectQuery(tab.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') tabs.selectQuery(tab.id) }}
                    >
                      <span className="tab-accent" />
                      <span className="tab-title">{tab.title}</span>
                      {tab.result && !tab.error && <i className="fresh" title="Has result" />}
                      {tab.error && <i className="error-dot" title="Query failed" />}
                      <button className="tab-close" onClick={(event) => { event.stopPropagation(); closeQuery(tab.id) }} aria-label={`Close ${tab.title}`}><X size={12} /></button>
                    </div>
                  )
                })}
              </div>
              <div className="query-tabs-actions">
                <button className="new-query" onClick={newQuery} aria-label="New query" title="New query"><Plus size={15} /></button>
                <button className="query-menu" aria-label="Query menu" onClick={() => setPaletteOpen(true)}><MoreHorizontal size={16} /></button>
              </div>
            </div>

            <div className="nl-query-bar">
              <span><Sparkles size={17} /></span>
              <input
                value={activeQuery.question}
                onChange={(event) => tabs.setQuestion(event.target.value)}
                aria-label="Describe the query to generate"
                placeholder="Ask Strata in plain English once a provider is configured…"
              />
              <em><Database size={13} />{catalog.activeSchema || 'schema'}</em>
              <button disabled title="Natural-language SQL needs a configured provider">
                <Sparkles size={14} />Provider not configured
              </button>
            </div>

            <div ref={workbenchRef} className="query-workbench" style={{ gridTemplateRows: `${queryPanePercent}fr 6px ${100 - queryPanePercent}fr` }}>
              <section ref={queryRef} className={`editor-pane ${running || explaining ? 'active' : ''}`}>
                <div className="editor-progress" />
                <div className="editor-toolbar">
                  <div className="dialect-control"><kbd>SQL</kbd><span>PostgreSQL</span></div>
                  {tabConnection && (
                    <button className="tab-connection" onClick={() => connections.setSwitcherOpen((value) => !value)} title="Query tab connection">
                      <i className="connection-chip" style={{ background: connections.connectionColor(tabConnection) }} />
                      {tabConnection.name || tabConnection.database}
                    </button>
                  )}
                  <label className="row-limit">Limit <select value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))}><option value={100}>100</option><option value={1000}>1,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option></select></label>
                  <div className="editor-actions">
                    <button onClick={() => void copySQL()}><Copy size={14} />Copy</button>
                    <button onClick={formatSQL}><Braces size={14} />Format</button>
                    <button onClick={() => editorRef.current?.requestExecution('explain')} disabled={!tabConnection || activeDocumentBusy}>{explaining ? <LoaderCircle className="spin" size={14} /> : <GitBranch size={14} />}Explain</button>
                    {(running || explaining) ? (
                      <button className="cancel-query" onClick={() => void cancelActive()}><Square size={13} />Cancel</button>
                    ) : (
                      <button className="run-query" onClick={() => editorRef.current?.requestExecution('query')} disabled={!tabConnection || activeDocumentBusy}>{running ? <LoaderCircle className="spin" size={14} /> : <Play size={13} fill="currentColor" />}<span ref={executionLabelRef}>Run</span><kbd>⌘ ↵</kbd></button>
                    )}
                  </div>
                </div>
                <Suspense fallback={<div className="editor-loading"><LoaderCircle className="spin" size={15} />Loading PostgreSQL editor…</div>}>
                  <SQLEditor
                    ref={editorRef}
                    documentId={activeQuery.id}
                    initialContent={activeQuery.sql}
                    initialRevision={activeQuery.revision}
                    persistedState={activeQuery.editorState}
                    openDocumentIds={tabs.queryTabs.map((tab) => tab.id)}
                    undoDepth={editorPreferences.undoDepth}
                    inactiveCacheMB={editorPreferences.inactiveCacheMB}
                    onChange={tabs.applyEditorChange}
                    onPersistedStateChange={tabs.setEditorState}
                    catalog={tabCompletion.catalog}
                    catalogLoading={tabCompletion.loading}
                    runDisabled={!tabConnection || activeDocumentBusy}
                    onRun={(request) => { void (request.kind === 'explain' ? explainQuery(request) : runQuery(request)) }}
                    onCursorChange={(id, line, column) => {
                      if (id === activeQuery.id && cursorLabelRef.current) cursorLabelRef.current.textContent = `Ln ${line}, Col ${column}`
                    }}
                    onExecutionTargetChange={(target) => {
                      if (!executionLabelRef.current) return
                      executionLabelRef.current.textContent = target?.kind === 'selection'
                        ? 'Run selection'
                        : target?.kind === 'statement' && target.statementCount > 1
                          ? `Run Query ${target.statementIndex + 1}`
                          : 'Run'
                    }}
                  />
                </Suspense>
                <footer className="editor-status">
                  <span>{catalogLabel(tabCompletion.catalog, tabCompletion.loading)}</span>
                  <span ref={cursorLabelRef}>Ln 1, Col 1</span>
                  <span>UTF-8</span>
                  <span className="status-spacer" />
                  <span>{tabs.saving ? 'Saving…' : tabs.persistenceError ? 'Local save unavailable' : tabs.savedAt ? 'Autosaved locally' : 'Preparing workspace…'}</span>
                </footer>
              </section>

              <div
                className="query-resizer"
                role="separator"
                aria-label="Resize query and results"
                aria-orientation="horizontal"
                tabIndex={0}
                aria-valuemin={30}
                aria-valuemax={68}
                aria-valuenow={Math.round(queryPanePercent)}
                onPointerDown={resizeWorkbench}
                onDoubleClick={() => setQueryPanePercent(48)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp') setQueryPanePercent((value) => Math.max(30, value - 4))
                  if (event.key === 'ArrowDown') setQueryPanePercent((value) => Math.min(68, value + 4))
                }}
              >
                <GripHorizontal size={14} />
              </div>

              <section className="results-pane">
                <div className="results-toolbar">
                  <div className="result-tabs" role="tablist" aria-label="Query output">
                    <button role="tab" aria-selected={activeQuery.resultView === 'data'} className={activeQuery.resultView === 'data' ? 'active' : ''} onClick={() => tabs.setResultView('data')}><Table2 size={14} />Data {activeQuery.result && <em>{activeQuery.result.rowCount}</em>}</button>
                    <button role="tab" aria-selected={activeQuery.resultView === 'plan'} className={activeQuery.resultView === 'plan' ? 'active' : ''} onClick={() => tabs.setResultView('plan')}><GitBranch size={14} />Query plan</button>
                  </div>
                  <div ref={resultMenusRef} className="result-actions">
                    {activeQuery.resultView === 'data' && (
                      <label>
                        <Search size={14} />
                        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter results" />
                        {filter && <button onClick={() => setFilter('')} aria-label="Clear result filter"><X size={12} /></button>}
                      </label>
                    )}
                    <div className="popover-anchor">
                      <button
                        className="columns-action"
                        onClick={() => {
                          setExportOpen(false)
                          setColumnsOpen((value) => !value)
                        }}
                        disabled={!activeQuery.result}
                        aria-haspopup="dialog"
                        aria-expanded={columnsOpen}
                        aria-controls={columnsOpen ? 'visible-columns-menu' : undefined}
                      ><Filter size={14} />Columns</button>
                      {columnsOpen && activeQuery.result && (
                        <div id="visible-columns-menu" className="columns-popover" role="dialog" aria-label="Visible columns">
                          {activeQuery.result.columns.map((column) => (
                            <label key={column.name}>
                              <input
                                type="checkbox"
                                checked={!hiddenColumns.has(column.name)}
                                onChange={() => setHiddenColumns((current) => {
                                  const next = new Set(current)
                                  if (next.has(column.name)) next.delete(column.name)
                                  else next.add(column.name)
                                  return next
                                })}
                              />
                              {column.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="popover-anchor">
                      <button
                        onClick={() => {
                          setColumnsOpen(false)
                          setExportOpen((value) => !value)
                        }}
                        disabled={!activeQuery.result}
                        aria-label="Export results"
                        aria-haspopup="menu"
                        aria-expanded={exportOpen}
                        aria-controls={exportOpen ? 'export-results-menu' : undefined}
                      ><Download size={14} /></button>
                      {exportOpen && activeQuery.result && (
                        <div id="export-results-menu" className="export-popover" role="menu">
                          <button role="menuitem" onClick={() => exportResult('csv')}>Export CSV</button>
                          <button role="menuitem" onClick={() => exportResult('json')}>Export JSON</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="result-content">
                  {activeQuery.error && activeQuery.resultView === 'data' && (
                    <div className="query-error" role="alert"><AlertCircle size={15} /><span>{activeQuery.error}</span></div>
                  )}
                  {activeQuery.resultView === 'data'
                    ? <DataGrid result={activeQuery.result} filter={filter} loading={running} hiddenColumns={hiddenColumns} />
                    : <PlanView result={activeQuery.explain} loading={explaining} />}
                </div>
                <footer className="result-status">
                  <span><i className={activeQuery.result ? (resultFresh ? 'fresh' : 'stale') : ''} />{activeQuery.result ? (resultFresh ? 'Fresh result' : 'Stale result') : activeQuery.error ? 'Query failed' : 'No result'}</span>
                  <span>
                    {activeQuery.result
                      ? `${visibleCount.toLocaleString()} rows in ${activeQuery.result.durationMs.toFixed(1)} ms${activeQuery.result.truncated ? ' · capped' : ''}`
                      : 'Run the query to inspect data'}
                  </span>
                  <span className="status-spacer" />
                  <span>
                    {activeQuery.result
                      ? filter.trim()
                        ? `Showing ${visibleCount.toLocaleString()} of ${activeQuery.result.rowCount.toLocaleString()} filtered`
                        : `Showing ${activeQuery.result.rowCount.toLocaleString()} rows${activeQuery.result.truncated ? ' (capped)' : ''}`
                      : '—'}
                  </span>
                </footer>
              </section>
            </div>
          </main>
        )}
        context={(
          <ContextPanel
            mode={contextMode}
            onMode={setContextMode}
            onCollapse={() => setPanelVisibility((current) => ({ ...current, contextCollapsed: true }))}
            detail={catalog.detail}
            detailLoading={catalog.detailLoading}
            title={activeQuery.title}
            question={activeQuery.question}
            sql={activeQuery.sql}
            result={activeQuery.result}
            explain={activeQuery.explain}
            onExplain={() => editorRef.current?.requestExecution('explain')}
            onInsertColumn={insertColumn}
            onOpenData={() => {
              if (!catalog.detail) return
              const connectionId = catalog.selectedConnectionId ?? connections.activeConnectionId
              if (!connectionId) return
              openRelationData(connectionId, catalog.detail.relation)
            }}
            onSourceClick={handleSourceClick}
          />
        )}
      />

      <footer className="global-statusbar">
        <span>
          <i className={tabConnection ? 'online' : ''} style={tabConnection ? { background: connections.connectionColor(tabConnection) } : undefined} />
          {tabConnection?.database ?? 'offline'}
        </span>
        <span>{tabConnection ? `${tabConnection.latencyMs} ms` : '—'}</span>
        <span><Database size={12} />{tabConnection ? `PostgreSQL ${tabConnection.serverVersion.match(/\d+(?:\.\d+)?/)?.[0] ?? ''}` : 'Not connected'}</span>
        <span className="status-spacer" />
        <span><ShieldCheck size={12} />{readOnly ? 'Read-only session' : 'Writes enabled'}</span>
        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </footer>

      <ConnectionModal
        open={connections.connectionModal}
        defaults={connections.modalDefaults}
        onClose={() => connections.setConnectionModal(false)}
        onConnected={(connection) => {
          connections.handleConnected(connection)
          void catalog.loadCatalog(connection)
          if (!activeQuery.connectionId) tabs.updateActiveQuery({ connectionId: connection.id })
        }}
      />
      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="editor-settings-title">
            <header className="modal-header">
              <span className="modal-icon"><Settings2 size={16} /></span>
              <div><strong id="editor-settings-title">Editor preferences</strong><span>Performance and worksheet history</span></div>
              <button onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={15} /></button>
            </header>
            <div className="settings-fields">
              <label>
                <span><strong>Undo depth per worksheet</strong><small>Session-only changes retained independently for each open worksheet.</small></span>
                <input
                  type="number"
                  min={20}
                  max={2000}
                  step={20}
                  value={editorPreferences.undoDepth}
                  onChange={(event) => setEditorPreferences((current) => ({ ...current, undoDepth: Math.max(20, Math.min(2000, Number(event.target.value) || 20)) }))}
                />
              </label>
              <label>
                <span><strong>Inactive editor cache</strong><small>Older inactive Undo history is released first; SQL and view state are always preserved.</small></span>
                <select
                  value={editorPreferences.inactiveCacheMB}
                  onChange={(event) => setEditorPreferences((current) => ({ ...current, inactiveCacheMB: Number(event.target.value) }))}
                >
                  {[128, 256, 512, 1024, 2048, 4096].map((size) => <option key={size} value={size}>{size.toLocaleString()} MB</option>)}
                </select>
              </label>
            </div>
            <footer className="modal-actions"><button className="primary" onClick={() => setSettingsOpen(false)}>Done</button></footer>
          </section>
        </div>
      )}
      <CommandPalette
        open={paletteOpen}
        relations={catalog.relations}
        connections={connections.connections}
        activeConnectionId={connections.activeConnectionId}
        onClose={() => setPaletteOpen(false)}
        onConnect={() => connections.openConnectModal(connections.connections.length ? {} : null)}
        onRun={() => editorRef.current?.requestExecution('query')}
        onRelation={(relation) => {
          const connectionId = connections.activeConnectionId
          if (!connectionId) return
          void catalog.selectRelation(connectionId, relation)
          setContextMode('object')
        }}
        onSwitchConnection={(connectionId) => {
          connections.switchConnection(connectionId)
          tabs.rebindActiveConnection(connectionId)
        }}
        onDisconnect={(id) => void connections.disconnect(id)}
      />
      {toast && (
        <div className={`toast strata-toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.tone === 'error' ? <AlertCircle size={14} /> : <Check size={14} />}
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default App
