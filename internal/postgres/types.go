package postgres

import "time"

type ConnectionInput struct {
	Name             string `json:"name"`
	Host             string `json:"host"`
	Port             int    `json:"port"`
	Database         string `json:"database"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	SSLMode          string `json:"sslMode"`
	ConnectTimeoutMS int    `json:"connectTimeoutMs"`
}

type ConnectionSummary struct {
	ID                 string `json:"id"`
	ProfileID          string `json:"profileId,omitempty"`
	Name               string `json:"name"`
	Host               string `json:"host"`
	Port               int    `json:"port"`
	Database           string `json:"database"`
	Username           string `json:"username"`
	ServerVersion      string `json:"serverVersion"`
	LatencyMS          int64  `json:"latencyMs"`
	ConnectedAt        string `json:"connectedAt"`
	ReadOnlyDefault    bool   `json:"readOnlyDefault"`
	CredentialStatus   string `json:"credentialStatus,omitempty"`
	PersistenceWarning string `json:"persistenceWarning,omitempty"`
}

type DatabaseSummary struct {
	Name             string `json:"name"`
	Owner            string `json:"owner"`
	SizeBytes        int64  `json:"sizeBytes"`
	AllowConnections bool   `json:"allowConnections"`
	IsTemplate       bool   `json:"isTemplate"`
	IsCurrent        bool   `json:"isCurrent"`
}

type SchemaSummary struct {
	Name          string `json:"name"`
	RelationCount int    `json:"relationCount"`
	SizeBytes     int64  `json:"sizeBytes"`
}

type RelationSummary struct {
	Schema        string  `json:"schema"`
	Name          string  `json:"name"`
	Kind          string  `json:"kind"`
	EstimatedRows float64 `json:"estimatedRows"`
	SizeBytes     int64   `json:"sizeBytes"`
	Description   string  `json:"description"`
	LastVacuum    *string `json:"lastVacuum,omitempty"`
}

type ColumnDetail struct {
	Name         string  `json:"name"`
	DataType     string  `json:"dataType"`
	Nullable     bool    `json:"nullable"`
	DefaultValue *string `json:"defaultValue,omitempty"`
	Description  string  `json:"description"`
	IsPrimaryKey bool    `json:"isPrimaryKey"`
}

type IndexDetail struct {
	Name       string   `json:"name"`
	Definition string   `json:"definition"`
	SizeBytes  int64    `json:"sizeBytes"`
	Scans      int64    `json:"scans"`
	Columns    []string `json:"columns"`
	IsUnique   bool     `json:"isUnique"`
	IsPrimary  bool     `json:"isPrimary"`
}

type RelationDetail struct {
	Relation RelationSummary `json:"relation"`
	Columns  []ColumnDetail  `json:"columns"`
	Indexes  []IndexDetail   `json:"indexes"`
}

type QueryInput struct {
	ConnectionID string `json:"connectionId"`
	DocumentID   string `json:"documentId,omitempty"`
	QueryID      string `json:"queryId,omitempty"`
	SQL          string `json:"sql"`
	MaxRows      int    `json:"maxRows"`
	TimeoutMS    int    `json:"timeoutMs"`
	ReadOnly     bool   `json:"readOnly"`
}

type CompletionColumn struct {
	Name     string `json:"name"`
	DataType string `json:"dataType"`
}

type CompletionRelation struct {
	Schema  string             `json:"schema"`
	Name    string             `json:"name"`
	Kind    string             `json:"kind"`
	Columns []CompletionColumn `json:"columns"`
}

type CompletionSchema struct {
	Name      string               `json:"name"`
	Relations []CompletionRelation `json:"relations"`
}

type CompletionCatalog struct {
	Schemas []CompletionSchema `json:"schemas"`
}

type ResultColumn struct {
	Name     string `json:"name"`
	DataType string `json:"dataType"`
}

type QueryResult struct {
	QueryID       string         `json:"queryId"`
	Columns       []ResultColumn `json:"columns"`
	Rows          [][]any        `json:"rows"`
	RowCount      int            `json:"rowCount"`
	AffectedRows  int64          `json:"affectedRows"`
	Command       string         `json:"command"`
	DurationMS    float64        `json:"durationMs"`
	Truncated     bool           `json:"truncated"`
	ExecutedAt    string         `json:"executedAt"`
	TransactionID string         `json:"transactionId,omitempty"`
}

type ExplainResult struct {
	QueryID    string  `json:"queryId"`
	Plan       any     `json:"plan"`
	DurationMS float64 `json:"durationMs"`
	ExecutedAt string  `json:"executedAt"`
}

func utcString(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
