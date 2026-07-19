\set ON_ERROR_STOP on

SELECT 'CREATE DATABASE saas_control OWNER strata TEMPLATE template0 ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'saas_control')\gexec

SELECT 'CREATE DATABASE operations_hub OWNER strata TEMPLATE template0 ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'operations_hub')\gexec

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'strata_reader') THEN
    CREATE ROLE strata_reader LOGIN PASSWORD 'strata_reader_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END;
$$;

GRANT CONNECT ON DATABASE strata TO strata_reader;
GRANT CONNECT ON DATABASE saas_control TO strata_reader;
GRANT CONNECT ON DATABASE operations_hub TO strata_reader;

ALTER DATABASE strata SET timezone = 'UTC';
ALTER DATABASE saas_control SET timezone = 'UTC';
ALTER DATABASE operations_hub SET timezone = 'UTC';

