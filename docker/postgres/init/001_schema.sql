\set ON_ERROR_STOP on

SET timezone = 'UTC';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA commerce;
CREATE SCHEMA analytics;
CREATE SCHEMA audit;

CREATE TYPE commerce.customer_segment AS ENUM ('starter', 'growth', 'scale', 'enterprise');
CREATE TYPE commerce.order_status AS ENUM ('pending', 'processing', 'completed', 'cancelled', 'refunded');

CREATE DOMAIN commerce.email_address AS text
  CHECK (VALUE ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$');

CREATE FUNCTION commerce.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TABLE commerce.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email commerce.email_address NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  full_name text GENERATED ALWAYS AS (btrim(first_name || ' ' || last_name)) STORED,
  segment commerce.customer_segment NOT NULL DEFAULT 'starter',
  country_code char(2) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_country_code_format CHECK (country_code ~ '^[A-Z]{2}$')
);

COMMENT ON TABLE commerce.customers IS 'Customer identity, acquisition, and segmentation attributes.';
COMMENT ON COLUMN commerce.customers.metadata IS 'Unstructured acquisition and preference attributes.';

CREATE TABLE commerce.products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  active boolean NOT NULL DEFAULT true,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE commerce.products IS 'Sellable products with current catalog pricing.';

CREATE TABLE commerce.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_id uuid NOT NULL REFERENCES commerce.customers(id),
  status commerce.order_status NOT NULL DEFAULT 'pending',
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  shipping_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount numeric(12,2) GENERATED ALWAYS AS (subtotal + tax_amount + shipping_amount - discount_amount) STORED,
  currency char(3) NOT NULL DEFAULT 'USD',
  country_code char(2) NOT NULL,
  channel text NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'mobile', 'sales', 'partner')),
  placed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_nonnegative_total CHECK (subtotal + tax_amount + shipping_amount >= discount_amount)
);

COMMENT ON TABLE commerce.orders IS 'All customer orders and their lifecycle state.';
COMMENT ON COLUMN commerce.orders.total_amount IS 'Stored generated gross order total after discount.';

CREATE TABLE commerce.order_items (
  order_id uuid NOT NULL REFERENCES commerce.orders(id) ON DELETE CASCADE,
  line_number smallint NOT NULL CHECK (line_number > 0),
  product_id bigint NOT NULL REFERENCES commerce.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total numeric(12,2) GENERATED ALWAYS AS ((quantity * unit_price) - discount_amount) STORED,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (order_id, line_number)
);

COMMENT ON TABLE commerce.order_items IS 'Line items using a composite primary key.';

CREATE TABLE commerce.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES commerce.orders(id),
  attempt_number smallint NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  provider text NOT NULL CHECK (provider IN ('stripe', 'adyen', 'paypal')), 
  provider_reference text UNIQUE,
  status text NOT NULL CHECK (status IN ('authorized', 'captured', 'failed', 'voided', 'refunded')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  processor_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, attempt_number)
);

COMMENT ON TABLE commerce.payments IS 'Payment attempts with structured and raw processor responses.';

