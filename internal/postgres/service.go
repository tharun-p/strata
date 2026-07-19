package postgres

import (
	"context"
	"crypto/rand"
	"encoding"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultQueryTimeout = 30 * time.Second
	maximumQueryTimeout = 10 * time.Minute
	defaultMaxRows      = 1000
	maximumRows         = 10000
)

type managedConnection struct {
	summary ConnectionSummary
	pool    *pgxpool.Pool
	// Session-only credentials so sibling databases on the same server can be opened.
	credentials ConnectionInput
}

type Service struct {
	ctx         context.Context
	mu          sync.RWMutex
	connections map[string]*managedConnection
	running     map[string]context.CancelFunc
}

func NewService() *Service {
	return &Service{
		ctx:         context.Background(),
		connections: make(map[string]*managedConnection),
		running:     make(map[string]context.CancelFunc),
	}
}

func (s *Service) Start(ctx context.Context) { s.ctx = ctx }

func (s *Service) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, cancel := range s.running {
		cancel()
		delete(s.running, id)
	}
	for id, conn := range s.connections {
		conn.pool.Close()
		delete(s.connections, id)
	}
}

func (s *Service) Connect(input ConnectionInput) (*ConnectionSummary, error) {
	input = normalizeConnectionInput(input)
	if err := validateConnectionInput(input); err != nil {
		return nil, err
	}

	connectionURL := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(input.Username, input.Password),
		Host:   fmt.Sprintf("%s:%d", input.Host, input.Port),
		Path:   input.Database,
	}
	query := connectionURL.Query()
	query.Set("sslmode", input.SSLMode)
	query.Set("connect_timeout", strconv.Itoa(max(1, input.ConnectTimeoutMS/1000)))
	connectionURL.RawQuery = query.Encode()

	config, err := pgxpool.ParseConfig(connectionURL.String())
	if err != nil {
		return nil, fmt.Errorf("invalid connection settings: %w", err)
	}
	config.MaxConns = 6
	config.MinConns = 0
	config.MaxConnIdleTime = 5 * time.Minute
	config.MaxConnLifetime = 30 * time.Minute
	config.ConnConfig.RuntimeParams["application_name"] = "strata-desktop"

	timeout := time.Duration(input.ConnectTimeoutMS) * time.Millisecond
	ctx, cancel := context.WithTimeout(s.ctx, timeout)
	defer cancel()
	started := time.Now()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, friendlyConnectionError(err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, friendlyConnectionError(err)
	}

	var version string
	if err := pool.QueryRow(ctx, "select current_setting('server_version')").Scan(&version); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connected, but could not read PostgreSQL version: %w", err)
	}

	id := newID("conn")
	summary := ConnectionSummary{
		ID:              id,
		Name:            input.Name,
		Host:            input.Host,
		Port:            input.Port,
		Database:        input.Database,
		Username:        input.Username,
		ServerVersion:   version,
		LatencyMS:       time.Since(started).Milliseconds(),
		ConnectedAt:     utcString(time.Now()),
		ReadOnlyDefault: true,
	}

	s.mu.Lock()
	s.connections[id] = &managedConnection{summary: summary, pool: pool, credentials: input}
	s.mu.Unlock()
	return &summary, nil
}

func (s *Service) Disconnect(connectionID string) error {
	s.mu.Lock()
	conn, ok := s.connections[connectionID]
	if ok {
		delete(s.connections, connectionID)
	}
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("connection %q was not found", connectionID)
	}
	conn.pool.Close()
	return nil
}

func (s *Service) ListConnections() []ConnectionSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	connections := make([]ConnectionSummary, 0, len(s.connections))
	for _, conn := range s.connections {
		connections = append(connections, conn.summary)
	}
	return connections
}

func (s *Service) connection(id string) (*managedConnection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	conn, ok := s.connections[id]
	if !ok {
		return nil, fmt.Errorf("connection %q is not active", id)
	}
	return conn, nil
}

