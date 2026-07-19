import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  foldEffect,
  foldGutter,
  foldKeymap,
  foldedRanges,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  type ChangeDesc,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
  type LayerMarker,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  layer,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react'
import { CatalogCompletionClient } from '../editor/catalogCompletion'
import {
  EditorSessionStore,
  sanitizePersistedEditorState,
  type EditorSession,
} from '../editor/editorSessions'
import type { TextChange } from '../editor/statementLexer'
import type {
  CompletionCatalog,
  PersistedEditorState,
  SQLDocumentChange,
  SQLExecutionRequest,
} from '../types'

const FULL_CONTROL_MAX_STATEMENTS = 500
const FULL_CONTROL_MAX_BYTES = 2 * 1024 * 1024

export type SQLExecutionTarget = {
  documentId: string
  revision: number
  kind: 'selection' | 'statement' | 'script'
  statementIndex: number
  statementCount: number
}

export type SQLEditorHandle = {
  focus: () => void
  getContent: () => string
  replaceContent: (sql: string) => void
  insertText: (text: string) => void
  flushState: () => void
  requestExecution: (kind: SQLExecutionRequest['kind']) => void
}

type Props = {
  documentId: string
  initialContent: string
  initialRevision: number
  persistedState?: PersistedEditorState
  openDocumentIds: string[]
  undoDepth: number
  inactiveCacheMB: number
  catalog: CompletionCatalog | null
  catalogLoading: boolean
  runDisabled?: boolean
  onChange: (change: SQLDocumentChange) => void
  onPersistedStateChange?: (documentId: string, state: PersistedEditorState) => void
  onRun?: (request: SQLExecutionRequest) => void
  onCursorChange?: (documentId: string, line: number, column: number) => void
  onExecutionTargetChange?: (target: SQLExecutionTarget | null) => void
}

type StatementIndex = {
  documentRevision: number
  indexedRevision: number
  ranges: Uint32Array
}

const setStatementIndex = StateEffect.define<{ revision: number; ranges: Uint32Array }>()
const refreshStatementControls = StateEffect.define<null>()
const statementIndexField = StateField.define<StatementIndex>({
  create: () => ({ documentRevision: 0, indexedRevision: -1, ranges: new Uint32Array() }),
  update(value, transaction) {
    let next = transaction.docChanged
      ? {
          ...value,
          documentRevision: value.documentRevision + 1,
          // Keep the previous worker result visually aligned while the next
          // authoritative index is in flight. Execution still checks the
          // revision and waits for the worker before using these ranges.
          ranges: mapStatementRanges(value.ranges, transaction.changes),
        }
      : value
    for (const effect of transaction.effects) {
      if (effect.is(setStatementIndex) && effect.value.revision === next.documentRevision) {
        next = { ...next, indexedRevision: effect.value.revision, ranges: effect.value.ranges }
      }
    }
    return next
  },
})

type EditorController = {
  documentId: string
  disabled: boolean
  requestExecution: (documentId: string, kind: SQLExecutionRequest['kind'], statementIndex?: number) => void
}

function targetForState(documentId: string, state: EditorState): SQLExecutionTarget | null {
  const indexed = state.field(statementIndexField)
  const selection = state.selection.main
  if (!selection.empty) {
    return {
      documentId,
      revision: indexed.documentRevision,
      kind: 'selection',
      statementIndex: -1,
      statementCount: indexed.indexedRevision === indexed.documentRevision ? indexed.ranges.length / 2 : 0,
    }
  }
  // The ranges are mapped through every local edit while the worker catches
  // up. They are safe for keeping the UI target stable, but execution still
  // waits for an authoritative range set in requestExecution below.
  const head = selection.head
  const statementIndex = statementIndexAtOrAfter(indexed.ranges, head)
  if (statementIndex >= 0) {
    return {
      documentId,
      revision: indexed.documentRevision,
      kind: 'statement',
      statementIndex,
      statementCount: indexed.ranges.length / 2,
    }
  }
  return {
    documentId,
    revision: indexed.documentRevision,
    kind: 'script',
    statementIndex: -1,
    statementCount: 0,
  }
}

