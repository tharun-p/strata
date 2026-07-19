# Strata PostgreSQL fixture

This folder defines the reproducible PostgreSQL environment used to exercise Strata. One PostgreSQL 17 container hosts three independent databases with different domain models, catalog shapes, and hundreds of thousands of deterministic rows.

## Start it

From the repository root:

```bash
scripts/dev-db up
scripts/dev-db verify
```

The container listens only on `127.0.0.1:55432`. Data is stored in the Docker volume `strata-postgres-data` and survives container restarts.

Initialization scripts run only when the data volume is empty. Rebuild the image and recreate all fixture data after changing an init script:

```bash
scripts/dev-db reset
```

`reset` deletes the current development fixture volume. It does not affect PostgreSQL instances outside this Compose project.

## Connections

All databases share the same local development administrator:

| Field | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `55432` |
| Username | `strata` |
| Password | `strata_dev` |
| SSL mode | `disable` |

Connection URLs:

```text
postgresql://strata:strata_dev@127.0.0.1:55432/strata?sslmode=disable
postgresql://strata:strata_dev@127.0.0.1:55432/saas_control?sslmode=disable
postgresql://strata:strata_dev@127.0.0.1:55432/operations_hub?sslmode=disable
```

A read-only login is also created for MCP and permission-state testing:

```text
username: strata_reader
password: strata_reader_dev
```

These credentials are intentionally local development fixtures and must not be reused outside this repository.

## Database inventory

### `strata` — commerce investigation

Schemas: `commerce`, `analytics`, `audit`.

The original investigation fixture covers customers, products, orders, composite-key line items, payment attempts, refunds, tickets, partitioned events, analytical views, a materialized customer-value view, enums, a domain, generated columns, comments, triggers, and GIN/BRIN/partial/expression indexes.

### `saas_control` — multi-tenant SaaS platform

Schemas: `identity`, `iam`, `billing`, `product`, `telemetry`, `support`, `integrations`, `analytics`, `audit`, `archive`.

Representative scale:

- 400 organizations and 8,000 users
- 12,000 invoices and 24,000 invoice items
- 5,000 projects, 10,000 environments, and 12,000 API keys
- 80,000 partitioned telemetry events
- 4,000 support tickets, 1,600 integrations, and 30,000 audit records

Catalog scenarios include CITEXT and custom domains, tenant composite keys, dateranges, arrays, JSONB, INET, UUIDs, enums, partial indexes, expression indexes, GIN indexes, time partitions, views, a materialized view, SQL functions, comments, and update triggers.

### `operations_hub` — logistics and supply-chain operations

Schemas: `geo`, `hr`, `supply`, `warehouse`, `procurement`, `logistics`, `fleet`, `maintenance`, `finance`, `reporting`, `audit`.

Representative scale:

- 60 facilities, 1,500 employees, 500 suppliers, and 3,000 parts
- 6,000 warehouse bins and 30,000 stock balances
- 60,000 partitioned inventory movements
- 8,000 purchase orders and 24,000 composite-key order lines
- 20,000 shipments, 40,000 stops, and 100,000 partitioned tracking events
- 600 vehicles, 5,000 work orders, 15,000 expenses, and 30,000 audit records

This database adds self-referencing employee relationships, geospatial coordinate columns, multidimensional operational JSON, generated financial totals, composite and temporal keys, filtered indexes, route and inventory views, materialized daily volume, table-returning functions, and multiple partitioned event streams.

## Useful commands

```bash
# Interactive psql session
scripts/dev-db psql strata
scripts/dev-db psql saas_control
scripts/dev-db psql operations_hub

# Container state
scripts/dev-db status

# Validate databases, schema counts, relation counts, and analyzed row estimates
scripts/dev-db verify

# Stop without deleting data
scripts/dev-db down
```

Useful catalog queries:

```sql
SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;

SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
ORDER BY schemaname, tablename, indexname;
```

## Folder layout

```text
docker/postgres/
├── Dockerfile
├── README.md
├── verify.sh
└── init/
    ├── 000_databases.sql
    ├── 001_schema.sql
    ├── 002_seed.sql
    ├── 003_strata_access.sql
    ├── 010_saas_schema.sql
    ├── 011_saas_seed.sql
    ├── 020_operations_schema.sql
    ├── 021_operations_seed.sql
    └── 099_fixture_manifest.sql
```

The numeric prefixes are part of the contract: the official PostgreSQL entrypoint executes the files lexicographically on first initialization.
