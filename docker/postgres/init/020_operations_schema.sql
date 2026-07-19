\set ON_ERROR_STOP on
\connect operations_hub strata

SET timezone = 'UTC';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA geo;
CREATE SCHEMA hr;
CREATE SCHEMA supply;
CREATE SCHEMA warehouse;
CREATE SCHEMA procurement;
CREATE SCHEMA logistics;
CREATE SCHEMA fleet;
CREATE SCHEMA maintenance;
CREATE SCHEMA finance;
CREATE SCHEMA reporting;
CREATE SCHEMA audit;

CREATE TYPE procurement.po_status AS ENUM ('draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled');
CREATE TYPE logistics.shipment_status AS ENUM ('planned', 'picked_up', 'in_transit', 'delayed', 'delivered', 'cancelled', 'exception');
CREATE TYPE maintenance.work_order_status AS ENUM ('requested', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled');

CREATE FUNCTION audit.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TABLE geo.countries (
  code char(2) PRIMARY KEY,
  name text NOT NULL UNIQUE,
  currency char(3) NOT NULL,
  timezone text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE geo.facilities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  facility_type text NOT NULL CHECK (facility_type IN ('warehouse', 'distribution_center', 'office', 'repair_depot', 'cross_dock')),
  country_code char(2) NOT NULL REFERENCES geo.countries(code),
  city text NOT NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  capacity_units integer NOT NULL CHECK (capacity_units > 0),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at date NOT NULL,
  closed_at date
);

CREATE TABLE hr.departments (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  cost_center text NOT NULL UNIQUE
);

CREATE TABLE hr.employees (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_number text NOT NULL UNIQUE,
  department_id smallint NOT NULL REFERENCES hr.departments(id),
  facility_id bigint REFERENCES geo.facilities(id) ON DELETE SET NULL,
  manager_id bigint REFERENCES hr.employees(id) DEFERRABLE INITIALLY DEFERRED,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  title text NOT NULL,
  employment_type text NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'temporary')),
  status text NOT NULL CHECK (status IN ('active', 'leave', 'terminated')),
  skills text[] NOT NULL DEFAULT '{}',
  hired_at date NOT NULL,
  terminated_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supply.suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  country_code char(2) NOT NULL REFERENCES geo.countries(code),
  category text NOT NULL,
  risk_tier smallint NOT NULL CHECK (risk_tier BETWEEN 1 AND 5),
  payment_terms_days integer NOT NULL CHECK (payment_terms_days BETWEEN 0 AND 180),
  certifications text[] NOT NULL DEFAULT '{}',
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supply.parts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  part_number text NOT NULL UNIQUE,
  supplier_id bigint NOT NULL REFERENCES supply.suppliers(id),
  name text NOT NULL,
  category text NOT NULL,
  unit_of_measure text NOT NULL CHECK (unit_of_measure IN ('each', 'box', 'kg', 'meter', 'liter', 'pallet')),
  unit_cost numeric(12,4) NOT NULL CHECK (unit_cost >= 0),
  lead_time_days integer NOT NULL CHECK (lead_time_days >= 0),
  reorder_point integer NOT NULL CHECK (reorder_point >= 0),
  specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  hazardous boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouse.zones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  facility_id bigint NOT NULL REFERENCES geo.facilities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  zone_type text NOT NULL CHECK (zone_type IN ('ambient', 'cold', 'frozen', 'secure', 'hazmat', 'staging')),
  temperature_min numeric(5,2),
  temperature_max numeric(5,2),
  UNIQUE (facility_id, code),
  CHECK (temperature_max IS NULL OR temperature_min IS NULL OR temperature_max >= temperature_min)
);

CREATE TABLE warehouse.bins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id bigint NOT NULL REFERENCES warehouse.zones(id) ON DELETE CASCADE,
  bin_code text NOT NULL,
  aisle text NOT NULL,
  rack text NOT NULL,
  level smallint NOT NULL CHECK (level > 0),
  capacity numeric(12,2) NOT NULL CHECK (capacity > 0),
  occupied boolean NOT NULL DEFAULT false,
  cycle_count_due date,
  UNIQUE (zone_id, bin_code)
);

