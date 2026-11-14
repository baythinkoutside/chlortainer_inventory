-- Applied 2026-11-14 via Supabase MCP (migration parts_active_flag)
alter table parts add column if not exists active boolean not null default true;
alter table parts add column if not exists inactive_reason text;
