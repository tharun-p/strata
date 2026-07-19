\set ON_ERROR_STOP on

SET timezone = 'UTC';
SELECT setseed(0.4242);

INSERT INTO commerce.customers (
  email, first_name, last_name, segment, country_code, metadata, created_at
)
SELECT
  format('customer%s' || '@' || 'strata.local', g),
  (ARRAY['Aarav','Maya','Theo','Nora','Mateo','Sofia','Eli','Amara','Noah','Iris'])[1 + (g % 10)],
  (ARRAY['Shah','Miller','Garcia','Wilson','Brown','Martin','Kim','Patel','Taylor','Nguyen'])[1 + ((g * 7) % 10)],
  (ARRAY['starter','growth','scale','enterprise']::commerce.customer_segment[])[1 + (g % 4)],
  (ARRAY['US','GB','DE','CA','AU','FR','NL','SG','IN','BR'])[1 + ((g * 3) % 10)],
  jsonb_build_object(
    'acquisition_channel', (ARRAY['organic','paid_search','partner','event'])[1 + (g % 4)],
    'marketing_opt_in', (g % 3 <> 0),
    'cohort', to_char(current_date - ((g % 18) || ' months')::interval, 'YYYY-MM')
  ),
  now() - ((g * 3) || ' hours')::interval
FROM generate_series(1, 240) AS g;

INSERT INTO commerce.products (sku, name, category, unit_price, active, attributes, created_at)
SELECT
  format('SKU-%04s', g),
  format('%s %s',
    (ARRAY['Essential','Studio','Cloud','Field','Prime','Core'])[1 + (g % 6)],
    (ARRAY['Kit','Seat','Module','Pack','Plan','Device','License','Bundle'])[1 + (g % 8)]
  ),
  (ARRAY['software','hardware','services','accessories'])[1 + (g % 4)],
  round((19 + (g * 7.35) + random() * 35)::numeric, 2),
  g % 17 <> 0,
  jsonb_build_object('tier', 1 + (g % 3), 'renewable', g % 4 = 0, 'color', (ARRAY['graphite','mint','blue','sand'])[1 + (g % 4)]),
  now() - ((g * 5) || ' days')::interval
FROM generate_series(1, 48) AS g;

WITH customer_pool AS (
  SELECT array_agg(id ORDER BY created_at, id) AS ids FROM commerce.customers
)
INSERT INTO commerce.orders (
  customer_id, status, subtotal, tax_amount, shipping_amount, discount_amount,
  currency, country_code, channel, placed_at, completed_at, created_at
)
SELECT
  cp.ids[1 + ((g * 37) % array_length(cp.ids, 1))],
  CASE
    WHEN g % 29 = 0 THEN 'cancelled'::commerce.order_status
    WHEN g % 19 = 0 THEN 'refunded'::commerce.order_status
    WHEN g % 13 = 0 THEN 'pending'::commerce.order_status
    WHEN g % 11 = 0 THEN 'processing'::commerce.order_status
    ELSE 'completed'::commerce.order_status
  END,
  round((35 + (g % 420) * 2.17 + random() * 90)::numeric, 2),
  round((4 + (g % 30) * 0.91)::numeric, 2),
  CASE WHEN g % 5 = 0 THEN 0 ELSE round((4.99 + (g % 4) * 2.5)::numeric, 2) END,
  CASE WHEN g % 7 = 0 THEN round((5 + (g % 25))::numeric, 2) ELSE 0 END,
  (ARRAY['USD','USD','EUR','GBP','CAD','AUD'])[1 + (g % 6)],
  (ARRAY['US','GB','DE','CA','AU','FR','NL','SG','IN','BR'])[1 + ((g * 3) % 10)],
  (ARRAY['web','mobile','sales','partner'])[1 + (g % 4)],
  now() - ((g % 180) || ' days')::interval - ((g % 24) || ' hours')::interval,
  CASE WHEN g % 13 = 0 OR g % 11 = 0 OR g % 29 = 0 THEN NULL
       ELSE now() - ((g % 180) || ' days')::interval - ((g % 24) || ' hours')::interval + interval '2 hours' END,
  now() - ((g % 180) || ' days')::interval - ((g % 24) || ' hours')::interval
FROM generate_series(1, 1500) AS g
CROSS JOIN customer_pool cp;

