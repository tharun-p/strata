package persistence

import "time"

type ConnectionProfile struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Host             string `json:"host"`
	Port             int    `json:"port"`
	Database         string `json:"database"`
	Username         string `json:"username"`
	SSLMode          string `json:"sslMode"`
	ConnectTimeoutMS int    `json:"connectTimeoutMs"`
	Color            string `json:"color"`
	ReadOnlyDefault  bool   `json:"readOnlyDefault"`
	AutoConnect      bool   `json:"autoConnect"`
	PrivateMode      bool   `json:"privateMode"`
	CredentialStatus string `json:"credentialStatus"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
	LastConnectedAt  string `json:"lastConnectedAt,omitempty"`
}

type WorkspaceSettings struct {
	ExplorerWidth         int     `json:"explorerWidth"`
	ContextWidth          int     `json:"contextWidth"`
	ExplorerCollapsed     bool    `json:"explorerCollapsed"`
	ContextCollapsed      bool    `json:"contextCollapsed"`
	QueryPanePercent      float64 `json:"queryPanePercent"`
	MaxRows               int     `json:"maxRows"`
	ContextMode           string  `json:"contextMode"`
	LeftPanelMode         string  `json:"leftPanelMode"`
	EditorUndoDepth       int     `json:"editorUndoDepth"`
	InactiveEditorCacheMB int     `json:"inactiveEditorCacheMB"`
}

func DefaultWorkspaceSettings() WorkspaceSettings {
	return WorkspaceSettings{
		ExplorerWidth:         270,
		ContextWidth:          292,
		QueryPanePercent:      48,
		MaxRows:               1000,
		ContextMode:           "object",
		LeftPanelMode:         "database",
		EditorUndoDepth:       200,
		InactiveEditorCacheMB: 512,
	}
}

type PersistedEditorRange struct {
	Anchor int `json:"anchor"`
	Head   int `json:"head"`
}

type PersistedEditorFold struct {
	From int `json:"from"`
	To   int `json:"to"`
}

type PersistedEditorState struct {
	Selection  []PersistedEditorRange `json:"selection"`
	ScrollTop  float64                `json:"scrollTop"`
	ScrollLeft float64                `json:"scrollLeft"`
	Folds      []PersistedEditorFold  `json:"folds"`
}

type WorkbookDocumentContent struct {
	SQL         string                `json:"sql"`
	Question    string                `json:"question"`
	EditorState *PersistedEditorState `json:"editorState,omitempty"`
}

type WorkbookPatch struct {
	ID                string             `json:"id"`
	ExpectedRevision  int64              `json:"expectedRevision"`
	Title             *string            `json:"title,omitempty"`
	State             *string            `json:"state,omitempty"`
	Pinned            *bool              `json:"pinned,omitempty"`
	ActiveDocumentID  *string            `json:"activeDocumentId,omitempty"`
	UpsertDocuments   []WorkbookDocument `json:"upsertDocuments,omitempty"`
	DeleteDocumentIDs []string           `json:"deleteDocumentIds,omitempty"`
	DocumentOrder     []string           `json:"documentOrder,omitempty"`
	Checkpoint        bool               `json:"checkpoint"`
}

type WorkbookDocument struct {
	ID             string                  `json:"id"`
	Kind           string                  `json:"kind"`
	Title          string                  `json:"title"`
	Position       int                     `json:"position"`
	ProfileID      string                  `json:"profileId,omitempty"`
	Database       string                  `json:"database,omitempty"`
	ContentVersion int                     `json:"contentVersion"`
	Content        WorkbookDocumentContent `json:"content"`
}

type Workbook struct {
	ID               string             `json:"id"`
	Title            string             `json:"title"`
	State            string             `json:"state"`
	Pinned           bool               `json:"pinned"`
	Revision         int64              `json:"revision"`
	ActiveDocumentID string             `json:"activeDocumentId,omitempty"`
	CreatedAt        string             `json:"createdAt"`
	UpdatedAt        string             `json:"updatedAt"`
	DeletedAt        string             `json:"deletedAt,omitempty"`
	Documents        []WorkbookDocument `json:"documents"`
}

type QueryRun struct {
	ID            string  `json:"id"`
	DocumentID    string  `json:"documentId,omitempty"`
	ProfileID     string  `json:"profileId,omitempty"`
	Database      string  `json:"database,omitempty"`
	SQL           string  `json:"sql"`
	QueryHash     string  `json:"queryHash"`
	Status        string  `json:"status"`
	Command       string  `json:"command,omitempty"`
	DurationMS    float64 `json:"durationMs"`
	RowCount      int     `json:"rowCount"`
	Truncated     bool    `json:"truncated"`
	ErrorCategory string  `json:"errorCategory,omitempty"`
	ExecutedAt    string  `json:"executedAt"`
}

func utcNow() string { return time.Now().UTC().Format(time.RFC3339Nano) }
