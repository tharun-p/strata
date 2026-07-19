#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$project_root"

databases=(strata saas_control operations_hub)

docker compose exec -T postgres psql -U strata -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT datname AS database FROM pg_database WHERE datname = ANY (ARRAY['strata','saas_control','operations_hub']) ORDER BY datname;"

for database in "${databases[@]}"; do
  docker compose exec -T postgres psql -U strata -d "$database" -v ON_ERROR_STOP=1 -c \
    "SELECT current_database() AS database,
            (SELECT fixture_version FROM public.strata_fixture_manifest LIMIT 1) AS fixture_version,
            count(DISTINCT n.nspname) FILTER (WHERE n.nspname <> 'public') AS schemas,
            count(*) FILTER (WHERE c.relkind IN ('r','p')) AS tables,
            count(*) FILTER (WHERE c.relkind IN ('v','m')) AS views,
            coalesce(sum(greatest(c.reltuples, 0)) FILTER (WHERE c.relkind = 'r'), 0)::bigint AS approximate_rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname !~ '^pg_toast';"
done
