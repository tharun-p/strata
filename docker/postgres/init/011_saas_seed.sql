\set ON_ERROR_STOP on
\connect saas_control strata

SET timezone = 'UTC';
SELECT setseed(0.271828);

INSERT INTO iam.roles (code, name, permissions)
VALUES
  ('owner', 'Organization owner', ARRAY['*']),
  ('admin', 'Administrator', ARRAY['users:write', 'billing:read', 'projects:write', 'audit:read']),
  ('member', 'Member', ARRAY['projects:read', 'projects:write', 'telemetry:read']),
  ('viewer', 'Viewer', ARRAY['projects:read', 'telemetry:read']);

INSERT INTO billing.plans (code, name, monthly_price, included_seats, limits)
VALUES
  ('free', 'Free', 0, 3, '{"events":10000,"projects":2,"retention_days":7}'),
  ('starter', 'Starter', 49, 10, '{"events":100000,"projects":10,"retention_days":30}'),
  ('growth', 'Growth', 199, 30, '{"events":1000000,"projects":50,"retention_days":90}'),
  ('scale', 'Scale', 799, 100, '{"events":10000000,"projects":250,"retention_days":365}'),
  ('enterprise', 'Enterprise', 2499, 500, '{"events":100000000,"projects":1000,"retention_days":730}');

INSERT INTO identity.organizations (slug, name, region, industry, employee_band, settings, created_at)
SELECT
  format('tenant-%s', g),
  format('%s %s',
    (ARRAY['Northstar','Meridian','Canvas','Orbit','Vertex','Prism','Signal','Harbor','Summit','Lattice'])[1 + (g % 10)],
    (ARRAY['Labs','Systems','Cloud','Studio','Health','Commerce','AI','Works'])[1 + ((g * 7) % 8)]
  ),
  (ARRAY['us-east','us-west','eu-west','ap-south','ap-southeast'])[1 + (g % 5)],
  (ARRAY['technology','healthcare','financial-services','retail','media','manufacturing','education'])[1 + (g % 7)],
  (ARRAY['1-20','21-100','101-500','501-2000','2000+'])[1 + (g % 5)],
  jsonb_build_object(
    'sso_enabled', g % 7 = 0,
    'data_residency', (ARRAY['standard','regional','dedicated'])[1 + (g % 3)],
    'feature_flags', jsonb_build_array('investigations', CASE WHEN g % 2 = 0 THEN 'exports' ELSE 'dashboards' END)
  ),
  now() - ((60 + g % 900) || ' days')::interval
FROM generate_series(1, 400) AS g;

INSERT INTO identity.users (
  organization_id, email, display_name, job_title, status, preferences,
  last_seen_at, created_at, deleted_at
)
SELECT
  1 + ((g - 1) % 400),
  format('user%s@tenant%s.example', g, 1 + ((g - 1) % 400)),
  format('%s %s',
    (ARRAY['Aarav','Maya','Theo','Nora','Mateo','Sofia','Eli','Amara','Noah','Iris','Lena','Owen'])[1 + (g % 12)],
    (ARRAY['Shah','Miller','Garcia','Wilson','Brown','Martin','Kim','Patel','Taylor','Nguyen'])[1 + ((g * 7) % 10)]
  ),
  (ARRAY['Engineer','Product Manager','Data Analyst','Designer','Support Lead','Finance Manager','Founder'])[1 + (g % 7)],
  CASE WHEN g % 97 = 0 THEN 'suspended' WHEN g % 43 = 0 THEN 'invited' WHEN g % 211 = 0 THEN 'deactivated' ELSE 'active' END,
  jsonb_build_object('theme', CASE WHEN g % 3 = 0 THEN 'dark' ELSE 'system' END, 'digest', g % 4 <> 0),
  CASE WHEN g % 43 = 0 THEN NULL ELSE now() - ((g % 1200) || ' hours')::interval END,
  now() - ((30 + g % 850) || ' days')::interval,
  CASE WHEN g % 211 = 0 THEN now() - ((g % 90) || ' days')::interval ELSE NULL END
FROM generate_series(1, 8000) AS g;