function statementIndexAtOrAfter(packed: Uint32Array, position: number) {
  const count = packed.length / 2
  if (count === 0) return -1
  let low = 0
  let high = count
  while (low < high) {
    const middle = (low + high) >>> 1
    if (packed[middle * 2] < position) low = middle + 1
    else high = middle
  }
  const previous = low - 1
  if (previous >= 0 && position < packed[previous * 2 + 1]) return previous
  if (low < count) return low
  return count - 1
}

function mapStatementRanges(packed: Uint32Array, changes: ChangeDesc) {
  if (packed.length === 0 || changes.empty) return packed
  // Full Query bands are capped at 500 statements. Larger documents use
  // compact controls and must not remap a 100k-entry index on the UI thread;
  // their worker result replaces these transient ranges shortly afterward.
  if (packed.length / 2 > FULL_CONTROL_MAX_STATEMENTS) return packed
  const mapped: number[] = []
  for (let cursor = 0; cursor < packed.length; cursor += 2) {
    const from = changes.mapPos(packed[cursor], -1)
    const to = changes.mapPos(packed[cursor + 1], 1)
    if (to > from) mapped.push(from, to)
  }
  return Uint32Array.from(mapped)
}

class QueryControlWidget extends WidgetType {
  constructor(
    readonly statementIndex: number,
    readonly documentId: string,
    readonly disabled: boolean,
    readonly controller: EditorController,
  ) {
    super()
  }

  eq(other: WidgetType) {
    return other instanceof QueryControlWidget
      && other.statementIndex === this.statementIndex
      && other.documentId === this.documentId
      && other.disabled === this.disabled
  }

  toDOM() {
    const container = document.createElement('div')
    container.className = 'cm-query-control full cm-query-control-widget'
    const label = document.createElement('span')
    label.textContent = `Query ${this.statementIndex + 1}`
    container.append(label)
    const button = document.createElement('button')
    button.type = 'button'
    this.configureButton(button)
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!this.controller.disabled) this.controller.requestExecution(this.documentId, 'query', this.statementIndex)
    })
    container.append(button)
    return container
  }

  updateDOM(dom: HTMLElement, _view: EditorView, previous: this) {
    if (!(previous instanceof QueryControlWidget)
      || previous.statementIndex !== this.statementIndex
      || previous.documentId !== this.documentId) return false
    const button = dom.querySelector('button')
    if (button) this.configureButton(button)
    return true
  }

  get estimatedHeight() {
    return 43
  }

  private configureButton(button: HTMLButtonElement) {
    button.disabled = this.disabled
    button.setAttribute('aria-label', `Run Query ${this.statementIndex + 1}`)
    button.title = this.disabled ? 'Connect a database to run this query' : `Run Query ${this.statementIndex + 1}`
    button.textContent = '▶  Run'
  }
}

class QueryControlMarker implements LayerMarker {
  constructor(
    readonly top: number,
    readonly left: number,
    readonly width: number,
    readonly statementIndex: number,
    readonly compact: boolean,
    readonly documentId: string,
    readonly disabled: boolean,
    readonly controller: EditorController,
  ) {}

  eq(other: LayerMarker): boolean {
    return other instanceof QueryControlMarker
      && other.top === this.top
      && other.left === this.left
      && other.width === this.width
      && other.statementIndex === this.statementIndex
      && other.compact === this.compact
      && other.documentId === this.documentId
      && other.disabled === this.disabled
  }

  draw() {
    const container = document.createElement('div')
    container.className = this.compact ? 'cm-query-control compact' : 'cm-query-control full'
    container.style.position = 'absolute'
    container.style.top = `${this.top}px`
    container.style.left = `${this.left}px`
    if (!this.compact) container.style.width = `${this.width}px`
    if (!this.compact) {
      const label = document.createElement('span')
      label.textContent = `Query ${this.statementIndex + 1}`
      container.append(label)
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.disabled = this.disabled
    button.setAttribute('aria-label', `Run Query ${this.statementIndex + 1}`)
    button.title = this.disabled ? 'Connect a database to run this query' : `Run Query ${this.statementIndex + 1}`
    button.textContent = this.compact ? '▶' : '▶  Run'
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!this.controller.disabled) this.controller.requestExecution(this.documentId, 'query', this.statementIndex)
    })
    container.append(button)
    return container
  }

  update(dom: HTMLElement, oldMarker: LayerMarker) {
    if (!(oldMarker instanceof QueryControlMarker)
      || oldMarker.statementIndex !== this.statementIndex
      || oldMarker.compact !== this.compact
      || oldMarker.documentId !== this.documentId) return false
    dom.style.top = `${this.top}px`
    dom.style.left = `${this.left}px`
    if (!this.compact) dom.style.width = `${this.width}px`
    const button = dom.querySelector('button')
    if (button) {
      button.disabled = this.disabled
      button.title = this.disabled ? 'Connect a database to run this query' : `Run Query ${this.statementIndex + 1}`
    }
    return true
  }
}

