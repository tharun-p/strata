/// <reference lib="webworker" />

import {
  incrementallyLexPostgreSQLStatements,
  lexPostgreSQLStatements,
  packStatementRanges,
  type StatementRange,
  type TextChange,
} from './statementLexer'

type IndexedDocument = {
  text: string
  ranges: StatementRange[]
  revision: number
}

type StatementWorkerRequest =
  | { type: 'open'; documentId: string; revision: number; text: string }
  | { type: 'change'; documentId: string; revision: number; changes: TextChange[] }
  | { type: 'close'; documentId: string }

const documents = new Map<string, IndexedDocument>()
const worker = self as unknown as DedicatedWorkerGlobalScope

worker.onmessage = (event: MessageEvent<StatementWorkerRequest>) => {
  const message = event.data
  if (message.type === 'close') {
    documents.delete(message.documentId)
    return
  }

  if (message.type === 'open') {
    const ranges = lexPostgreSQLStatements(message.text)
    documents.set(message.documentId, { text: message.text, ranges, revision: message.revision })
    const packed = packStatementRanges(ranges)
    worker.postMessage({ type: 'indexed', documentId: message.documentId, revision: message.revision, ranges: packed }, [packed.buffer])
    return
  }

  const document = documents.get(message.documentId)
  if (!document || message.revision <= document.revision) return
  const indexed = incrementallyLexPostgreSQLStatements(document.text, document.ranges, message.changes)
  document.text = indexed.text
  document.ranges = indexed.ranges
  document.revision = message.revision
  const packed = packStatementRanges(indexed.ranges)
  worker.postMessage({ type: 'indexed', documentId: message.documentId, revision: message.revision, ranges: packed }, [packed.buffer])
}

export {}
