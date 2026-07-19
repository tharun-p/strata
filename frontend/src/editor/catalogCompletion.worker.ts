/// <reference lib="webworker" />

import type { CompletionCatalog } from '../types'
import { completeCatalog, createCatalogIndex } from './catalogIndex'

type CompletionWorkerRequest =
  | { type: 'catalog'; revision: number; catalog: CompletionCatalog | null }
  | { type: 'complete'; requestId: number; catalogRevision: number; token: string; sqlBefore: string; explicit: boolean }
  | { type: 'cancel'; requestId: number }

const worker = self as unknown as DedicatedWorkerGlobalScope
const cancelled = new Set<number>()
let index = createCatalogIndex(0, null)

worker.onmessage = (event: MessageEvent<CompletionWorkerRequest>) => {
  const message = event.data
  if (message.type === 'catalog') {
    index = createCatalogIndex(message.revision, message.catalog)
    worker.postMessage({ type: 'catalogued', revision: message.revision })
    return
  }
  if (message.type === 'cancel') {
    cancelled.add(message.requestId)
    return
  }
  if (message.catalogRevision !== index.revision || cancelled.delete(message.requestId)) return
  const result = completeCatalog(index, message.token, message.sqlBefore)
  if (cancelled.delete(message.requestId)) return
  worker.postMessage({
    type: 'completed',
    requestId: message.requestId,
    catalogRevision: index.revision,
    items: result.items.map((candidate) => ({
      label: candidate.label,
      apply: candidate.apply,
      type: candidate.type,
      detail: candidate.detail,
      info: candidate.info,
    })),
    truncated: result.truncated,
  })
}

export {}
