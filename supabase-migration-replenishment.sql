-- ChlorTainer Inventory System — Replenishment forecasting schema
-- Additive only: new tables + new columns. Safe to re-run (IF NOT EXISTS).

-- 1. Vessel models (e.g. "Dual 150") --------------------------------------
create table if not exists vessel_models (
  id          text primary key,
  name        text not null unique,
  description text,
  created_at  timestamptz default now()
);

-- 2. Control lists: parts required per build unit, by list type -----------
--    list_type references the expandable packing_slip_types lookup
--    (Main Parts / Loose Parts / Spare Parts / custom).
create table if not exists control_list_lines (
  id              uuid primary key default gen_random_uuid(),
  vessel_model_id text not null references vessel_models(id) on delete cascade,
  list_type       text not null references packing_slip_types(name) on update cascade,
  part_id         text not null references parts(id),
  qty_per_unit    numeric not null check (qty_per_unit > 0),
  notes           text,
  created_at      timestamptz default now(),
  unique (vessel_model_id, list_type, part_id)
);

-- 3. When each list type is needed (project build timing) -----------------
--    Main parts are consumed during the build; loose/spare ship with the vessel.
alter table packing_slip_types
  add column if not exists needed_by_anchor text not null default 'ship_date'
    check (needed_by_anchor in ('build_start','ship_date')),
  add column if not exists lead_buffer_days integer not null default 0
    check (lead_buffer_days >= 0);
update packing_slip_types set needed_by_anchor = 'build_start' where name = 'Main Parts';

-- 4. Order lines: vessel configurations on an order, with timing ----------
alter table orders add column if not exists project_name text;

create table if not exists order_lines (
  id               uuid primary key default gen_random_uuid(),
  order_id         text not null references orders(id) on delete cascade,
  vessel_model_id  text not null references vessel_models(id),
  units            integer not null default 1 check (units > 0),
  build_start_date date,
  ship_date        date,
  status           text not null default 'Open'
                     check (status in ('Open','In Build','Shipped','Cancelled')),
  notes            text,
  created_at       timestamptz default now()
);

-- 5. Procurement settings, one row per inventory item ---------------------
create table if not exists part_procurement (
  part_id               text primary key references parts(id) on delete cascade,
  policy                text not null default 'order_driven'
                          check (policy in ('order_driven','reorder_point','min_max','fixed_interval','do_not_reorder')),
  preferred_supplier_id text references suppliers(id) on delete set null,
  backup_supplier_id    text references suppliers(id) on delete set null,
  lead_time_days        integer check (lead_time_days >= 0),   -- overrides part_suppliers.lead_days
  lead_buffer_days      integer not null default 0 check (lead_buffer_days >= 0),
  service_level         numeric not null default 0.95 check (service_level > 0.5 and service_level < 1),
  moq                   numeric not null default 1 check (moq >= 1),
  order_multiple        numeric not null default 1 check (order_multiple >= 1),
  manual_monthly_usage  numeric not null default 0 check (manual_monthly_usage >= 0), -- unplanned demand
  min_qty               numeric check (min_qty >= 0),           -- min_max policy
  max_qty               numeric check (max_qty >= 0),           -- min_max policy
  review_interval_days  integer check (review_interval_days > 0), -- fixed_interval / cycle cover
  notes                 text,
  updated_at            timestamptz default now()
);

-- 6. Purchase orders ------------------------------------------------------
create table if not exists purchase_orders (
  id            text primary key,
  supplier_id   text references suppliers(id),
  status        text not null default 'Draft'
                  check (status in ('Draft','Sent','Partially Received','Received','Cancelled')),
  order_date    date,
  expected_date date,
  notes         text,
  created_by    uuid,
  created_at    timestamptz default now()
);

create table if not exists purchase_order_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        text not null references purchase_orders(id) on delete cascade,
  part_id      text not null references parts(id),
  qty          numeric not null check (qty > 0),
  unit_cost    numeric,
  mfg_part_no  text,
  needed_by    date,
  qty_received numeric not null default 0 check (qty_received >= 0),
  source_orders jsonb default '[]',
  created_at   timestamptz default now()
);

create index if not exists idx_control_lines_model on control_list_lines(vessel_model_id);
create index if not exists idx_order_lines_order   on order_lines(order_id);
create index if not exists idx_po_lines_po         on purchase_order_lines(po_id);
create index if not exists idx_po_lines_part       on purchase_order_lines(part_id);

-- 7. Row-level security, consistent with the other tables -----------------
do $$
declare t text;
begin
  foreach t in array array['vessel_models','control_list_lines','order_lines',
                           'part_procurement','purchase_orders','purchase_order_lines']
  loop
    execute format('alter table %I enable row level security', t);
    begin
      execute format('create policy "allow all" on %I for all using (true) with check (true)', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
