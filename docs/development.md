# Developing Strata

This guide covers local setup, the PostgreSQL fixture, configuration, tests, desktop builds, and contribution expectations. For the product overview, see the [main README](../README.md).

## Prerequisites

Install the following before running Strata:

- [Go 1.25 or later](https://go.dev/doc/install)
- [Node.js 20 or later](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Wails platform dependencies](https://wails.io/docs/gettingstarted/installation/)

The Wails documentation lists the native packages required by macOS, Windows, and Linux.

## Run the desktop application

Clone the repository and install its frontend and Wails dependencies:

```bash
git clone https://github.com/dbexplorer/strata.git
cd strata

npm --prefix frontend install
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
```

Start the PostgreSQL fixture and native application together:

```bash
scripts/dev
```

The script runs `scripts/dev-db up`, waits for PostgreSQL to become healthy, and then starts `wails dev`.

Strata does not silently connect to the fixture. Create a connection from the application using these values:

| Field | Value |
| --- | --- |
| Name | `Local Strata` |
| Host | `127.0.0.1` |
| Port | `55432` |
| Database | `strata` |
| Username | `strata` |
| Password | `strata_dev` |
| SSL mode | `disable` |

The same PostgreSQL server contains the `saas_control` and `operations_hub` databases. They can be opened from the database explorer without creating separate server profiles.

## PostgreSQL development fixture

The Docker environment runs PostgreSQL 17 with three databases, 24 non-system schemas, and more than 550,000 deterministic rows. It is the development source of truth; there is no runtime mock-data fallback.

The fixture covers:

- UUID and composite primary keys;
- foreign keys and self-referencing relationships;
- enums and domains;
- generated columns, checks, and triggers;
- arrays, JSONB, `INET`, and range types;
- views, materialized views, and SQL functions;
- partitioned tables and time-series event data;
- GIN, BRIN, partial, and expression indexes; and
- relation and column comments.

Use `scripts/dev-db` for common operations:

```bash
scripts/dev-db up                 # build and start PostgreSQL
scripts/dev-db status             # show container health
scripts/dev-db verify             # verify fixture objects and row counts
scripts/dev-db psql               # open psql in the strata database
scripts/dev-db psql saas_control  # open another fixture database
scripts/dev-db reset              # recreate the volume and fixture data
scripts/dev-db down               # stop the fixture
```

`reset` removes the Docker volume before rebuilding it. Do not use it if the container holds data that must be preserved.

The fixture domains and object inventory are documented in [docker/postgres/README.md](../docker/postgres/README.md).

## Environment configuration

### Startup connection

Environment-based auto-connect is disabled by default. Enable it by setting `STRATA_AUTO_CONNECT=true` and providing the required connection values before starting Strata:

```bash
export STRATA_AUTO_CONNECT=true
export STRATA_PG_HOST=127.0.0.1
export STRATA_PG_PORT=55432
export STRATA_PG_DATABASE=strata
export STRATA_PG_USERNAME=strata
export STRATA_PG_PASSWORD=strata_dev
export STRATA_PG_SSLMODE=disable
export STRATA_PG_NAME="Local Strata"

wails dev
```

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `STRATA_AUTO_CONNECT` | No | `false` | Enables environment startup connection when set to `true` or `1` |
| `STRATA_PG_HOST` | With auto-connect | — | PostgreSQL hostname or IP address |
| `STRATA_PG_DATABASE` | With auto-connect | — | Initial database name |
| `STRATA_PG_USERNAME` | With auto-connect | — | PostgreSQL role |
| `STRATA_PG_PASSWORD` | No | empty | Password for the startup role |
| `STRATA_PG_PORT` | No | `5432` | PostgreSQL port |
| `STRATA_PG_SSLMODE` | No | `prefer` | `disable`, `allow`, `prefer`, `require`, `verify-ca`, or `verify-full` |
| `STRATA_PG_NAME` | No | database name | Label shown in the connection switcher |
| `STRATA_DATA_DIR` | No | platform configuration directory | Overrides the directory containing `strata.db` |

Saved profiles can opt into auto-connect from the application. Their password must be available in the operating-system credential vault for unattended reconnection.

### Local application data

Strata stores its embedded SQLite database at the platform user configuration path under `Strata/strata.db`. Use `STRATA_DATA_DIR` to isolate development or test state:

```bash
export STRATA_DATA_DIR=/tmp/strata-development
wails dev
```

Do not commit the application-data directory or copy credential-vault contents into the repository.

## Keyboard shortcuts

Use <kbd>⌘</kbd> on macOS and <kbd>Ctrl</kbd> on Windows or Linux.

| Shortcut | Action |
| --- | --- |
| <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> | Run the selected or current SQL statement |
| <kbd>⌘/Ctrl</kbd> + <kbd>K</kbd> | Open the command palette |
| <kbd>⌘/Ctrl</kbd> + <kbd>P</kbd> | Focus database object search |
| <kbd>Ctrl</kbd> + <kbd>Space</kbd> | Open schema-aware SQL completion |
| <kbd>Esc</kbd> | Close the active menu, dialog, or popover |

## Build and test

### Fast checks

```bash
go test ./...
npm --prefix frontend run lint
npm --prefix frontend run build
```

### Live PostgreSQL integration test

Start the fixture and explicitly enable the integration test:

```bash
scripts/dev-db up
STRATA_POSTGRES_INTEGRATION=1 go test . -run TestDevelopmentDatabaseIntegration
```

The test connects to port `55432` by default. Set `STRATA_TEST_PG_PORT` if the fixture is published on another port.

### Native desktop build

```bash
wails build
```

Wails writes platform artifacts to `build/bin/`.

A release candidate should pass the Go tests, frontend lint and build, fixture verification, live PostgreSQL integration test, and native Wails build.

## Using the MCP server

Build the isolated stdio server:

```bash
go build -o build/bin/strata-mcp ./cmd/strata-mcp
```

Configure an MCP client with an absolute path to the binary:

```json
{
  "mcpServers": {
    "strata-postgres": {
      "command": "/absolute/path/to/strata/build/bin/strata-mcp",
      "env": {
        "DATABASE_URL": "postgresql://strata:strata_dev@127.0.0.1:55432/strata?sslmode=disable"
      }
    }
  }
}
```

Use a dedicated read-only PostgreSQL role outside local development. The server never accepts credentials through tool arguments.

Available tools:

| Tool | Purpose |
| --- | --- |
| `postgres_list_schemas` | List non-system schemas with relation counts and total sizes |
| `postgres_list_relations` | List tables and views in a schema |
| `postgres_describe_relation` | Inspect columns, primary keys, indexes, sizes, and index usage |
| `postgres_query` | Run one query in a read-only transaction |
| `postgres_explain` | Produce a non-executing PostgreSQL JSON query plan |

MCP queries default to 200 rows and are capped at 1,000. The default timeout is 30 seconds.

## Architecture

```mermaid
flowchart LR
    UI["React + TypeScript workspace"] -->|"Wails bindings"| APP["Go desktop bridge"]
    APP --> SERVICE["PostgreSQL service"]
    MCP["Strata MCP server"] --> SERVICE
    SERVICE --> POOL["pgx connection pools"]
    POOL --> PG[("PostgreSQL")]
    APP --> STORE[("SQLite workspace")]
    APP --> VAULT["OS credential vault"]
```

The bridge in `app.go` stays intentionally narrow. PostgreSQL behavior belongs in `internal/postgres`, allowing the desktop application and MCP server to share catalog semantics, normalization, limits, and read-only behavior.

The frontend calls typed Wails methods through `frontend/src/lib/api.ts`. Missing bindings, disconnected state, query failures, and persistence errors remain explicit rather than falling back to mock responses.

More detail is available in [docs/architecture.md](architecture.md) and [docs/persistence.md](persistence.md).

## Project structure

```text
.
├── app.go                    # Wails bridge and application lifecycle
├── cmd/strata-mcp/           # Read-only MCP stdio server
├── docker/postgres/          # PostgreSQL 17 fixture and verification
├── docs/                     # Product, development, and architecture notes
├── frontend/
│   ├── src/components/       # Explorer, editor, results, plans, and dialogs
│   ├── src/editor/           # SQL statement parsing and catalog completion
│   ├── src/hooks/            # Connections, tabs, catalog, and UI state
│   └── src/lib/              # Wails API, export, formatting, and metadata
├── internal/credentials/     # OS credential-vault abstraction
├── internal/persistence/     # SQLite store and migrations
├── internal/postgres/        # Connections, catalog inspection, and queries
├── scripts/dev               # Start the fixture and Wails development mode
├── scripts/dev-db            # Development database lifecycle helper
└── wails.json                # Desktop build configuration
```

## Contributing

Issues and focused pull requests are welcome. Before opening a change:

1. Keep PostgreSQL behavior in `internal/postgres` rather than embedding it in frontend handlers.
2. Preserve visible safety controls for connection identity, read-only state, limits, and execution.
3. Do not persist credentials or query results outside their documented stores.
4. Add or update tests for service behavior and boundary conditions.
5. Run the fast checks and any relevant integration test.

Bug reports should include the operating system, PostgreSQL version, steps to reproduce, and the smallest SQL or schema example that demonstrates the problem. Remove credentials and sensitive row data before attaching logs or screenshots.
