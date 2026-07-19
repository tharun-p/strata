package persistence

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var ErrRevisionConflict = errors.New("workbook was changed by another session")

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("persistence path is required")
	}
	memory := strings.HasPrefix(path, ":memory:") || strings.HasPrefix(path, "file::memory:")
	if !memory {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create Strata data directory: %w", err)
		}
	}
	dsn := path
	if !memory {
		dsn = (&url.URL{Scheme: "file", Path: path}).String()
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open local workspace database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.configure(context.Background(), memory); err != nil {
		db.Close()
		return nil, err
	}
	if err := store.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	if !memory {
		if err := os.Chmod(path, 0o600); err != nil {
			db.Close()
			return nil, fmt.Errorf("secure local workspace database: %w", err)
		}
	}
	return store, nil
}

func (s *Store) configure(ctx context.Context, memory bool) error {
	pragmas := []string{"PRAGMA foreign_keys = ON", "PRAGMA busy_timeout = 5000", "PRAGMA synchronous = NORMAL"}
	if !memory {
		pragmas = append(pragmas, "PRAGMA journal_mode = WAL")
	}
	for _, statement := range pragmas {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("configure local workspace database: %w", err)
		}
	}
	return nil
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
    )`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	for index, migration := range migrations {
		version := index + 1
		var exists int
		if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", version).Scan(&exists); err != nil {
			return fmt.Errorf("read migration ledger: %w", err)
		}
		if exists != 0 {
			continue
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin persistence migration: %w", err)
		}
		if _, err = tx.ExecContext(ctx, migration); err == nil {
			_, err = tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", version, utcNow())
		}
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("apply persistence migration %d: %w", version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit persistence migration %d: %w", version, err)
		}
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

func newID(prefix string) string {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(raw)
}

func (s *Store) SaveConnectionProfile(ctx context.Context, profile ConnectionProfile) (*ConnectionProfile, error) {
	profile.Host = strings.TrimSpace(profile.Host)
	profile.Database = strings.TrimSpace(profile.Database)
	profile.Username = strings.TrimSpace(profile.Username)
	profile.Name = strings.TrimSpace(profile.Name)
	if profile.Host == "" || profile.Database == "" || profile.Username == "" {
		return nil, errors.New("host, database, and username are required")
	}
	if profile.Port < 1 || profile.Port > 65535 {
		return nil, errors.New("port must be between 1 and 65535")
	}
	if profile.ID == "" {
		profile.ID = newID("profile")
	}
	if profile.Name == "" {
		profile.Name = profile.Database
	}
	if profile.SSLMode == "" {
		profile.SSLMode = "prefer"
	}
	if profile.ConnectTimeoutMS <= 0 {
		profile.ConnectTimeoutMS = 10000
	}
	if profile.Color == "" {
		profile.Color = s.nextProfileColor(ctx)
	}
	now := utcNow()
	if profile.CreatedAt == "" {
		profile.CreatedAt = now
	}
	profile.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `INSERT INTO connection_profiles(
        id, name, host, port, database_name, username, ssl_mode, connect_timeout_ms,
        color, read_only_default, auto_connect, private_mode, created_at, updated_at, last_connected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''))
    ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, host=excluded.host, port=excluded.port,
        database_name=excluded.database_name, username=excluded.username,
        ssl_mode=excluded.ssl_mode, connect_timeout_ms=excluded.connect_timeout_ms,
        color=excluded.color, read_only_default=excluded.read_only_default,
        auto_connect=excluded.auto_connect, private_mode=excluded.private_mode,
        updated_at=excluded.updated_at`,
		profile.ID, profile.Name, profile.Host, profile.Port, profile.Database, profile.Username,
		profile.SSLMode, profile.ConnectTimeoutMS, profile.Color, boolInt(profile.ReadOnlyDefault),
		boolInt(profile.AutoConnect), boolInt(profile.PrivateMode), profile.CreatedAt, profile.UpdatedAt,
		profile.LastConnectedAt)
	if err != nil {
		return nil, fmt.Errorf("save connection profile: %w", err)
	}
	return s.GetConnectionProfile(ctx, profile.ID)
}

func (s *Store) nextProfileColor(ctx context.Context) string {
	colors := []string{"#6955ee", "#18a77c", "#2563eb", "#d45b64", "#a77413", "#db2777", "#0f766e", "#7c3aed"}
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM connection_profiles WHERE 1=1").Scan(&count); err != nil {
		return colors[0]
	}
	return colors[count%len(colors)]
}

func (s *Store) GetConnectionProfile(ctx context.Context, id string) (*ConnectionProfile, error) {
	row := s.db.QueryRowContext(ctx, profileSelect+" WHERE p.id = ?", id)
	profile, err := scanProfile(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("connection profile %q was not found", id)
	}
	return profile, err
}

func (s *Store) ListConnectionProfiles(ctx context.Context) ([]ConnectionProfile, error) {
	rows, err := s.db.QueryContext(ctx, profileSelect+" ORDER BY COALESCE(p.last_connected_at, p.created_at) DESC")
	if err != nil {
		return nil, fmt.Errorf("list connection profiles: %w", err)
	}
	defer rows.Close()
	profiles := make([]ConnectionProfile, 0)
	for rows.Next() {
		profile, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, *profile)
	}
	return profiles, rows.Err()
}

func (s *Store) ImportConnectionProfiles(ctx context.Context, profiles []ConnectionProfile) error {
	if len(profiles) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	colors := []string{"#6955ee", "#18a77c", "#2563eb", "#d45b64", "#a77413", "#db2777", "#0f766e", "#7c3aed"}
	now := utcNow()
	for index, profile := range profiles {
		profile.Host = strings.TrimSpace(profile.Host)
		profile.Database = strings.TrimSpace(profile.Database)
		profile.Username = strings.TrimSpace(profile.Username)
		if profile.Host == "" || profile.Database == "" || profile.Username == "" {
			return errors.New("legacy connection profile is missing host, database, or username")
		}
		var existingID string
		err := tx.QueryRowContext(ctx, `SELECT id FROM connection_profiles
            WHERE host=? AND port=? AND database_name=? AND username=? ORDER BY created_at LIMIT 1`,
			profile.Host, profile.Port, profile.Database, profile.Username).Scan(&existingID)
		if err == nil {
			profile.ID = existingID
		} else if errors.Is(err, sql.ErrNoRows) && profile.ID == "" {
			profile.ID = newID("profile")
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("match legacy connection profile: %w", err)
		}
		if profile.Name == "" {
			profile.Name = profile.Database
		}
		if profile.Port <= 0 {
			profile.Port = 5432
		}
		if profile.SSLMode == "" {
			profile.SSLMode = "prefer"
		}
		if profile.ConnectTimeoutMS <= 0 {
			profile.ConnectTimeoutMS = 10000
		}
		if profile.Color == "" {
			profile.Color = colors[index%len(colors)]
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO connection_profiles(
            id, name, host, port, database_name, username, ssl_mode, connect_timeout_ms,
            color, read_only_default, auto_connect, private_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, ssl_mode=excluded.ssl_mode,
            connect_timeout_ms=excluded.connect_timeout_ms, color=excluded.color,
            updated_at=excluded.updated_at`, profile.ID, profile.Name, profile.Host, profile.Port,
			profile.Database, profile.Username, profile.SSLMode, profile.ConnectTimeoutMS,
			profile.Color, boolInt(profile.ReadOnlyDefault), boolInt(profile.AutoConnect),
			boolInt(profile.PrivateMode), now, now)
		if err != nil {
			return fmt.Errorf("import legacy connection profile: %w", err)
		}
	}
	return tx.Commit()
}