CREATE TABLE warehouse.stock_balances (
  bin_id bigint NOT NULL REFERENCES warehouse.bins(id) ON DELETE CASCADE,
  part_id bigint NOT NULL REFERENCES supply.parts(id),
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0,
  quantity_reserved numeric(14,3) NOT NULL DEFAULT 0,
  lot_number text,
  expires_at date,
  last_counted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bin_id, part_id),
  CHECK (quantity_on_hand >= 0),
  CHECK (quantity_reserved >= 0),
  CHECK (quantity_reserved <= quantity_on_hand)
);

CREATE TABLE warehouse.inventory_movements (
  id bigint GENERATED ALWAYS AS IDENTITY,
  part_id bigint NOT NULL,
  from_bin_id bigint,
  to_bin_id bigint,
  movement_type text NOT NULL CHECK (movement_type IN ('receipt', 'pick', 'transfer', 'adjustment', 'return', 'write_off')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  reference_type text,
  reference_id text,
  performed_by_employee_id bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE warehouse.inventory_movements_2025 PARTITION OF warehouse.inventory_movements
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE warehouse.inventory_movements_2026_h1 PARTITION OF warehouse.inventory_movements
  FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE warehouse.inventory_movements_2026_h2 PARTITION OF warehouse.inventory_movements
  FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');
CREATE TABLE warehouse.inventory_movements_default PARTITION OF warehouse.inventory_movements DEFAULT;

CREATE TABLE procurement.purchase_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_number text NOT NULL UNIQUE,
  supplier_id bigint NOT NULL REFERENCES supply.suppliers(id),
  facility_id bigint NOT NULL REFERENCES geo.facilities(id),
  buyer_employee_id bigint REFERENCES hr.employees(id) ON DELETE SET NULL,
  status procurement.po_status NOT NULL,
  currency char(3) NOT NULL,
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  shipping_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  total_amount numeric(14,2) GENERATED ALWAYS AS (subtotal + tax_amount + shipping_amount) STORED,
  ordered_at timestamptz,
  expected_at timestamptz,
  received_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE procurement.purchase_order_lines (
  purchase_order_id bigint NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE CASCADE,
  line_number smallint NOT NULL CHECK (line_number > 0),
  part_id bigint NOT NULL REFERENCES supply.parts(id),
  ordered_quantity numeric(14,3) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost numeric(12,4) NOT NULL CHECK (unit_cost >= 0),
  line_total numeric(14,2) GENERATED ALWAYS AS (ordered_quantity * unit_cost) STORED,
  promised_at date,
  PRIMARY KEY (purchase_order_id, line_number),
  CHECK (received_quantity <= ordered_quantity)
);

CREATE TABLE logistics.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL UNIQUE,
  purchase_order_id bigint REFERENCES procurement.purchase_orders(id),
  origin_facility_id bigint NOT NULL REFERENCES geo.facilities(id),
  destination_facility_id bigint NOT NULL REFERENCES geo.facilities(id),
  carrier text NOT NULL,
  service_level text NOT NULL CHECK (service_level IN ('standard', 'express', 'overnight', 'freight', 'economy')),
  status logistics.shipment_status NOT NULL,
  weight_kg numeric(12,3) NOT NULL CHECK (weight_kg > 0),
  package_count integer NOT NULL CHECK (package_count > 0),
  declared_value numeric(14,2) NOT NULL DEFAULT 0,
  scheduled_pickup_at timestamptz,
  picked_up_at timestamptz,
  estimated_delivery_at timestamptz,
  delivered_at timestamptz,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (origin_facility_id <> destination_facility_id)
);

CREATE TABLE logistics.shipment_stops (
  shipment_id uuid NOT NULL REFERENCES logistics.shipments(id) ON DELETE CASCADE,
  stop_sequence smallint NOT NULL CHECK (stop_sequence > 0),
  facility_id bigint NOT NULL REFERENCES geo.facilities(id),
  stop_type text NOT NULL CHECK (stop_type IN ('pickup', 'transfer', 'delivery')),
  planned_arrival_at timestamptz,
  actual_arrival_at timestamptz,
  actual_departure_at timestamptz,
  PRIMARY KEY (shipment_id, stop_sequence)
);

CREATE TABLE logistics.tracking_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY,
  shipment_id uuid NOT NULL,
  event_code text NOT NULL,
  facility_id bigint,
  latitude numeric(9,6),
  longitude numeric(9,6),
  message text NOT NULL,
  source text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE logistics.tracking_events_2025 PARTITION OF logistics.tracking_events
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE logistics.tracking_events_2026_h1 PARTITION OF logistics.tracking_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE logistics.tracking_events_2026_h2 PARTITION OF logistics.tracking_events
  FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');
CREATE TABLE logistics.tracking_events_default PARTITION OF logistics.tracking_events DEFAULT;

CREATE TABLE fleet.vehicles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_number text NOT NULL UNIQUE,
  home_facility_id bigint NOT NULL REFERENCES geo.facilities(id),
  vin text NOT NULL UNIQUE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('van', 'box_truck', 'tractor', 'trailer', 'forklift', 'service_vehicle')),
  make text NOT NULL,
  model text NOT NULL,
  model_year smallint NOT NULL CHECK (model_year BETWEEN 1990 AND 2035),
  odometer_km numeric(12,1) NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('available', 'assigned', 'maintenance', 'retired')),
  telematics jsonb NOT NULL DEFAULT '{}'::jsonb,
  acquired_at date NOT NULL,
  retired_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fleet.driver_assignments (
  vehicle_id bigint NOT NULL REFERENCES fleet.vehicles(id),
  employee_id bigint NOT NULL REFERENCES hr.employees(id),
  assigned_from timestamptz NOT NULL,
  assigned_until timestamptz,
  primary_driver boolean NOT NULL DEFAULT true,
  PRIMARY KEY (vehicle_id, employee_id, assigned_from),
  CHECK (assigned_until IS NULL OR assigned_until > assigned_from)
);