INSERT INTO iam.memberships (organization_id, user_id, role_id, invited_by_user_id, joined_at)
SELECT
  u.organization_id,
  u.id,
  CASE WHEN u.id <= 400 THEN 1 WHEN u.id % 17 = 0 THEN 2 WHEN u.id % 7 = 0 THEN 4 ELSE 3 END,
  CASE WHEN u.id > 400 THEN u.organization_id ELSE NULL END,
  u.created_at + interval '1 hour'
FROM identity.users u;

INSERT INTO billing.subscriptions (
  organization_id, plan_id, status, seat_count, billing_interval,
  current_period_start, current_period_end, trial_ends_at,
  cancel_at_period_end, metadata, created_at
)
SELECT
  o.id,
  1 + (o.id % 5)::smallint,
  (CASE
    WHEN o.id % 37 = 0 THEN 'cancelled'
    WHEN o.id % 29 = 0 THEN 'past_due'
    WHEN o.id % 23 = 0 THEN 'paused'
    WHEN o.id % 17 = 0 THEN 'trialing'
    ELSE 'active'
  END)::billing.subscription_status,
  3 + (o.id % 240)::integer,
  CASE WHEN o.id % 4 = 0 THEN 'annual' ELSE 'monthly' END,
  current_date - (o.id % 28)::integer,
  current_date - (o.id % 28)::integer + CASE WHEN o.id % 4 = 0 THEN 365 ELSE 30 END,
  CASE WHEN o.id % 17 = 0 THEN now() + interval '10 days' ELSE NULL END,
  o.id % 37 = 0,
  jsonb_build_object('sales_assisted', o.id % 9 = 0, 'contract_id', CASE WHEN o.id % 4 = 0 THEN format('CTR-%s', o.id) ELSE NULL END),
  o.created_at + interval '2 days'
FROM identity.organizations o;

WITH subscription_pool AS (
  SELECT organization_id, id AS subscription_id FROM billing.subscriptions
)
INSERT INTO billing.invoices (
  invoice_number, organization_id, subscription_id, status, currency,
  subtotal, tax_amount, credit_amount, issued_at, due_at, paid_at,
  external_reference, metadata
)
SELECT
  format('INV-%s-%s', to_char(now() - ((g % 720) || ' days')::interval, 'YYYYMM'), lpad(g::text, 7, '0')),
  1 + ((g - 1) % 400),
  sp.subscription_id,
  (CASE
    WHEN g % 61 = 0 THEN 'uncollectible'
    WHEN g % 47 = 0 THEN 'void'
    WHEN g % 13 = 0 THEN 'open'
    WHEN g % 31 = 0 THEN 'draft'
    ELSE 'paid'
  END)::billing.invoice_status,
  (ARRAY['USD','USD','USD','EUR','GBP','INR','SGD'])[1 + (g % 7)],
  round((25 + (g % 1800) * 1.73 + random() * 80)::numeric, 2),
  round((g % 140 * 0.79)::numeric, 2),
  CASE WHEN g % 19 = 0 THEN round((5 + g % 120)::numeric, 2) ELSE 0 END,
  now() - ((g % 720) || ' days')::interval,
  now() - ((g % 720) || ' days')::interval + interval '30 days',
  CASE WHEN g % 13 <> 0 AND g % 61 <> 0 AND g % 47 <> 0 AND g % 31 <> 0
    THEN now() - ((g % 720) || ' days')::interval + interval '8 days' ELSE NULL END,
  format('stripe_inv_%s', g),
  jsonb_build_object('attempts', 1 + g % 3, 'automatic_tax', g % 5 = 0)
FROM generate_series(1, 12000) AS g
JOIN subscription_pool sp ON sp.organization_id = 1 + ((g - 1) % 400);

INSERT INTO billing.invoice_items (
  invoice_id, line_number, description, quantity, unit_amount, period, metadata
)
SELECT
  i.id,
  line_no,
  CASE line_no WHEN 1 THEN 'Platform subscription' ELSE 'Usage overage' END,
  CASE line_no WHEN 1 THEN 1 ELSE 10 + i.id % 500 END,
  CASE line_no WHEN 1 THEN round((i.subtotal * 0.8)::numeric, 2) ELSE round((i.subtotal * 0.2 / (10 + i.id % 500))::numeric, 4) END,
  daterange(i.issued_at::date - 30, i.issued_at::date, '[)'),
  jsonb_build_object('meter', CASE line_no WHEN 1 THEN 'subscription' ELSE 'events' END)
