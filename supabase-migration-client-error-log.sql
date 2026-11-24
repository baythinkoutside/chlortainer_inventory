-- Applied 2026-11-24 via Supabase MCP (migration client_error_log)
-- Lets any signed-in user (fabricators included) record a screen error in the audit log, so crashes on phones can be diagnosed.
create or replace function public.log_client_error(p_where text, p_msg text, p_stack text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return false; end if;
  insert into audit_log(user_id,user_email,action,entity_type,entity_id,details)
  values (auth.uid(), coalesce(auth.jwt()->>'email','unknown'), 'client_error','app',left(coalesce(p_where,''),80),
          jsonb_build_object('message',left(coalesce(p_msg,''),1000),'stack',left(coalesce(p_stack,''),4000),
                             'role',public.jwt_role(),'fabricator_id',public.jwt_fabricator()));
  return true;
end $$;
grant execute on function public.log_client_error(text,text,text) to authenticated;
