-- Pending/rejected clients have only the approval and password flows, including
-- when a caller bypasses the page and invokes the settings RPC directly.
create or replace function public.save_settings(p_name text,p_workspace uuid,p_workspace_name text,p_timezone text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and not p.archived and
  (p.role='admin' or (p.role='client' and p.approval_status='approved') or
   (p.role='bidder' and exists(select 1 from public.bidders b where b.user_id=p.id and public.can_read(b.workspace_id,b.user_id)))))
 then raise exception 'Access denied'; end if;
 if length(trim(coalesce(p_name,'')))=0 then raise exception 'Name required'; end if;
 update public.profiles set display_name=left(trim(p_name),100) where id=auth.uid();
 if p_workspace is not null then
  perform public.require_manager(p_workspace);
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
  update public.workspaces set name=left(trim(p_workspace_name),100),timezone=p_timezone where id=p_workspace;
 end if;
end $$;
