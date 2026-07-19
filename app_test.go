package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/dbexplorer/strata/internal/credentials"
	"github.com/dbexplorer/strata/internal/persistence"
	"github.com/dbexplorer/strata/internal/postgres"
)

func TestStartupAutoConnectIsExplicitOptIn(t *testing.T) {
	t.Setenv("STRATA_AUTO_CONNECT", "")
	if startupAutoConnectEnabled() {
		t.Fatal("auto-connect must be disabled by default")
	}
	t.Setenv("STRATA_AUTO_CONNECT", "true")
	if !startupAutoConnectEnabled() {
		t.Fatal("explicit auto-connect opt-in was not honored")
	}
}

func TestStartupConnectionInputRequiresExplicitSettings(t *testing.T) {
	t.Setenv("STRATA_PG_HOST", "")
	t.Setenv("STRATA_PG_DATABASE", "")
	t.Setenv("STRATA_PG_USERNAME", "")
	if _, err := startupConnectionInput(); err == nil {
		t.Fatal("expected missing startup settings to fail")
	}
}

func TestStartupConnectionInputEnvironment(t *testing.T) {
	t.Setenv("STRATA_PG_HOST", "db.internal")
	t.Setenv("STRATA_PG_PORT", "6432")
	t.Setenv("STRATA_PG_DATABASE", "warehouse")
	t.Setenv("STRATA_PG_USERNAME", "analyst")
	input, err := startupConnectionInput()
	if err != nil {
		t.Fatal(err)
	}
	if input.Name != "warehouse" || input.Host != "db.internal" || input.Port != 6432 || input.Database != "warehouse" || input.Username != "analyst" || input.SSLMode != "prefer" {
		t.Fatalf("environment was not applied: %#v", input)
	}
}

func TestWindowCloseRequiresOneFlushPermission(t *testing.T) {
	app := newApp(t.TempDir(), credentials.NewMemoryStore())
	if !app.preventWindowClose() {
		t.Fatal("an unflushed close must be intercepted")
	}
	app.AllowWindowClose()
	if app.preventWindowClose() {
		t.Fatal("the close immediately following a successful flush must proceed")
	}
	if !app.preventWindowClose() {
		t.Fatal("close permission must be consumed exactly once")
	}
}

func TestLocalWorkspaceSurvivesRestart(t *testing.T) {
	dataDir := t.TempDir()
	first := newApp(dataDir, credentials.NewMemoryStore())
	first.startup(context.Background())
	if status := first.GetStartupStatus(); !status.PersistenceReady || status.PersistenceError != "" {
		t.Fatalf("persistence did not start: %#v", status)
	}
	settings := persistence.DefaultWorkspaceSettings()
	settings.ExplorerWidth = 338
	settings.ContextCollapsed = true
	if err := first.SaveWorkspaceSettings(settings); err != nil {
		t.Fatal(err)
	}
	workbook, err := first.LoadDefaultWorkbook()
	if err != nil {
		t.Fatal(err)
	}
	workbook.Title = "Persistent investigation"
	workbook.Documents[0].Content.SQL = "select current_database()"
	if _, err := first.SaveWorkbook(*workbook, workbook.Revision, true); err != nil {
		t.Fatal(err)
	}
	first.shutdown(context.Background())

	second := newApp(dataDir, credentials.NewMemoryStore())
	second.startup(context.Background())
	defer second.shutdown(context.Background())
	loadedSettings, err := second.LoadWorkspaceSettings()
	if err != nil {
		t.Fatal(err)
	}
	if loadedSettings.ExplorerWidth != 338 || !loadedSettings.ContextCollapsed {
		t.Fatalf("settings were not restored: %#v", loadedSettings)
	}
	loadedWorkbook, err := second.LoadDefaultWorkbook()
	if err != nil {
		t.Fatal(err)
	}
	if loadedWorkbook.Title != "Persistent investigation" || loadedWorkbook.Documents[0].Content.SQL != "select current_database()" {
		t.Fatalf("workbook was not restored: %#v", loadedWorkbook)
	}
}

