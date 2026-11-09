-- ChlorTainer Inventory System — Maintenance demand (customer maintenance POs)
-- Additive only. Run after supabase-migration-replenishment.sql.
-- Parts serve two purposes: manufacturing fulfillment (vessel builds via control
-- lists) and customer maintenance purchase orders (direct part lines or kits).

-- 1. Order purpose --------------------------------------------------------
alter table orders
  add column if not exists order_type text not null default 'manufacturing'
    check (order_type in ('manufacturing','maintenance'));

-- 2. Reusable maintenance kits (e.g. annual service kit) ------------------
create table if not exists maintenance_kits (
  id          text primary key,
  name        text not null unique,
  description text,
  created_at  timestamptz default now()
);

create table if not exists maintenance_kit_lines (
  id         uuid primary key default gen_random_uuid(),
  kit_id     text not null references maintenance_kits(id) on delete cascade,
  part_id    text not null references parts(id),
  qty        numeric not null check (qty > 0),
  created_at timestamptz default now(),
  unique (kit_id, part_id)
);

-- 3. Maintenance PO lines: either a direct part or a kit -------------------
create table if not exists maintenance_order_lines (
  id         uuid primary key default gen_random_uuid(),
  order_id   text not null references orders(id) on delete cascade,
  line_type  text not null check (line_type in ('part','kit')),
  part_id    text references parts(id),
  kit_id     text references maintenance_kits(id),
  qty        numeric not null check (qty > 0),
  needed_by  date,
  status     text not null default 'Open' check (status in ('Open','Shipped','Cancelled')),
  notes      text,
  created_at timestamptz default now(),
  check (
    (line_type = 'part' and part_id is not null and kit_id is null) or
    (line_type = 'kit'  and kit_id  is not null and part_id is null)
  )
);

create index if not exists idx_kit_lines_kit      on maintenance_kit_lines(kit_id);
create index if not exists idx_maint_lines_order  on maintenance_order_lines(order_id);
create index if not exists idx_maint_lines_part   on maintenance_order_lines(part_id);

-- 4. Row-level security, consistent with the other tables -----------------
do $$
declare t text;
begin
  foreach t in array array['maintenance_kits','maintenance_kit_lines','maintenance_order_lines']
  loop
    execute format('alter table %I enable row level security', t);
    begin
      execute format('create policy "allow all" on %I for all using (true) with check (true)', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
