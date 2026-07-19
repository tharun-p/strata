package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dbexplorer/strata/internal/credentials"
	"github.com/dbexplorer/strata/internal/persistence"
	"github.com/dbexplorer/strata/internal/postgres"
)

// App is the narrow desktop bridge. Product logic lives in internal packages so
// the same services can later be exposed over HTTP and MCP without depending on
// the desktop shell.
type App struct {
	service            *postgres.Service
	store              *persistence.Store
	secrets            credentials.Store
	dataDir            string
	startupStatus      StartupStatus
	connectionProfiles map[string]string
	allowWindowClose   bool
	mu                 sync.RWMutex
}

func (a *App) AllowWindowClose() {
	a.mu.Lock()
	a.allowWindowClose = true
	a.mu.Unlock()
}

func (a *App) preventWindowClose() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.allowWindowClose {
		a.allowWindowClose = false
		return false
	}
	return true
}

type StartupStatus struct {
	AutoConnectAttempted bool   `json:"autoConnectAttempted"`
	Connected            bool   `json:"connected"`
	Error                string `json:"error,omitempty"`
	PersistenceReady     bool   `json:"persistenceReady"`
	PersistenceError     string `json:"persistenceError,omitempty"`
}

func NewApp() *App {
	return newApp(defaultDataDir(), credentials.NewOSStore("com.strata.database-studio"))
}

func newApp(dataDir string, secretStore credentials.Store) *App {
	return &App{
		service:            postgres.NewService(),
		secrets:            secretStore,
		dataDir:            dataDir,
		connectionProfiles: make(map[string]string),
	}
}

func defaultDataDir() string {
	if configured := strings.TrimSpace(os.Getenv("STRATA_DATA_DIR")); configured != "" {
		return configured
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "Strata")
	}
	return filepath.Join(root, "Strata")
}

func (a *App) startup(ctx context.Context) {
	a.service.Start(ctx)
	store, err := persistence.Open(filepath.Join(a.dataDir, "strata.db"))
	if err != nil {
		a.startupStatus.PersistenceError = err.Error()
	} else {
		a.store = store
		a.startupStatus.PersistenceReady = true
		if err := store.PruneQueryHistory(ctx, 90*24*time.Hour, 10000); err != nil {
			a.startupStatus.PersistenceError = "query history cleanup failed: " + err.Error()
		}
	}
	// Apply after the native window exists.
	go func() {
		time.Sleep(120 * time.Millisecond)
		applyMacRoundedWindow(14)
	}()
	if startupAutoConnectEnabled() {
		a.startupStatus.AutoConnectAttempted = true
		input, err := startupConnectionInput()
		if err == nil {
			_, err = a.service.Connect(input)
		}
		if err != nil {
			a.startupStatus.Error = err.Error()
			return
		}
		a.startupStatus.Connected = true
		return
	}
	if a.store != nil {
		profiles, err := a.store.ListConnectionProfiles(ctx)
		if err != nil {
			a.startupStatus.PersistenceError = err.Error()
			return
		}
		for _, profile := range profiles {
			if !profile.AutoConnect {
				continue
			}
			a.startupStatus.AutoConnectAttempted = true
			if _, err := a.Connect(ConnectionRequest{ProfileID: profile.ID, RememberPassword: true}); err != nil {
				a.startupStatus.Error = err.Error()
				continue
			}
			a.startupStatus.Connected = true
		}
	}
}

func startupAutoConnectEnabled() bool {
	value := strings.TrimSpace(os.Getenv("STRATA_AUTO_CONNECT"))
	return strings.EqualFold(value, "true") || value == "1"
}

// SetWindowCornerRadius clips the content view to a continuous rounded rect.
// Call once at startup — not on every zoom/resize.
func (a *App) SetWindowCornerRadius(radius float64) {
	if radius < 0 {
		radius = 0
	}
	if radius > 32 {
		radius = 32
	}
	applyMacRoundedWindow(radius)
}

// ToggleWindowZoom uses NSWindow's native zoom: (same as a standard macOS
// title-bar double-click / zoom button).
func (a *App) ToggleWindowZoom() {
	toggleMacZoomWindow()
}

// WindowIsZoomed reports NSWindow.isZoomed.
func (a *App) WindowIsZoomed() bool {
	return macWindowIsZoomed()
}

func (a *App) shutdown(_ context.Context) {
	a.service.Close()
	if a.store != nil {
		_ = a.store.Close()
	}
}

