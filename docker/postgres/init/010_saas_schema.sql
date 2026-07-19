\set ON_ERROR_STOP on
\connect saas_control strata

SET timezone = 'UTC';

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA identity;
CREATE SCHEMA iam;
CREATE SCHEMA billing;
CREATE SCHEMA product;
CREATE SCHEMA telemetry;
CREATE SCHEMA support;
CREATE SCHEMA integrations;
CREATE SCHEMA analytics;
CREATE SCHEMA audit;
CREATE SCHEMA archive;

CREATE TYPE billing.subscription_status AS ENUM ('trialing', 'active', 'past_due', 'paused', 'cancelled');
CREATE TYPE billing.invoice_status AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
CREATE TYPE support.ticket_status AS ENUM ('new', 'open', 'waiting', 'resolved', 'closed');

CREATE DOMAIN identity.email_address AS citext
  CHECK (position('@' IN VALUE::text) > 1);

CREATE FUNCTION audit.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TABLE identity.organizations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug citext NOT NULL UNIQUE,
  name text NOT NULL,
  region text NOT NULL CHECK (region IN ('us-east', 'us-west', 'eu-west', 'ap-south', 'ap-southeast')),
  industry text NOT NULL,
  employee_band text NOT NULL CHECK (employee_band IN ('1-20', '21-100', '101-500', '501-2000', '2000+')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

COMMENT ON TABLE identity.organizations IS 'SaaS tenants with regional placement and lifecycle metadata.';

CREATE TABLE identity.users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  email identity.email_address NOT NULL,
  display_name text NOT NULL,
  job_title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, email)
);

CREATE TABLE iam.roles (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  system_role boolean NOT NULL DEFAULT true
);

CREATE TABLE iam.memberships (
  organization_id bigint NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role_id smallint NOT NULL REFERENCES iam.roles(id),
  invited_by_user_id bigint REFERENCES identity.users(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

COMMENT ON TABLE iam.memberships IS 'Composite-key tenant membership and role assignment table.';

CREATE TABLE billing.plans (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  monthly_price numeric(12,2) NOT NULL CHECK (monthly_price >= 0),
  included_seats integer NOT NULL CHECK (included_seats > 0),
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE billing.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL UNIQUE REFERENCES identity.organizations(id),
  plan_id smallint NOT NULL REFERENCES billing.plans(id),
  status billing.subscription_status NOT NULL,
  seat_count integer NOT NULL CHECK (seat_count > 0),
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  current_period_start date NOT NULL,
  current_period_end date NOT NULL,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end > current_period_start)
);

CREATE TABLE billing.invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_number text NOT NULL UNIQUE,
  organization_id bigint NOT NULL REFERENCES identity.organizations(id),
  subscription_id uuid NOT NULL REFERENCES billing.subscriptions(id),
  status billing.invoice_status NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  credit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  total_amount numeric(14,2) GENERATED ALWAYS AS (subtotal + tax_amount - credit_amount) STORED,
  issued_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  external_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (subtotal + tax_amount >= credit_amount)
);

CREATE TABLE billing.invoice_items (
  invoice_id bigint NOT NULL REFERENCES billing.invoices(id) ON DELETE CASCADE,
  line_number smallint NOT NULL CHECK (line_number > 0),
  description text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_amount numeric(14,2) NOT NULL CHECK (unit_amount >= 0),
  line_amount numeric(14,2) GENERATED ALWAYS AS (quantity * unit_amount) STORED,
  period daterange,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (invoice_id, line_number)
);

CREATE TABLE product.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'organization', 'public')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id bigint REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (organization_id, key)
);

