\set ON_ERROR_STOP on
\connect operations_hub strata

SET timezone = 'UTC';
SELECT setseed(0.57721);

INSERT INTO geo.countries (code, name, currency, timezone)
VALUES
  ('US', 'United States', 'USD', 'America/New_York'),
  ('CA', 'Canada', 'CAD', 'America/Toronto'),
  ('MX', 'Mexico', 'MXN', 'America/Mexico_City'),
  ('BR', 'Brazil', 'BRL', 'America/Sao_Paulo'),
  ('GB', 'United Kingdom', 'GBP', 'Europe/London'),
  ('DE', 'Germany', 'EUR', 'Europe/Berlin'),
  ('FR', 'France', 'EUR', 'Europe/Paris'),
  ('NL', 'Netherlands', 'EUR', 'Europe/Amsterdam'),
  ('IN', 'India', 'INR', 'Asia/Kolkata'),
  ('SG', 'Singapore', 'SGD', 'Asia/Singapore'),
  ('JP', 'Japan', 'JPY', 'Asia/Tokyo'),
  ('AU', 'Australia', 'AUD', 'Australia/Sydney'),
  ('ZA', 'South Africa', 'ZAR', 'Africa/Johannesburg'),
  ('AE', 'United Arab Emirates', 'AED', 'Asia/Dubai'),
  ('SE', 'Sweden', 'SEK', 'Europe/Stockholm');

INSERT INTO geo.facilities (
  code, name, facility_type, country_code, city, latitude, longitude,
  capacity_units, attributes, opened_at
)
SELECT
  format('FAC-%03s', g),
  format('%s %s',
    (ARRAY['North','South','East','West','Central','Harbor','Airport','Metro'])[1 + (g % 8)],
    (ARRAY['Distribution Center','Warehouse','Cross Dock','Repair Depot','Operations Hub'])[1 + (g % 5)]
  ),
  (ARRAY['warehouse','distribution_center','office','repair_depot','cross_dock'])[1 + (g % 5)],
  (ARRAY['US','CA','MX','BR','GB','DE','FR','NL','IN','SG','JP','AU','ZA','AE','SE'])[1 + (g % 15)],
  (ARRAY['Austin','Toronto','Monterrey','Sao Paulo','London','Berlin','Lyon','Rotterdam','Bengaluru','Singapore','Osaka','Sydney'])[1 + (g % 12)],
  round((-40 + (g * 13 % 115) + random())::numeric, 6),
  round((-120 + (g * 17 % 240) + random())::numeric, 6),
  10000 + (g * 3700) % 180000,
  jsonb_build_object('automated', g % 3 = 0, 'dock_doors', 4 + g % 38, 'operating_hours', CASE WHEN g % 4 = 0 THEN '24x7' ELSE '06:00-22:00' END),
  current_date - (500 + g * 41 % 6500)
FROM generate_series(1, 60) AS g;

INSERT INTO hr.departments (code, name, cost_center)
VALUES
  ('OPS', 'Operations', 'CC-100'),
  ('LOG', 'Logistics', 'CC-110'),
  ('WH', 'Warehouse', 'CC-120'),
  ('PROC', 'Procurement', 'CC-130'),
  ('FIN', 'Finance', 'CC-200'),
  ('HR', 'People Operations', 'CC-210'),
  ('IT', 'Information Technology', 'CC-220'),
  ('SEC', 'Security', 'CC-230'),
  ('CS', 'Customer Operations', 'CC-300'),
  ('MNT', 'Maintenance', 'CC-310'),
  ('QA', 'Quality Assurance', 'CC-320'),
  ('DATA', 'Data and Analytics', 'CC-330');

