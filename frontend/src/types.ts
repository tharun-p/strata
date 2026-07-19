export type ConnectionInput = {
  profileId?: string
  name: string
  host: string
  port: number
  database: string
  username: string
  password: string
  sslMode: string
  connectTimeoutMs: number
  color?: string
  rememberPassword: boolean
  privateMode: boolean
  autoConnect: boolean
}

export type ConnectionSummary = Omit<ConnectionInput, 'password' | 'sslMode' | 'connectTimeoutMs' | 'rememberPassword' | 'privateMode' | 'autoConnect'> & {
  id: string
  serverVersion: string
  latencyMs: number
  connectedAt: string
  readOnlyDefault: boolean
  credentialStatus?: CredentialStatus
  persistenceWarning?: string
}

export type CredentialStatus = 'available' | 'missing' | 'locked' | 'session-only'

export type ConnectionProfile = {
  id: string
  name: string
  host: string
  port: number
  database: string
  username: string
  sslMode: string
  connectTimeoutMs: number
  color: string
  readOnlyDefault: boolean
  autoConnect: boolean
  privateMode: boolean
  credentialStatus: CredentialStatus
  createdAt: string
  updatedAt: string
  lastConnectedAt?: string
}

export type StartupStatus = {
  autoConnectAttempted: boolean
  connected: boolean
  error?: string
  persistenceReady: boolean
  persistenceError?: string
}

export type WorkspaceSettings = {
  explorerWidth: number
  contextWidth: number
  explorerCollapsed: boolean
  contextCollapsed: boolean
  queryPanePercent: number
  maxRows: number
  contextMode: ContextMode
  leftPanelMode: LeftPanelMode
  editorUndoDepth: number
  inactiveEditorCacheMB: number
}

export type PersistedEditorRange = {
  anchor: number
  head: number
}

export type PersistedEditorState = {
  selection: PersistedEditorRange[]
  scrollTop: number
  scrollLeft: number
  folds: Array<{ from: number; to: number }>
}

export type WorkbookDocument = {
  id: string
  kind: 'sql' | 'markdown' | 'chart' | 'explain' | 'note'
  title: string
  position: number
  profileId?: string
  database?: string
  contentVersion: number
  content: {
    sql: string
    question: string
    editorState?: PersistedEditorState
  }
}

export type WorkbookPatch = {
  id: string
  expectedRevision: number
  title?: string
  state?: Workbook['state']
  pinned?: boolean
  activeDocumentId?: string
  upsertDocuments?: WorkbookDocument[]
  deleteDocumentIds?: string[]
  documentOrder?: string[]
  checkpoint?: boolean
}

export type Workbook = {
  id: string
  title: string
  state: 'draft' | 'saved' | 'archived'
  pinned: boolean
  revision: number
  activeDocumentId?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  documents: WorkbookDocument[]
}

export type DatabaseSummary = {
  name: string
  owner: string
  sizeBytes: number
  allowConnections: boolean
  isTemplate: boolean
  isCurrent: boolean
}

export type SchemaSummary = {
  name: string
  relationCount: number
  sizeBytes: number
}

export type RelationSummary = {
  schema: string
  name: string
  kind: string
  estimatedRows: number
  sizeBytes: number
  description: string
  lastVacuum?: string
}

export type ColumnDetail = {
  name: string
  dataType: string
  nullable: boolean
  defaultValue?: string
  description: string
  isPrimaryKey: boolean
}

export type IndexDetail = {
  name: string
  definition: string
  sizeBytes: number
  scans: number
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
}

export type RelationDetail = {
  relation: RelationSummary
  columns: ColumnDetail[]
  indexes: IndexDetail[]
}

export type QueryInput = {
  connectionId: string
  documentId?: string
  queryId?: string
  sql: string
  maxRows: number
  timeoutMs: number
  readOnly: boolean
}

export type ResultColumn = { name: string; dataType: string }

export type QueryResult = {
  queryId: string
  columns: ResultColumn[]
  rows: unknown[][]
  rowCount: number
  affectedRows: number
  command: string
  durationMs: number
  truncated: boolean
  executedAt: string
}

export type ExplainResult = {
  queryId: string
  plan: unknown
  durationMs: number
  executedAt: string
}

export type SQLExecutionRequest = {
  documentId: string
  revision: number
  sql: string
  kind: 'query' | 'explain'
  statementIndex: number
}

export type SQLDocumentChange = {
  documentId: string
  revision: number
  changes: Array<{ from: number; to: number; insert: string }>
  editorState: PersistedEditorState
}

export type DocumentActivity = {
  requestId: string
  documentId: string
  connectionId: string
  kind: SQLExecutionRequest['kind']
  status: 'queued' | 'running' | 'cancelling'
  startedAt?: string
}

export type CompletionColumn = {
  name: string
  dataType: string
}

export type CompletionRelation = {
  schema: string
  name: string
  kind: string
  columns: CompletionColumn[]
}

export type CompletionSchema = {
  name: string
  relations: CompletionRelation[]
}

export type CompletionCatalog = {
  schemas: CompletionSchema[]
}

export type ResultView = 'data' | 'plan'
export type ContextMode = 'object' | 'query'
export type LeftPanelMode = 'database' | 'worksheets'
export type ToastTone = 'info' | 'success' | 'error'

export type QueryTabState = {
  id: string
  title: string
  sql: string
  revision: number
  editorState: PersistedEditorState
  question: string
  connectionId: string | null
  profileId: string | null
  result: QueryResult | null
  explain: ExplainResult | null
  resultView: ResultView
  error: string | null
  resultRevision: number | null
  resultSQLHash: string | null
  explainRevision: number | null
}
