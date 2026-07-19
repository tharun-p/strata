import type {
  CompletionCatalog,
  ConnectionInput,
  ConnectionProfile,
  ConnectionSummary,
  DatabaseSummary,
  ExplainResult,
  QueryInput,
  QueryResult,
  RelationDetail,
  RelationSummary,
  SchemaSummary,
  StartupStatus,
  Workbook,
  WorkbookPatch,
  WorkspaceSettings,
} from '../types'

type Backend = {
  Connect(input: ConnectionInput): Promise<ConnectionSummary>
  Disconnect(connectionId: string): Promise<void>
  ListConnections(): Promise<ConnectionSummary[]>
  ListConnectionProfiles(): Promise<ConnectionProfile[]>
  ImportConnectionProfiles(profiles: ConnectionProfile[]): Promise<void>
  ForgetProfileCredential(profileId: string): Promise<void>
  DeleteConnectionProfile(profileId: string): Promise<void>
  GetStartupStatus(): Promise<StartupStatus>
  LoadWorkspaceSettings(): Promise<WorkspaceSettings>
  SaveWorkspaceSettings(settings: WorkspaceSettings): Promise<void>
  LoadDefaultWorkbook(): Promise<Workbook>
  ListWorkbooks(): Promise<Workbook[]>
  GetWorkbook(id: string): Promise<Workbook>
  SaveWorkbook(workbook: Workbook, expectedRevision: number, checkpoint: boolean): Promise<Workbook>
  ApplyWorkbookPatch(patch: WorkbookPatch): Promise<Workbook>
  ListDatabases(connectionId: string): Promise<DatabaseSummary[]>
  EnsureDatabase(connectionId: string, databaseName: string): Promise<ConnectionSummary>
  ListSchemas(connectionId: string): Promise<SchemaSummary[]>
  ListRelations(connectionId: string, schema: string): Promise<RelationSummary[]>
  DescribeRelation(connectionId: string, schema: string, relation: string): Promise<RelationDetail>
  GetCompletionCatalog(connectionId: string): Promise<CompletionCatalog>
  ExecuteQuery(input: QueryInput): Promise<QueryResult>
  ExplainQuery(input: QueryInput): Promise<ExplainResult>
  CancelQuery(queryId: string): Promise<boolean>
  SetWindowCornerRadius(radius: number): Promise<void>
  ToggleWindowZoom(): Promise<void>
  WindowIsZoomed(): Promise<boolean>
  AllowWindowClose(): Promise<void>
}

declare global {
  interface Window {
    go?: { main?: { App?: Backend } }
  }
}

const bridge = () => window.go?.main?.App
const requiredBridge = () => {
  const backend = bridge()
  if (!backend) throw new Error('The Go desktop bridge is unavailable. Start Strata with `wails dev` or open the native app.')
  return backend
}

export const api = {
  async listConnections() {
    return requiredBridge().ListConnections()
  },

  async getStartupStatus() {
    return requiredBridge().GetStartupStatus()
  },

  async listConnectionProfiles() {
    return requiredBridge().ListConnectionProfiles()
  },

  async importConnectionProfiles(profiles: ConnectionProfile[]) {
    return requiredBridge().ImportConnectionProfiles(profiles)
  },

  async forgetProfileCredential(profileId: string) {
    return requiredBridge().ForgetProfileCredential(profileId)
  },

  async deleteConnectionProfile(profileId: string) {
    return requiredBridge().DeleteConnectionProfile(profileId)
  },

  async loadWorkspaceSettings() {
    return requiredBridge().LoadWorkspaceSettings()
  },

  async saveWorkspaceSettings(settings: WorkspaceSettings) {
    return requiredBridge().SaveWorkspaceSettings(settings)
  },

  async loadDefaultWorkbook() {
    return requiredBridge().LoadDefaultWorkbook()
  },

  async listWorkbooks() {
    return requiredBridge().ListWorkbooks()
  },

  async getWorkbook(id: string) {
    return requiredBridge().GetWorkbook(id)
  },

  async saveWorkbook(workbook: Workbook, expectedRevision: number, checkpoint = false) {
    return requiredBridge().SaveWorkbook(workbook, expectedRevision, checkpoint)
  },

  async applyWorkbookPatch(patch: WorkbookPatch) {
    return requiredBridge().ApplyWorkbookPatch(patch)
  },

  async connect(input: ConnectionInput) {
    return requiredBridge().Connect(input)
  },

  async disconnect(connectionId: string) {
    return requiredBridge().Disconnect(connectionId)
  },

  async listDatabases(connectionId: string) {
    return requiredBridge().ListDatabases(connectionId)
  },

  async ensureDatabase(connectionId: string, databaseName: string) {
    return requiredBridge().EnsureDatabase(connectionId, databaseName)
  },

  async listSchemas(connectionId: string) {
    return requiredBridge().ListSchemas(connectionId)
  },

  async listRelations(connectionId: string, schema: string) {
    return requiredBridge().ListRelations(connectionId, schema)
  },

  async describeRelation(connectionId: string, schema: string, relation: string) {
    return requiredBridge().DescribeRelation(connectionId, schema, relation)
  },

  async getCompletionCatalog(connectionId: string) {
    return requiredBridge().GetCompletionCatalog(connectionId)
  },

  async executeQuery(input: QueryInput) {
    return requiredBridge().ExecuteQuery(input)
  },

  async explainQuery(input: QueryInput) {
    return requiredBridge().ExplainQuery(input)
  },

  async cancelQuery(queryId: string) {
    return requiredBridge().CancelQuery(queryId)
  },

  async setWindowCornerRadius(radius: number) {
    const backend = bridge()
    if (!backend?.SetWindowCornerRadius) return
    await backend.SetWindowCornerRadius(radius)
  },

  async toggleWindowZoom() {
    const backend = bridge()
    if (!backend?.ToggleWindowZoom) return
    await backend.ToggleWindowZoom()
  },

  async windowIsZoomed() {
    const backend = bridge()
    if (!backend?.WindowIsZoomed) return false
    return backend.WindowIsZoomed()
  },

  async allowWindowClose() {
    const backend = bridge()
    if (!backend?.AllowWindowClose) return
    await backend.AllowWindowClose()
  },
}