FROM billing.invoices i
CROSS JOIN generate_series(1, 2) AS line_no;

INSERT INTO product.projects (
  organization_id, key, name, visibility, settings, created_by_user_id, created_at, archived_at
)
SELECT
  1 + ((g - 1) % 400),
  format('project-%s', g),
  format('%s %s',
    (ARRAY['Checkout','Identity','Growth','Warehouse','Insights','Mobile','Platform'])[1 + (g % 7)],
    (ARRAY['API','Workspace','Pipeline','Console','Service'])[1 + (g % 5)]
  ),
  (ARRAY['private','private','organization','public'])[1 + (g % 4)],
  jsonb_build_object('retention_days', (ARRAY[7,30,90,365])[1 + (g % 4)], 'sampling_rate', round((0.1 + (g % 10) * 0.1)::numeric, 2)),
  1 + ((g - 1) % 8000),
  now() - ((g % 700) || ' days')::interval,
  CASE WHEN g % 101 = 0 THEN now() - ((g % 60) || ' days')::interval ELSE NULL END
FROM generate_series(1, 5000) AS g;

INSERT INTO product.environments (project_id, name, kind, variables, created_at)
SELECT
  p.id,
  env.name,
  env.kind,
  jsonb_build_object('region', (ARRAY['iad','sfo','fra','sin'])[1 + (p.organization_id % 4)], 'debug', env.kind = 'development'),
  p.created_at + interval '1 hour'
FROM product.projects p
CROSS JOIN (VALUES ('Development','development'), ('Production','production')) AS env(name, kind);

WITH ordered_environments AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM product.environments
)
INSERT INTO product.api_keys (
  environment_id, key_prefix, label, scopes, last_used_at, expires_at, revoked_at, created_at
)
SELECT
  e.id,
  format('sk_%s_%s', CASE WHEN g % 2 = 0 THEN 'live' ELSE 'test' END, lpad(g::text, 10, '0')),
  (ARRAY['CI deploy','Backend service','Local development','Data export'])[1 + (g % 4)],
  CASE WHEN g % 3 = 0 THEN ARRAY['events:write'] ELSE ARRAY['events:write','projects:read'] END,
  CASE WHEN g % 17 = 0 THEN NULL ELSE now() - ((g % 500) || ' hours')::interval END,
  CASE WHEN g % 11 = 0 THEN now() + ((30 + g % 300) || ' days')::interval ELSE NULL END,
  CASE WHEN g % 53 = 0 THEN now() - ((g % 100) || ' days')::interval ELSE NULL END,
  now() - ((g % 600) || ' days')::interval
FROM generate_series(1, 12000) AS g
JOIN ordered_environments e ON e.rn = 1 + ((g - 1) % 10000);

WITH project_pool AS (
  SELECT organization_id, array_agg(id ORDER BY id) AS project_ids
  FROM product.projects
  GROUP BY organization_id
)
INSERT INTO telemetry.events (
  organization_id, project_id, event_name, actor_user_id, session_id,
  source, properties, occurred_at, received_at
)
SELECT
  1 + ((g - 1) % 400) AS organization_id,
  pp.project_ids[1 + (g % array_length(pp.project_ids, 1))],
  (ARRAY['page.viewed','query.executed','dashboard.opened','export.created','api.requested','member.invited','alert.triggered'])[1 + (g % 7)],
  1 + ((g - 1) % 8000),
  gen_random_uuid(),
  (ARRAY['web','desktop','api','worker'])[1 + (g % 4)],
  jsonb_build_object(
    'duration_ms', 5 + (g * 37) % 12000,
    'success', g % 29 <> 0,
    'country', (ARRAY['US','GB','DE','IN','SG','AU','BR'])[1 + (g % 7)],
    'release', format('2026.%s.%s', 1 + g % 12, g % 20)
  ),
  now() - ((g % 540) || ' days')::interval - ((g % 86400) || ' seconds')::interval,
  now() - ((g % 540) || ' days')::interval - ((g % 86400) || ' seconds')::interval + ((g % 900) || ' milliseconds')::interval
FROM generate_series(1, 80000) AS g
JOIN project_pool pp ON pp.organization_id = 1 + ((g - 1) % 400);

