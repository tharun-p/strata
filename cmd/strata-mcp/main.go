package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/dbexplorer/strata/internal/postgres"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const version = "0.1.0"

type mcpServer struct {
	service      *postgres.Service
	connectionID string
}

type EmptyInput struct{}

type ListSchemasOutput struct {
	Schemas []postgres.SchemaSummary `json:"schemas" jsonschema:"PostgreSQL schemas available to investigate"`
}

type ListRelationsInput struct {
	Schema string `json:"schema" jsonschema:"schema name, for example public"`
}

type ListRelationsOutput struct {
	Relations []postgres.RelationSummary `json:"relations" jsonschema:"tables, views, materialized views, and foreign tables"`
}

type DescribeRelationInput struct {
	Schema   string `json:"schema" jsonschema:"schema containing the relation"`
	Relation string `json:"relation" jsonschema:"table or view name"`
}

type DescribeRelationOutput struct {
	Detail postgres.RelationDetail `json:"detail" jsonschema:"columns, indexes, and relation metadata"`
}

type QueryInput struct {
	SQL       string `json:"sql" jsonschema:"a single PostgreSQL query to execute in a read-only transaction"`
	MaxRows   int    `json:"maxRows,omitempty" jsonschema:"maximum rows to return, defaults to 200 and is capped at 1000"`
	TimeoutMS int    `json:"timeoutMs,omitempty" jsonschema:"query timeout in milliseconds, defaults to 30000"`
}

type QueryOutput struct {
	Result postgres.QueryResult `json:"result" jsonschema:"columns, rows, duration, and truncation metadata"`
}

type ExplainOutput struct {
	Result postgres.ExplainResult `json:"result" jsonschema:"non-executing PostgreSQL JSON query plan"`
}

func main() {
	connectionURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if connectionURL == "" {
		log.Fatal("DATABASE_URL is required; Strata MCP never accepts credentials through tool arguments")
	}
	input, err := connectionInputFromURL(connectionURL)
	if err != nil {
		log.Fatalf("invalid DATABASE_URL: %v", err)
	}

	service := postgres.NewService()
	service.Start(context.Background())
	defer service.Close()
	connection, err := service.Connect(input)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	handler := &mcpServer{service: service, connectionID: connection.ID}
	server := mcp.NewServer(&mcp.Implementation{Name: "strata-postgres", Version: version}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "postgres_list_schemas", Description: "List non-system PostgreSQL schemas with relation counts and total sizes."}, handler.listSchemas)
	mcp.AddTool(server, &mcp.Tool{Name: "postgres_list_relations", Description: "List tables and views in one PostgreSQL schema with sizes and estimated row counts."}, handler.listRelations)
	mcp.AddTool(server, &mcp.Tool{Name: "postgres_describe_relation", Description: "Describe a PostgreSQL table or view, including columns, primary keys, indexes, sizes, and index usage."}, handler.describeRelation)
	mcp.AddTool(server, &mcp.Tool{Name: "postgres_query", Description: "Run one PostgreSQL query in a read-only transaction with enforced row and time limits."}, handler.query)
	mcp.AddTool(server, &mcp.Tool{Name: "postgres_explain", Description: "Produce a non-executing PostgreSQL JSON query plan. ANALYZE is never enabled."}, handler.explain)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}

func (s *mcpServer) listSchemas(context.Context, *mcp.CallToolRequest, EmptyInput) (*mcp.CallToolResult, ListSchemasOutput, error) {
	items, err := s.service.ListSchemas(s.connectionID)
	return nil, ListSchemasOutput{Schemas: items}, err
}

func (s *mcpServer) listRelations(_ context.Context, _ *mcp.CallToolRequest, input ListRelationsInput) (*mcp.CallToolResult, ListRelationsOutput, error) {
	if strings.TrimSpace(input.Schema) == "" {
		return nil, ListRelationsOutput{}, errors.New("schema is required")
	}
	items, err := s.service.ListRelations(s.connectionID, input.Schema)
	return nil, ListRelationsOutput{Relations: items}, err
}

func (s *mcpServer) describeRelation(_ context.Context, _ *mcp.CallToolRequest, input DescribeRelationInput) (*mcp.CallToolResult, DescribeRelationOutput, error) {
	if strings.TrimSpace(input.Schema) == "" || strings.TrimSpace(input.Relation) == "" {
		return nil, DescribeRelationOutput{}, errors.New("schema and relation are required")
	}
	item, err := s.service.DescribeRelation(s.connectionID, input.Schema, input.Relation)
	if err != nil {
		return nil, DescribeRelationOutput{}, err
	}
	return nil, DescribeRelationOutput{Detail: *item}, nil
}

func (s *mcpServer) query(_ context.Context, _ *mcp.CallToolRequest, input QueryInput) (*mcp.CallToolResult, QueryOutput, error) {
	maxRows := input.MaxRows
	if maxRows <= 0 {
		maxRows = 200
	}
	if maxRows > 1000 {
		maxRows = 1000
	}
	result, err := s.service.ExecuteQuery(postgres.QueryInput{ConnectionID: s.connectionID, SQL: input.SQL, MaxRows: maxRows, TimeoutMS: input.TimeoutMS, ReadOnly: true})
	if err != nil {
		return nil, QueryOutput{}, err
	}
	return nil, QueryOutput{Result: *result}, nil
}

func (s *mcpServer) explain(_ context.Context, _ *mcp.CallToolRequest, input QueryInput) (*mcp.CallToolResult, ExplainOutput, error) {
	result, err := s.service.ExplainQuery(postgres.QueryInput{ConnectionID: s.connectionID, SQL: input.SQL, TimeoutMS: input.TimeoutMS, ReadOnly: true})
	if err != nil {
		return nil, ExplainOutput{}, err
	}
	return nil, ExplainOutput{Result: *result}, nil
}

func connectionInputFromURL(raw string) (postgres.ConnectionInput, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return postgres.ConnectionInput{}, err
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return postgres.ConnectionInput{}, errors.New("URL scheme must be postgres or postgresql")
	}
	if parsed.User == nil || parsed.User.Username() == "" {
		return postgres.ConnectionInput{}, errors.New("username is required")
	}
	port := 5432
	if parsed.Port() != "" {
		port, err = strconv.Atoi(parsed.Port())
		if err != nil {
			return postgres.ConnectionInput{}, fmt.Errorf("invalid port: %w", err)
		}
	}
	password, _ := parsed.User.Password()
	sslMode := parsed.Query().Get("sslmode")
	if sslMode == "" {
		sslMode = "prefer"
	}
	database := strings.TrimPrefix(parsed.EscapedPath(), "/")
	database, err = url.PathUnescape(database)
	if err != nil {
		return postgres.ConnectionInput{}, fmt.Errorf("invalid database name: %w", err)
	}
	return postgres.ConnectionInput{
		Name: "Strata MCP", Host: parsed.Hostname(), Port: port, Database: database,
		Username: parsed.User.Username(), Password: password, SSLMode: sslMode, ConnectTimeoutMS: 10000,
	}, nil
}
