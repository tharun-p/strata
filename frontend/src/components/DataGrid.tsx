import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Copy, Database, Expand, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueryResult, ResultColumn } from '../types'
import { formatCell } from '../lib/format'

type Props = {
  result: QueryResult | null
  filter: string
  loading: boolean
  hiddenColumns?: Set<string>
}

const ROW_HEIGHT = 34
const HEADER_HEIGHT = 38
const ROW_NUMBER_WIDTH = 44
const ACTIONS_WIDTH = 34

function estimateColumnWidth(column: ResultColumn, index: number, rows: unknown[][]) {
  const type = column.dataType.toLowerCase()
  let minimum = 120
  if (/(timestamp|date|time)/.test(type)) minimum = 180
  else if (/(json|text|xml)/.test(type)) minimum = 200
  else if (/(bool)/.test(type)) minimum = 100
  else if (/(int|numeric|decimal|float|double|real)/.test(type)) minimum = 130

  // Sample enough values to make useful columns readable without making one
  // unusually long value dominate the entire result grid.
  let longest = Math.max(column.name.length, column.dataType.length)
  for (const row of rows.slice(0, 100)) {
    longest = Math.max(longest, Math.min(formatCell(row[index], column.dataType).length, 36))
  }
  return Math.min(320, Math.max(minimum, longest * 7 + 30))
}

export function DataGrid({ result, filter, loading, hiddenColumns }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const expandedOriginRef = useRef<HTMLElement | null>(null)
  const expandedCloseRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState<{ row: number; column: number; text: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const normalizedFilter = filter.trim().toLowerCase()
  const visibleColumns = useMemo(() => {
    if (!result) return []
    return result.columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => !hiddenColumns?.has(column.name))
  }, [hiddenColumns, result])

  const rows = useMemo(() => {
    if (!result) return [] as unknown[][]
    if (!normalizedFilter) return result.rows
    return result.rows.filter((row) => row.some((value) => formatCell(value).toLowerCase().includes(normalizedFilter)))
  }, [normalizedFilter, result])

  const columnWidths = useMemo(
    () => visibleColumns.map(({ column, index }) => estimateColumnWidth(column, index, rows)),
    [rows, visibleColumns],
  )
  const gridTemplateColumns = useMemo(
    () => [
      `${ROW_NUMBER_WIDTH}px`,
      ...columnWidths.map((width) => `minmax(${width}px, ${width}fr)`),
      `${ACTIONS_WIDTH}px`,
    ].join(' '),
    [columnWidths],
  )
  const gridWidth = ROW_NUMBER_WIDTH + ACTIONS_WIDTH + columnWidths.reduce((sum, width) => sum + width, 0)

  const closeExpanded = useCallback((restoreFocus = true) => {
    setExpanded(null)
    if (restoreFocus) window.requestAnimationFrame(() => expandedOriginRef.current?.focus())
  }, [])

  useEffect(() => {
    setExpanded(null)
    expandedOriginRef.current = null
  }, [filter, result?.queryId])

  useEffect(() => {
    if (!expanded) return
    window.requestAnimationFrame(() => expandedCloseRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeExpanded()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeExpanded, expanded])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  })

  if (loading) {
    return (
      <div className="grid-loading" aria-live="polite">
        <div className="grid-loading-line" />
        <div className="grid-loading-line short" />
        <div className="grid-loading-line" />
        <span>Running against a read-only transaction…</span>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Database size={19} /></div>
        <strong>Ready to investigate</strong>
        <span>Run the query to inspect its result set.</span>
        <kbd>⌘ ↵</kbd>
      </div>
    )
  }

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 900)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  return (
    <div className="data-grid-wrap" ref={parentRef} tabIndex={0} aria-label="Query result data grid">
      <div
        className="data-grid-virtual"
        style={{
          height: virtualizer.getTotalSize() + HEADER_HEIGHT,
          width: gridWidth,
          minWidth: '100%',
        }}
      >
        <div className="data-grid-header" style={{ height: HEADER_HEIGHT, gridTemplateColumns }}>
          <div className="row-number-cell">#</div>
          {visibleColumns.map(({ column, index }) => (
            <div className="data-grid-cell head" key={`${column.name}-${index}`}>
              <span className="column-heading">
                <span>{column.name}</span>
                <small>{column.dataType}</small>
              </span>
            </div>
          ))}
          <div className="grid-actions" />
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <div
                className="data-grid-row"
                key={virtualRow.key}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns,
                }}
              >
                <div className="row-number-cell">{virtualRow.index + 1}</div>
                {visibleColumns.map(({ column, index }) => {
                  const value = row[index]
                  const isNull = value === null || value === undefined
                  const text = formatCell(value, column.dataType)
                  const cellKey = `${virtualRow.index}:${index}`
                  return (
                    <div
                      className={`data-grid-cell ${isNull ? 'null-cell' : ''} ${copied === cellKey ? 'copied' : ''}`}
                      key={cellKey}
                      title={text}
                      tabIndex={0}
                      onDoubleClick={(event) => {
                        expandedOriginRef.current = event.currentTarget
                        setExpanded({ row: virtualRow.index, column: index, text })
                      }}
                    >
                      <span>{text}</span>
                      <button
                        className="cell-copy"
                        aria-label="Copy cell"
                        onClick={() => void copyText(text, cellKey)}
                      >
                        {copied === cellKey ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  )
                })}
                <div className="grid-actions">
                  <button
                    aria-label={`Copy row ${virtualRow.index + 1}`}
                    onClick={() => void copyText(JSON.stringify(Object.fromEntries(visibleColumns.map(({ column, index }) => [column.name, row[index]]))), `row-${virtualRow.index}`)}
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {rows.length === 0 && <div className="filter-empty">No rows match “{filter}”</div>}
      {expanded && (
        <div className="cell-expand-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeExpanded() }}>
          <div className="cell-expand" role="dialog" aria-modal="true" aria-label="Cell value">
            <header>
              <strong>Row {expanded.row + 1}</strong>
              <button onClick={() => void copyText(expanded.text, 'expanded')} aria-label="Copy expanded cell"><Copy size={14} /></button>
              <button ref={expandedCloseRef} onClick={() => closeExpanded()} aria-label="Close"><X size={14} /></button>
            </header>
            <pre>{expanded.text}</pre>
            <footer><Expand size={12} /> Double-click any cell to expand</footer>
          </div>
        </div>
      )}
    </div>
  )
}