CREATE TABLE commerce.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES commerce.payments(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.support_tickets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id uuid REFERENCES commerce.customers(id) ON DELETE SET NULL,
  order_id uuid REFERENCES commerce.orders(id) ON DELETE SET NULL,
  priority smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  subject text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE audit.order_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY,
  order_id uuid NOT NULL,
  event_type text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit.order_events_2025 PARTITION OF audit.order_events
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE audit.order_events_2026_h1 PARTITION OF audit.order_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE audit.order_events_2026_h2 PARTITION OF audit.order_events
  FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');
CREATE TABLE audit.order_events_default PARTITION OF audit.order_events DEFAULT;

COMMENT ON TABLE audit.order_events IS 'Range-partitioned immutable order lifecycle event stream.';

CREATE INDEX customers_email_lower_idx ON commerce.customers (lower(email::text));
CREATE INDEX customers_metadata_gin_idx ON commerce.customers USING gin (metadata jsonb_path_ops);
CREATE INDEX orders_customer_created_idx ON commerce.orders (customer_id, created_at DESC);
CREATE INDEX orders_open_partial_idx ON commerce.orders (created_at DESC) WHERE status IN ('pending', 'processing');
CREATE INDEX orders_completed_brin_idx ON commerce.orders USING brin (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX order_items_product_idx ON commerce.order_items (product_id, order_id);
CREATE INDEX payments_order_processed_idx ON commerce.payments (order_id, processed_at DESC);
CREATE INDEX payments_response_gin_idx ON commerce.payments USING gin (processor_response);
CREATE INDEX support_tickets_tags_gin_idx ON commerce.support_tickets USING gin (tags);
CREATE INDEX order_events_order_time_idx ON audit.order_events (order_id, occurred_at DESC);
CREATE INDEX order_events_payload_gin_idx ON audit.order_events USING gin (payload jsonb_path_ops);

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON commerce.customers
FOR EACH ROW EXECUTE FUNCTION commerce.set_updated_at();

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON commerce.products
FOR EACH ROW EXECUTE FUNCTION commerce.set_updated_at();

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON commerce.orders
FOR EACH ROW EXECUTE FUNCTION commerce.set_updated_at();

CREATE VIEW commerce.order_summary AS
SELECT
  o.id,
  o.order_number,
  o.customer_id,
  c.full_name AS customer_name,
  c.segment,
  o.status,
  o.total_amount,
  o.currency,
  o.country_code,
  o.channel,
  coalesce(items.item_count, 0) AS item_count,
  payment.latest_payment_status,
  o.created_at,
  o.completed_at
FROM commerce.orders o
JOIN commerce.customers c ON c.id = o.customer_id
LEFT JOIN LATERAL (
  SELECT sum(oi.quantity)::bigint AS item_count
  FROM commerce.order_items oi
  WHERE oi.order_id = o.id
) items ON true
LEFT JOIN LATERAL (
  SELECT p.status AS latest_payment_status
  FROM commerce.payments p
  WHERE p.order_id = o.id
  ORDER BY p.attempt_number DESC
  LIMIT 1
) payment ON true;

COMMENT ON VIEW commerce.order_summary IS 'Investigation-friendly order view with customer, item, and payment context.';

CREATE VIEW analytics.daily_revenue AS
SELECT
  date_trunc('day', completed_at)::date AS revenue_date,
  country_code,
  channel,
  count(*) AS order_count,
  sum(total_amount) AS gross_revenue,
  avg(total_amount) AS average_order_value
FROM commerce.orders
WHERE status IN ('completed', 'refunded')
GROUP BY 1, 2, 3;

CREATE VIEW analytics.product_performance AS
SELECT
  p.id AS product_id,
  p.sku,
  p.name,
  p.category,
  sum(oi.quantity)::bigint AS units_sold,
  sum(oi.line_total) AS item_revenue,
  count(DISTINCT oi.order_id) AS order_count
FROM commerce.products p
LEFT JOIN commerce.order_items oi ON oi.product_id = p.id
GROUP BY p.id, p.sku, p.name, p.category;

CREATE MATERIALIZED VIEW analytics.customer_value AS
SELECT
  c.id AS customer_id,
  c.full_name,
  c.segment,
  c.country_code,
  count(o.id) AS lifetime_orders,
  coalesce(sum(o.total_amount) FILTER (WHERE o.status IN ('completed', 'refunded')), 0) AS lifetime_value,
  max(o.created_at) AS latest_order_at
FROM commerce.customers c
LEFT JOIN commerce.orders o ON o.customer_id = c.id
GROUP BY c.id, c.full_name, c.segment, c.country_code
WITH NO DATA;

CREATE UNIQUE INDEX customer_value_customer_idx ON analytics.customer_value (customer_id);
CREATE INDEX customer_value_rank_idx ON analytics.customer_value (lifetime_value DESC);

CREATE FUNCTION commerce.customer_orders(target_customer_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_number bigint,
  status commerce.order_status,
  total_amount numeric,
  created_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, orders.order_number, orders.status, orders.total_amount, orders.created_at
  FROM commerce.orders
  WHERE customer_id = target_customer_id
  ORDER BY created_at DESC;
$$;