CREATE TABLE product.environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES product.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('development', 'staging', 'production', 'preview')),
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE product.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES product.environments(id) ON DELETE CASCADE,
  key_prefix text NOT NULL UNIQUE,
  label text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telemetry.events (
  event_id bigint GENERATED ALWAYS AS IDENTITY,
  organization_id bigint NOT NULL,
  project_id uuid,
  event_name text NOT NULL,
  actor_user_id bigint,
  session_id uuid,
  source text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE telemetry.events_2025 PARTITION OF telemetry.events
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE telemetry.events_2026_h1 PARTITION OF telemetry.events
  FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE telemetry.events_2026_h2 PARTITION OF telemetry.events
  FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');
CREATE TABLE telemetry.events_default PARTITION OF telemetry.events DEFAULT;

COMMENT ON TABLE telemetry.events IS 'High-volume product event stream partitioned by event time.';

CREATE TABLE support.tickets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES identity.organizations(id),
  requester_user_id bigint REFERENCES identity.users(id) ON DELETE SET NULL,
  assignee_user_id bigint REFERENCES identity.users(id) ON DELETE SET NULL,
  status support.ticket_status NOT NULL DEFAULT 'new',
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  subject text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integrations.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'disconnected', 'error')),
  external_account_id text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE TABLE audit.change_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  organization_id bigint,
  actor_user_id bigint,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  request_id uuid,
  ip_address inet,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit.change_log_2025 PARTITION OF audit.change_log
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE audit.change_log_2026 PARTITION OF audit.change_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE audit.change_log_default PARTITION OF audit.change_log DEFAULT;

CREATE TABLE archive.deleted_projects (
  project_id uuid PRIMARY KEY,
  organization_id bigint NOT NULL,
  project_key text NOT NULL,
  snapshot jsonb NOT NULL,
  deleted_by_user_id bigint,
  deleted_at timestamptz NOT NULL
);

