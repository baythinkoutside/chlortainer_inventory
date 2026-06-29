-- ChlorTainer Inventory — Supabase Setup Script
-- Run this once in: Supabase Dashboard → Database → SQL Editor → New Query

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists suppliers (
  id         text primary key,
  name       text not null,
  contact    text,
  phone      text,
  created_at timestamptz default now()
);

create table if not exists parts (
  id          text primary key,
  description text not null,
  category    text,
  uom         text default 'EA',
  stock       integer default 0,
  min_stock   integer default 0,
  location    text,
  created_at  timestamptz default now()
);

create table if not exists part_suppliers (
  id          uuid primary key default gen_random_uuid(),
  part_id     text references parts(id) on delete cascade,
  supplier_id text references suppliers(id) on delete cascade,
  mfg_part_no text,
  lead_days   integer default 0,
  unit_cost   numeric(10,2) default 0,
  unique(part_id, supplier_id)
);

create table if not exists license_plates (
  id          text primary key,
  type        text default 'Outbound',
  destination text,
  status      text default 'Pending',
  created_at  date default current_date,
  items       jsonb default '[]'
);

-- ── Enable Realtime ───────────────────────────────────────────────────────────

alter publication supabase_realtime add table suppliers;
alter publication supabase_realtime add table parts;
alter publication supabase_realtime add table part_suppliers;
alter publication supabase_realtime add table license_plates;

-- ── Seed Data ─────────────────────────────────────────────────────────────────

insert into suppliers (id, name, contact, phone) values
  ('SUP-001', 'Aldrich Chemical Co.', 'orders@aldrichchem.com', '800-325-3010'),
  ('SUP-002', 'Parker Hannifin',       'industrial@parker.com',  '216-896-3000'),
  ('SUP-003', 'Swagelok',              'info@swagelok.com',      '440-349-5934'),
  ('SUP-004', 'McMaster-Carr',          'orders@mcmaster.com',   '630-833-0300')
on conflict do nothing;

insert into parts (id, description, category, uom, stock, min_stock, location) values
  ('CT-BC-0001', 'HDPE Containment Body 55gal', 'Containment',    'EA', 24,  10, 'A-01-03'),
  ('CT-BC-0002', 'PTFE Gasket 2-inch',           'Seals & Gaskets','EA',  8,  25, 'B-03-01'),
  ('CT-BC-0003', '316 SS Ball Valve 1/2"',       'Valves',         'EA', 42,  15, 'C-02-04'),
  ('CT-BC-0004', 'Chlorine Sensor Probe',        'Instrumentation','EA',  5,   5, 'D-01-01'),
  ('CT-BC-0005', 'HDPE Lid Assembly',            'Containment',    'EA', 19,   8, 'A-01-04'),
  ('CT-BC-0006', 'Vent Filter HEPA 4"',          'Filtration',     'EA',  3,  12, 'B-04-02')
on conflict do nothing;

insert into part_suppliers (part_id, supplier_id, mfg_part_no, lead_days, unit_cost) values
  ('CT-BC-0001', 'SUP-002', 'HB-55-HDPE',    7,  142.00),
  ('CT-BC-0001', 'SUP-004', 'MC-HDPE-55G',   5,  138.50),
  ('CT-BC-0002', 'SUP-003', 'SS-PTFE-2',     3,    4.75),
  ('CT-BC-0002', 'SUP-004', 'MC-GKT-PTFE',   2,    5.10),
  ('CT-BC-0003', 'SUP-003', 'SW-BV-SS-050',  4,   67.80),
  ('CT-BC-0004', 'SUP-001', 'AC-CLR-PRB-01', 14, 312.00),
  ('CT-BC-0005', 'SUP-002', 'HB-LID-ASM',    7,   58.25),
  ('CT-BC-0005', 'SUP-004', 'MC-LID-HDPE',   4,   55.00),
  ('CT-BC-0006', 'SUP-004', 'MC-VNT-HEPA4',  2,   18.40)
on conflict do nothing;

insert into license_plates (id, type, destination, status, created_at, items) values
  ('LP-20240628-A1B2', 'Outbound', 'Parker Hannifin', 'Shipped', '2024-06-28',
   '[{"partId":"CT-BC-0001","qty":10},{"partId":"CT-BC-0005","qty":10}]')
on conflict do nothing;