function visibleStatementIndexes(packed: Uint32Array, visibleFrom: number, visibleTo: number) {
  let low = 0
  let high = packed.length / 2
  while (low < high) {
    const middle = (low + high) >>> 1
    if (packed[middle * 2] < visibleFrom) low = middle + 1
    else high = middle
  }
  const indexes: number[] = []
  for (let index = Math.max(0, low - 1); index < packed.length / 2; index += 1) {
    const from = packed[index * 2]
    if (from > visibleTo) break
    if (from >= visibleFrom) indexes.push(index)
  }
  return indexes
}

function statementControlsExtension(controller: EditorController): Extension {
  const usesFullControls = (state: EditorState) => {
    const indexed = state.field(statementIndexField)
    return indexed.ranges.length / 2 <= FULL_CONTROL_MAX_STATEMENTS
      && state.doc.length <= FULL_CONTROL_MAX_BYTES
  }

  const buildFullControls = (state: EditorState) => {
    const indexed = state.field(statementIndexField)
    if (!usesFullControls(state)) return Decoration.none
    const decorations = []
    const seen = new Set<number>()
    for (let cursor = 0; cursor < indexed.ranges.length; cursor += 2) {
      const lineStart = state.doc.lineAt(Math.min(indexed.ranges[cursor], state.doc.length)).from
      if (seen.has(lineStart)) continue
      seen.add(lineStart)
      decorations.push(Decoration.widget({
        widget: new QueryControlWidget(cursor / 2, controller.documentId, controller.disabled, controller),
        block: true,
        side: -1,
      }).range(lineStart))
    }
    return Decoration.set(decorations, true)
  }

  const sameFullControlLayout = (before: EditorState, after: EditorState) => {
    const beforeRanges = before.field(statementIndexField).ranges
    const afterRanges = after.field(statementIndexField).ranges
    if (beforeRanges.length !== afterRanges.length) return false
    for (let cursor = 0; cursor < beforeRanges.length; cursor += 2) {
      const beforeLine = before.doc.lineAt(Math.min(beforeRanges[cursor], before.doc.length)).from
      const afterLine = after.doc.lineAt(Math.min(afterRanges[cursor], after.doc.length)).from
      if (beforeLine !== afterLine) return false
    }
    return true
  }

  // CodeMirror only accepts block decorations from a state field. Mapping the
  // field through ordinary typing transactions preserves the widget instances
  // and their DOM instead of tearing down and repainting every Run band.
  const fullControlsField = StateField.define<DecorationSet>({
    create: buildFullControls,
    update(value, transaction) {
      const controlsChanged = transaction.effects.some(
        (effect) => effect.is(setStatementIndex) || effect.is(refreshStatementControls),
      )
      const modeChanged = usesFullControls(transaction.startState) !== usesFullControls(transaction.state)
      const disabledChanged = transaction.effects.some((effect) => effect.is(refreshStatementControls))
      const layoutChanged = controlsChanged && !sameFullControlLayout(transaction.startState, transaction.state)
      if (disabledChanged || layoutChanged || modeChanged) return buildFullControls(transaction.state)
      return transaction.docChanged ? value.map(transaction.changes) : value
    },
  })

  const controlsLayer = layer({
    above: true,
    class: 'cm-query-controls-layer',
    update: (update) => update.docChanged
      || update.viewportChanged
      || update.geometryChanged
      || update.transactions.some((transaction) => transaction.effects.length > 0),
    markers(view) {
      const indexed = view.state.field(statementIndexField)
      if (indexed.ranges.length === 0) return []
      const compact = indexed.ranges.length / 2 > FULL_CONTROL_MAX_STATEMENTS || view.state.doc.length > FULL_CONTROL_MAX_BYTES
      if (!compact) return []
      const markers: QueryControlMarker[] = []
      const visibleIndexes = new Set<number>()
      for (const visible of view.visibleRanges) {
        for (const index of visibleStatementIndexes(indexed.ranges, visible.from, visible.to)) visibleIndexes.add(index)
      }
      const seenLines = new Set<number>()
      for (const statementIndex of visibleIndexes) {
        const from = Math.min(indexed.ranges[statementIndex * 2], view.state.doc.length)
        const lineStart = view.state.doc.lineAt(from).from
        if (seenLines.has(lineStart)) continue
        seenLines.add(lineStart)
        const lineBlock = view.lineBlockAt(from)
        markers.push(new QueryControlMarker(
          lineBlock.top + Math.max(0, (lineBlock.height - 20) / 2),
          5,
          Math.max(120, view.scrollDOM.clientWidth - 8),
          statementIndex,
          compact,
          controller.documentId,
          controller.disabled,
          controller,
        ))
      }
      return markers
    },
  })
  return [fullControlsField, EditorView.decorations.from(fullControlsField), controlsLayer]
}

const strataHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#4f46e5', fontWeight: '650' },
  { tag: t.operator, color: '#64748b' },
  { tag: t.string, color: '#0f766e' },
  { tag: t.number, color: '#b45309' },
  { tag: t.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.typeName, color: '#2563eb' },
  { tag: t.variableName, color: '#1e293b' },
  { tag: t.propertyName, color: '#4338ca' },
  { tag: t.function(t.variableName), color: '#7c3aed' },
  { tag: t.bool, color: '#b45309' },
  { tag: t.null, color: '#94a3b8', fontStyle: 'italic' },
])

const strataTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff', color: '#1e293b', height: '100%' },
  '.cm-scroller': { fontFamily: '"SF Mono", "SFMono-Regular", Menlo, Consolas, monospace', fontSize: '13px', lineHeight: '1.65' },
  '.cm-content': { caretColor: '#4f46e5', padding: '10px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#4f46e5', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#c7d2fe' },
  '.cm-activeLine': { backgroundColor: '#f8fafc' },
  '&.cm-has-selection .cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: '#fcfcfd', color: '#94a3b8', borderRight: '1px solid #eef2f7', minWidth: '44px' },
  '.cm-activeLineGutter': { backgroundColor: '#f1f5f9', color: '#4f46e5', fontWeight: '600' },
  '.cm-foldPlaceholder': { backgroundColor: '#f1f5f9', border: 'none', color: '#64748b' },
  '.cm-matchingBracket': { backgroundColor: '#e0e7ff', outline: '1px solid #a5b4fc' },
  '.cm-placeholder': { color: '#94a3b8', fontStyle: 'italic' },
  '.cm-tooltip': {
    border: '1px solid #dbe1ea', backgroundColor: '#fff', borderRadius: '10px',
    boxShadow: '0 18px 48px rgba(15, 23, 42, .14), 0 2px 8px rgba(15, 23, 42, .06)',
    overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': { padding: '4px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { maxHeight: '280px', fontFamily: 'inherit' },
  '.cm-tooltip.cm-tooltip-autocomplete ul li': {
    display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', alignItems: 'center', gap: '8px',
    padding: '7px 10px', margin: '1px 0', borderRadius: '7px', fontSize: '12px', lineHeight: '1.35', color: '#334155',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#eef2ff', color: '#312e81' },
  '.cm-completionLabel': { fontFamily: '"SF Mono", Menlo, Consolas, monospace', fontSize: '12px', fontWeight: '550' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: '#4f46e5', fontWeight: '700' },
  '.cm-completionDetail': { color: '#94a3b8', fontSize: '10.5px', fontStyle: 'normal' },
})

function captureViewState(view: EditorView): PersistedEditorState {
  const folds: Array<{ from: number; to: number }> = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { folds.push({ from, to }) })
  return {
    selection: view.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head })),
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
    folds,
  }
}

function restoreScroll(view: EditorView, persisted: PersistedEditorState) {
  view.requestMeasure({
    key: 'restore-editor-scroll',
    read: () => persisted,
    write: (position, currentView) => currentView.scrollDOM.scrollTo(position.scrollLeft, position.scrollTop),
  })
}

