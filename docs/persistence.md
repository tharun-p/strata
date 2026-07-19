# Local persistence

Strata separates durable application state, secrets, and ephemeral database data.

## Stores

| Store | Data | Lifetime |
| --- | --- | --- |
| `strata.db` | Connection profiles, scoped settings, workbooks/documents, revisions, and query-run metadata | Until the user deletes it |
| OS credential vault | PostgreSQL passwords keyed by an opaque profile ID and purpose | Until credentials are forgotten or the profile is deleted |
| Go process memory | Resolved passwords, `pgx` pools, live results, and plans | Current application session |
| WebView storage | One-time source for legacy profile/tab/layout import | Cleared after successful backend import |

The database is placed in the platform user configuration directory under `Strata/strata.db`. `STRATA_DATA_DIR` overrides the directory for tests and development. Strata creates the directory with owner-only permissions and the database with mode `0600` on Unix systems.

## Schema and evolution

Migrations are embedded, forward-only, ordered, and applied in transactions. Stable identity and relationships use relational columns; feature-specific document content uses a `content_version` plus JSON payload. New document kinds can therefore be added without turning profiles or workbooks into untyped key/value records.

The `settings` table is namespaced and scoped. Current UI code exposes typed workspace settings rather than arbitrary frontend writes. Future settings should add a typed Go boundary and reuse the same table.

Persistent documents reference a connection profile UUID. A live PostgreSQL connection ID is session-only and must never be written into a workbook.

## Credential lifecycle

1. PostgreSQL accepts the supplied credentials.
2. Strata saves or updates the non-secret connection profile.
3. When the user selected **Remember password securely**, Strata writes the password to the OS vault.
4. SQLite receives only an opaque binding with owner, purpose, provider, and availability status.

Replacing a password follows the same order, so a failed credential never overwrites a working saved value. Forgetting credentials preserves the profile. Deleting a profile deletes its credential-vault item before removing local metadata.

## Workbooks and history

The open query workspace is an autosaved workbook containing ordered SQL documents. SQL and natural-language questions are durable; results and explain output are not. Saves use monotonically increasing revisions and reject stale expected revisions. Explicit future checkpoints can retain the latest 20 snapshots through the existing revision table.

Executed-query history contains SQL and execution metadata but no returned rows or raw server error text. It is limited to 90 days and 10,000 entries. Profiles marked **Private history** do not create query-run records.

## Security invariants

- Never add password, token, passphrase, or private-key columns to SQLite.
- Never return a stored secret through a Wails method.
- Never log full connection URLs or credential-vault payloads.
- Never persist result rows implicitly.
- Never clear a legacy browser-storage key before the corresponding backend write succeeds.
- Exports and future synchronization omit credential bindings and secrets by default.