INSERT INTO commerce.order_items (
  order_id, line_number, product_id, quantity, unit_price, discount_amount, metadata
)
SELECT
  o.id,
  line.line_number,
  product.id,
  1 + mod(o.order_number + line.line_number, 4)::integer,
  product.unit_price,
  CASE WHEN mod(o.order_number + line.line_number, 9) = 0 THEN 5.00 ELSE 0 END,
  jsonb_build_object('source', o.channel, 'gift', mod(o.order_number + line.line_number, 17) = 0)
FROM commerce.orders o
CROSS JOIN LATERAL generate_series(1, 1 + mod(o.order_number, 4)::integer) AS line(line_number)
JOIN LATERAL (
  SELECT p.id, p.unit_price
  FROM commerce.products p
  ORDER BY p.id
  OFFSET mod(o.order_number * 7 + line.line_number * 11, 48)::integer
  LIMIT 1
) product ON true;

INSERT INTO commerce.payments (
  order_id, attempt_number, provider, provider_reference, status, amount,
  processor_response, processed_at, created_at
)
SELECT
  o.id,
  1,
  (ARRAY['stripe','adyen','paypal'])[1 + (o.order_number % 3)],
  format('pay_%s', replace(o.id::text, '-', '')),
  CASE
    WHEN o.status = 'cancelled' THEN 'voided'
    WHEN o.status = 'refunded' THEN 'refunded'
    WHEN o.status = 'pending' THEN 'authorized'
    ELSE 'captured'
  END,
  o.total_amount,
  jsonb_build_object(
    'risk_score', mod(o.order_number * 17, 100),
    'network', (ARRAY['visa','mastercard','amex'])[1 + (o.order_number % 3)],
    'three_ds', o.order_number % 4 = 0,
    'response_code', CASE WHEN o.status = 'cancelled' THEN 'do_not_honor' ELSE 'approved' END
  ),
  o.created_at + interval '3 minutes',
  o.created_at + interval '2 minutes'
FROM commerce.orders o;

INSERT INTO commerce.refunds (payment_id, amount, reason, status, created_at)
SELECT
  p.id,
  round((p.amount * (CASE WHEN p.amount > 400 THEN 0.5 ELSE 1 END))::numeric, 2),
  (ARRAY['customer_request','duplicate','fraud_review','product_issue'])[1 + (p.attempt_number % 4)],
  'completed',
  p.processed_at + interval '3 days'
FROM commerce.payments p
JOIN commerce.orders o ON o.id = p.order_id
WHERE o.status = 'refunded';

INSERT INTO commerce.support_tickets (
  customer_id, order_id, priority, status, subject, tags, details, opened_at, resolved_at
)
SELECT
  o.customer_id,
  o.id,
  1 + mod(o.order_number, 4)::smallint,
  CASE WHEN o.order_number % 5 = 0 THEN 'open' ELSE 'resolved' END,
  (ARRAY['Delivery status','Billing question','Refund request','Product setup'])[1 + (o.order_number % 4)],
  ARRAY[(ARRAY['billing','delivery','refund','onboarding'])[1 + (o.order_number % 4)], 'generated-fixture'],
  jsonb_build_object('sentiment', (ARRAY['positive','neutral','negative'])[1 + (o.order_number % 3)]),
  o.created_at + interval '1 day',
  CASE WHEN o.order_number % 5 = 0 THEN NULL ELSE o.created_at + interval '1 day 4 hours' END
FROM commerce.orders o
WHERE o.order_number % 12 = 0;

INSERT INTO audit.order_events (order_id, event_type, actor, payload, occurred_at)
SELECT o.id, 'order.created', 'checkout-api', jsonb_build_object('channel', o.channel, 'status', 'pending'), o.created_at
FROM commerce.orders o
UNION ALL
SELECT
  o.id,
  'order.' || o.status::text,
  CASE WHEN o.status = 'cancelled' THEN 'support-agent' ELSE 'order-worker' END,
  jsonb_build_object('total', o.total_amount, 'currency', o.currency, 'country', o.country_code),
  coalesce(o.completed_at, o.updated_at)
FROM commerce.orders o;

REFRESH MATERIALIZED VIEW analytics.customer_value;

ANALYZE commerce.customers;
ANALYZE commerce.products;
ANALYZE commerce.orders;
ANALYZE commerce.order_items;
ANALYZE commerce.payments;
ANALYZE commerce.refunds;
ANALYZE commerce.support_tickets;
ANALYZE audit.order_events;
