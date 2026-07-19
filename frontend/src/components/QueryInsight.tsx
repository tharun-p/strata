import { ArrowRight, CheckCircle2, Database, GitBranch, Sparkles, Table2, Timer, Zap } from 'lucide-react'
import type { ExplainResult, QueryResult } from '../types'

type Props = {
  title: string
  question: string
  sql: string
  result: QueryResult | null
  explain: ExplainResult | null
  onExplain: () => void
  onSourceClick?: (source: string) => void
}

function querySources(sql: string) {
  const matches = [...sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/gi)]
  return [...new Set(matches.map((match) => match[1]))]
}

function findIndexName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findIndexName(child)
      if (found) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record['Index Name'] === 'string') return record['Index Name']
  for (const child of Object.values(record)) {
    const found = findIndexName(child)
    if (found) return found
  }
  return null
}

export function QueryInsight({ title, question, sql, result, explain, onExplain, onSourceClick }: Props) {
  const sources = querySources(sql)
  const indexName = explain ? findIndexName(explain.plan) : null
  const duration = result?.durationMs ?? 0
  const performance = duration === 0 ? 'Waiting' : duration < 100 ? 'Excellent' : duration < 500 ? 'Good' : 'Review'
  const executionWidth = duration === 0 ? 0 : Math.min(100, Math.max(12, duration / 5))
  const planningWidth = explain ? Math.min(100, Math.max(8, explain.durationMs / 2)) : 0

  return (
    <aside className="query-insight" aria-label="Query insight">
      <header className="insight-heading">
        <div><span>Query</span><strong>{title}</strong></div>
        <GitBranch size={16} />
      </header>

      <div className="insight-scroll">
        <section className="intent-card">
          <span><Sparkles size={15} /></span>
          <p>{question || 'Describe what this query should investigate. SQL generation needs a provider (not configured).'}</p>
        </section>

        <section className="insight-metrics">
          <div><small>Duration</small><strong>{result ? `${result.durationMs.toFixed(1)} ms` : '—'}</strong><em>{performance}</em></div>
          <div><small>Rows returned</small><strong>{result ? result.rowCount.toLocaleString() : '—'}</strong><em>{result?.truncated ? 'Limited result' : 'Live result'}</em></div>
        </section>

        <section className="insight-section">
          <div className="insight-section-title"><strong>Sources</strong><span>{sources.length} detected</span></div>
          <div className="source-list">
            {sources.map((source, index) => (
              <button className="source-item" key={source} type="button" onClick={() => onSourceClick?.(source)}>
                <span className={index % 2 === 0 ? 'accent' : 'mint'}>{source.includes('.') ? <Table2 size={14} /> : <Database size={14} />}</span>
                <div><strong>{source}</strong><small>Referenced by current SQL</small></div>
                <ArrowRight size={13} />
              </button>
            ))}
            {sources.length === 0 && <div className="insight-empty">No table sources detected yet.</div>}
          </div>
        </section>

        <section className="insight-section performance-section">
          <div className="insight-section-title"><strong>Performance</strong><span className={performance.toLowerCase()}>{performance}</span></div>
          <div className="timing-row"><span>Planning</span><i><b style={{ width: `${planningWidth}%` }} /></i><em>{explain ? `${explain.durationMs.toFixed(1)} ms` : '—'}</em></div>
          <div className="timing-row"><span>Execution</span><i><b style={{ width: `${executionWidth}%` }} /></i><em>{result ? `${result.durationMs.toFixed(1)} ms` : '—'}</em></div>
          {indexName ? (
            <div className="index-signal"><CheckCircle2 size={16} /><span><strong>Index used</strong><small>{indexName}</small></span></div>
          ) : (
            <button className="plan-signal" onClick={onExplain}><Timer size={15} /><span><strong>Inspect query plan</strong><small>Check scans, costs, and index usage</small></span><ArrowRight size={13} /></button>
          )}
        </section>

        <section className="insight-section next-step-section">
          <div className="insight-section-title"><strong>Suggested next step</strong></div>
          <button onClick={onExplain}><Zap size={15} /><span><strong>Explain this query</strong><small>Compare plan cost and scan strategy</small></span><ArrowRight size={13} /></button>
        </section>
      </div>
    </aside>
  )
}