const profileSelect = `SELECT p.id, p.name, p.host, p.port, p.database_name, p.username,
    p.ssl_mode, p.connect_timeout_ms, p.color, p.read_only_default, p.auto_connect,
    p.private_mode, p.created_at, p.updated_at, COALESCE(p.last_connected_at, ''),
    COALESCE(b.status, 'missing')
    FROM connection_profiles p
    LEFT JOIN secret_bindings b ON b.owner_type='connection_profile'
      AND b.owner_id=p.id AND b.purpose='database_password'`

type rowScanner interface{ Scan(...any) error }

func scanProfile(row rowScanner) (*ConnectionProfile, error) {
	var profile ConnectionProfile
	var readOnly, autoConnect, privateMode int
	if err := row.Scan(&profile.ID, &profile.Name, &profile.Host, &profile.Port, &profile.Database,
		&profile.Username, &profile.SSLMode, &profile.ConnectTimeoutMS, &profile.Color,
		&readOnly, &autoConnect, &privateMode, &profile.CreatedAt, &profile.UpdatedAt,
		&profile.LastConnectedAt, &profile.CredentialStatus); err != nil {
		return nil, err
	}
	profile.ReadOnlyDefault = readOnly != 0
	profile.AutoConnect = autoConnect != 0
	profile.PrivateMode = privateMode != 0
	return &profile, nil
}

