# Product principles

## Positioning

Strata is a PostgreSQL investigator, not an admin console with an AI button attached. Its core loop is:

1. Ask a question or notice an anomaly.
2. Gather relevant schema context.
3. Draft and review SQL.
4. Inspect results and the query plan.
5. Branch, compare, annotate, and preserve evidence.
6. Share a reproducible investigation rather than a screenshot.

## Non-negotiables

- **PostgreSQL depth over database breadth.** Catalogs, types, locks, plans, bloat, partitions, extensions, replication, and Postgres-specific failure modes should feel native.
- **Local-first trust.** Credentials, query history, and AI context remain under the operator's control.
- **Fast paths stay fast.** Connection and catalog work happens in Go; the UI paints independently; the SQL editor is code-split; results are capped and streamed in the service boundary.
- **Safety is visible.** Read-only state, target database, timeout, row cap, and whether a plan executes are always present at the point of action.
- **AI drafts, humans authorize.** Generated SQL is schema-grounded, explained, editable, and never silently executed.
- **Every conclusion is traceable.** A finding links back to SQL, parameters, connection identity, timestamp, and plan.

## V1 milestones

### M0 — foundation (this repository)

- Desktop shell and polished investigation workspace.
- PostgreSQL connection, catalog introspection, SQL results, and non-executing plans.
- Containerized PostgreSQL 17 fixture database with automatic startup connection and no runtime mocks.
- Read-only MCP server with schema, query, and plan tools.
- Local SQLite persistence for profiles, scoped configuration, autosaved SQL workbooks, revisions, and result-free query history.
- Opt-in operating-system credential-vault storage with no password persistence in browser or project files.

### M1 — dependable daily driver

- SSH tunnels, cloud CA bundles, and expanded authentication providers on top of the existing credential-vault profile model.
- Workbook library, starred queries, history UI, Trash/revision recovery, and explicit result snapshots on top of the existing durable workbook store.
- Server-side cancellation, `COPY` streaming, editable parameters, and PostgreSQL type-aware cell views.
- Plan comparison, index recommendations with evidence, locks/activity, and query error locations.

### M2 — investigation system

- Branchable investigation timeline with notes, snapshots, comparisons, and shareable local bundles.
- Schema-grounded natural-language-to-SQL with provider choice, prompt preview, validation, and feedback.
- Relationship graph, lineage hints, data profiling on explicit request, and anomaly comparison.
- MCP lifecycle controls in the app, scoped tool grants, audit log, and per-connection policies.

### M3 — web without a rewrite

- Put the existing Go application services behind authenticated HTTP/WebSocket adapters.
- Reuse the React workspace with a web transport implementation.
- Add organizations, encrypted server-side credentials, policy, and collaborative investigations only then.

## Explicitly out of scope for the first release

- MySQL, SQLite, warehouses, or generic JDBC/ODBC abstraction.
- Schema migrations and full DBA administration.
- Autonomous writes or background model access to database values.
- Collaborative cloud sync before the local investigation model is excellent.