INSERT INTO support.tickets (
  organization_id, requester_user_id, assignee_user_id, status, priority,
  subject, tags, body, first_response_at, resolved_at, created_at
)
SELECT
  1 + ((g - 1) % 400),
  1 + ((g - 1) % 8000),
  CASE WHEN g % 9 = 0 THEN NULL ELSE 1 + ((g * 13 - 1) % 8000) END,
  (CASE WHEN g % 17 = 0 THEN 'new' WHEN g % 11 = 0 THEN 'waiting' WHEN g % 7 = 0 THEN 'open' WHEN g % 5 = 0 THEN 'closed' ELSE 'resolved' END)::support.ticket_status,
  (ARRAY['low','normal','normal','high','urgent'])[1 + (g % 5)],
  (ARRAY['Unable to invite member','Invoice total question','Events delayed','API key rotation','Dashboard mismatch','SSO configuration'])[1 + (g % 6)],
  ARRAY[(ARRAY['billing','api','identity','telemetry','dashboard'])[1 + (g % 5)], CASE WHEN g % 13 = 0 THEN 'escalated' ELSE 'standard' END],
  jsonb_build_object('sentiment', (ARRAY['positive','neutral','negative'])[1 + (g % 3)], 'channel', (ARRAY['email','chat','web'])[1 + (g % 3)]),
  now() - ((g % 400) || ' days')::interval + interval '2 hours',
  CASE WHEN g % 17 = 0 OR g % 11 = 0 OR g % 7 = 0 THEN NULL ELSE now() - ((g % 400) || ' days')::interval + interval '18 hours' END,
  now() - ((g % 400) || ' days')::interval
FROM generate_series(1, 4000) AS g;

INSERT INTO integrations.connections (
  organization_id, provider, status, external_account_id, configuration, last_synced_at, created_at
)
SELECT
  o.id,
  provider.name,
  CASE WHEN (o.id + provider.ordinal) % 41 = 0 THEN 'error' WHEN (o.id + provider.ordinal) % 17 = 0 THEN 'degraded' ELSE 'healthy' END,
  format('%s-account-%s', provider.name, o.id),
  jsonb_build_object('sync_interval_minutes', 15 * provider.ordinal, 'objects', ARRAY['users','events','invoices']),
  now() - (((o.id * provider.ordinal) % 180) || ' minutes')::interval,
  o.created_at + interval '3 days'
FROM identity.organizations o
CROSS JOIN (VALUES ('slack', 1), ('github', 2), ('stripe', 3), ('salesforce', 4)) AS provider(name, ordinal);

INSERT INTO audit.change_log (
  organization_id, actor_user_id, action, entity_type, entity_id,
  before_data, after_data, request_id, ip_address, occurred_at
)
SELECT
  1 + ((g - 1) % 400),
  1 + ((g - 1) % 8000),
  (ARRAY['created','updated','archived','restored','permission.changed'])[1 + (g % 5)],
  (ARRAY['project','user','subscription','api_key','integration'])[1 + (g % 5)],
  format('%s-%s', (ARRAY['prj','usr','sub','key','int'])[1 + (g % 5)], g % 9000),
  CASE WHEN g % 5 = 0 THEN NULL ELSE jsonb_build_object('state', 'previous', 'version', g % 12) END,
  jsonb_build_object('state', 'current', 'version', 1 + g % 12, 'source', 'fixture'),
  gen_random_uuid(),
  format('10.%s.%s.%s', 1 + g % 240, 1 + (g * 3) % 240, 1 + (g * 7) % 240)::inet,
  now() - ((g % 500) || ' days')::interval - ((g % 86400) || ' seconds')::interval
FROM generate_series(1, 30000) AS g;

INSERT INTO archive.deleted_projects (
  project_id, organization_id, project_key, snapshot, deleted_by_user_id, deleted_at
)
SELECT
  p.id,
  p.organization_id,
  p.key,
  jsonb_build_object('name', p.name, 'settings', p.settings, 'visibility', p.visibility),
  p.created_by_user_id,
  p.archived_at
FROM product.projects p
WHERE p.archived_at IS NOT NULL;

REFRESH MATERIALIZED VIEW analytics.daily_active_organizations;

ANALYZE;

