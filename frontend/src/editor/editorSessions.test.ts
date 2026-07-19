import { history, undo } from '@codemirror/commands'
import { EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { EditorSessionStore, emptyPersistedEditorState } from './editorSessions'

function update(state: EditorState, insert: string) {
  return state.update({ changes: { from: state.doc.length, insert }, userEvent: 'input.type' }).state
}

function undoState(state: EditorState) {
  let next = state
  undo({ state, dispatch: (transaction: Transaction) => { next = transaction.state } } as never)
  return next
}

describe('EditorSessionStore', () => {
  it('keeps document content and Undo branches isolated', () => {
    const store = new EditorSessionStore(512)
    const create = (session: { sql: string }) => EditorState.create({ doc: session.sql, extensions: history() })
    const first = store.ensure({ documentId: 'one', sql: 'SELECT 1', revision: 0, persisted: emptyPersistedEditorState() }, create)
    const second = store.ensure({ documentId: 'two', sql: 'SELECT 2', revision: 0, persisted: emptyPersistedEditorState() }, create)
    first.state = update(first.state!, ';')
    second.state = update(second.state!, ' + 2;')
    first.state = undoState(first.state!)
    expect(first.state.doc.toString()).toBe('SELECT 1')
    expect(second.state.doc.toString()).toBe('SELECT 2 + 2;')
  })

  it('evicts inactive CodeMirror state without evicting SQL or persisted view state', () => {
    const store = new EditorSessionStore(0.01)
    const create = (session: { sql: string }) => EditorState.create({ doc: session.sql })
    const first = store.ensure({ documentId: 'one', sql: 'SELECT 1', revision: 4, persisted: { selection: [{ anchor: 3, head: 3 }], scrollTop: 90, scrollLeft: 5, folds: [] } }, create)
    store.ensure({ documentId: 'two', sql: 'SELECT 2', revision: 8, persisted: emptyPersistedEditorState() }, create)
    expect(first.state).toBeUndefined()
    expect(first.sql).toBe('SELECT 1')
    expect(first.persisted.scrollTop).toBe(90)
  })
})
