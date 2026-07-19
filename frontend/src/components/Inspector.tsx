import { Columns3, FileKey2, Gauge, Info, KeyRound, ScanSearch, TableProperties } from 'lucide-react'
import type { RelationDetail } from '../types'
import { formatBytes, formatCount } from '../lib/format'

type Props = {
  detail: RelationDetail | null
  loading: boolean
  onInsertColumn?: (columnName: string) => void
  onOpenData?: () => void
}

export function Inspector({ detail, loading, onInsertColumn, onOpenData }: Props) {
  const primaryKeys = detail?.columns.filter((column) => column.isPrimaryKey) ?? []
  return (
    <aside className="inspector-panel">
      <div className="inspector-heading">
        <span className="eyebrow">Object</span>
        <strong>{detail ? `${detail.relation.schema}.${detail.relation.name}` : 'Select an object'}</strong>
        {detail && onOpenData && <button className="inspector-open" onClick={onOpenData}>Open data</button>}
      </div>

      {loading ? (
        <div className="inspector-skeleton"><i /><i /><i /><i /></div>
      ) : detail ? (
        <>
          <section className="inspector-section overview-section">
            <div className="section-title"><span><TableProperties size={14} /> Overview</span><span className="section-hint" title={detail.relation.description || 'No description'}><Info size={13} /></span></div>
            <p>{detail.relation.description || 'No description has been added to this relation.'}</p>
            <div className="stat-pair">
              <span><small>Estimated rows</small><strong>{formatCount(detail.relation.estimatedRows)}</strong></span>
              <span><small>Total size</small><strong>{formatBytes(detail.relation.sizeBytes)}</strong></span>
            </div>
          </section>

          <section className="inspector-section insight-card catalog-evidence">
            <div className="insight-title"><ScanSearch size={14} /><span>Catalog evidence</span></div>
            <p>
              {primaryKeys.length > 0 ? <><strong>{primaryKeys.map((column) => column.name).join(', ')}</strong> {primaryKeys.length === 1 ? 'is the primary key.' : 'form the composite primary key.'}</> : 'No primary key is declared.'}
              {' '}{detail.indexes.length} {detail.indexes.length === 1 ? 'index is' : 'indexes are'} available for plan investigation.
            </p>
            {detail.relation.lastVacuum && <small>Last vacuum: {new Date(detail.relation.lastVacuum).toLocaleString()}</small>}
          </section>

          <section className="inspector-section">
            <div className="section-title"><span><Columns3 size={14} /> Columns</span><small>{detail.columns.length}</small></div>
            <div className="column-list">
              {detail.columns.map((column) => (
                <button className="column-row" key={column.name} onClick={() => onInsertColumn?.(column.name)} title="Insert into editor">
                  <span className={`column-glyph ${column.isPrimaryKey ? 'primary' : ''}`}>
                    {column.isPrimaryKey ? <KeyRound size={11} /> : column.dataType.slice(0, 1).toUpperCase()}
                  </span>
                  <span><strong>{column.name}</strong><small>{column.dataType}</small></span>
                  {column.nullable && <em>nullable</em>}
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-title"><span><FileKey2 size={14} /> Indexes</span><small>{detail.indexes.length}</small></div>
            <div className="index-list">
              {detail.indexes.map((index) => (
                <div className="index-row" key={index.name} title={index.definition}>
                  <Gauge size={13} />
                  <span><strong>{index.name}</strong><small>{index.columns.join(', ')} · {formatBytes(index.sizeBytes)} · {index.scans.toLocaleString()} scans</small></span>
                  {index.isPrimary && <em>PK</em>}
                </div>
              ))}
              {detail.indexes.length === 0 && <div className="inspector-empty compact">No indexes on this relation.</div>}
            </div>
          </section>
        </>
      ) : (
        <div className="inspector-empty">Choose a table or view to inspect its columns, indexes, size, and activity.</div>
      )}
    </aside>
  )
}
