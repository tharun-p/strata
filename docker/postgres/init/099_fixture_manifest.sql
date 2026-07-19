\set ON_ERROR_STOP on

\connect strata strata
CREATE TABLE public.strata_fixture_manifest (
  fixture_version text PRIMARY KEY,
  database_role text NOT NULL,
  expected_rows bigint NOT NULL,
  initialized_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.strata_fixture_manifest (fixture_version, database_role, expected_rows)
VALUES ('2026-07-19-v1', 'commerce', 10239);
GRANT SELECT ON public.strata_fixture_manifest TO strata_reader;

\connect saas_control strata
CREATE TABLE public.strata_fixture_manifest (
  fixture_version text PRIMARY KEY,
  database_role text NOT NULL,
  expected_rows bigint NOT NULL,
  initialized_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.strata_fixture_manifest (fixture_version, database_role, expected_rows)
VALUES ('2026-07-19-v1', 'saas', 195458);
GRANT SELECT ON public.strata_fixture_manifest TO strata_reader;

\connect operations_hub strata
CREATE TABLE public.strata_fixture_manifest (
  fixture_version text PRIMARY KEY,
  database_role text NOT NULL,
  expected_rows bigint NOT NULL,
  initialized_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.strata_fixture_manifest (fixture_version, database_role, expected_rows)
VALUES ('2026-07-19-v1', 'operations', 344659);
GRANT SELECT ON public.strata_fixture_manifest TO strata_reader;