func TestDevelopmentDatabaseIntegration(t *testing.T) {
	if os.Getenv("STRATA_POSTGRES_INTEGRATION") != "1" {
		t.Skip("set STRATA_POSTGRES_INTEGRATION=1 with the development container running")
	}
	t.Setenv("STRATA_AUTO_CONNECT", "true")
	t.Setenv("STRATA_PG_HOST", "127.0.0.1")
	testPort := os.Getenv("STRATA_TEST_PG_PORT")
	if testPort == "" {
		testPort = "55432"
	}
	t.Setenv("STRATA_PG_PORT", testPort)
	t.Setenv("STRATA_PG_DATABASE", "strata")
	t.Setenv("STRATA_PG_USERNAME", "strata")
	t.Setenv("STRATA_PG_PASSWORD", "strata_dev")
	t.Setenv("STRATA_PG_SSLMODE", "disable")
	dataDir := t.TempDir()
	vault := credentials.NewMemoryStore()
	app := newApp(dataDir, vault)
	app.startup(context.Background())
	defer app.shutdown(context.Background())
	status := app.GetStartupStatus()
	if !status.Connected {
		t.Fatalf("startup connection failed: %s", status.Error)
	}
	connections := app.ListConnections()
	if len(connections) != 1 {
		t.Fatalf("expected one startup connection, got %d", len(connections))
	}
	schemas, err := app.ListSchemas(connections[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	foundCommerce := false
	for _, schema := range schemas {
		foundCommerce = foundCommerce || schema.Name == "commerce"
	}
	if !foundCommerce {
		t.Fatalf("commerce schema was not discovered: %#v", schemas)
	}
	relations, err := app.ListRelations(connections[0].ID, "commerce")
	if err != nil {
		t.Fatal(err)
	}
	foundOrders, foundSummary := false, false
	for _, relation := range relations {
		foundOrders = foundOrders || (relation.Name == "orders" && relation.Kind == "table")
		foundSummary = foundSummary || (relation.Name == "order_summary" && relation.Kind == "view")
	}
	if !foundOrders || !foundSummary {
		t.Fatalf("expected live table and view discovery: %#v", relations)
	}
	detail, err := app.DescribeRelation(connections[0].ID, "commerce", "order_items")
	if err != nil {
		t.Fatal(err)
	}
	primaryColumns := 0
	for _, column := range detail.Columns {
		if column.IsPrimaryKey {
			primaryColumns++
		}
	}
	if primaryColumns != 2 {
		t.Fatalf("expected the composite primary key to contain two columns, got %#v", detail.Columns)
	}
	result, err := app.ExecuteQuery(postgres.QueryInput{
		ConnectionID: connections[0].ID,
		SQL:          "select count(*) as order_count from commerce.orders",
		MaxRows:      10,
		TimeoutMS:    5000,
		ReadOnly:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.RowCount != 1 || len(result.Rows[0]) != 1 {
		t.Fatalf("unexpected live query result: %#v", result)
	}
	plan, err := app.ExplainQuery(postgres.QueryInput{
		ConnectionID: connections[0].ID,
		SQL:          "select * from commerce.order_summary order by created_at desc limit 25",
		TimeoutMS:    5000,
		ReadOnly:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Plan == nil {
		t.Fatal("expected a live PostgreSQL JSON plan")
	}
	persisted, err := app.Connect(ConnectionRequest{
		Name: "Fixture profile", Host: "127.0.0.1", Port: mustAtoi(t, testPort), Database: "strata",
		Username: "strata", Password: "strata_dev", SSLMode: "disable", ConnectTimeoutMS: 5000,
		RememberPassword: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if persisted.ProfileID == "" || persisted.CredentialStatus != "available" {
		t.Fatalf("profile and credential were not persisted: %#v", persisted)
	}
	storedSecret, err := vault.Get(persisted.ProfileID, credentials.DatabasePasswordPurpose())
	if err != nil || storedSecret != "strata_dev" {
		t.Fatalf("credential vault did not receive the password: %q, %v", storedSecret, err)
	}
	for _, suffix := range []string{"", "-wal"} {
		data, err := os.ReadFile(filepath.Join(dataDir, "strata.db") + suffix)
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if bytes.Contains(data, []byte("strata_dev")) {
			t.Fatalf("password leaked into the SQLite workspace%s", suffix)
		}
	}
}

func mustAtoi(t *testing.T, value string) int {
	t.Helper()
	parsed, err := strconv.Atoi(value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