CREATE INDEX users_org_status_idx ON identity.users (organization_id, status, last_seen_at DESC);
CREATE INDEX users_email_lower_idx ON identity.users (lower(email::text));
CREATE INDEX organizations_settings_gin_idx ON identity.organizations USING gin (settings jsonb_path_ops);
CREATE INDEX memberships_role_idx ON iam.memberships (role_id, organization_id);
CREATE INDEX subscriptions_status_period_idx ON billing.subscriptions (status, current_period_end);
CREATE INDEX invoices_org_issued_idx ON billing.invoices (organization_id, issued_at DESC);
CREATE INDEX invoices_open_due_idx ON billing.invoices (due_at) WHERE status = 'open';
CREATE INDEX invoices_metadata_gin_idx ON billing.invoices USING gin (metadata jsonb_path_ops);
CREATE INDEX projects_org_updated_idx ON product.projects (organization_id, updated_at DESC);
CREATE INDEX projects_settings_gin_idx ON product.projects USING gin (settings);
CREATE INDEX api_keys_active_idx ON product.api_keys (environment_id, last_used_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX events_org_time_idx ON telemetry.events (organization_id, occurred_at DESC);
CREATE INDEX events_name_time_idx ON telemetry.events (event_name, occurred_at DESC);
CREATE INDEX events_properties_gin_idx ON telemetry.events USING gin (properties jsonb_path_ops);
CREATE INDEX tickets_org_status_idx ON support.tickets (organization_id, status, created_at DESC);
CREATE INDEX tickets_tags_gin_idx ON support.tickets USING gin (tags);
CREATE INDEX connections_provider_status_idx ON integrations.connections (provider, status);
CREATE INDEX change_log_entity_idx ON audit.change_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX change_log_request_idx ON audit.change_log (request_id) WHERE request_id IS NOT NULL;

CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON identity.organizations
FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON identity.users
FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON billing.subscriptions
FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER projects_set_updated_at
BEFORE UPDATE ON product.projects
FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER tickets_set_updated_at
BEFORE UPDATE ON support.tickets
FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER connections_set_updated_at
BEFORE UPDATE ON integrations.connections
FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE VIEW identity.organization_directory AS
SELECT
  o.id,
  o.slug,
  o.name,
  o.region,
  o.industry,
  count(u.id) FILTER (WHERE u.deleted_at IS NULL) AS user_count,
  max(u.last_seen_at) AS latest_user_activity,
  o.created_at
FROM identity.organizations o
LEFT JOIN identity.users u ON u.organization_id = o.id
GROUP BY o.id;

CREATE VIEW billing.invoice_aging AS
SELECT
  i.id,
  i.invoice_number,
  i.organization_id,
  o.name AS organization_name,
  i.status,
  i.total_amount,
  i.currency,
  i.due_at,
  greatest(0, current_date - i.due_at::date) AS days_overdue
FROM billing.invoices i
JOIN identity.organizations o ON o.id = i.organization_id
WHERE i.status IN ('open', 'uncollectible');

CREATE VIEW analytics.mrr_by_plan AS
SELECT
  p.code AS plan_code,
  p.name AS plan_name,
  count(*) FILTER (WHERE s.status IN ('trialing', 'active', 'past_due')) AS subscriptions,
  sum(CASE WHEN s.status IN ('active', 'past_due') THEN p.monthly_price ELSE 0 END) AS monthly_recurring_revenue,
  sum(s.seat_count) FILTER (WHERE s.status IN ('trialing', 'active', 'past_due')) AS active_seats
FROM billing.plans p
LEFT JOIN billing.subscriptions s ON s.plan_id = p.id
GROUP BY p.id;

CREATE VIEW analytics.organization_health AS
SELECT
  o.id AS organization_id,
  o.name,
  o.region,
  s.status AS subscription_status,
  p.code AS plan_code,
  count(DISTINCT u.id) FILTER (WHERE u.status = 'active') AS active_users,
  count(DISTINCT pr.id) FILTER (WHERE pr.archived_at IS NULL) AS active_projects,
  max(u.last_seen_at) AS latest_activity,
  count(DISTINCT t.id) FILTER (WHERE t.status IN ('new', 'open', 'waiting')) AS open_tickets
FROM identity.organizations o
LEFT JOIN billing.subscriptions s ON s.organization_id = o.id
LEFT JOIN billing.plans p ON p.id = s.plan_id
LEFT JOIN identity.users u ON u.organization_id = o.id
LEFT JOIN product.projects pr ON pr.organization_id = o.id
LEFT JOIN support.tickets t ON t.organization_id = o.id
GROUP BY o.id, s.status, p.code;

CREATE MATERIALIZED VIEW analytics.daily_active_organizations AS
SELECT
  occurred_at::date AS activity_date,
  count(DISTINCT organization_id) AS active_organizations,
  count(*) AS event_count,
  count(DISTINCT actor_user_id) AS active_users
FROM telemetry.events
GROUP BY 1
WITH NO DATA;

CREATE UNIQUE INDEX daily_active_orgs_date_idx ON analytics.daily_active_organizations (activity_date);

CREATE FUNCTION billing.organization_mrr(target_organization_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN s.status IN ('active', 'past_due') THEN p.monthly_price ELSE 0 END
  FROM billing.subscriptions s
  JOIN billing.plans p ON p.id = s.plan_id
  WHERE s.organization_id = target_organization_id;
$$;

CREATE FUNCTION identity.organization_members(target_organization_id bigint)
RETURNS TABLE (user_id bigint, email citext, display_name text, role_code text, last_seen_at timestamptz)
LANGUAGE sql
STABLE
AS $$
  SELECT u.id, u.email::citext, u.display_name, r.code, u.last_seen_at
  FROM identity.users u
  JOIN iam.memberships m ON m.organization_id = u.organization_id AND m.user_id = u.id
  JOIN iam.roles r ON r.id = m.role_id
  WHERE u.organization_id = target_organization_id
  ORDER BY u.display_name;
$$;

GRANT USAGE ON SCHEMA identity, iam, billing, product, telemetry, support, integrations, analytics, audit, archive TO strata_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA identity, iam, billing, product, telemetry, support, integrations, analytics, audit, archive TO strata_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, iam, billing, product, telemetry, support, integrations, analytics, audit, archive GRANT SELECT ON TABLES TO strata_reader;

