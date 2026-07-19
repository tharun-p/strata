import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { clearLegacyQueryTabs, loadLegacyQueryTabs } from '../lib/connectionMeta'
import { applyTextChanges } from '../editor/statementLexer'
import type {
  ConnectionSummary,
  ExplainResult,
  PersistedEditorState,
  QueryResult,
  QueryTabState,
  ResultView,
  SQLDocumentChange,
  Workbook,
} from '../types'

function deriveTitle(sql: string, fallback: string) {
  const sample = sql.slice(0, 4096)
  const compact = sample.replace(/\s+/g, ' ').trim()
  if (!compact) return fallback
  const match = compact.match(/\bfrom\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/i)
  if (match) return match[1]
  return compact.slice(0, 28) + (compact.length > 28 || sql.length > sample.length ? '…' : '')
}

function nextDocumentID() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `document_${crypto.randomUUID()}`
  return `document_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function createTab(
  id: string,
  connectionId: string | null,
  profileId: string | null,
  sql: string,
  title?: string,
  question = '',
  editorState: PersistedEditorState = { selection: [{ anchor: 0, head: 0 }], scrollTop: 0, scrollLeft: 0, folds: [] },
): QueryTabState {
  return {
    id,
    title: title ?? deriveTitle(sql, 'Untitled query'),
    sql,
    revision: 0,
    editorState,
    question,
    connectionId,
    profileId,
    result: null,
    explain: null,
    resultView: 'data',
    error: null,
    resultRevision: null,
    resultSQLHash: null,
    explainRevision: null,
  }
}

function profileForConnection(connections: ConnectionSummary[], connectionId: string | null) {
  return connections.find((connection) => connection.id === connectionId)?.profileId ?? null
}

function tabsForWorkbook(
  loaded: Workbook,
  connections: ConnectionSummary[],
  fallbackConnectionId: string | null,
) {
  if (loaded.documents.length === 0) {
    return [createTab(
      nextDocumentID(),
      fallbackConnectionId,
      profileForConnection(connections, fallbackConnectionId),
      '',
      'Untitled query',
    )]
  }
  return loaded.documents.map((document) => {
    const connection = connections.find((item) => item.profileId === document.profileId) ?? null
    return createTab(
      document.id,
      connection?.id ?? null,
      document.profileId ?? null,
      document.content.sql,
      document.title,
      document.content.question,
      document.content.editorState,
    )
  })
}

function sortWorkbooks(workbooks: Workbook[]) {
  return [...workbooks].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    const leftCreatedAt = Date.parse(left.createdAt || left.updatedAt)
    const rightCreatedAt = Date.parse(right.createdAt || right.updatedAt)
    if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt
    return left.id.localeCompare(right.id)
  })
}

type SaveOptions = {
  checkpoint?: boolean
  title?: string
  state?: Workbook['state']
}

export function useQueryTabs(activeConnectionId: string | null, connections: ConnectionSummary[]) {
  const initialID = useRef(nextDocumentID()).current
  const [queryTabs, setQueryTabs] = useState<QueryTabState[]>(() => [
    createTab(initialID, activeConnectionId, profileForConnection(connections, activeConnectionId), '', 'Untitled query'),
  ])
  const [activeQueryId, setActiveQueryId] = useState(initialID)
  const [workbook, setWorkbook] = useState<Workbook | null>(null)
  const [workbooks, setWorkbooks] = useState<Workbook[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openingWorkbookId, setOpeningWorkbookId] = useState<string | null>(null)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const workbookRef = useRef<Workbook | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const legacyTabsPendingRef = useRef(false)
  const tabsRef = useRef(queryTabs)
  const activeQueryIDRef = useRef(activeQueryId)
  const dirtyDocumentsRef = useRef(new Set<string>())
  const deletedDocumentsRef = useRef(new Set<string>())
  const metadataDirtyRef = useRef(false)
  const orderingDirtyRef = useRef(false)
  const editorPublishTimerRef = useRef(0)
  const directAutosaveTimerRef = useRef(0)
  workbookRef.current = workbook
  tabsRef.current = queryTabs
  activeQueryIDRef.current = activeQueryId

  useEffect(() => () => {
    window.clearTimeout(editorPublishTimerRef.current)
    window.clearTimeout(directAutosaveTimerRef.current)
  }, [])

  const applyWorkbook = useCallback((loaded: Workbook, preferredTabs?: QueryTabState[], preferredActiveID?: string) => {
    const tabs = preferredTabs ?? tabsForWorkbook(loaded, connections, activeConnectionId)
    const nextActiveID = preferredActiveID ?? loaded.activeDocumentId
    workbookRef.current = loaded
    tabsRef.current = tabs
    activeQueryIDRef.current = tabs.some((tab) => tab.id === nextActiveID) ? nextActiveID! : tabs[0].id
    dirtyDocumentsRef.current.clear()
    deletedDocumentsRef.current.clear()
    metadataDirtyRef.current = false
    orderingDirtyRef.current = false
    setWorkbook(loaded)
    setQueryTabs(tabs)
    setActiveQueryId(activeQueryIDRef.current)
    setSavedAt(loaded.updatedAt)
    setPersistenceError(null)
  }, [activeConnectionId, connections])

  const updateWorkbookList = useCallback((saved: Workbook) => {
    setWorkbooks((current) => sortWorkbooks([saved, ...current.filter((item) => item.id !== saved.id)]))
  }, [])

  const refreshWorkbooks = useCallback(async () => {
    try {
      const loaded = await api.listWorkbooks()
      setWorkbooks(sortWorkbooks(loaded))
      setPersistenceError(null)
      return loaded
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : String(error))
      return []
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void api.loadDefaultWorkbook().then(async (loaded) => {
      if (cancelled) return
      const defaultIsBlank = loaded.documents.length === 1
        && loaded.documents[0].content.sql.trim() === ''
        && loaded.documents[0].content.question.trim() === ''
      const legacy = defaultIsBlank ? loadLegacyQueryTabs() : null
      const legacyTabs = legacy?.tabs.filter((tab) => typeof tab.sql === 'string' || typeof tab.question === 'string') ?? []
      const tabs = legacyTabs.length > 0
        ? legacyTabs.map((tab) => createTab(
          tab.id || nextDocumentID(),
          null,
          null,
          tab.sql ?? '',
          tab.title,
          tab.question ?? '',
        ))
        : tabsForWorkbook(loaded, connections, activeConnectionId)
      applyWorkbook(loaded, tabs, legacy?.activeId ?? loaded.activeDocumentId)
      legacyTabsPendingRef.current = legacyTabs.length > 0
      if (legacyTabs.length > 0) {
        tabs.forEach((tab) => dirtyDocumentsRef.current.add(tab.id))
        loaded.documents.forEach((document) => {
          if (!tabs.some((tab) => tab.id === document.id)) deletedDocumentsRef.current.add(document.id)
        })
        metadataDirtyRef.current = true
        orderingDirtyRef.current = true
      }
      const allWorkbooks = await api.listWorkbooks()
      if (!cancelled) setWorkbooks(sortWorkbooks(allWorkbooks))
    }).catch((error) => {
      if (!cancelled) setPersistenceError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (!cancelled) setHydrated(true)
    })
    return () => { cancelled = true }
    // The initial connection bindings are resolved again by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const nextTabs = tabsRef.current.map((tab) => {
      if (tab.connectionId && connections.some((item) => item.id === tab.connectionId)) return tab
      if (!tab.profileId) return tab.connectionId ? { ...tab, connectionId: null } : tab
      const connection = connections.find((item) => item.profileId === tab.profileId)
      const connectionId = connection?.id ?? null
      return connectionId !== tab.connectionId ? { ...tab, connectionId } : tab
    })
    tabsRef.current = nextTabs
    setQueryTabs(nextTabs)
  }, [connections, hydrated])

  const enqueueSave = useCallback((options: SaveOptions = {}) => {
    let resolveSaved: (value: Workbook | null) => void = () => undefined
    const result = new Promise<Workbook | null>((resolve) => { resolveSaved = resolve })
    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(async () => {
      const current = workbookRef.current
      if (!current) {
        resolveSaved(null)
        return
      }
      const dirtyIDs = new Set(dirtyDocumentsRef.current)
      const deletedIDs = new Set(deletedDocumentsRef.current)
      const metadataDirty = metadataDirtyRef.current || Boolean(options.title || options.state || options.checkpoint)
      const orderingDirty = orderingDirtyRef.current
      if (dirtyIDs.size === 0 && deletedIDs.size === 0 && !metadataDirty && !orderingDirty) {
        resolveSaved(current)
        return
      }
      dirtyIDs.forEach((id) => dirtyDocumentsRef.current.delete(id))
      deletedIDs.forEach((id) => deletedDocumentsRef.current.delete(id))
      metadataDirtyRef.current = false
      orderingDirtyRef.current = false
      setSaving(true)
      const liveTabs = tabsRef.current
      const upsertDocuments = liveTabs
        .map((tab, position) => ({ tab, position }))
        .filter(({ tab }) => dirtyIDs.has(tab.id))
        .map(({ tab, position }) => {
          const liveProfileID = profileForConnection(connections, tab.connectionId)
          const connection = connections.find((item) => item.id === tab.connectionId)
          return {
            id: tab.id,
            kind: 'sql' as const,
            title: tab.title,
            position,
            profileId: liveProfileID ?? tab.profileId ?? undefined,
            database: connection?.database,
            contentVersion: 2,
            content: { sql: tab.sql, question: tab.question, editorState: tab.editorState },
          }
        })
      try {
        const saved = await api.applyWorkbookPatch({
          id: current.id,
          expectedRevision: current.revision,
          title: options.title?.trim() || undefined,
          state: options.state,
          activeDocumentId: activeQueryIDRef.current,
          upsertDocuments,
          deleteDocumentIds: [...deletedIDs],
          documentOrder: orderingDirty ? liveTabs.map((tab) => tab.id) : undefined,
          checkpoint: options.checkpoint ?? false,
        })
        workbookRef.current = saved
        setWorkbook(saved)
        updateWorkbookList(saved)
        setSavedAt(saved.updatedAt)
        setPersistenceError(null)
        if (legacyTabsPendingRef.current) {
          clearLegacyQueryTabs()
          legacyTabsPendingRef.current = false
        }
        resolveSaved(saved)
      } catch (error) {
        dirtyIDs.forEach((id) => dirtyDocumentsRef.current.add(id))
        deletedIDs.forEach((id) => deletedDocumentsRef.current.add(id))
        if (metadataDirty) metadataDirtyRef.current = true
        if (orderingDirty) orderingDirtyRef.current = true
        setPersistenceError(error instanceof Error ? error.message : String(error))
        resolveSaved(null)
      } finally {
        setSaving(false)
      }
    })
    return result
  }, [connections, updateWorkbookList])

  const workbookID = workbook?.id

  useEffect(() => {
    if (!hydrated || !workbookID) return
    const timer = window.setTimeout(() => {
      void enqueueSave()
    }, 650)
    return () => window.clearTimeout(timer)
  }, [activeQueryId, enqueueSave, hydrated, queryTabs, workbookID])

  const saveCurrentWorkbook = useCallback(async (options: SaveOptions = {}) => {
    return enqueueSave(options)
  }, [enqueueSave])

  const openWorkbook = useCallback(async (id: string) => {
    if (!id || id === workbookRef.current?.id || openingWorkbookId) return
    setOpeningWorkbookId(id)
    try {
      const flushed = await saveCurrentWorkbook()
      if (workbookRef.current && !flushed) return
      const loaded = await api.getWorkbook(id)
      applyWorkbook(loaded)
      updateWorkbookList(loaded)
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : String(error))
    } finally {
      setOpeningWorkbookId(null)
    }
  }, [applyWorkbook, openingWorkbookId, saveCurrentWorkbook, updateWorkbookList])

  const createWorkbook = useCallback(async () => {
    if (openingWorkbookId) return null
    setOpeningWorkbookId('new')
    try {
      const flushed = await saveCurrentWorkbook()
      if (workbookRef.current && !flushed) return null
      const usedTitles = new Set(workbooks.map((item) => item.title.toLocaleLowerCase()))
      let title = 'Untitled worksheet'
      let suffix = 2
      while (usedTitles.has(title.toLocaleLowerCase())) {
        title = `Untitled worksheet ${suffix}`
        suffix += 1
      }
      const documentID = nextDocumentID()
      const connection = connections.find((item) => item.id === activeConnectionId)
      const created = await api.saveWorkbook({
        id: '',
        title,
        state: 'draft',
        pinned: false,
        revision: 0,
        activeDocumentId: documentID,
        createdAt: '',
        updatedAt: '',
        documents: [{
          id: documentID,
          kind: 'sql',
          title: 'Untitled query',
          position: 0,
          profileId: connection?.profileId,
          database: connection?.database,
          contentVersion: 2,
          content: { sql: '', question: '', editorState: { selection: [{ anchor: 0, head: 0 }], scrollTop: 0, scrollLeft: 0, folds: [] } },
        }],
      }, 0, true)
      applyWorkbook(created)
      updateWorkbookList(created)
      return created
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setOpeningWorkbookId(null)
    }
  }, [activeConnectionId, applyWorkbook, connections, openingWorkbookId, saveCurrentWorkbook, updateWorkbookList, workbooks])

  const saveWorkbook = useCallback((title: string) => saveCurrentWorkbook({
    checkpoint: true,
    title,
    state: 'saved',
  }), [saveCurrentWorkbook])

  const activeQuery = useMemo(
    () => queryTabs.find((tab) => tab.id === activeQueryId) ?? queryTabs[0],
    [activeQueryId, queryTabs],
  )

  const updateQueryTab = useCallback((id: string, patch: Partial<Omit<QueryTabState, 'id'>>) => {
    if (patch.sql !== undefined || patch.question !== undefined || patch.title !== undefined
      || patch.profileId !== undefined || patch.connectionId !== undefined || patch.editorState !== undefined) {
      dirtyDocumentsRef.current.add(id)
    }
    const nextTabs = tabsRef.current.map((tab) => {
      if (tab.id !== id) return tab
      const next = { ...tab, ...patch }
      if (patch.sql !== undefined && !patch.title) {
        next.title = deriveTitle(patch.sql, tab.title.startsWith('Untitled') ? tab.title : deriveTitle(patch.sql, 'Untitled query'))
      }
      return next
    })
    tabsRef.current = nextTabs
    setQueryTabs(nextTabs)
  }, [])

  const updateActiveQuery = useCallback((patch: Partial<Omit<QueryTabState, 'id'>>) => {
    updateQueryTab(activeQueryId, patch)
  }, [activeQueryId, updateQueryTab])

  const newQuery = useCallback((sql: string, connectionId: string | null, title?: string) => {
    const id = nextDocumentID()
    const number = queryTabs.length + 1
    const tab = createTab(id, connectionId, profileForConnection(connections, connectionId), sql, title ?? `Untitled query ${number}`)
    dirtyDocumentsRef.current.add(id)
    metadataDirtyRef.current = true
    orderingDirtyRef.current = true
    tabsRef.current = [...tabsRef.current, tab]
    setQueryTabs(tabsRef.current)
    activeQueryIDRef.current = id
    setActiveQueryId(id)
    return id
  }, [connections, queryTabs.length])

  const selectQuery = useCallback((id: string) => {
    if (id === activeQueryIDRef.current) return
    void enqueueSave()
    window.clearTimeout(editorPublishTimerRef.current)
    setQueryTabs(tabsRef.current)
    activeQueryIDRef.current = id
    metadataDirtyRef.current = true
    setActiveQueryId(id)
  }, [enqueueSave])

  const closeQuery = useCallback((id: string, fallbackSql: string, fallbackConnectionId: string | null) => {
    const current = tabsRef.current
    const closingIndex = current.findIndex((tab) => tab.id === id)
    if (closingIndex < 0) return
    if (current.length === 1) {
      const replacementID = nextDocumentID()
      deletedDocumentsRef.current.add(id)
      dirtyDocumentsRef.current.delete(id)
      dirtyDocumentsRef.current.add(replacementID)
      metadataDirtyRef.current = true
      orderingDirtyRef.current = true
      tabsRef.current = [createTab(replacementID, fallbackConnectionId, profileForConnection(connections, fallbackConnectionId), fallbackSql, 'Untitled query')]
      activeQueryIDRef.current = replacementID
      setQueryTabs(tabsRef.current)
      setActiveQueryId(replacementID)
      void enqueueSave()
      return
    }
    deletedDocumentsRef.current.add(id)
    dirtyDocumentsRef.current.delete(id)
    metadataDirtyRef.current = true
    orderingDirtyRef.current = true
    const remaining = current.filter((tab) => tab.id !== id)
    if (activeQueryIDRef.current === id) {
      const nextID = remaining[Math.min(closingIndex, remaining.length - 1)].id
      activeQueryIDRef.current = nextID
      setActiveQueryId(nextID)
    }
    tabsRef.current = remaining
    setQueryTabs(remaining)
    void enqueueSave()
  }, [connections, enqueueSave])

  const applyEditorChange = useCallback((change: SQLDocumentChange) => {
    dirtyDocumentsRef.current.add(change.documentId)
    tabsRef.current = tabsRef.current.map((tab) => {
      if (tab.id !== change.documentId) return tab
      const sql = applyTextChanges(tab.sql, change.changes)
      return {
        ...tab,
        sql,
        revision: change.revision,
        editorState: change.editorState,
        error: null,
        title: deriveTitle(sql, tab.title.startsWith('Untitled') ? tab.title : deriveTitle(sql, 'Untitled query')),
      }
    })
    window.clearTimeout(editorPublishTimerRef.current)
    editorPublishTimerRef.current = window.setTimeout(() => setQueryTabs(tabsRef.current), 220)
    window.clearTimeout(directAutosaveTimerRef.current)
    directAutosaveTimerRef.current = window.setTimeout(() => { void enqueueSave() }, 650)
  }, [enqueueSave])
  const setEditorState = useCallback((documentId: string, editorState: PersistedEditorState) => {
    dirtyDocumentsRef.current.add(documentId)
    tabsRef.current = tabsRef.current.map((tab) => tab.id === documentId ? { ...tab, editorState } : tab)
    window.clearTimeout(directAutosaveTimerRef.current)
    directAutosaveTimerRef.current = window.setTimeout(() => { void enqueueSave() }, 650)
  }, [enqueueSave])
  const setQuestion = useCallback((question: string) => updateActiveQuery({ question }), [updateActiveQuery])
  const setDocumentResult = useCallback((documentId: string, result: QueryResult | null, revision: number | null, sqlHash: string | null) => {
    updateQueryTab(documentId, { result, resultRevision: revision, resultSQLHash: sqlHash, error: null })
  }, [updateQueryTab])
  const setDocumentExplain = useCallback((documentId: string, explain: ExplainResult | null, revision: number | null) => {
    updateQueryTab(documentId, { explain, explainRevision: revision })
  }, [updateQueryTab])
  const setResultView = useCallback((resultView: ResultView) => updateActiveQuery({ resultView }), [updateActiveQuery])
  const setError = useCallback((error: string | null) => updateActiveQuery({ error }), [updateActiveQuery])

  const rebindActiveConnection = useCallback((connectionId: string | null) => {
    updateActiveQuery({ connectionId, profileId: profileForConnection(connections, connectionId) })
  }, [connections, updateActiveQuery])

  return {
    queryTabs,
    activeQueryId,
    activeQuery,
    workbook,
    workbooks,
    hydrated,
    saving,
    openingWorkbookId,
    savedAt,
    persistenceError,
    refreshWorkbooks,
    openWorkbook,
    createWorkbook,
    saveWorkbook,
    flushPendingSaves: saveCurrentWorkbook,
    updateQueryTab,
    updateActiveQuery,
    newQuery,
    selectQuery,
    closeQuery,
    applyEditorChange,
    setEditorState,
    setQuestion,
    setDocumentResult,
    setDocumentExplain,
    setResultView,
    setError,
    rebindActiveConnection,
  }
}