INSERT INTO hr.employees (
  employee_number, department_id, facility_id, manager_id, full_name, email,
  title, employment_type, status, skills, hired_at, terminated_at, created_at
)
SELECT
  format('EMP-%06s', g),
  1 + ((g - 1) % 12),
  1 + ((g - 1) % 60),
  CASE WHEN g <= 12 THEN NULL ELSE 1 + ((g - 1) % 12) END,
  format('%s %s',
    (ARRAY['Aarav','Maya','Theo','Nora','Mateo','Sofia','Eli','Amara','Noah','Iris','Lena','Owen'])[1 + (g % 12)],
    (ARRAY['Shah','Miller','Garcia','Wilson','Brown','Martin','Kim','Patel','Taylor','Nguyen'])[1 + ((g * 7) % 10)]
  ),
  format('employee%s@operations.example', g),
  (ARRAY['Operations Associate','Team Lead','Warehouse Specialist','Buyer','Driver','Mechanic','Analyst','Manager'])[1 + (g % 8)],
  (ARRAY['full_time','full_time','full_time','part_time','contractor','temporary'])[1 + (g % 6)],
  CASE WHEN g % 131 = 0 THEN 'terminated' WHEN g % 67 = 0 THEN 'leave' ELSE 'active' END,
  ARRAY[
    (ARRAY['forklift','hazmat','dispatch','inventory','procurement','first_aid'])[1 + (g % 6)],
    (ARRAY['leadership','quality','routing','maintenance','analytics'])[1 + (g % 5)]
  ],
  current_date - (100 + g % 4500),
  CASE WHEN g % 131 = 0 THEN current_date - (g % 180) ELSE NULL END,
  now() - ((100 + g % 1400) || ' days')::interval
FROM generate_series(1, 1500) AS g;

INSERT INTO supply.suppliers (
  supplier_code, legal_name, country_code, category, risk_tier,
  payment_terms_days, certifications, contacts, active, created_at
)
SELECT
  format('SUP-%05s', g),
  format('%s %s',
    (ARRAY['Atlas','Pioneer','Summit','Harbor','Vertex','Evergreen','Precision','Global'])[1 + (g % 8)],
    (ARRAY['Components','Industrial','Materials','Logistics','Manufacturing','Supply Co.'])[1 + (g % 6)]
  ),
  (ARRAY['US','CA','MX','BR','GB','DE','FR','NL','IN','SG','JP','AU','ZA','AE','SE'])[1 + (g % 15)],
  (ARRAY['electronics','packaging','mechanical','chemicals','textiles','transportation','facilities'])[1 + (g % 7)],
  1 + g % 5,
  (ARRAY[15,30,45,60,90])[1 + (g % 5)],
  CASE WHEN g % 3 = 0 THEN ARRAY['ISO-9001','ISO-14001'] ELSE ARRAY['ISO-9001'] END,
  jsonb_build_array(
    jsonb_build_object('name', format('Account Manager %s', g), 'email', format('contact%s@supplier.example', g), 'primary', true),
    jsonb_build_object('name', format('Escalation %s', g), 'email', format('escalation%s@supplier.example', g), 'primary', false)
  ),
  g % 73 <> 0,
  now() - ((g % 2200) || ' days')::interval
FROM generate_series(1, 500) AS g;

INSERT INTO supply.parts (
  part_number, supplier_id, name, category, unit_of_measure, unit_cost,
  lead_time_days, reorder_point, specifications, hazardous, active, created_at
)
SELECT
  format('PART-%07s', g),
  1 + ((g * 17 - 1) % 500),
  format('%s %s',
    (ARRAY['Precision','Industrial','Heavy Duty','Compact','Smart','Universal'])[1 + (g % 6)],
    (ARRAY['Bearing','Controller','Cable','Housing','Seal','Sensor','Fastener','Filter'])[1 + (g % 8)]
  ),
  (ARRAY['mechanical','electrical','packaging','safety','consumable','hydraulic'])[1 + (g % 6)],
  (ARRAY['each','box','kg','meter','liter','pallet'])[1 + (g % 6)],
  round((1.5 + (g % 950) * 0.83 + random() * 25)::numeric, 4),
  1 + g % 120,
  5 + (g * 7) % 500,
  jsonb_build_object('weight_kg', round((0.05 + g % 80 * 0.17)::numeric, 3), 'revision', 1 + g % 9, 'color', (ARRAY['black','silver','blue','natural'])[1 + (g % 4)]),
  g % 47 = 0,
  g % 101 <> 0,
  now() - ((g % 1600) || ' days')::interval
FROM generate_series(1, 3000) AS g;

INSERT INTO warehouse.zones (
  facility_id, code, name, zone_type, temperature_min, temperature_max
)
SELECT
  f.id,
  format('Z%s', z.ordinal),
  z.name,
  z.zone_type,
  CASE z.zone_type WHEN 'cold' THEN 2 WHEN 'frozen' THEN -25 ELSE NULL END,
  CASE z.zone_type WHEN 'cold' THEN 8 WHEN 'frozen' THEN -15 ELSE NULL END
FROM geo.facilities f
CROSS JOIN (VALUES
  (1, 'Ambient storage', 'ambient'),
  (2, 'Cold storage', 'cold'),
  (3, 'Frozen storage', 'frozen'),
  (4, 'Secure cage', 'secure'),
  (5, 'Hazardous materials', 'hazmat'),
  (6, 'Outbound staging', 'staging')
) AS z(ordinal, name, zone_type);