func (s *Store) MarkProfileConnected(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE connection_profiles SET last_connected_at=?, updated_at=? WHERE id=?", utcNow(), utcNow(), id)
	return err
}

func (s *Store) SetSecretBinding(ctx context.Context, ownerID, purpose, provider, status string) error {
	now := utcNow()
	_, err := s.db.ExecContext(ctx, `INSERT INTO secret_bindings(owner_type, owner_id, purpose, provider, opaque_key, status, created_at, updated_at)
        VALUES ('connection_profile', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_type, owner_id, purpose) DO UPDATE SET
          provider=excluded.provider, opaque_key=excluded.opaque_key, status=excluded.status, updated_at=excluded.updated_at`,
		ownerID, purpose, provider, ownerID+":"+purpose, status, now, now)
	return err
}

func (s *Store) RemoveSecretBinding(ctx context.Context, ownerID, purpose string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM secret_bindings WHERE owner_type='connection_profile' AND owner_id=? AND purpose=?", ownerID, purpose)
	return err
}

func (s *Store) DeleteConnectionProfile(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM secret_bindings WHERE owner_type='connection_profile' AND owner_id=?", id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM connection_profiles WHERE id=?", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) LoadWorkspaceSettings(ctx context.Context) (WorkspaceSettings, error) {
	settings := DefaultWorkspaceSettings()
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT value_json FROM settings
        WHERE scope='global' AND scope_id='' AND namespace='workspace' AND key='layout'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return settings, fmt.Errorf("load workspace settings: %w", err)
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return DefaultWorkspaceSettings(), fmt.Errorf("decode workspace settings: %w", err)
	}
	return settings, nil
}

