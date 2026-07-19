<div align="center">

<h1><img src="docs/icon.png" alt="Strata icon" width="44" height="44" valign="middle"> Strata</h1>

**The PostgreSQL workspace built for investigation.**

Explore schemas, write SQL, inspect results, and understand query performance<br>
without losing the context behind the work.

[Overview](#overview) · [Capabilities](#capabilities) · [Security](#security-by-design) · [Roadmap](#roadmap) · [Documentation](#documentation)

</div>

---

## Overview

Database work rarely ends with opening a table.

A customer reports an issue. A metric changes without explanation. A query that used to be fast starts timing out. An unfamiliar schema becomes your responsibility. Reaching an answer often means moving between a database browser, SQL editor, terminal, query-plan viewer, notes, and screenshots.

Strata brings that investigation into one focused desktop workspace.

It keeps the PostgreSQL catalog, SQL, query results, plans, and working context together—so you can move from a symptom to an explanation without reconstructing your process across several tools.

## Why Strata

| Principle | What it means |
| --- | --- |
| **PostgreSQL-native** | Catalogs, types, indexes, plans, partitions, and PostgreSQL behavior are first-class product concepts. |
| **Investigation-first** | The workspace is organized around understanding a problem, not simply browsing objects or executing statements. |
| **Safe by default** | Read-only mode, connection identity, row limits, timeouts, and execution state remain visible while you work. |
| **Local-first** | Workbooks and settings stay on your machine. Live results remain in memory, and password storage uses the operating-system vault. |
| **Human-controlled** | Strata can assist with analysis, but it does not silently execute generated actions or enable writes. |

## Capabilities

### Explore PostgreSQL in context

- Work across multiple servers and databases from one workspace.
- Browse schemas, tables, views, materialized views, and foreign tables.
- Inspect columns, keys, indexes, comments, relation sizes, row estimates, and vacuum activity.
- Search database objects without leaving the current investigation.

### Write SQL with confidence

- Use a PostgreSQL-aware editor with schema, relation, and column completion.
- Keep every query tab attached to a visible database connection.
- Run the selected statement or the statement at the cursor.
- Cancel in-flight work and keep expensive queries bounded.
- Enable writes only through an explicit session-level decision.

### Work with real result sets

- Explore large results in a responsive virtualized grid.
- Filter rows and hide columns without rerunning the query.
- Expand long values without distorting the table.
- Copy individual cells or complete rows.
- Export results as CSV or JSON when they need to leave Strata.

### Understand query plans

- Generate non-executing PostgreSQL plans.
- Read plans as a navigable tree instead of raw JSON.
- See operations, relations, indexes, estimated rows, and costs together.
- Identify expensive plan nodes and understand scan strategy more quickly.

### Continue where you stopped

- Restore saved connection profiles and SQL workbooks.
- Reopen tabs with their database context intact.
- Preserve workspace layout across sessions.
- Keep returned rows ephemeral unless you explicitly export them.

## Designed for real investigations

Strata supports the work that happens between noticing a problem and reaching a defensible conclusion.

| Use case | How Strata helps |
| --- | --- |
| **Understand an unfamiliar database** | Explore schema structure, relationships, comments, indexes, and representative queries in one place. |
| **Investigate incorrect data** | Follow related records across tables while keeping every query tied to its source database. |
| **Debug customer and application issues** | Build a focused SQL workbook that preserves the steps behind the finding. |
| **Analyze query performance** | Move directly from SQL to a visual PostgreSQL plan without executing `EXPLAIN ANALYZE`. |
| **Review production safely** | Start read-only, keep limits visible, and require explicit confirmation before writes are available. |

## PostgreSQL without compromise

Strata is not a generic database client with PostgreSQL added as one option among many. PostgreSQL is the product.

That focus makes room for deeper support for PostgreSQL-specific workflows—plans, locks, activity, bloat, partitions, extensions, replication, lineage, and failure modes—without being constrained by a lowest-common-denominator database abstraction.

## Security by design

Strata separates application state, credentials, and database data.

| Data | Storage |
| --- | --- |
| Connection metadata, settings, workbooks, and bounded query history | Local SQLite database |
| Saved PostgreSQL passwords | Keychain, Credential Manager, or Secret Service |
| Query results, resolved credentials, and plans | Process memory for the current session |

Additional safeguards include:

- read-only mode by default for desktop queries;
- mandatory read-only transactions for MCP queries;
- visible query timeouts and row limits;
- non-executing query plans without `ANALYZE`;
- no password persistence in browser storage or project files;
- no automatic persistence of returned rows; and
- private-history profiles that omit executed statements from query history.

[Read the local persistence and security model](docs/persistence.md).

## Controlled access for AI tools

Strata includes a separate MCP server for tools that need PostgreSQL context without unrestricted database access.

The MCP surface can inspect schemas and relations, run bounded read-only queries, and produce non-executing plans. Credentials are supplied to the isolated process rather than passed through tool arguments, and database writes are not exposed.

## Product direction

Strata’s long-term goal is to make the investigation—not the connection or query tab—the durable unit of work.

A complete investigation should preserve the original question, relevant schema context, queries and revisions, result snapshots, plan comparisons, observations, and supporting evidence. Another person should be able to review the conclusion without relying on a collection of screenshots or undocumented steps.

That direction shapes the product today: fast paths stay fast, safety remains visible, and every conclusion should be traceable to the database work behind it.

## Roadmap

| Stage | Focus |
| --- | --- |
| **Available today** | Multi-database exploration, schema-aware SQL, virtualized results, visual plans, persistent workbooks, secure credentials, and read-only MCP access. |
| **Next** | Packaged desktop releases, SSH tunnels, cloud authentication, richer history, recovery, result snapshots, parameters, and type-specific value viewers. |
| **Investigation workflows** | Plan comparison, index guidance, locks and activity, branchable timelines, notes, evidence, and reproducible investigation bundles. |
| **Assisted analysis** | Schema-grounded natural-language SQL with provider choice, prompt visibility, validation, and human approval. |

[View the complete product principles and roadmap](docs/product.md).

## Documentation

| Document | Description |
| --- | --- |
| [Product principles](docs/product.md) | Positioning, product boundaries, and milestones |
| [Local persistence](docs/persistence.md) | Storage model, credential lifecycle, and security invariants |
| [Architecture](docs/architecture.md) | Application services, frontend boundaries, and transport design |
| [Development guide](docs/development.md) | Source setup, builds, tests, MCP configuration, and contribution workflow |
| [Contributing](CONTRIBUTING.md) | Contribution workflow, engineering principles, tests, and pull-request expectations |

## Project status

Strata is under active development toward its first production-ready release. The current source build is available for early users and contributors; packaged desktop releases will follow as the release pipeline is completed.

### Platform testing

The desktop application is currently developed and tested on macOS only. Windows and Linux builds have not yet been tested or validated, so platform-specific build, credential-vault, windowing, and runtime issues should be expected on those systems. Windows and Linux support is planned, but should not be considered production-ready yet.

Follow the repository to track progress. If you want to run Strata from source or contribute, start with the [development guide](docs/development.md).