WITH ordered_zones AS (
  SELECT id, row_number() OVER (ORDER BY facility_id, id) AS rn
  FROM warehouse.zones
)
INSERT INTO warehouse.bins (
  zone_id, bin_code, aisle, rack, level, capacity, occupied, cycle_count_due
)
SELECT
  z.id,
  format('BIN-%06s', g),
  format('A%02s', 1 + g % 40),
  format('R%02s', 1 + (g * 3) % 30),
  1 + g % 6,
  round((50 + g % 950 + random() * 80)::numeric, 2),
  g % 7 <> 0,
  current_date + ((g % 180) - 60)
FROM generate_series(1, 6000) AS g
JOIN ordered_zones z ON z.rn = 1 + ((g - 1) % 360);

INSERT INTO warehouse.stock_balances (
  bin_id, part_id, quantity_on_hand, quantity_reserved, lot_number,
  expires_at, last_counted_at, updated_at
)
SELECT
  1 + ((g - 1) % 6000),
  1 + ((((g - 1) / 6000) * 613 + ((g - 1) % 6000) * 37) % 3000),
  5 + (g * 19) % 1200,
  CASE WHEN g % 8 = 0 THEN least(5 + (g * 19) % 1200, (g * 7) % 80) ELSE 0 END,
  CASE WHEN g % 5 = 0 THEN format('LOT-%s-%s', g % 500, extract(year FROM current_date)::integer) ELSE NULL END,
  CASE WHEN g % 5 = 0 THEN current_date + (30 + g % 720) ELSE NULL END,
  now() - ((g % 2400) || ' hours')::interval,
  now() - ((g % 1200) || ' hours')::interval
FROM generate_series(1, 30000) AS g;

INSERT INTO warehouse.inventory_movements (
  part_id, from_bin_id, to_bin_id, movement_type, quantity,
  reference_type, reference_id, performed_by_employee_id, metadata, occurred_at
)
SELECT
  1 + ((g * 37 - 1) % 3000),
  CASE WHEN g % 6 IN (0, 1) THEN NULL ELSE 1 + ((g * 11 - 1) % 6000) END,
  CASE WHEN g % 6 IN (2, 3) THEN NULL ELSE 1 + ((g * 17 - 1) % 6000) END,
  (ARRAY['receipt','pick','transfer','adjustment','return','write_off'])[1 + (g % 6)],
  1 + (g * 13) % 180,
  (ARRAY['purchase_order','shipment','cycle_count','return'])[1 + (g % 4)],
  format('REF-%s', g % 18000),
  1 + ((g - 1) % 1500),
  jsonb_build_object('scanner', format('SCN-%s', 1 + g % 400), 'reason', (ARRAY['planned','damage','replenishment','customer_return'])[1 + (g % 4)]),
  now() - ((g % 520) || ' days')::interval - ((g % 86400) || ' seconds')::interval
FROM generate_series(1, 60000) AS g;

INSERT INTO procurement.purchase_orders (
  po_number, supplier_id, facility_id, buyer_employee_id, status, currency,
  subtotal, tax_amount, shipping_amount, ordered_at, expected_at, received_at,
  notes, metadata, created_at
)
SELECT
  format('PO-%s-%07s', extract(year FROM current_date)::integer, g),
  1 + ((g * 17 - 1) % 500),
  1 + ((g * 7 - 1) % 60),
  1 + ((g * 13 - 1) % 1500),
  (CASE
    WHEN g % 41 = 0 THEN 'cancelled'
    WHEN g % 23 = 0 THEN 'draft'
    WHEN g % 11 = 0 THEN 'submitted'
    WHEN g % 7 = 0 THEN 'approved'
    WHEN g % 5 = 0 THEN 'partially_received'
    ELSE 'received'
  END)::procurement.po_status,
  (ARRAY['USD','USD','EUR','GBP','INR','SGD','JPY','AUD'])[1 + (g % 8)],
  round((200 + (g % 5000) * 4.31 + random() * 900)::numeric, 2),
  round((g % 650 * 1.17)::numeric, 2),
  round((25 + g % 480)::numeric, 2),
  now() - ((g % 600) || ' days')::interval,
  now() - ((g % 600) || ' days')::interval + ((5 + g % 90) || ' days')::interval,
  CASE WHEN g % 41 <> 0 AND g % 23 <> 0 AND g % 11 <> 0 AND g % 7 <> 0 AND g % 5 <> 0
    THEN now() - ((g % 600) || ' days')::interval + ((4 + g % 60) || ' days')::interval ELSE NULL END,
  CASE WHEN g % 19 = 0 THEN 'Expedite requested by operations' ELSE NULL END,
  jsonb_build_object('incoterm', (ARRAY['EXW','FOB','CIF','DDP'])[1 + (g % 4)], 'approval_level', 1 + g % 3),
  now() - ((g % 600) || ' days')::interval - interval '2 days'