func normalizeConnectionInput(input ConnectionInput) ConnectionInput {
	input.Name = strings.TrimSpace(input.Name)
	input.Host = strings.TrimSpace(input.Host)
	input.Database = strings.TrimSpace(input.Database)
	input.Username = strings.TrimSpace(input.Username)
	input.SSLMode = strings.TrimSpace(strings.ToLower(input.SSLMode))
	if input.Port == 0 {
		input.Port = 5432
	}
	if input.ConnectTimeoutMS == 0 {
		input.ConnectTimeoutMS = 10000
	}
	if input.Name == "" {
		input.Name = input.Database
	}
	if input.SSLMode == "" {
		input.SSLMode = "prefer"
	}
	return input
}

func validateConnectionInput(input ConnectionInput) error {
	if input.Host == "" {
		return errors.New("host is required")
	}
	if input.Database == "" {
		return errors.New("database is required")
	}
	if input.Username == "" {
		return errors.New("username is required")
	}
	if input.Port < 1 || input.Port > 65535 {
		return errors.New("port must be between 1 and 65535")
	}
	validSSL := map[string]bool{"disable": true, "allow": true, "prefer": true, "require": true, "verify-ca": true, "verify-full": true}
	if !validSSL[input.SSLMode] {
		return fmt.Errorf("unsupported SSL mode %q", input.SSLMode)
	}
	if input.ConnectTimeoutMS < 1000 || input.ConnectTimeoutMS > 120000 {
		return errors.New("connection timeout must be between 1 and 120 seconds")
	}
	return nil
}

func friendlyConnectionError(err error) error {
	message := err.Error()
	switch {
	case strings.Contains(message, "password authentication failed"):
		return errors.New("authentication failed; check the username and password")
	case strings.Contains(message, "no such host"):
		return errors.New("host could not be resolved")
	case strings.Contains(message, "connection refused"):
		return errors.New("connection was refused; check the host, port, and PostgreSQL network settings")
	case strings.Contains(message, "deadline exceeded"):
		return errors.New("connection timed out")
	default:
		return fmt.Errorf("could not connect to PostgreSQL: %w", err)
	}
}

func newID(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	return prefix + "_" + hex.EncodeToString(buf)
}

func normalizeQueryInput(input QueryInput) QueryInput {
	input.SQL = strings.TrimSpace(input.SQL)
	if input.MaxRows <= 0 {
		input.MaxRows = defaultMaxRows
	}
	if input.MaxRows > maximumRows {
		input.MaxRows = maximumRows
	}
	if input.TimeoutMS <= 0 {
		input.TimeoutMS = int(defaultQueryTimeout / time.Millisecond)
	}
	if time.Duration(input.TimeoutMS)*time.Millisecond > maximumQueryTimeout {
		input.TimeoutMS = int(maximumQueryTimeout / time.Millisecond)
	}
	return input
}

func (s *Service) queryContext(queryID string, timeout time.Duration) (context.Context, func()) {
	ctx, cancel := context.WithTimeout(s.ctx, timeout)
	s.mu.Lock()
	s.running[queryID] = cancel
	s.mu.Unlock()
	return ctx, func() {
		cancel()
		s.mu.Lock()
		delete(s.running, queryID)
		s.mu.Unlock()
	}
}

func (s *Service) CancelQuery(queryID string) bool {
	s.mu.RLock()
	cancel, ok := s.running[queryID]
	s.mu.RUnlock()
	if ok {
		cancel()
	}
	return ok
}