func (s *Store) SaveWorkspaceSettings(ctx context.Context, settings WorkspaceSettings) error {
	if settings.ExplorerWidth < 220 || settings.ExplorerWidth > 460 || settings.ContextWidth < 220 || settings.ContextWidth > 420 {
		return errors.New("panel width is outside the supported range")
	}
	if settings.QueryPanePercent < 30 || settings.QueryPanePercent > 68 {
		return errors.New("query pane percentage is outside the supported range")
	}
	if settings.MaxRows != 100 && settings.MaxRows != 1000 && settings.MaxRows != 5000 && settings.MaxRows != 10000 {
		return errors.New("unsupported result row limit")
	}
	if settings.ContextMode != "object" && settings.ContextMode != "query" {
		return errors.New("unsupported context mode")
	}
	if settings.LeftPanelMode != "database" && settings.LeftPanelMode != "worksheets" {
		return errors.New("unsupported left panel mode")
	}
	if settings.EditorUndoDepth < 20 || settings.EditorUndoDepth > 2000 {
		return errors.New("editor Undo depth is outside the supported range")
	}
	if settings.InactiveEditorCacheMB < 128 || settings.InactiveEditorCacheMB > 4096 {
		return errors.New("inactive editor cache is outside the supported range")
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO settings(scope, scope_id, namespace, key, value_json, value_version, updated_at)
        VALUES ('global', '', 'workspace', 'layout', ?, 1, ?)
        ON CONFLICT(scope, scope_id, namespace, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`, string(raw), utcNow())
	return err
}

func (s *Store) LoadDefaultWorkbook(ctx context.Context) (*Workbook, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM workbooks WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC LIMIT 1`).Scan(&id)
	if err == nil {
		return s.GetWorkbook(ctx, id)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("find default workbook: %w", err)
	}
	workbook := Workbook{
		Title: "Workspace",
		State: "draft",
		Documents: []WorkbookDocument{{
			Kind: "sql", Title: "Untitled query", Position: 0, ContentVersion: 2,
		}},
	}
	return s.SaveWorkbook(ctx, workbook, 0, false)
}

func (s *Store) ListWorkbooks(ctx context.Context) ([]Workbook, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM workbooks WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	workbooks := make([]Workbook, 0, len(ids))
	for _, id := range ids {
		workbook, err := s.GetWorkbook(ctx, id)
		if err != nil {
			return nil, err
		}
		workbooks = append(workbooks, *workbook)
	}
	return workbooks, nil
}

func (s *Store) GetWorkbook(ctx context.Context, id string) (*Workbook, error) {
	var workbook Workbook
	var pinned int
	err := s.db.QueryRowContext(ctx, `SELECT id, title, state, pinned, revision,
        COALESCE(active_document_id, ''), created_at, updated_at, COALESCE(deleted_at, '')
        FROM workbooks WHERE id=?`, id).Scan(&workbook.ID, &workbook.Title, &workbook.State,
		&pinned, &workbook.Revision, &workbook.ActiveDocumentID, &workbook.CreatedAt, &workbook.UpdatedAt, &workbook.DeletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("workbook %q was not found", id)
	}
	if err != nil {
		return nil, err
	}
	workbook.Pinned = pinned != 0
	rows, err := s.db.QueryContext(ctx, `SELECT id, kind, title, position, COALESCE(profile_id, ''),
        COALESCE(database_name, ''), content_json, content_version
        FROM workbook_documents WHERE workbook_id=? ORDER BY position`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	workbook.Documents = make([]WorkbookDocument, 0)
	for rows.Next() {
		var document WorkbookDocument
		var content string
		if err := rows.Scan(&document.ID, &document.Kind, &document.Title, &document.Position,
			&document.ProfileID, &document.Database, &content, &document.ContentVersion); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(content), &document.Content); err != nil {
			return nil, err
		}
		workbook.Documents = append(workbook.Documents, document)
	}
	return &workbook, rows.Err()
}

func (s *Store) SaveWorkbook(ctx context.Context, workbook Workbook, expectedRevision int64, checkpoint bool) (*Workbook, error) {
	if workbook.ID == "" {
		workbook.ID = newID("workbook")
	}
	if workbook.Title == "" {
		workbook.Title = "Untitled workbook"
	}
	if workbook.State == "" {
		workbook.State = "draft"
	}
	now := utcNow()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var currentRevision int64
	var createdAt string
	err = tx.QueryRowContext(ctx, "SELECT revision, created_at FROM workbooks WHERE id=?", workbook.ID).Scan(&currentRevision, &createdAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil && expectedRevision > 0 && expectedRevision != currentRevision {
		return nil, ErrRevisionConflict
	}
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
		createdAt = now
	}
	nextRevision := currentRevision + 1
	_, err = tx.ExecContext(ctx, `INSERT INTO workbooks(id, title, state, pinned, revision, active_document_id, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, NULLIF(?, ''))
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, state=excluded.state, pinned=excluded.pinned,
          revision=excluded.revision, active_document_id=excluded.active_document_id,
          updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`, workbook.ID, workbook.Title, workbook.State,
		boolInt(workbook.Pinned), nextRevision, workbook.ActiveDocumentID, createdAt, now, workbook.DeletedAt)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM workbook_documents WHERE workbook_id=?", workbook.ID); err != nil {
		return nil, err
	}
	for position, document := range workbook.Documents {
		if document.ID == "" {
			document.ID = newID("document")
		}
		if document.Kind == "" {
			document.Kind = "sql"
		}
		if document.Title == "" {
			document.Title = "Untitled query"
		}
		if document.ContentVersion <= 0 {
			document.ContentVersion = 2
		}
		document.Position = position
		if document.ProfileID != "" {
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM connection_profiles WHERE id=?", document.ProfileID).Scan(&exists); err != nil {
				return nil, err
			}
			if exists == 0 {
				document.ProfileID = ""
			}
		}
		content, err := json.Marshal(document.Content)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO workbook_documents(id, workbook_id, kind, title, position, profile_id,
            database_name, content_json, content_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?)`, document.ID, workbook.ID,
			document.Kind, document.Title, document.Position, document.ProfileID, document.Database, string(content),
			document.ContentVersion, now, now)
		if err != nil {
			return nil, err
		}
	}
	if checkpoint {
		snapshot, err := json.Marshal(workbook)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO workbook_revisions(id, workbook_id, revision, snapshot_json, created_at)
            VALUES (?, ?, ?, ?, ?)`, newID("revision"), workbook.ID, nextRevision, string(snapshot), now)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM workbook_revisions WHERE id IN (
            SELECT id FROM workbook_revisions WHERE workbook_id=? ORDER BY revision DESC LIMIT -1 OFFSET 20
        )`, workbook.ID)
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetWorkbook(ctx, workbook.ID)
}

// ApplyWorkbookPatch updates only dirty workbook documents. It intentionally
// leaves untouched document rows in place so autosave cost is proportional to
// the user's edit, not the number or size of open worksheets.
func (s *Store) ApplyWorkbookPatch(ctx context.Context, patch WorkbookPatch) (*Workbook, error) {
	if patch.ID == "" {
		return nil, errors.New("workbook id is required")
	}
	current, err := s.GetWorkbook(ctx, patch.ID)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var currentRevision int64
	if err := tx.QueryRowContext(ctx, "SELECT revision FROM workbooks WHERE id=?", patch.ID).Scan(&currentRevision); err != nil {
		return nil, err
	}
	if currentRevision != patch.ExpectedRevision {
		return nil, ErrRevisionConflict
	}
	if patch.Title != nil && strings.TrimSpace(*patch.Title) != "" {
		current.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.State != nil {
		current.State = *patch.State
	}
	if patch.Pinned != nil {
		current.Pinned = *patch.Pinned
	}
	if patch.ActiveDocumentID != nil {
		current.ActiveDocumentID = *patch.ActiveDocumentID
	}
	now := utcNow()
	nextRevision := currentRevision + 1
	_, err = tx.ExecContext(ctx, `UPDATE workbooks SET title=?, state=?, pinned=?, revision=?,
        active_document_id=NULLIF(?, ''), updated_at=? WHERE id=?`, current.Title, current.State,
		boolInt(current.Pinned), nextRevision, current.ActiveDocumentID, now, patch.ID)
	if err != nil {
		return nil, err
	}

	documents := make(map[string]WorkbookDocument, len(current.Documents)+len(patch.UpsertDocuments))
	for _, document := range current.Documents {
		documents[document.ID] = document
	}
	for _, document := range patch.UpsertDocuments {
		if document.ID == "" {
			document.ID = newID("document")
		}
		if document.Kind == "" {
			document.Kind = "sql"
		}
		if document.Title == "" {
			document.Title = "Untitled query"
		}
		if document.ContentVersion <= 0 {
			document.ContentVersion = 2
		}
		if document.ProfileID != "" {
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM connection_profiles WHERE id=?", document.ProfileID).Scan(&exists); err != nil {
				return nil, err
			}
			if exists == 0 {
				document.ProfileID = ""
			}
		}
		content, err := json.Marshal(document.Content)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO workbook_documents(id, workbook_id, kind, title, position, profile_id,
            database_name, content_json, content_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, position=excluded.position,
              profile_id=excluded.profile_id, database_name=excluded.database_name, content_json=excluded.content_json,
              content_version=excluded.content_version, updated_at=excluded.updated_at
            WHERE workbook_documents.workbook_id=excluded.workbook_id`, document.ID, patch.ID, document.Kind,
			document.Title, document.Position, document.ProfileID, document.Database, string(content), document.ContentVersion, now, now)
		if err != nil {
			return nil, err
		}
		documents[document.ID] = document
	}
	for _, documentID := range patch.DeleteDocumentIDs {
		if _, err := tx.ExecContext(ctx, "DELETE FROM workbook_documents WHERE workbook_id=? AND id=?", patch.ID, documentID); err != nil {
			return nil, err
		}
		delete(documents, documentID)
	}
	for position, documentID := range patch.DocumentOrder {
		if _, exists := documents[documentID]; !exists {
			return nil, fmt.Errorf("document %q is not part of workbook %q", documentID, patch.ID)
		}
		if _, err := tx.ExecContext(ctx, "UPDATE workbook_documents SET position=? WHERE workbook_id=? AND id=?", position, patch.ID, documentID); err != nil {
			return nil, err
		}
		document := documents[documentID]
		document.Position = position
		documents[documentID] = document
	}

	current.Revision = nextRevision
	current.UpdatedAt = now
	current.Documents = current.Documents[:0]
	for _, document := range documents {
		current.Documents = append(current.Documents, document)
	}
	sort.Slice(current.Documents, func(left, right int) bool {
		return current.Documents[left].Position < current.Documents[right].Position
	})
	if patch.Checkpoint {
		snapshot, err := json.Marshal(current)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO workbook_revisions(id, workbook_id, revision, snapshot_json, created_at)
            VALUES (?, ?, ?, ?, ?)`, newID("revision"), patch.ID, nextRevision, string(snapshot), now); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM workbook_revisions WHERE id IN (
            SELECT id FROM workbook_revisions WHERE workbook_id=? ORDER BY revision DESC LIMIT -1 OFFSET 20
        )`, patch.ID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetWorkbook(ctx, patch.ID)
}

func (s *Store) RecordQueryRun(ctx context.Context, run QueryRun) error {
	if run.ID == "" {
		run.ID = newID("run")
	}
	if run.ExecutedAt == "" {
		run.ExecutedAt = utcNow()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO query_runs(id, document_id, profile_id, database_name, sql_text,
        query_hash, status, command, duration_ms, row_count, truncated, error_category, executed_at)
        VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), ?)`,
		run.ID, run.DocumentID, run.ProfileID, run.Database, run.SQL, run.QueryHash, run.Status, run.Command,
		run.DurationMS, run.RowCount, boolInt(run.Truncated), run.ErrorCategory, run.ExecutedAt)
	return err
}

func (s *Store) PruneQueryHistory(ctx context.Context, maxAge time.Duration, maxEntries int) error {
	if maxAge <= 0 || maxEntries <= 0 {
		return errors.New("query history retention must be positive")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	cutoff := time.Now().UTC().Add(-maxAge).Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, "DELETE FROM query_runs WHERE executed_at < ?", cutoff); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM query_runs WHERE id IN (
        SELECT id FROM query_runs ORDER BY executed_at DESC LIMIT -1 OFFSET ?
    )`, maxEntries); err != nil {
		return err
	}
	return tx.Commit()
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
