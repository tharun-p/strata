package persistence

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "strata.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestStoreUsesOwnerOnlyPermissions(t *testing.T) {
	root := filepath.Join(t.TempDir(), "nested", "Strata")
	path := filepath.Join(root, "strata.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	directoryInfo, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	databaseInfo, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := directoryInfo.Mode().Perm(); got != 0o700 {
		t.Fatalf("data directory permissions = %o", got)
	}
	if got := databaseInfo.Mode().Perm(); got != 0o600 {
		t.Fatalf("database permissions = %o", got)
	}
}

func TestStorePersistsProfilesWithoutSecrets(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	profile, err := store.SaveConnectionProfile(ctx, ConnectionProfile{
		Name: "Production", Host: "db.internal", Port: 5432, Database: "app",
		Username: "analyst", SSLMode: "verify-full", ConnectTimeoutMS: 10000,
		ReadOnlyDefault: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if profile.ID == "" || profile.CredentialStatus != "missing" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
	if err := store.SetSecretBinding(ctx, profile.ID, "database_password", "test", "available"); err != nil {
		t.Fatal(err)
	}
	profiles, err := store.ListConnectionProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 || profiles[0].CredentialStatus != "available" {
		t.Fatalf("unexpected profiles: %#v", profiles)
	}
	var passwordColumns int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info('connection_profiles') WHERE lower(name) LIKE '%password%'`).Scan(&passwordColumns); err != nil {
		t.Fatal(err)
	}
	if passwordColumns != 0 {
		t.Fatal("connection_profiles must never expose a password column")
	}
}

func TestWorkspaceSettingsAndWorkbookRoundTrip(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	settings := DefaultWorkspaceSettings()
	settings.ExplorerWidth = 320
	settings.ContextCollapsed = true
	settings.LeftPanelMode = "worksheets"
	if err := store.SaveWorkspaceSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.LoadWorkspaceSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ExplorerWidth != 320 || !loaded.ContextCollapsed || loaded.LeftPanelMode != "worksheets" {
		t.Fatalf("unexpected settings: %#v", loaded)
	}

	workbook, err := store.SaveWorkbook(ctx, Workbook{Title: "Revenue", State: "saved", Documents: []WorkbookDocument{{
		Kind: "sql", Title: "Top customers", ContentVersion: 1,
		Content: WorkbookDocumentContent{SQL: "select * from customers", Question: "top customers"},
	}}}, 0, true)
	if err != nil {
		t.Fatal(err)
	}
	if workbook.Revision != 1 || len(workbook.Documents) != 1 || workbook.Documents[0].Content.SQL == "" {
		t.Fatalf("unexpected workbook: %#v", workbook)
	}
	workbook.Documents[0].Content.SQL = "select count(*) from customers"
	updated, err := store.SaveWorkbook(ctx, *workbook, workbook.Revision, false)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updated.Documents[0].Content.SQL != "select count(*) from customers" {
		t.Fatalf("unexpected update: %#v", updated)
	}
	updated.Title = "Customer revenue"
	renamed, err := store.SaveWorkbook(ctx, *updated, updated.Revision, true)
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Revision != 3 || renamed.Title != "Customer revenue" {
		t.Fatalf("unexpected renamed workbook: %#v", renamed)
	}
	if _, err := store.SaveWorkbook(ctx, Workbook{Title: "Incident review", State: "draft", Documents: []WorkbookDocument{{
		Kind: "sql", Title: "Slow queries", ContentVersion: 1,
		Content: WorkbookDocumentContent{SQL: "select * from pg_stat_activity"},
	}}}, 0, true); err != nil {
		t.Fatal(err)
	}
	workbooks, err := store.ListWorkbooks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(workbooks) != 2 {
		t.Fatalf("expected two workbooks, got %#v", workbooks)
	}
	seen := map[string]bool{}
	for _, item := range workbooks {
		seen[item.Title] = true
	}
	if !seen["Customer revenue"] || !seen["Incident review"] {
		t.Fatalf("workbook list did not include saved worksheets: %#v", workbooks)
	}
	var revisionCount int
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM workbook_revisions WHERE workbook_id=?", renamed.ID).Scan(&revisionCount); err != nil {
		t.Fatal(err)
	}
	if revisionCount != 2 {
		t.Fatalf("expected two explicit checkpoints, got %d", revisionCount)
	}
}

func TestApplyWorkbookPatchOnlyChangesDirtyDocuments(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	workbook, err := store.SaveWorkbook(ctx, Workbook{Title: "Investigation", State: "draft", Documents: []WorkbookDocument{
		{ID: "doc-a", Kind: "sql", Title: "A", Position: 0, ContentVersion: 1, Content: WorkbookDocumentContent{SQL: "select 1"}},
		{ID: "doc-b", Kind: "sql", Title: "B", Position: 1, ContentVersion: 1, Content: WorkbookDocumentContent{SQL: "select 2"}},
		{ID: "doc-c", Kind: "sql", Title: "C", Position: 2, ContentVersion: 1, Content: WorkbookDocumentContent{SQL: "select 3"}},
	}}, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	var untouchedUpdatedAt string
	if err := store.db.QueryRowContext(ctx, "SELECT updated_at FROM workbook_documents WHERE id='doc-a'").Scan(&untouchedUpdatedAt); err != nil {
		t.Fatal(err)
	}
	active := "doc-b"
	updated, err := store.ApplyWorkbookPatch(ctx, WorkbookPatch{
		ID: workbook.ID, ExpectedRevision: workbook.Revision, ActiveDocumentID: &active,
		UpsertDocuments: []WorkbookDocument{{
			ID: "doc-b", Kind: "sql", Title: "B changed", Position: 1, ContentVersion: 2,
			Content: WorkbookDocumentContent{SQL: "select 22", EditorState: &PersistedEditorState{
				Selection: []PersistedEditorRange{{Anchor: 4, Head: 4}}, ScrollTop: 80,
			}},
		}},
		DeleteDocumentIDs: []string{"doc-c"},
		DocumentOrder:     []string{"doc-b", "doc-a"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != workbook.Revision+1 || len(updated.Documents) != 2 || updated.ActiveDocumentID != "doc-b" {
		t.Fatalf("unexpected patch result: %#v", updated)
	}
	if updated.Documents[0].ID != "doc-b" || updated.Documents[0].Content.SQL != "select 22" || updated.Documents[0].Content.EditorState == nil {
		t.Fatalf("dirty document was not persisted: %#v", updated.Documents)
	}
	var afterUpdatedAt string
	if err := store.db.QueryRowContext(ctx, "SELECT updated_at FROM workbook_documents WHERE id='doc-a'").Scan(&afterUpdatedAt); err != nil {
		t.Fatal(err)
	}
	if afterUpdatedAt != untouchedUpdatedAt {
		t.Fatalf("untouched document was rewritten: %q != %q", afterUpdatedAt, untouchedUpdatedAt)
	}
	if _, err := store.ApplyWorkbookPatch(ctx, WorkbookPatch{ID: workbook.ID, ExpectedRevision: workbook.Revision}); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
}

func TestVersionOneWorkbookLoadsWithoutEditorState(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	workbook, err := store.SaveWorkbook(ctx, Workbook{Title: "Legacy", Documents: []WorkbookDocument{{
		ID: "legacy-doc", Kind: "sql", Title: "Legacy query", ContentVersion: 1,
		Content: WorkbookDocumentContent{SQL: "select 1"},
	}}}, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetWorkbook(ctx, workbook.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Documents[0].ContentVersion != 1 || loaded.Documents[0].Content.EditorState != nil {
		t.Fatalf("version-one content was not loaded compatibly: %#v", loaded.Documents[0])
	}
}

func TestLegacyProfileImportIsAtomicAndIdempotent(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	profiles := []ConnectionProfile{{
		Name: "Legacy", Host: "legacy.internal", Port: 5432, Database: "app",
		Username: "developer", SSLMode: "require", ConnectTimeoutMS: 5000,
	}}
	if err := store.ImportConnectionProfiles(ctx, profiles); err != nil {
		t.Fatal(err)
	}
	if err := store.ImportConnectionProfiles(ctx, profiles); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.ListConnectionProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 || loaded[0].CredentialStatus != "missing" {
		t.Fatalf("unexpected import result: %#v", loaded)
	}
}

func TestProfilesUseStableIDsNotConnectionTupleIdentity(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	input := ConnectionProfile{
		Name: "Primary route", Host: "same.internal", Port: 5432, Database: "app",
		Username: "developer", SSLMode: "require", ConnectTimeoutMS: 5000,
	}
	first, err := store.SaveConnectionProfile(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Name = "Alternate route"
	second, err := store.SaveConnectionProfile(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("profiles with the same target must retain independent identities")
	}
}