func (s *Service) ExecuteQuery(raw QueryInput) (*QueryResult, error) {
	input := normalizeQueryInput(raw)
	if input.SQL == "" {
		return nil, errors.New("query is empty")
	}
	conn, err := s.connection(input.ConnectionID)
	if err != nil {
		return nil, err
	}

	queryID := strings.TrimSpace(input.QueryID)
	if queryID == "" {
		queryID = newID("query")
	}
	ctx, done := s.queryContext(queryID, time.Duration(input.TimeoutMS)*time.Millisecond)
	defer done()
	started := time.Now()

	var rows pgx.Rows
	var tx pgx.Tx
	if input.ReadOnly {
		tx, err = conn.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if err == nil {
			rows, err = tx.Query(ctx, input.SQL)
		}
	} else {
		rows, err = conn.pool.Query(ctx, input.SQL)
	}
	if err != nil {
		if tx != nil {
			_ = tx.Rollback(context.Background())
		}
		return nil, fmt.Errorf("query failed: %w", err)
	}
	fields := rows.FieldDescriptions()
	columns := make([]ResultColumn, len(fields))
	for i, field := range fields {
		columns[i] = ResultColumn{Name: field.Name, DataType: dataTypeName(field.DataTypeOID)}
	}
	resultRows := make([][]any, 0, min(input.MaxRows, 256))
	truncated := false
	for rows.Next() {
		if len(resultRows) >= input.MaxRows {
			truncated = true
			break
		}
		values, valuesErr := rows.Values()
		if valuesErr != nil {
			return nil, fmt.Errorf("could not decode result row: %w", valuesErr)
		}
		for i, value := range values {
			values[i] = normalizeValue(value)
		}
		resultRows = append(resultRows, values)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("query stream failed: %w", err)
	}
	tag := rows.CommandTag()
	if tx != nil {
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("could not finish read-only transaction: %w", err)
		}
	}

	return &QueryResult{
		QueryID: queryID, Columns: columns, Rows: resultRows, RowCount: len(resultRows),
		AffectedRows: tag.RowsAffected(), Command: tag.String(),
		DurationMS: float64(time.Since(started).Microseconds()) / 1000,
		Truncated:  truncated, ExecutedAt: utcString(time.Now()),
	}, nil
}

func (s *Service) ExplainQuery(raw QueryInput) (*ExplainResult, error) {
	input := normalizeQueryInput(raw)
	if input.SQL == "" {
		return nil, errors.New("query is empty")
	}
	conn, err := s.connection(input.ConnectionID)
	if err != nil {
		return nil, err
	}

	queryID := strings.TrimSpace(input.QueryID)
	if queryID == "" {
		queryID = newID("plan")
	}
	ctx, done := s.queryContext(queryID, time.Duration(input.TimeoutMS)*time.Millisecond)
	defer done()
	started := time.Now()
	var rawPlan []byte
	err = conn.pool.QueryRow(ctx, "EXPLAIN (FORMAT JSON, VERBOSE TRUE, COSTS TRUE) "+input.SQL).Scan(&rawPlan)
	if err != nil {
		return nil, fmt.Errorf("explain failed: %w", err)
	}
	var plan any
	if err := json.Unmarshal(rawPlan, &plan); err != nil {
		return nil, fmt.Errorf("could not decode PostgreSQL plan: %w", err)
	}
	return &ExplainResult{QueryID: queryID, Plan: plan, DurationMS: float64(time.Since(started).Microseconds()) / 1000, ExecutedAt: utcString(time.Now())}, nil
}

func normalizeValue(value any) any {
	switch typed := value.(type) {
	case time.Time:
		return utcString(typed)
	case pgtype.Numeric:
		encoded, err := typed.Value()
		if err == nil {
			return encoded
		}
		return typed.Int.String()
	case [16]byte:
		return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", typed[0:4], typed[4:6], typed[6:8], typed[8:10], typed[10:16])
	case []byte:
		if json.Valid(typed) {
			var decoded any
			if json.Unmarshal(typed, &decoded) == nil {
				return decoded
			}
		}
		return string(typed)
	case encoding.TextMarshaler:
		encoded, err := typed.MarshalText()
		if err == nil {
			return string(encoded)
		}
		return fmt.Sprint(typed)
	default:
		if _, err := json.Marshal(typed); err != nil {
			return fmt.Sprint(typed)
		}
		return typed
	}
}

func dataTypeName(oid uint32) string {
	names := map[uint32]string{16: "bool", 17: "bytea", 20: "int8", 21: "int2", 23: "int4", 25: "text", 26: "oid", 700: "float4", 701: "float8", 1042: "bpchar", 1043: "varchar", 1082: "date", 1083: "time", 1114: "timestamp", 1184: "timestamptz", 1700: "numeric", 2950: "uuid", 3802: "jsonb"}
	if name, ok := names[oid]; ok {
		return name
	}
	return fmt.Sprintf("oid:%d", oid)
}
