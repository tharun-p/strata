import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { CompletionCatalog } from '../types'

type WorkerCompletion = Completion & { apply: string }
type WorkerResponse = {
  type: 'completed'
  requestId: number
  catalogRevision: number
  items: WorkerCompletion[]
  truncated: boolean
}

type PendingCompletion = {
  resolve: (value: CompletionResult | null) => void
  from: number
  validFor: RegExp
}

export class CatalogCompletionClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, PendingCompletion>()
  private requestId = 0
  private catalogRevision = 0

  constructor() {
    this.worker = new Worker(new URL('./catalogCompletion.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type !== 'completed') return
      const pending = this.pending.get(event.data.requestId)
      if (!pending) return
      this.pending.delete(event.data.requestId)
      if (event.data.catalogRevision !== this.catalogRevision) {
        pending.resolve(null)
        return
      }
      pending.resolve({
        from: pending.from,
        options: event.data.items,
        ...(event.data.truncated ? {} : { validFor: pending.validFor }),
      })
    }
  }

  setCatalog(catalog: CompletionCatalog | null) {
    this.catalogRevision += 1
    for (const pending of this.pending.values()) pending.resolve(null)
    this.pending.clear()
    this.worker.postMessage({ type: 'catalog', revision: this.catalogRevision, catalog })
  }

  readonly source: CompletionSource = (context: CompletionContext) => {
    const word = context.matchBefore(/(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?:\.(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)?)*$/)
    if (!word && !context.explicit) return null
    const token = word?.text ?? ''
    if (!token && !context.explicit) return null
    const from = word?.from ?? context.pos
    const requestId = ++this.requestId
    return new Promise<CompletionResult | null>((resolve) => {
      this.pending.set(requestId, { resolve, from, validFor: /^(?:"(?:[^"]|"")*"|[\w$])*(?:\.(?:"(?:[^"]|"")*"|[\w$])*)*$/ })
      context.addEventListener('abort', () => {
        const pending = this.pending.get(requestId)
        if (!pending) return
        this.pending.delete(requestId)
        pending.resolve(null)
        this.worker.postMessage({ type: 'cancel', requestId })
      })
      this.worker.postMessage({
        type: 'complete',
        requestId,
        catalogRevision: this.catalogRevision,
        token,
        sqlBefore: context.state.doc.sliceString(Math.max(0, context.pos - 64_000), context.pos),
        explicit: context.explicit,
      })
    })
  }

  destroy() {
    for (const pending of this.pending.values()) pending.resolve(null)
    this.pending.clear()
    this.worker.terminate()
  }
}
