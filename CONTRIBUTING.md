# Contributing to Strata

Thank you for helping improve Strata. The project welcomes focused bug fixes, tests, documentation, performance improvements, and features that strengthen PostgreSQL investigation workflows.

Strata is under active development. Before investing in a large change, open an issue or discussion describing the problem, intended user experience, and proposed technical direction. This helps avoid duplicate work and changes that conflict with the product direction.

## Current platform status

Development and release testing currently happen on macOS. Windows and Linux builds have not yet been validated and are not considered production-ready. Reports and fixes for those platforms are welcome; include the operating system version, architecture, desktop environment where applicable, and Wails diagnostic output.

## Prerequisites

- Go 1.25 or later
- Node.js 20 or later
- Docker Desktop or a compatible Docker environment
- Platform dependencies required by [Wails v2](https://wails.io/docs/gettingstarted/installation/)

The complete local setup is documented in [docs/development.md](docs/development.md).

## Set up the project

```bash
git clone https://github.com/dbexplorer/strata.git
cd strata
npm --prefix frontend install
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
scripts/dev
```

The development PostgreSQL fixture runs at `127.0.0.1:55432` and contains three databases with deterministic schemas and data. Connection details and fixture commands are documented in [docker/postgres/README.md](docker/postgres/README.md).

Use a separate application-data directory when testing persistence changes:

```bash
export STRATA_DATA_DIR=/tmp/strata-development
wails dev
```

Never commit local application data, passwords, credentials, exported production data, or database logs containing sensitive values.

## Development principles

Contributions should preserve these boundaries:

- Keep PostgreSQL connection, catalog, query, and plan behavior in `internal/postgres`.
- Keep durable configuration and workbook behavior in `internal/persistence`.
- Store passwords only through the operating-system credential vault abstraction in `internal/credentials`.
- Keep the Wails bridge in `app.go` narrow and typed.
- Call backend methods from the frontend through `frontend/src/lib/api.ts`.
- Do not introduce mock database data as a runtime fallback.
- Keep connection identity, read-only state, query limits, timeouts, and execution status visible.
- Never execute generated SQL without an explicit user action.
- Do not persist query results unless the user explicitly exports them.

Read [docs/architecture.md](docs/architecture.md), [docs/persistence.md](docs/persistence.md), and [docs/product.md](docs/product.md) before changing these boundaries.

## SQL editor changes

The SQL editor is designed around isolated documents and background processing. Editor contributions must not reintroduce controlled React text state or cross-document state sharing.

- Preserve one independent CodeMirror `EditorState` per opened worksheet.
- Route editor changes, query jobs, and results by document ID and revision.
- Keep large statement indexing and catalog construction off the UI thread.
- Never infer an execution range while the statement index is stale.
- Keep editor controls outside selectable SQL text.
- Add regression coverage for selection, Undo/Redo, tab switching, and large-document behavior when relevant.

## PostgreSQL fixture

Start and verify the fixture with:

```bash
scripts/dev-db up
scripts/dev-db verify
```

Initialization files live in `docker/postgres/init/` and run in filename order. Fixture changes must be deterministic and should cover realistic PostgreSQL behavior rather than UI-only examples.

Rebuild the fixture after changing initialization scripts:

```bash
scripts/dev-db reset
```

`reset` deletes the Strata development fixture volume. Do not run it against data you need to preserve.

## Tests and release checks

Run the checks relevant to your change. Before opening a pull request, run the complete fast suite:

```bash
go test ./...
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

Editor or interaction changes should also pass the WebKit end-to-end suite:

```bash
npm --prefix frontend run test:e2e
```

PostgreSQL service, catalog, connection, or query-scheduling changes should run against the live fixture:

```bash
scripts/dev-db up
STRATA_POSTGRES_INTEGRATION=1 go test ./...
```

Changes that affect desktop lifecycle, windowing, credentials, bindings, or packaging must include a native build:

```bash
wails build
```

Add tests for new behavior and regressions. Performance-sensitive editor changes should include representative large-document or large-catalog coverage, not only small unit fixtures.

## Code and documentation style

- Format Go code with `gofmt`.
- Keep TypeScript type-safe and free of lint errors.
- Prefer explicit errors over silent fallbacks.
- Keep functions focused and place behavior in the owning package or module.
- Explain security, persistence, concurrency, or migration decisions in code comments or documentation where the reason is not obvious.
- Update user-facing documentation when behavior, configuration, shortcuts, or platform support changes.

Avoid unrelated formatting or refactoring in a focused pull request. Smaller changes are easier to review and safer to validate.

## Reporting bugs

A useful bug report includes:

- Strata version or commit;
- operating system, version, and architecture;
- PostgreSQL version and relevant extensions;
- exact reproduction steps;
- expected and actual behavior;
- relevant logs or screenshots; and
- the smallest safe schema or SQL example that reproduces the issue.

Remove credentials, connection strings, customer data, and other sensitive values before sharing any artifact.

For performance reports, include document size, approximate statement or catalog count, number of open worksheets, and whether queries were running concurrently.

## Pull requests

Keep pull requests focused on one problem. The description should explain:

1. the user or developer problem being solved;
2. the chosen approach and important trade-offs;
3. security, persistence, concurrency, or compatibility implications;
4. tests performed; and
5. screenshots or recordings for visible UI changes.

Before requesting review, confirm that:

- the application has no mock or silent fallback for the changed behavior;
- credentials and returned database data are handled according to the security model;
- migrations or content-version changes are backward compatible;
- asynchronous work is routed to the originating connection, workbook, and document;
- tests cover the new behavior and relevant failures; and
- documentation is updated where needed.