export const SQLEditor = forwardRef<SQLEditorHandle, Props>(function SQLEditor({
  documentId,
  initialContent,
  initialRevision,
  persistedState,
  openDocumentIds,
  undoDepth,
  inactiveCacheMB,
  catalog,
  catalogLoading,
  runDisabled = false,
  onChange,
  onPersistedStateChange,
  onRun,
  onCursorChange,
  onExecutionTargetChange,
}, forwardedRef) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const currentDocumentRef = useRef(documentId)
  const sessionStoreRef = useRef<EditorSessionStore | null>(null)
  if (!sessionStoreRef.current) sessionStoreRef.current = new EditorSessionStore(inactiveCacheMB)
  const workerRef = useRef<Worker | null>(null)
  const historyCompartmentRef = useRef(new Compartment())
  const completionRef = useRef<CatalogCompletionClient | null>(null)
  const persistTimerRef = useRef(0)
  const pendingRunsRef = useRef(new Map<string, Array<{
    revision: number
    kind: SQLExecutionRequest['kind']
    statementIndex?: number
    sql: string
    selection: { from: number; to: number }
  }>>())
  const callbacksRef = useRef({ onChange, onPersistedStateChange, onRun, onCursorChange, onExecutionTargetChange })
  callbacksRef.current = { onChange, onPersistedStateChange, onRun, onCursorChange, onExecutionTargetChange }

  const controllerRef = useRef<EditorController>({
    documentId,
    disabled: runDisabled,
    requestExecution: () => undefined,
  })
  controllerRef.current.documentId = documentId
  controllerRef.current.disabled = runDisabled

  const publishViewState = (view: EditorView, targetDocumentId = currentDocumentRef.current) => {
    const session = sessionStoreRef.current?.get(targetDocumentId)
    if (!session) return
    const persisted = captureViewState(view)
    sessionStoreRef.current?.capture(targetDocumentId, view.state, view.state.field(statementIndexField).documentRevision, persisted)
    callbacksRef.current.onPersistedStateChange?.(targetDocumentId, persisted)
  }

  const scheduleViewState = (view: EditorView) => {
    window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => publishViewState(view), 180)
  }

  const emitLocationAndTarget = (view: EditorView) => {
    const currentId = currentDocumentRef.current
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    callbacksRef.current.onCursorChange?.(currentId, line.number, head - line.from + 1)
    callbacksRef.current.onExecutionTargetChange?.(targetForState(currentId, view.state))
  }

  const executeFromSnapshot = (
    targetDocumentId: string,
    revision: number,
    sqlSnapshot: string,
    selection: { from: number; to: number },
    packed: Uint32Array,
    kind: SQLExecutionRequest['kind'],
    requestedIndex?: number,
  ) => {
    if (selection.to > selection.from) {
      const selectedSQL = sqlSnapshot.slice(selection.from, selection.to).trim()
      if (selectedSQL) callbacksRef.current.onRun?.({ documentId: targetDocumentId, revision, sql: selectedSQL, kind, statementIndex: -1 })
      return
    }
    const statementIndex = requestedIndex ?? statementIndexAtOrAfter(packed, selection.from)
    const from = statementIndex >= 0 ? packed[statementIndex * 2] : 0
    const to = statementIndex >= 0 ? packed[statementIndex * 2 + 1] : sqlSnapshot.length
    const sqlText = sqlSnapshot.slice(from, to).trim()
    if (sqlText) callbacksRef.current.onRun?.({
      documentId: targetDocumentId,
      revision,
      sql: sqlText,
      kind,
      statementIndex,
    })
  }

  controllerRef.current.requestExecution = (targetDocumentId, kind, statementIndex) => {
    const view = viewRef.current
    const session = sessionStoreRef.current?.get(targetDocumentId)
    const state = targetDocumentId === currentDocumentRef.current ? view?.state : session?.state
    if (!state || controllerRef.current.disabled) return
    const indexed = state.field(statementIndexField)
    const revision = indexed.documentRevision
    const selection = state.selection.main
    const snapshot = state.doc.toString()
    if (!selection.empty || indexed.indexedRevision === revision) {
      executeFromSnapshot(targetDocumentId, revision, snapshot, selection, indexed.ranges, kind, statementIndex)
      return
    }
    const pending = pendingRunsRef.current.get(targetDocumentId) ?? []
    pending.push({ revision, kind, statementIndex, sql: snapshot, selection: { from: selection.from, to: selection.to } })
    pendingRunsRef.current.set(targetDocumentId, pending)
  }

  const createState = (session: EditorSession) => {
    const persisted = sanitizePersistedEditorState(session.persisted, session.sql.length)
    const selection = EditorSelection.create(persisted.selection.map((range) => EditorSelection.range(range.anchor, range.head)))
    const extensions: Extension[] = [
      EditorState.allowMultipleSelections.of(true),
      statementIndexField.init(() => ({ documentRevision: session.revision, indexedRevision: -1, ranges: new Uint32Array() })),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      historyCompartmentRef.current.of(history({ minDepth: Math.max(20, Math.min(2000, undoDepth)) })),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      syntaxHighlighting(strataHighlight),
      strataTheme,
      placeholder('Write SQL — Ctrl+Space for schema-aware completions'),
      sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
      EditorState.languageData.of(() => [{ autocomplete: completionRef.current?.source }]),
      autocompletion({ activateOnTyping: true, maxRenderedOptions: 64, closeOnBlur: true, icons: true }),
      statementControlsExtension(controllerRef.current),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            controllerRef.current.requestExecution(currentDocumentRef.current, 'query')
            return true
          },
          preventDefault: true,
        },
        indentWithTab,
        ...closeBracketsKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        update.view.dom.classList.toggle('cm-has-selection', update.state.selection.ranges.some((range) => !range.empty))
        if (update.docChanged) {
          const changes: TextChange[] = []
          update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            changes.push({ from: fromA, to: toA, insert: inserted.toString() })
          })
          const id = currentDocumentRef.current
          const revision = update.state.field(statementIndexField).documentRevision
          workerRef.current?.postMessage({ type: 'change', documentId: id, revision, changes })
          const editorState = captureViewState(update.view)
          sessionStoreRef.current?.applyChanges(id, update.state, revision, editorState, changes)
          callbacksRef.current.onChange({ documentId: id, revision, changes, editorState })
        }
        if (update.selectionSet || update.docChanged) emitLocationAndTarget(update.view)
        if (update.selectionSet || update.docChanged || update.transactions.some((transaction) => transaction.effects.length > 0)) {
          scheduleViewState(update.view)
        }
      }),
      EditorView.domEventObservers({ scroll: (_event, view) => scheduleViewState(view) }),
    ]
    let state = EditorState.create({ doc: session.sql, selection, extensions })
    if (persisted.folds.length > 0) {
      state = state.update({ effects: persisted.folds.map((range) => foldEffect.of(range)) }).state
    }
    return state
  }

  useImperativeHandle(forwardedRef, () => ({
    focus: () => viewRef.current?.focus(),
    getContent: () => viewRef.current?.state.doc.toString() ?? '',
    replaceContent: (nextSQL: string) => {
      const view = viewRef.current
      if (!view || view.state.doc.toString() === nextSQL) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextSQL },
        selection: { anchor: Math.min(view.state.selection.main.head, nextSQL.length) },
        annotations: isolateHistory.of('full'),
        userEvent: 'input.format',
      })
      view.focus()
    },
    insertText: (text: string) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch(view.state.replaceSelection(text))
      view.focus()
    },
    flushState: () => {
      const view = viewRef.current
      if (view) publishViewState(view)
    },
    requestExecution: (kind) => {
      const view = viewRef.current
      if (!view) return
      controllerRef.current.requestExecution(currentDocumentRef.current, kind)
    },
  }), [])

  useEffect(() => {
    if (!mountRef.current) return
    const worker = new Worker(new URL('../editor/statement.worker.ts', import.meta.url), { type: 'module' })
    const completion = new CatalogCompletionClient()
    workerRef.current = worker
    completionRef.current = completion
    completion.setCatalog(catalog)
    const store = sessionStoreRef.current!
    const session = store.ensure({ documentId, sql: initialContent, revision: initialRevision, persisted: persistedState }, createState)
    worker.postMessage({ type: 'open', documentId: session.documentId, revision: session.revision, text: session.sql })
    currentDocumentRef.current = documentId
    const view = new EditorView({ state: session.state!, parent: mountRef.current })
    viewRef.current = view
    restoreScroll(view, session.persisted)
    emitLocationAndTarget(view)

    worker.onmessage = (event: MessageEvent<{ documentId: string; revision: number; ranges: Uint32Array }>) => {
      const message = event.data
      if (message.documentId === currentDocumentRef.current && mountRef.current?.parentElement) {
        mountRef.current.parentElement.dataset.statementCount = String(message.ranges.length / 2)
        mountRef.current.parentElement.dataset.indexRevision = String(message.revision)
      }
      const openView = viewRef.current
      const targetSession = store.get(message.documentId)
      const state = message.documentId === currentDocumentRef.current ? openView?.state : targetSession?.state
      if (state && state.field(statementIndexField).documentRevision === message.revision) {
        if (message.documentId === currentDocumentRef.current && openView) {
          openView.dispatch({ effects: setStatementIndex.of({ revision: message.revision, ranges: message.ranges }) })
          emitLocationAndTarget(openView)
        } else if (targetSession) {
          targetSession.state = state.update({ effects: setStatementIndex.of({ revision: message.revision, ranges: message.ranges }) }).state
        }
      }
      const pending = pendingRunsRef.current.get(message.documentId) ?? []
      const ready = pending.filter((item) => item.revision === message.revision)
      if (ready.length > 0) {
        pendingRunsRef.current.set(message.documentId, pending.filter((item) => item.revision !== message.revision))
        for (const request of ready) {
          executeFromSnapshot(message.documentId, request.revision, request.sql, request.selection, message.ranges, request.kind, request.statementIndex)
        }
      }
    }
    worker.onerror = (event) => {
      if (mountRef.current?.parentElement) mountRef.current.parentElement.dataset.indexError = event.message
    }

    return () => {
      window.clearTimeout(persistTimerRef.current)
      publishViewState(view)
      view.destroy()
      worker.terminate()
      completion.destroy()
      viewRef.current = null
      workerRef.current = null
      completionRef.current = null
    }
    // One native view owns all document states for the lifetime of the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    completionRef.current?.setCatalog(catalog)
  }, [catalog])

  useEffect(() => {
    sessionStoreRef.current?.setMemoryBudget(inactiveCacheMB, documentId)
  }, [documentId, inactiveCacheMB])

  useEffect(() => {
    const extension = history({ minDepth: Math.max(20, Math.min(2000, undoDepth)) })
    const view = viewRef.current
    sessionStoreRef.current?.forEach((session) => {
      if (!session.state) return
      if (session.documentId === currentDocumentRef.current && view) {
        view.dispatch({ effects: historyCompartmentRef.current.reconfigure(extension) })
        session.state = view.state
      } else {
        session.state = session.state.update({ effects: historyCompartmentRef.current.reconfigure(extension) }).state
      }
    })
  }, [undoDepth])

  useLayoutEffect(() => {
    const store = sessionStoreRef.current
    const view = viewRef.current
    if (!store || !view || currentDocumentRef.current === documentId) return
    window.clearTimeout(persistTimerRef.current)
    const previousId = currentDocumentRef.current
    publishViewState(view, previousId)
    const session = store.ensure({ documentId, sql: initialContent, revision: initialRevision, persisted: persistedState }, createState)
    workerRef.current?.postMessage({ type: 'open', documentId: session.documentId, revision: session.revision, text: session.sql })
    currentDocumentRef.current = documentId
    controllerRef.current.documentId = documentId
    view.setState(session.state!)
    restoreScroll(view, session.persisted)
    emitLocationAndTarget(view)
    store.setMemoryBudget(inactiveCacheMB, documentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId])

  useEffect(() => {
    const store = sessionStoreRef.current
    if (!store) return
    const removed = store.retain(openDocumentIds)
    for (const id of removed) {
      workerRef.current?.postMessage({ type: 'close', documentId: id })
      pendingRunsRef.current.delete(id)
    }
  }, [openDocumentIds])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: refreshStatementControls.of(null) })
  }, [runDisabled])

  return (
    <div
      className={`sql-editor-shell ${catalogLoading ? 'catalog-loading' : ''}`}
      data-catalog={catalogLoading ? 'loading' : catalog ? 'ready' : 'empty'}
    >
      <div ref={mountRef} className="sql-editor-mount" />
    </div>
  )
})
