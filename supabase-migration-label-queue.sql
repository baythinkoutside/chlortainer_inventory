-- Applied 2026-11-24 via Supabase MCP (migration label_print_queue)
-- Item label print queue: received stock waits here until its labels are printed.
create table if not exists public.label_queue (
  id uuid primary key default gen_random_uuid(),
  part_id text not null references public.parts(id) on update cascade on delete cascade,
  qty integer not null check (qty > 0),
  source text,            -- 'po_receive' | 'receive_no_po' | 'manual'
  ref text,               -- PO number, etc.
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists label_queue_created_idx on public.label_queue(created_at);
alter table public.label_queue enable row level security;
do $$ begin
  create policy "staff all" on public.label_queue for all to authenticated
    using (jwt_role() <> 'fabricator') with check (jwt_role() <> 'fabricator');
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.label_queue;
exception when duplicate_object then null; when undefined_object then null; end $$;
