\set ON_ERROR_STOP on
\connect strata strata

GRANT USAGE ON SCHEMA commerce, analytics, audit TO strata_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA commerce, analytics, audit TO strata_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA commerce, analytics, audit GRANT SELECT ON TABLES TO strata_reader;