FROM generate_series(1, 8000) AS g;

INSERT INTO procurement.purchase_order_lines (
  purchase_order_id, line_number, part_id, ordered_quantity,
  received_quantity, unit_cost, promised_at
)
SELECT
  po.id,
  line_no,
  1 + ((po.id * 31 + line_no * 101 - 1) % 3000),
  10 + (po.id * line_no) % 900,
  CASE
    WHEN po.status = 'received' THEN 10 + (po.id * line_no) % 900
    WHEN po.status = 'partially_received' THEN round((10 + (po.id * line_no) % 900) * 0.6)
    ELSE 0
  END,
  round((2 + (po.id * line_no) % 850 * 0.91)::numeric, 4),
  po.expected_at::date
FROM procurement.purchase_orders po
CROSS JOIN generate_series(1, 3) AS line_no;

INSERT INTO logistics.shipments (
  tracking_number, purchase_order_id, origin_facility_id, destination_facility_id,
  carrier, service_level, status, weight_kg, package_count, declared_value,
  scheduled_pickup_at, picked_up_at, estimated_delivery_at, delivered_at,
  attributes, created_at
)
SELECT
  format('STR%s%s', lpad((g % 97)::text, 2, '0'), lpad(g::text, 12, '0')),
  1 + ((g - 1) % 8000),
  1 + ((g - 1) % 60),
  1 + ((g * 7) % 60),
  (ARRAY['DHL','FedEx','UPS','Maersk','DB Schenker','BlueDart','Local Freight'])[1 + (g % 7)],
  (ARRAY['standard','express','overnight','freight','economy'])[1 + (g % 5)],
  (CASE
    WHEN g % 53 = 0 THEN 'cancelled'
    WHEN g % 31 = 0 THEN 'exception'
    WHEN g % 19 = 0 THEN 'delayed'
    WHEN g % 11 = 0 THEN 'in_transit'
    WHEN g % 7 = 0 THEN 'picked_up'
    WHEN g % 5 = 0 THEN 'planned'
    ELSE 'delivered'
  END)::logistics.shipment_status,
  round((1 + g % 18000 + random() * 50)::numeric, 3),
  1 + g % 45,
  round((100 + g % 75000 + random() * 500)::numeric, 2),
  now() - ((g % 450) || ' days')::interval,
  CASE WHEN g % 53 = 0 OR g % 5 = 0 THEN NULL ELSE now() - ((g % 450) || ' days')::interval + interval '3 hours' END,
  now() - ((g % 450) || ' days')::interval + ((1 + g % 12) || ' days')::interval,
  CASE WHEN g % 53 <> 0 AND g % 31 <> 0 AND g % 19 <> 0 AND g % 11 <> 0 AND g % 7 <> 0 AND g % 5 <> 0
    THEN now() - ((g % 450) || ' days')::interval + ((1 + g % 10) || ' days')::interval ELSE NULL END,
  jsonb_build_object('temperature_controlled', g % 17 = 0, 'insurance', g % 4 = 0, 'carbon_kg', round((g % 900 * 0.37)::numeric, 2)),
  now() - ((g % 450) || ' days')::interval - interval '1 day'
FROM generate_series(1, 20000) AS g;

INSERT INTO logistics.shipment_stops (
  shipment_id, stop_sequence, facility_id, stop_type,
  planned_arrival_at, actual_arrival_at, actual_departure_at
)
SELECT
  s.id,
  stop.sequence,
  CASE stop.sequence WHEN 1 THEN s.origin_facility_id ELSE s.destination_facility_id END,
  CASE stop.sequence WHEN 1 THEN 'pickup' ELSE 'delivery' END,
  CASE stop.sequence WHEN 1 THEN s.scheduled_pickup_at ELSE s.estimated_delivery_at END,
  CASE stop.sequence WHEN 1 THEN s.picked_up_at ELSE s.delivered_at END,
  CASE WHEN stop.sequence = 1 AND s.picked_up_at IS NOT NULL THEN s.picked_up_at + interval '45 minutes' ELSE NULL END
