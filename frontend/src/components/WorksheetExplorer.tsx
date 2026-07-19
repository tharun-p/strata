import { Check, Clock3, FileCode2, LoaderCircle, PanelLeftClose, Plus, RefreshCw, Save, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Workbook } from '../types'

type Props = {
  workbooks: Workbook[]
  activeWorkbook: Workbook | null
  saving: boolean
  openingWorkbookId: string | null
  savedAt: string | null
  onOpen: (id: string) => Promise<void>
  onCreate: () => Promise<Workbook | null>
  onSave: (title: string) => Promise<Workbook | null>
  onRefresh: () => Promise<Workbook[]>
  onCollapse: () => void
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Not saved yet'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 10) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp))
}

export function WorksheetExplorer({
  workbooks,
  activeWorkbook,
  saving,
  openingWorkbookId,
  savedAt,
  onOpen,
  onCreate,
  onSave,
  onRefresh,
  onCollapse,
}: Props) {
  const [search, setSearch] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(activeWorkbook?.title ?? '')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitle(activeWorkbook?.title ?? '')
    setEditingTitle(false)
  }, [activeWorkbook?.id, activeWorkbook?.title])

  useEffect(() => {
    if (!editingTitle) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [editingTitle])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== '/' || target.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      searchInputRef.current?.focus()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  const visibleWorkbooks = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    if (!needle) return workbooks
    return workbooks.filter((item) => item.title.toLocaleLowerCase().includes(needle)
      || item.documents.some((document) => document.title.toLocaleLowerCase().includes(needle)))
  }, [search, workbooks])

  const commitTitle = async () => {
    const nextTitle = title.trim()
    if (!nextTitle) {
      titleInputRef.current?.focus()
      return
    }
    const saved = await onSave(nextTitle)
    if (saved) setEditingTitle(false)
  }

  return (
    <aside id="worksheet-explorer" className="explorer-panel worksheet-panel">
      <div className="panel-heading worksheet-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <strong>Worksheets</strong>
        </div>
        <button
          className="icon-button"
          onClick={() => void onCreate()}
          disabled={openingWorkbookId !== null}
          aria-label="Create worksheet"
          title="New worksheet"
        >
          {openingWorkbookId === 'new' ? <LoaderCircle className="spin" size={15} /> : <Plus size={16} />}
        </button>
        <button
          className="icon-button panel-collapse"
          onClick={onCollapse}
          aria-controls="worksheet-explorer"
          aria-expanded="true"
          aria-label="Collapse worksheets"
          title="Collapse worksheets"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <label className="explorer-search worksheet-search">
        <Search size={14} />
        <input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find worksheets or queries…" />
        <kbd>/</kbd>
      </label>

      {activeWorkbook && (
        <section className="active-worksheet" aria-label="Current worksheet">
          <div className="active-worksheet-label">
            <span>Current worksheet</span>
            <span className={`worksheet-state ${activeWorkbook.state}`}>{activeWorkbook.state}</span>
          </div>
          {editingTitle ? (
            <form
              className="worksheet-title-form"
              onSubmit={(event) => { event.preventDefault(); void commitTitle() }}
            >
              <input
                ref={titleInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setEditingTitle(false) }}
                aria-label="Worksheet name"
                maxLength={120}
              />
              <button type="submit" disabled={saving || !title.trim()} aria-label="Save worksheet name" title="Save worksheet name">{saving ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}</button>
            </form>
          ) : (
            <div className="active-worksheet-title">
              <div><FileCode2 size={16} /><strong title={activeWorkbook.title}>{activeWorkbook.title}</strong></div>
              <button onClick={() => setEditingTitle(true)} disabled={saving}>
                <Save size={13} />{activeWorkbook.state === 'draft' ? 'Save' : 'Rename'}
              </button>
            </div>
          )}
          <div className="active-worksheet-meta">
            <span>{activeWorkbook.documents.length} {activeWorkbook.documents.length === 1 ? 'query' : 'queries'}</span>
            <span><Clock3 size={11} />{saving ? 'Saving…' : `Saved ${relativeTime(savedAt ?? activeWorkbook.updatedAt)}`}</span>
          </div>
        </section>
      )}

      <div className="worksheet-list-heading">
        <span>All worksheets</span>
        <span>{visibleWorkbooks.length}</span>
        <button onClick={() => void onRefresh()} aria-label="Refresh worksheets" title="Refresh worksheets"><RefreshCw size={13} /></button>
      </div>

      <div className="worksheet-list">
        {visibleWorkbooks.map((item) => {
          const active = item.id === activeWorkbook?.id
          const opening = item.id === openingWorkbookId
          return (
            <button
              key={item.id}
              className={`worksheet-row ${active ? 'active' : ''}`}
              onClick={() => void onOpen(item.id)}
              disabled={active || openingWorkbookId !== null}
              aria-current={active ? 'page' : undefined}
            >
              <span className="worksheet-file-mark">{opening ? <LoaderCircle className="spin" size={14} /> : <FileCode2 size={14} />}</span>
              <span className="worksheet-row-copy">
                <strong>{item.title}</strong>
                <small>{item.documents.length} {item.documents.length === 1 ? 'query' : 'queries'} · {relativeTime(item.updatedAt)}</small>
              </span>
              {active ? <Check className="worksheet-active-check" size={14} /> : <span className={`worksheet-dot ${item.state}`} title={item.state} />}
            </button>
          )
        })}
        {visibleWorkbooks.length === 0 && (
          <div className="worksheet-empty">
            <FileCode2 size={20} />
            <strong>{search ? 'No matching worksheets' : 'No worksheets yet'}</strong>
            <span>{search ? 'Try another name or query title.' : 'Create one to start a separate SQL investigation.'}</span>
          </div>
        )}
      </div>

      <div className="worksheet-panel-footer">
        <button onClick={() => void onCreate()} disabled={openingWorkbookId !== null}>
          <Plus size={14} />New worksheet
        </button>
        <span>Stored locally</span>
      </div>
    </aside>
  )
}