type ConnectionRequest struct {
	ProfileID        string `json:"profileId,omitempty"`
	Name             string `json:"name"`
	Host             string `json:"host"`
	Port             int    `json:"port"`
	Database         string `json:"database"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	SSLMode          string `json:"sslMode"`
	ConnectTimeoutMS int    `json:"connectTimeoutMs"`
	Color            string `json:"color,omitempty"`
	RememberPassword bool   `json:"rememberPassword"`
	PrivateMode      bool   `json:"privateMode"`
	AutoConnect      bool   `json:"autoConnect"`
}

func (a *App) Connect(request ConnectionRequest) (*postgres.ConnectionSummary, error) {
	if request.ProfileID != "" {
		if a.store == nil {
			return nil, errors.New("saved connection profiles are unavailable because local persistence did not start")
		}
		profile, err := a.store.GetConnectionProfile(context.Background(), request.ProfileID)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(request.Host) == "" {
			request.Name = profile.Name
			request.Host = profile.Host
			request.Port = profile.Port
			request.Database = profile.Database
			request.Username = profile.Username
			request.SSLMode = profile.SSLMode
			request.ConnectTimeoutMS = profile.ConnectTimeoutMS
			request.Color = profile.Color
			request.PrivateMode = profile.PrivateMode
			request.AutoConnect = profile.AutoConnect
		}
		if request.Password == "" && profile.CredentialStatus == "available" {
			request.Password, err = a.secrets.Get(profile.ID, credentials.DatabasePasswordPurpose())
			if err != nil {
				if errors.Is(err, credentials.ErrNotFound) {
					_ = a.store.RemoveSecretBinding(context.Background(), profile.ID, credentials.DatabasePasswordPurpose())
					return nil, errors.New("the saved password is missing; enter it again to reconnect")
				}
				return nil, err
			}
		}
	}

	summary, err := a.service.Connect(postgres.ConnectionInput{
		Name: request.Name, Host: request.Host, Port: request.Port, Database: request.Database,
		Username: request.Username, Password: request.Password, SSLMode: request.SSLMode,
		ConnectTimeoutMS: request.ConnectTimeoutMS,
	})
	if err != nil {
		return nil, err
	}
	if a.store == nil {
		summary.PersistenceWarning = "Connected for this session, but local persistence is unavailable."
		return summary, nil
	}

	profile, saveErr := a.store.SaveConnectionProfile(context.Background(), persistence.ConnectionProfile{
		ID: request.ProfileID, Name: request.Name, Host: request.Host, Port: request.Port,
		Database: request.Database, Username: request.Username, SSLMode: request.SSLMode,
		ConnectTimeoutMS: request.ConnectTimeoutMS, Color: request.Color, ReadOnlyDefault: true,
		AutoConnect: request.AutoConnect, PrivateMode: request.PrivateMode,
	})
	if saveErr != nil {
		summary.PersistenceWarning = "Connected, but the profile could not be saved: " + saveErr.Error()
		return summary, nil
	}
	summary.ProfileID = profile.ID
	a.mu.Lock()
	a.connectionProfiles[summary.ID] = profile.ID
	a.mu.Unlock()
	_ = a.store.MarkProfileConnected(context.Background(), profile.ID)

	if request.RememberPassword && request.Password != "" {
		if err := a.secrets.Set(profile.ID, credentials.DatabasePasswordPurpose(), request.Password); err != nil {
			summary.CredentialStatus = "session-only"
			summary.PersistenceWarning = "Connected and saved the profile, but the password could not be stored securely: " + err.Error()
		} else if err := a.store.SetSecretBinding(context.Background(), profile.ID, credentials.DatabasePasswordPurpose(), "os-keyring", "available"); err != nil {
			_ = a.secrets.Delete(profile.ID, credentials.DatabasePasswordPurpose())
			summary.CredentialStatus = "session-only"
			summary.PersistenceWarning = "Connected, but the credential reference could not be saved: " + err.Error()
		} else {
			summary.CredentialStatus = "available"
		}
	} else if !request.RememberPassword && request.ProfileID != "" {
		if err := a.secrets.Delete(profile.ID, credentials.DatabasePasswordPurpose()); err != nil {
			summary.PersistenceWarning = "Connected, but the previous saved password could not be removed: " + err.Error()
		} else {
			_ = a.store.RemoveSecretBinding(context.Background(), profile.ID, credentials.DatabasePasswordPurpose())
			summary.CredentialStatus = "session-only"
		}
	}
	return summary, nil
}

func (a *App) Disconnect(connectionID string) error {
	err := a.service.Disconnect(connectionID)
	if err == nil {
		a.mu.Lock()
		delete(a.connectionProfiles, connectionID)
		a.mu.Unlock()
	}
	return err
}

func (a *App) ListConnections() []postgres.ConnectionSummary {
	connections := a.service.ListConnections()
	a.mu.RLock()
	defer a.mu.RUnlock()
	for index := range connections {
		connections[index].ProfileID = a.connectionProfiles[connections[index].ID]
	}
	return connections
}

func (a *App) ListDatabases(connectionID string) ([]postgres.DatabaseSummary, error) {
	return a.service.ListDatabases(connectionID)
}

func (a *App) EnsureDatabase(connectionID, databaseName string) (*postgres.ConnectionSummary, error) {
	summary, err := a.service.EnsureDatabase(connectionID, databaseName)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	profileID := a.connectionProfiles[connectionID]
	a.connectionProfiles[summary.ID] = profileID
	a.mu.Unlock()
	summary.ProfileID = profileID
	return summary, nil
}

func (a *App) GetStartupStatus() StartupStatus {
	return a.startupStatus
}

func (a *App) ListSchemas(connectionID string) ([]postgres.SchemaSummary, error) {
	return a.service.ListSchemas(connectionID)
}

func (a *App) ListRelations(connectionID, schema string) ([]postgres.RelationSummary, error) {
	return a.service.ListRelations(connectionID, schema)
}

func (a *App) DescribeRelation(connectionID, schema, relation string) (*postgres.RelationDetail, error) {
	return a.service.DescribeRelation(connectionID, schema, relation)
}

func (a *App) ExecuteQuery(input postgres.QueryInput) (*postgres.QueryResult, error) {
	result, err := a.service.ExecuteQuery(input)
	a.recordQueryRun(input, result, err)
	return result, err
}

func (a *App) ExplainQuery(input postgres.QueryInput) (*postgres.ExplainResult, error) {
	return a.service.ExplainQuery(input)
}

func (a *App) CancelQuery(queryID string) bool {
	return a.service.CancelQuery(queryID)
}

func (a *App) GetCompletionCatalog(connectionID string) (*postgres.CompletionCatalog, error) {
	return a.service.GetCompletionCatalog(connectionID)
}

func (a *App) ListConnectionProfiles() ([]persistence.ConnectionProfile, error) {
	if a.store == nil {
		return []persistence.ConnectionProfile{}, errors.New("local persistence is unavailable")
	}
	return a.store.ListConnectionProfiles(context.Background())
}

func (a *App) ImportConnectionProfiles(profiles []persistence.ConnectionProfile) error {
	if a.store == nil {
		return errors.New("local persistence is unavailable")
	}
	return a.store.ImportConnectionProfiles(context.Background(), profiles)
}

func (a *App) ForgetProfileCredential(profileID string) error {
	if a.store == nil {
		return errors.New("local persistence is unavailable")
	}
	if err := a.secrets.Delete(profileID, credentials.DatabasePasswordPurpose()); err != nil {
		return err
	}
	return a.store.RemoveSecretBinding(context.Background(), profileID, credentials.DatabasePasswordPurpose())
}

func (a *App) DeleteConnectionProfile(profileID string) error {
	if a.store == nil {
		return errors.New("local persistence is unavailable")
	}
	if err := a.secrets.Delete(profileID, credentials.DatabasePasswordPurpose()); err != nil {
		return err
	}
	if err := a.store.RemoveSecretBinding(context.Background(), profileID, credentials.DatabasePasswordPurpose()); err != nil {
		return err
	}
	return a.store.DeleteConnectionProfile(context.Background(), profileID)
}

func (a *App) LoadWorkspaceSettings() (persistence.WorkspaceSettings, error) {
	if a.store == nil {
		return persistence.DefaultWorkspaceSettings(), errors.New("local persistence is unavailable")
	}
	return a.store.LoadWorkspaceSettings(context.Background())
}

func (a *App) SaveWorkspaceSettings(settings persistence.WorkspaceSettings) error {
	if a.store == nil {
		return errors.New("local persistence is unavailable")
	}
	return a.store.SaveWorkspaceSettings(context.Background(), settings)
}

func (a *App) LoadDefaultWorkbook() (*persistence.Workbook, error) {
	if a.store == nil {
		return nil, errors.New("local persistence is unavailable")
	}
	return a.store.LoadDefaultWorkbook(context.Background())
}

func (a *App) ListWorkbooks() ([]persistence.Workbook, error) {
	if a.store == nil {
		return []persistence.Workbook{}, errors.New("local persistence is unavailable")
	}
	return a.store.ListWorkbooks(context.Background())
}

func (a *App) GetWorkbook(id string) (*persistence.Workbook, error) {
	if a.store == nil {
		return nil, errors.New("local persistence is unavailable")
	}
	return a.store.GetWorkbook(context.Background(), id)
}

func (a *App) SaveWorkbook(workbook persistence.Workbook, expectedRevision int64, checkpoint bool) (*persistence.Workbook, error) {
	if a.store == nil {
		return nil, errors.New("local persistence is unavailable")
	}
	return a.store.SaveWorkbook(context.Background(), workbook, expectedRevision, checkpoint)
}

func (a *App) ApplyWorkbookPatch(patch persistence.WorkbookPatch) (*persistence.Workbook, error) {
	if a.store == nil {
		return nil, errors.New("persistence is unavailable")
	}
	return a.store.ApplyWorkbookPatch(context.Background(), patch)
}

func (a *App) recordQueryRun(input postgres.QueryInput, result *postgres.QueryResult, queryErr error) {
	if a.store == nil {
		return
	}
	a.mu.RLock()
	profileID := a.connectionProfiles[input.ConnectionID]
	a.mu.RUnlock()
	if profileID == "" {
		return
	}
	profile, err := a.store.GetConnectionProfile(context.Background(), profileID)
	if err != nil || profile.PrivateMode {
		return
	}
	hash := sha256.Sum256([]byte(input.SQL))
	run := persistence.QueryRun{
		DocumentID: input.DocumentID, ProfileID: profileID, Database: profile.Database,
		SQL: input.SQL, QueryHash: hex.EncodeToString(hash[:]), Status: "failed", ExecutedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if result != nil {
		run.Status = "succeeded"
		run.Command = result.Command
		run.DurationMS = result.DurationMS
		run.RowCount = result.RowCount
		run.Truncated = result.Truncated
	}
	if queryErr != nil {
		run.ErrorCategory = queryErrorCategory(queryErr)
	}
	_ = a.store.RecordQueryRun(context.Background(), run)
}

func queryErrorCategory(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "cancel"):
		return "cancelled"
	case strings.Contains(message, "timeout") || strings.Contains(message, "deadline"):
		return "timeout"
	case strings.Contains(message, "permission") || strings.Contains(message, "read-only"):
		return "permission"
	case strings.Contains(message, "syntax"):
		return "syntax"
	default:
		return "database"
	}
}

func startupConnectionInput() (postgres.ConnectionInput, error) {
	host := strings.TrimSpace(os.Getenv("STRATA_PG_HOST"))
	if host == "" {
		return postgres.ConnectionInput{}, fmt.Errorf("STRATA_PG_HOST is required when STRATA_AUTO_CONNECT is enabled")
	}
	database := strings.TrimSpace(os.Getenv("STRATA_PG_DATABASE"))
	if database == "" {
		return postgres.ConnectionInput{}, fmt.Errorf("STRATA_PG_DATABASE is required when STRATA_AUTO_CONNECT is enabled")
	}
	username := strings.TrimSpace(os.Getenv("STRATA_PG_USERNAME"))
	if username == "" {
		return postgres.ConnectionInput{}, fmt.Errorf("STRATA_PG_USERNAME is required when STRATA_AUTO_CONNECT is enabled")
	}

	port := 5432
	if configured := strings.TrimSpace(os.Getenv("STRATA_PG_PORT")); configured != "" {
		parsed, err := strconv.Atoi(configured)
		if err != nil {
			return postgres.ConnectionInput{}, fmt.Errorf("invalid STRATA_PG_PORT: %w", err)
		}
		port = parsed
	}
	return postgres.ConnectionInput{
		Name:             envOrDefault("STRATA_PG_NAME", database),
		Host:             host,
		Port:             port,
		Database:         database,
		Username:         username,
		Password:         os.Getenv("STRATA_PG_PASSWORD"),
		SSLMode:          envOrDefault("STRATA_PG_SSLMODE", "prefer"),
		ConnectTimeoutMS: 10000,
	}, nil
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