FROM logistics.shipments s
CROSS JOIN (VALUES (1), (2)) AS stop(sequence);

WITH ordered_shipments AS (
  SELECT id, origin_facility_id, destination_facility_id, created_at,
    row_number() OVER (ORDER BY tracking_number) AS rn
  FROM logistics.shipments
)
INSERT INTO logistics.tracking_events (
  shipment_id, event_code, facility_id, latitude, longitude, message,
  source, raw_payload, occurred_at, received_at
)
SELECT
  s.id,
  (ARRAY['label.created','picked_up','departed_facility','arrived_facility','out_for_delivery','delivered','exception'])[1 + (g % 7)],
  CASE WHEN g % 2 = 0 THEN s.origin_facility_id ELSE s.destination_facility_id END,
  round((-40 + (g * 13 % 115) + random())::numeric, 6),
  round((-120 + (g * 17 % 240) + random())::numeric, 6),
  (ARRAY['Shipping label created','Shipment picked up','Departed facility','Arrived at facility','Out for delivery','Delivered','Delivery exception'])[1 + (g % 7)],
  (ARRAY['carrier_api','mobile_scanner','telematics','edi'])[1 + (g % 4)],
  jsonb_build_object('code', 100 + g % 900, 'temperature_c', round((-5 + g % 38 * 0.7)::numeric, 1), 'battery_percent', 20 + g % 81),
  s.created_at + ((g % 240) || ' hours')::interval,
  s.created_at + ((g % 240) || ' hours')::interval + ((g % 600) || ' seconds')::interval
FROM generate_series(1, 100000) AS g
JOIN ordered_shipments s ON s.rn = 1 + ((g - 1) % 20000);

INSERT INTO fleet.vehicles (
  vehicle_number, home_facility_id, vin, vehicle_type, make, model,
  model_year, odometer_km, status, telematics, acquired_at, retired_at, created_at
)
SELECT
  format('VEH-%05s', g),
  1 + ((g * 7 - 1) % 60),
  format('STRATA%s', lpad(g::text, 11, '0')),
  (ARRAY['van','box_truck','tractor','trailer','forklift','service_vehicle'])[1 + (g % 6)],
  (ARRAY['Ford','Mercedes','Volvo','Toyota','Isuzu','Freightliner'])[1 + (g % 6)],
  (ARRAY['Transit','Sprinter','VNL','HiAce','N-Series','Cascadia'])[1 + (g % 6)],
  2014 + g % 13,
  round((5000 + g % 380000 + random() * 3000)::numeric, 1),
  CASE WHEN g % 71 = 0 THEN 'retired' WHEN g % 17 = 0 THEN 'maintenance' WHEN g % 3 = 0 THEN 'assigned' ELSE 'available' END,
  jsonb_build_object('device_id', format('TEL-%s', g), 'fuel_percent', g % 101, 'engine_hours', 100 + g * 17),
  current_date - (500 + g % 4000),
  CASE WHEN g % 71 = 0 THEN current_date - (g % 300) ELSE NULL END,
  now() - ((500 + g % 3500) || ' days')::interval
FROM generate_series(1, 600) AS g;

INSERT INTO fleet.driver_assignments (
  vehicle_id, employee_id, assigned_from, assigned_until, primary_driver
)
SELECT
  v.id,
  1 + ((v.id * 11 - 1) % 1500),
  now() - ((v.id % 300) || ' days')::interval,
  CASE WHEN v.status IN ('retired', 'maintenance') THEN now() - ((v.id % 300) || ' days')::interval + interval '14 days' ELSE NULL END,
  true
FROM fleet.vehicles v;

