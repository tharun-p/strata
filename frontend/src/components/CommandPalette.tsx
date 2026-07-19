import { ArrowRight, Command, Database, Search, Settings2, Table2, TerminalSquare, Unplug, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionSummary, RelationSummary } from '../types'

type PaletteItem = {
  id: string
  label: string
  detail: string
  icon: 'run' | 'connect' | 'switch' | 'disconnect' | 'relation'
  run: () => void
}

type Props = {
  open: boolean
  relations: RelationSummary[]
  connections: ConnectionSummary[]
  activeConnectionId: string | null
  onClose: () => void
  onConnect: () => void
  onRun: () => void
  onRelation: (relation: RelationSummary) => void
  onSwitchConnection: (connectionId: string) => void
  onDisconnect: (connectionId: string) => void
}

export function CommandPalette({
  open,
  relations,
  connections,
  activeConnectionId,
  onClose,
  onConnect,
  onRun,
  onRelation,
  onSwitchConnection,
  onDisconnect,
}: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setIndex(0)
      return
    }
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const actions: PaletteItem[] = [
      { id: 'run', label: 'Run current query', detail: 'Execute with the session safety setting', icon: 'run', run: () => { onRun(); onClose() } },
      { id: 'connect', label: 'Add connection…', detail: 'Open the PostgreSQL connection form', icon: 'connect', run: () => { onConnect(); onClose() } },
    ]
    for (const connection of connections) {
      if (connection.id !== activeConnectionId) {
        actions.push({
          id: `switch-${connection.id}`,
          label: `Switch to ${connection.name || connection.database}`,
          detail: `${connection.host}:${connection.port} · ${connection.database}`,
          icon: 'switch',
          run: () => { onSwitchConnection(connection.id); onClose() },
        })
      }
      actions.push({
        id: `disconnect-${connection.id}`,
        label: `Disconnect ${connection.name || connection.database}`,
        detail: 'Close this pooled connection',
        icon: 'disconnect',
        run: () => { onDisconnect(connection.id); onClose() },
      })
    }
    const filteredActions = actions.filter((item) => !needle || item.label.toLowerCase().includes(needle) || item.detail.toLowerCase().includes(needle))
    const filteredRelations = relations
      .filter((relation) => !needle || `${relation.schema}.${relation.name}`.toLowerCase().includes(needle) || relation.description.toLowerCase().includes(needle))
      .slice(0, 6)
      .map((relation): PaletteItem => ({
        id: `rel-${relation.schema}.${relation.name}`,
        label: `${relation.schema}.${relation.name}`,
        detail: `${relation.kind}${relation.description ? ` · ${relation.description}` : ''}`,
        icon: 'relation',
        run: () => { onRelation(relation); onClose() },
      }))
    return [...filteredActions, ...filteredRelations]
  }, [activeConnectionId, connections, onClose, onConnect, onDisconnect, onRelation, onRun, onSwitchConnection, query, relations])

  useEffect(() => setIndex(0), [query, open])
  useEffect(() => {
    setIndex((value) => Math.min(value, Math.max(0, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((value) => Math.min(Math.max(0, items.length - 1), value + 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((value) => Math.max(0, value - 1))
      }
      if (event.key === 'Enter' && items[index]) {
        event.preventDefault()
        items[index].run()
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items, onClose, open])

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const iconFor = (icon: PaletteItem['icon']) => {
    if (icon === 'run') return <span className="command-icon green"><TerminalSquare size={15} /></span>
    if (icon === 'connect') return <span className="command-icon blue"><Database size={15} /></span>
    if (icon === 'switch') return <span className="command-icon blue"><Database size={15} /></span>
    if (icon === 'disconnect') return <span className="command-icon"><Unplug size={15} /></span>
    return <span className="command-icon"><Table2 size={15} /></span>
  }

  return (
    <div className="modal-backdrop palette-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Strata command bar">
        <div className="palette-search">
          <Search size={18} />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Go to a table, switch connection, or run a command…" />
          <button onClick={onClose} aria-label="Close command bar"><X size={15} /></button>
        </div>
        <div className="palette-body" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">No matching commands or objects</div>}
          {items.map((item, itemIndex) => (
            <button
              key={item.id}
              data-selected={itemIndex === index}
              className={itemIndex === index ? 'selected' : ''}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={item.run}
            >
              {iconFor(item.icon)}
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              {item.icon === 'run' ? <kbd>⌘↵</kbd> : <ArrowRight size={14} />}
            </button>
          ))}
        </div>
        <div className="palette-footer"><span><Command size={12} /> Strata command bar</span><span><kbd>↑↓</kbd> navigate · <kbd>↵</kbd> run · <kbd>esc</kbd> close</span><Settings2 size={13} /></div>
      </div>
    </div>
  )
}