CREATE TABLE maintenance.work_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_number text NOT NULL UNIQUE,
  vehicle_id bigint REFERENCES fleet.vehicles(id) ON DELETE SET NULL,
  facility_id bigint NOT NULL REFERENCES geo.facilities(id),
  assigned_employee_id bigint REFERENCES hr.employees(id) ON DELETE SET NULL,
  status maintenance.work_order_status NOT NULL,
  priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 4),
  category text NOT NULL,
  description text NOT NULL,
  parts_cost numeric(12,2) NOT NULL DEFAULT 0,
  labor_hours numeric(8,2) NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  completed_at timestamptz,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.cost_centers (
  code text PRIMARY KEY,
  name text NOT NULL,
  department_id smallint REFERENCES hr.departments(id),
  annual_budget numeric(16,2) NOT NULL CHECK (annual_budget >= 0),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE finance.expenses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cost_center_code text NOT NULL REFERENCES finance.cost_centers(code),
  employee_id bigint REFERENCES hr.employees(id) ON DELETE SET NULL,
  supplier_id bigint REFERENCES supply.suppliers(id) ON DELETE SET NULL,
  expense_type text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  receipt jsonb,
  incurred_on date NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.activity_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  actor_employee_id bigint,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  request_id uuid,
  source_ip inet,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit.activity_log_2025 PARTITION OF audit.activity_log
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE audit.activity_log_2026 PARTITION OF audit.activity_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE audit.activity_log_default PARTITION OF audit.activity_log DEFAULT;

CREATE INDEX facilities_country_type_idx ON geo.facilities (country_code, facility_type);
CREATE INDEX facilities_attributes_gin_idx ON geo.facilities USING gin (attributes jsonb_path_ops);
CREATE INDEX employees_department_status_idx ON hr.employees (department_id, status);
CREATE INDEX employees_skills_gin_idx ON hr.employees USING gin (skills);
CREATE INDEX suppliers_country_risk_idx ON supply.suppliers (country_code, risk_tier) WHERE active;
CREATE INDEX suppliers_contacts_gin_idx ON supply.suppliers USING gin (contacts);
CREATE INDEX parts_supplier_category_idx ON supply.parts (supplier_id, category);
CREATE INDEX parts_specs_gin_idx ON supply.parts USING gin (specifications jsonb_path_ops);
CREATE INDEX bins_zone_cycle_count_idx ON warehouse.bins (zone_id, cycle_count_due);
CREATE INDEX stock_part_quantity_idx ON warehouse.stock_balances (part_id, quantity_on_hand);
CREATE INDEX movements_part_time_idx ON warehouse.inventory_movements (part_id, occurred_at DESC);
CREATE INDEX movements_reference_idx ON warehouse.inventory_movements (reference_type, reference_id);
CREATE INDEX purchase_orders_supplier_status_idx ON procurement.purchase_orders (supplier_id, status, ordered_at DESC);
CREATE INDEX purchase_orders_open_expected_idx ON procurement.purchase_orders (expected_at) WHERE status IN ('approved', 'partially_received');
CREATE INDEX po_lines_part_idx ON procurement.purchase_order_lines (part_id, promised_at);
CREATE INDEX shipments_status_eta_idx ON logistics.shipments (status, estimated_delivery_at);
CREATE INDEX shipments_route_idx ON logistics.shipments (origin_facility_id, destination_facility_id, created_at DESC);
CREATE INDEX shipments_attributes_gin_idx ON logistics.shipments USING gin (attributes jsonb_path_ops);
CREATE INDEX tracking_shipment_time_idx ON logistics.tracking_events (shipment_id, occurred_at DESC);
CREATE INDEX tracking_payload_gin_idx ON logistics.tracking_events USING gin (raw_payload jsonb_path_ops);
CREATE INDEX vehicles_facility_status_idx ON fleet.vehicles (home_facility_id, status);
CREATE INDEX work_orders_status_schedule_idx ON maintenance.work_orders (status, scheduled_at);
CREATE INDEX expenses_cost_center_date_idx ON finance.expenses (cost_center_code, incurred_on DESC);
CREATE INDEX activity_object_idx ON audit.activity_log (object_type, object_id, occurred_at DESC);

CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON hr.employees FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON supply.suppliers FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER parts_set_updated_at BEFORE UPDATE ON supply.parts FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER purchase_orders_set_updated_at BEFORE UPDATE ON procurement.purchase_orders FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER shipments_set_updated_at BEFORE UPDATE ON logistics.shipments FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER vehicles_set_updated_at BEFORE UPDATE ON fleet.vehicles FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER work_orders_set_updated_at BEFORE UPDATE ON maintenance.work_orders FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE VIEW reporting.inventory_risk AS
SELECT
  p.id AS part_id,
  p.part_number,
  p.name,
  p.category,
  s.legal_name AS supplier_name,
  p.lead_time_days,
  p.reorder_point,
  coalesce(sum(sb.quantity_on_hand), 0) AS quantity_on_hand,
  coalesce(sum(sb.quantity_reserved), 0) AS quantity_reserved,
  coalesce(sum(sb.quantity_on_hand - sb.quantity_reserved), 0) AS quantity_available,
  CASE
    WHEN coalesce(sum(sb.quantity_on_hand - sb.quantity_reserved), 0) <= 0 THEN 'stockout'
    WHEN coalesce(sum(sb.quantity_on_hand - sb.quantity_reserved), 0) < p.reorder_point THEN 'reorder'
    ELSE 'healthy'
  END AS inventory_status
FROM supply.parts p
JOIN supply.suppliers s ON s.id = p.supplier_id
LEFT JOIN warehouse.stock_balances sb ON sb.part_id = p.id
GROUP BY p.id, s.legal_name;

CREATE VIEW reporting.shipment_performance AS
SELECT
  s.carrier,
  s.service_level,
  count(*) AS shipments,
  count(*) FILTER (WHERE s.status = 'delivered') AS delivered_shipments,
  count(*) FILTER (WHERE s.status IN ('delayed', 'exception')) AS disrupted_shipments,
  round(avg(extract(epoch FROM (s.delivered_at - s.picked_up_at)) / 3600) FILTER (WHERE s.delivered_at IS NOT NULL), 2) AS average_transit_hours,
  round(100.0 * count(*) FILTER (WHERE s.delivered_at <= s.estimated_delivery_at) / nullif(count(*) FILTER (WHERE s.delivered_at IS NOT NULL), 0), 2) AS on_time_percentage
FROM logistics.shipments s
GROUP BY s.carrier, s.service_level;

CREATE VIEW reporting.spend_by_supplier AS
SELECT
  supplier.id AS supplier_id,
  supplier.supplier_code,
  supplier.legal_name,
  supplier.risk_tier,
  count(po.id) AS purchase_orders,
  sum(po.total_amount) FILTER (WHERE po.status <> 'cancelled') AS committed_spend,
  avg(po.total_amount) FILTER (WHERE po.status <> 'cancelled') AS average_order_value,
  max(po.ordered_at) AS latest_order_at
FROM supply.suppliers supplier
LEFT JOIN procurement.purchase_orders po ON po.supplier_id = supplier.id
GROUP BY supplier.id;

CREATE VIEW reporting.fleet_utilization AS
SELECT
  f.code AS facility_code,
  v.vehicle_type,
  count(*) AS vehicles,
  count(*) FILTER (WHERE v.status = 'assigned') AS assigned,
  count(*) FILTER (WHERE v.status = 'maintenance') AS in_maintenance,
  round(avg(v.odometer_km), 1) AS average_odometer_km
FROM fleet.vehicles v
JOIN geo.facilities f ON f.id = v.home_facility_id
GROUP BY f.code, v.vehicle_type;

CREATE MATERIALIZED VIEW reporting.daily_shipment_volume AS
SELECT
  created_at::date AS shipment_date,
  count(*) AS shipment_count,
  sum(package_count) AS package_count,
  sum(weight_kg) AS total_weight_kg,
  count(*) FILTER (WHERE status IN ('delayed', 'exception')) AS disrupted_shipments
FROM logistics.shipments
GROUP BY 1
WITH NO DATA;

CREATE UNIQUE INDEX daily_shipment_volume_date_idx ON reporting.daily_shipment_volume (shipment_date);

CREATE FUNCTION supply.part_availability(target_part_id bigint)
RETURNS TABLE (facility_code text, quantity_on_hand numeric, quantity_reserved numeric, quantity_available numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    f.code,
    sum(sb.quantity_on_hand),
    sum(sb.quantity_reserved),
    sum(sb.quantity_on_hand - sb.quantity_reserved)
  FROM warehouse.stock_balances sb
  JOIN warehouse.bins b ON b.id = sb.bin_id
  JOIN warehouse.zones z ON z.id = b.zone_id
  JOIN geo.facilities f ON f.id = z.facility_id
  WHERE sb.part_id = target_part_id
  GROUP BY f.code
  ORDER BY f.code;
$$;

CREATE FUNCTION logistics.shipment_timeline(target_shipment_id uuid)
RETURNS TABLE (event_code text, message text, facility_code text, occurred_at timestamptz)
LANGUAGE sql
STABLE
AS $$
  SELECT e.event_code, e.message, f.code, e.occurred_at
  FROM logistics.tracking_events e
  LEFT JOIN geo.facilities f ON f.id = e.facility_id
  WHERE e.shipment_id = target_shipment_id
  ORDER BY e.occurred_at;
$$;

GRANT USAGE ON SCHEMA geo, hr, supply, warehouse, procurement, logistics, fleet, maintenance, finance, reporting, audit TO strata_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA geo, hr, supply, warehouse, procurement, logistics, fleet, maintenance, finance, reporting, audit TO strata_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA geo, hr, supply, warehouse, procurement, logistics, fleet, maintenance, finance, reporting, audit GRANT SELECT ON TABLES TO strata_reader;