INSERT INTO maintenance.work_orders (
  work_order_number, vehicle_id, facility_id, assigned_employee_id,
  status, priority, category, description, parts_cost, labor_hours,
  scheduled_at, completed_at, checklist, created_at
)
SELECT
  format('WO-%s-%06s', extract(year FROM current_date)::integer, g),
  1 + ((g * 7 - 1) % 600),
  1 + ((g * 11 - 1) % 60),
  1 + ((g * 13 - 1) % 1500),
  (CASE WHEN g % 37 = 0 THEN 'cancelled' WHEN g % 19 = 0 THEN 'blocked' WHEN g % 13 = 0 THEN 'in_progress' WHEN g % 7 = 0 THEN 'scheduled' WHEN g % 5 = 0 THEN 'requested' ELSE 'completed' END)::maintenance.work_order_status,
  1 + g % 4,
  (ARRAY['preventive','brakes','engine','tires','electrical','inspection'])[1 + (g % 6)],
  (ARRAY['Scheduled preventive service','Brake vibration reported','Engine fault code investigation','Tire replacement','Electrical system diagnosis','Annual safety inspection'])[1 + (g % 6)],
  round((g % 2300 + random() * 180)::numeric, 2),
  round((1 + g % 80 * 0.5)::numeric, 2),
  now() - ((g % 500) || ' days')::interval + interval '2 days',
  CASE WHEN g % 37 <> 0 AND g % 19 <> 0 AND g % 13 <> 0 AND g % 7 <> 0 AND g % 5 <> 0
    THEN now() - ((g % 500) || ' days')::interval + interval '3 days' ELSE NULL END,
  jsonb_build_array(
    jsonb_build_object('item', 'Visual inspection', 'complete', g % 5 <> 0),
    jsonb_build_object('item', 'Diagnostic scan', 'complete', g % 7 <> 0)
  ),
  now() - ((g % 500) || ' days')::interval
FROM generate_series(1, 5000) AS g;

INSERT INTO finance.cost_centers (code, name, department_id, annual_budget)
SELECT
  d.cost_center,
  d.name || ' budget',
  d.id,
  500000 + d.id * 375000
FROM hr.departments d;

INSERT INTO finance.expenses (
  cost_center_code, employee_id, supplier_id, expense_type, amount,
  currency, status, receipt, incurred_on, approved_at, created_at
)
SELECT
  format('CC-%s', CASE 1 + ((g - 1) % 12)
    WHEN 1 THEN '100' WHEN 2 THEN '110' WHEN 3 THEN '120' WHEN 4 THEN '130'
    WHEN 5 THEN '200' WHEN 6 THEN '210' WHEN 7 THEN '220' WHEN 8 THEN '230'
    WHEN 9 THEN '300' WHEN 10 THEN '310' WHEN 11 THEN '320' ELSE '330' END),
  1 + ((g * 13 - 1) % 1500),
  CASE WHEN g % 7 = 0 THEN NULL ELSE 1 + ((g * 17 - 1) % 500) END,
  (ARRAY['travel','fuel','parts','software','training','facilities','freight'])[1 + (g % 7)],
  round((15 + g % 12000 + random() * 350)::numeric, 2),
  (ARRAY['USD','USD','EUR','GBP','INR','SGD','JPY','AUD'])[1 + (g % 8)],
  CASE WHEN g % 29 = 0 THEN 'rejected' WHEN g % 17 = 0 THEN 'draft' WHEN g % 11 = 0 THEN 'submitted' WHEN g % 5 = 0 THEN 'approved' ELSE 'paid' END,
  CASE WHEN g % 9 = 0 THEN NULL ELSE jsonb_build_object('file', format('receipt-%s.pdf', g), 'verified', g % 13 <> 0) END,
  current_date - (g % 720),
  CASE WHEN g % 17 = 0 OR g % 11 = 0 OR g % 29 = 0 THEN NULL ELSE now() - ((g % 720) || ' days')::interval + interval '2 days' END,
  now() - ((g % 720) || ' days')::interval
FROM generate_series(1, 15000) AS g;

INSERT INTO audit.activity_log (
  actor_employee_id, action, object_type, object_id, request_id,
  source_ip, details, occurred_at
)
SELECT
  1 + ((g * 13 - 1) % 1500),
  (ARRAY['created','updated','approved','cancelled','assigned','exported'])[1 + (g % 6)],
  (ARRAY['purchase_order','shipment','part','vehicle','work_order','expense'])[1 + (g % 6)],
  format('%s-%s', (ARRAY['po','shp','part','veh','wo','exp'])[1 + (g % 6)], g % 20000),
  gen_random_uuid(),
  format('10.%s.%s.%s', 1 + g % 240, 1 + (g * 3) % 240, 1 + (g * 7) % 240)::inet,
  jsonb_build_object('source', (ARRAY['web','desktop','api','scanner'])[1 + (g % 4)], 'correlation', format('corr-%s', g % 8000)),
  now() - ((g % 520) || ' days')::interval - ((g % 86400) || ' seconds')::interval
FROM generate_series(1, 30000) AS g;

REFRESH MATERIALIZED VIEW reporting.daily_shipment_volume;

ANALYZE;
