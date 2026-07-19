package postgres

import (
	"fmt"
	"math/big"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNormalizeConnectionInput(t *testing.T) {
	got := normalizeConnectionInput(ConnectionInput{Host: " localhost ", Database: " app ", Username: " user "})
	if got.Host != "localhost" || got.Database != "app" || got.Username != "user" {
		t.Fatalf("expected whitespace to be trimmed, got %#v", got)
	}
	if got.Name != "app" || got.Port != 5432 || got.SSLMode != "prefer" || got.ConnectTimeoutMS != 10000 {
		t.Fatalf("expected safe defaults, got %#v", got)
	}
}

func TestParallelWorksheetQueriesAgainstPostgres(t *testing.T) {
	if os.Getenv("STRATA_POSTGRES_INTEGRATION") != "1" {
		t.Skip("set STRATA_POSTGRES_INTEGRATION=1 with the development fixture running")
	}
	port := 55432
	if configured := os.Getenv("STRATA_TEST_PG_PORT"); configured != "" {
		parsed, err := strconv.Atoi(configured)
		if err != nil {
			t.Fatal(err)
		}
		port = parsed
	}
	service := NewService()
	defer service.Close()
	service.Start(t.Context())
	connections := make([]string, 2)
	for index := range connections {
		summary, err := service.Connect(ConnectionInput{
			Name: fmt.Sprintf("parallel-%d", index), Host: "127.0.0.1", Port: port,
			Database: "strata", Username: "strata", Password: "strata_dev",
			SSLMode: "disable", ConnectTimeoutMS: 5000,
		})
		if err != nil {
			t.Fatal(err)
		}
		connections[index] = summary.ID
	}

	started := time.Now()
	results := make([]*QueryResult, 8)
	errorsByDocument := make([]error, 8)
	var wait sync.WaitGroup
	for index := range results {
		wait.Add(1)
		go func(document int) {
			defer wait.Done()
			connection := connections[document/4]
			results[document], errorsByDocument[document] = service.ExecuteQuery(QueryInput{
				ConnectionID: connection,
				DocumentID:   fmt.Sprintf("document-%d", document),
				QueryID:      fmt.Sprintf("parallel-%d", document),
				SQL:          fmt.Sprintf("select pg_sleep(0.08), %d::int as document_number", document),
				MaxRows:      1,
				TimeoutMS:    5000,
				ReadOnly:     true,
			})
		}(index)
	}
	wait.Wait()
	if elapsed := time.Since(started); elapsed > 750*time.Millisecond {
		t.Fatalf("eight worksheet jobs did not execute concurrently: %s", elapsed)
	}
	for document, err := range errorsByDocument {
		if err != nil {
			t.Fatalf("document %d failed: %v", document, err)
		}
		if results[document].QueryID != fmt.Sprintf("parallel-%d", document) || results[document].RowCount != 1 {
			t.Fatalf("result was not routed to document %d: %#v", document, results[document])
		}
	}
}

func TestValidateConnectionInput(t *testing.T) {
	valid := ConnectionInput{Host: "localhost", Port: 5432, Database: "app", Username: "user", SSLMode: "require", ConnectTimeoutMS: 5000}
	if err := validateConnectionInput(valid); err != nil {
		t.Fatalf("valid input was rejected: %v", err)
	}
	invalid := valid
	invalid.Port = 70000
	if err := validateConnectionInput(invalid); err == nil || !strings.Contains(err.Error(), "port") {
		t.Fatalf("expected a port validation error, got %v", err)
	}
}

func TestNormalizeQueryInputCapsResourceUse(t *testing.T) {
	got := normalizeQueryInput(QueryInput{SQL: " select 1 ", MaxRows: 50000, TimeoutMS: int((20 * time.Minute) / time.Millisecond)})
	if got.SQL != "select 1" || got.MaxRows != maximumRows || got.TimeoutMS != int(maximumQueryTimeout/time.Millisecond) {
		t.Fatalf("query limits were not normalized: %#v", got)
	}
}

func TestNormalizeValue(t *testing.T) {
	numeric := pgtype.Numeric{Int: big.NewInt(12345), Exp: -2, Valid: true}
	if got := normalizeValue(numeric); got != "123.45" {
		t.Fatalf("expected numeric to become a JSON-safe string, got %#v", got)
	}
	uuid := [16]byte{0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78}
	if got := normalizeValue(uuid); got != "12345678-1234-5678-90ab-cdef12345678" {
		t.Fatalf("expected UUID text, got %#v", got)
	}
}

func TestCancelQueryUnknownID(t *testing.T) {
	service := NewService()
	if service.CancelQuery("missing") {
		t.Fatal("expected CancelQuery to return false for an unknown id")
	}
}

func TestGetCompletionCatalogRequiresConnection(t *testing.T) {
	service := NewService()
	_, err := service.GetCompletionCatalog("missing")
	if err == nil || !strings.Contains(err.Error(), "not active") {
		t.Fatalf("expected missing connection error, got %v", err)
	}
}
