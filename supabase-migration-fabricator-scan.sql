-- Applied 2026-11-24 via Supabase MCP (migration fabricator_scan_lookups)
-- What a fabricator's scan of an LP / box label points to. Returns only a result word and the LP id:
--   mine | other_fabricator | not_sent | none
create or replace function public.fab_scan_lp(p_code text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare l record;
begin
  if public.jwt_role()<>'fabricator' then return jsonb_build_object('result','none'); end if;
  select id, fabricator_id, status into l from license_plates where upper(id)=upper(trim(p_code)) limit 1;
  if not found then return jsonb_build_object('result','none'); end if;
  if public.fab_owns_lp(l.id) then return jsonb_build_object('result','mine','id',l.id); end if;
  if l.fabricator_id is not null and l.fabricator_id<>public.jwt_fabricator()
     and l.status in ('Sent to Fabricator','Received','Received with issues','Shipped','Delivered')
    then return jsonb_build_object('result','other_fabricator','id',l.id); end if;
  return jsonb_build_object('result','not_sent','id',l.id);
end $$;

-- Part ids a scanned code can mean: CT- number, new / old part number, or a manufacturer (product) barcode.
create or replace function public.fab_resolve_code(p_code text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from (
    select p.id x from parts p where public.jwt_role()='fabricator' and (
      upper(p.id)=upper(trim(p_code)) or upper(coalesce(p.new_part_no,''))=upper(trim(p_code))
      or upper(coalesce(p.legacy_part_no,''))=upper(trim(p_code)))
    union
    select m.part_id from mfg_barcodes m where public.jwt_role()='fabricator' and upper(m.barcode)=upper(trim(p_code))
  ) s;
$$;

grant execute on function public.fab_scan_lp(text) to authenticated;
grant execute on function public.fab_resolve_code(text) to authenticated;
