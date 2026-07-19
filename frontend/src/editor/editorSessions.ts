import type { EditorState } from '@codemirror/state'
import type { PersistedEditorState } from '../types'
import { applyTextChanges, type TextChange } from './statementLexer'

export const emptyPersistedEditorState = (): PersistedEditorState => ({
  selection: [{ anchor: 0, head: 0 }],
  scrollTop: 0,
  scrollLeft: 0,
  folds: [],
})

export type EditorSession = {
  documentId: string
  sql: string
  revision: number
  persisted: PersistedEditorState
  state?: EditorState
  lastUsed: number
  estimatedBytes: number
}

type SessionSeed = {
  documentId: string
  sql: string
  revision: number
  persisted?: PersistedEditorState
}

function clampPosition(position: number, length: number) {
  return Math.max(0, Math.min(length, Number.isFinite(position) ? position : 0))
}

export function sanitizePersistedEditorState(value: PersistedEditorState | undefined, documentLength: number): PersistedEditorState {
  const fallback = emptyPersistedEditorState()
  if (!value) return fallback
  const selection = (value.selection ?? [])
    .slice(0, 64)
    .map((range) => ({
      anchor: clampPosition(range.anchor, documentLength),
      head: clampPosition(range.head, documentLength),
    }))
  const folds = (value.folds ?? [])
    .map((range) => ({ from: clampPosition(range.from, documentLength), to: clampPosition(range.to, documentLength) }))
    .filter((range) => range.to > range.from)
  return {
    selection: selection.length > 0 ? selection : fallback.selection,
    scrollTop: Math.max(0, Number.isFinite(value.scrollTop) ? value.scrollTop : 0),
    scrollLeft: Math.max(0, Number.isFinite(value.scrollLeft) ? value.scrollLeft : 0),
    folds,
  }
}

function estimateSessionBytes(session: EditorSession) {
  // UTF-16 text plus a conservative allowance for syntax nodes, selections,
  // decorations and retained history branches.
  return Math.max(32 * 1024, session.sql.length * 6 + 24 * 1024)
}

export class EditorSessionStore {
  private readonly sessions = new Map<string, EditorSession>()
  private memoryBudgetBytes: number

  constructor(memoryBudgetMB = 512) {
    this.memoryBudgetBytes = memoryBudgetMB * 1024 * 1024
  }

  setMemoryBudget(memoryBudgetMB: number, activeDocumentId?: string) {
    this.memoryBudgetBytes = Math.max(128, Math.min(4096, memoryBudgetMB)) * 1024 * 1024
    this.evict(activeDocumentId)
  }

  ensure(seed: SessionSeed, createState: (session: EditorSession) => EditorState) {
    let session = this.sessions.get(seed.documentId)
    if (!session) {
      session = {
        documentId: seed.documentId,
        sql: seed.sql,
        revision: seed.revision,
        persisted: sanitizePersistedEditorState(seed.persisted, seed.sql.length),
        lastUsed: performance.now(),
        estimatedBytes: 0,
      }
      this.sessions.set(seed.documentId, session)
    }
    session.lastUsed = performance.now()
    if (!session.state) session.state = createState(session)
    session.estimatedBytes = estimateSessionBytes(session)
    this.evict(seed.documentId)
    return session
  }

  capture(documentId: string, state: EditorState, revision: number, persisted: PersistedEditorState) {
    const session = this.sessions.get(documentId)
    if (!session) return
    session.state = state
    session.revision = revision
    session.persisted = sanitizePersistedEditorState(persisted, state.doc.length)
    session.lastUsed = performance.now()
    session.estimatedBytes = estimateSessionBytes(session)
  }

  applyChanges(documentId: string, state: EditorState, revision: number, persisted: PersistedEditorState, changes: readonly TextChange[]) {
    const session = this.sessions.get(documentId)
    if (!session) return
    session.sql = applyTextChanges(session.sql, changes)
    this.capture(documentId, state, revision, persisted)
  }

  get(documentId: string) {
    return this.sessions.get(documentId)
  }

  replace(seed: SessionSeed, createState: (session: EditorSession) => EditorState) {
    this.sessions.delete(seed.documentId)
    return this.ensure(seed, createState)
  }

  delete(documentId: string) {
    this.sessions.delete(documentId)
  }

  retain(documentIds: readonly string[]) {
    const retained = new Set(documentIds)
    const removed: string[] = []
    for (const documentId of this.sessions.keys()) {
      if (!retained.has(documentId)) {
        this.sessions.delete(documentId)
        removed.push(documentId)
      }
    }
    return removed
  }

  forEach(callback: (session: EditorSession) => void) {
    this.sessions.forEach(callback)
  }

  private evict(activeDocumentId?: string) {
    let used = [...this.sessions.values()].reduce(
      (total, session) => total + (session.state ? session.estimatedBytes : 0),
      0,
    )
    if (used <= this.memoryBudgetBytes) return
    const candidates = [...this.sessions.values()]
      .filter((session) => session.documentId !== activeDocumentId && session.state)
      .sort((left, right) => left.lastUsed - right.lastUsed)
    for (const session of candidates) {
      if (used <= this.memoryBudgetBytes) break
      session.state = undefined
      used -= session.estimatedBytes
    }
  }
}
