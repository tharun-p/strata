import { PanelRightClose } from 'lucide-react'
import { Inspector } from './Inspector'
import { QueryInsight } from './QueryInsight'
import type { ContextMode, ExplainResult, QueryResult, RelationDetail } from '../types'

type Props = {
  mode: ContextMode
  onMode: (mode: ContextMode) => void
  onCollapse: () => void
  detail: RelationDetail | null
  detailLoading: boolean
  title: string
  question: string
  sql: string
  result: QueryResult | null
  explain: ExplainResult | null
  onExplain: () => void
  onInsertColumn: (columnName: string) => void
  onOpenData: () => void
  onSourceClick: (source: string) => void
}

export function ContextPanel({
  mode,
  onMode,
  onCollapse,
  detail,
  detailLoading,
  title,
  question,
  sql,
  result,
  explain,
  onExplain,
  onInsertColumn,
  onOpenData,
  onSourceClick,
}: Props) {
  return (
    <aside id="context-panel" className="context-panel">
      <div className="context-panel-heading">
        <div className="context-tabs" role="tablist" aria-label="Context panel">
          <button role="tab" aria-selected={mode === 'object'} className={mode === 'object' ? 'active' : ''} onClick={() => onMode('object')}>Object</button>
          <button role="tab" aria-selected={mode === 'query'} className={mode === 'query' ? 'active' : ''} onClick={() => onMode('query')}>Query</button>
        </div>
        <button className="context-collapse" onClick={onCollapse} aria-controls="context-panel" aria-expanded="true" aria-label="Collapse context panel" title="Collapse context panel">
          <PanelRightClose size={15} />
        </button>
      </div>
      <div className="context-body">
        {mode === 'object' ? (
          <Inspector detail={detail} loading={detailLoading} onInsertColumn={onInsertColumn} onOpenData={detail ? onOpenData : undefined} />
        ) : (
          <QueryInsight title={title} question={question} sql={sql} result={result} explain={explain} onExplain={onExplain} onSourceClick={onSourceClick} />
        )}
      </div>
    </aside>
  )
}
