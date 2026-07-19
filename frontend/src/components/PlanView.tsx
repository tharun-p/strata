import { ArrowDown, GitBranch, Layers3, Timer } from 'lucide-react'
import type { ExplainResult } from '../types'

type PlanNode = {
  'Node Type'?: string
  'Startup Cost'?: number
  'Total Cost'?: number
  'Plan Rows'?: number
  'Relation Name'?: string
  'Index Name'?: string
  'Join Type'?: string
  Plans?: PlanNode[]
}

function extractRoot(plan: unknown): PlanNode | null {
  if (!Array.isArray(plan) || plan.length === 0 || typeof plan[0] !== 'object' || plan[0] === null) return null
  const wrapped = plan[0] as { Plan?: PlanNode }
  return wrapped.Plan ?? null
}

function PlanNodeCard({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  const expensive = (node['Total Cost'] ?? 0) > 30_000
  return (
    <div className="plan-branch">
      <div className={`plan-node ${expensive ? 'expensive' : ''}`}>
        <span className="plan-node-icon">{node.Plans?.length ? <GitBranch size={15} /> : <Layers3 size={15} />}</span>
        <span className="plan-node-copy">
          <strong>{node['Node Type'] ?? 'Plan node'}</strong>
          <small>{node['Relation Name'] ?? node['Index Name'] ?? node['Join Type'] ?? (depth === 0 ? 'Root operation' : 'Execution step')}</small>
        </span>
        <span className="plan-node-metric"><small>cost</small><strong>{Math.round(node['Total Cost'] ?? 0).toLocaleString()}</strong></span>
        <span className="plan-node-metric"><small>rows</small><strong>{(node['Plan Rows'] ?? 0).toLocaleString()}</strong></span>
        {expensive && <em>high cost</em>}
      </div>
      {node.Plans && node.Plans.length > 0 && (
        <div className="plan-children">
          <ArrowDown size={13} />
          {node.Plans.map((child, index) => <PlanNodeCard key={index} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}

export function PlanView({ result, loading }: { result: ExplainResult | null; loading: boolean }) {
  if (loading) return <div className="plan-empty"><Timer className="spin" size={18} />Generating PostgreSQL plan…</div>
  const root = result ? extractRoot(result.plan) : null
  if (!root) return <div className="plan-empty"><GitBranch size={18} />Choose Explain to inspect the query plan.</div>
  return <div className="plan-view"><div className="plan-summary"><span><small>Planning time</small><strong>{result!.durationMs.toFixed(1)} ms</strong></span><span><small>Estimated cost</small><strong>{Math.round(root['Total Cost'] ?? 0).toLocaleString()}</strong></span><span><small>Estimated rows</small><strong>{(root['Plan Rows'] ?? 0).toLocaleString()}</strong></span><span className="plan-safe">Non-executing plan</span></div><PlanNodeCard node={root} /></div>
}

