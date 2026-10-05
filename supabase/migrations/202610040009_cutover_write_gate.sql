-- Briefly pause application-library writes while a production reset is being
-- confirmed and verified. The gate is fail-closed in database triggers.
create table public.application_library_cutover_control (
 singleton boolean primary key default true check(singleton),
 active boolean not null default false,
 changed_at timestamptz not null default clock_timestamp()
);
insert into public.application_library_cutover_control(singleton,active) values(true,false);
alter table public.application_library_cutover_control enable row level security;
revoke all on public.application_library_cutover_control from public,anon,authenticated;
grant all on public.application_library_cutover_control to service_role;

create function public.set_application_library_cutover(p_active boolean) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 update public.application_library_cutover_control set active=p_active,changed_at=clock_timestamp() where singleton;
end $$;
revoke all on function public.set_application_library_cutover(boolean) from public,anon,authenticated;
grant execute on function public.set_application_library_cutover(boolean) to service_role;

create function public.guard_application_library_cutover_write() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('bidder_check.reset_override',true),'')<>'on'
  and exists(select 1 from public.application_library_cutover_control where singleton and active) then
  raise exception 'Application library is temporarily paused for a verified data reset';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.guard_application_library_cutover_write() from public,anon,authenticated;

create trigger cutover_write_guard before insert or update or delete on public.candidate_profiles
 for each row execute function public.guard_application_library_cutover_write();
create trigger cutover_write_guard before insert or update or delete on public.resumes
 for each row execute function public.guard_application_library_cutover_write();
create trigger cutover_write_guard before insert or update or delete on public.bids
 for each row execute function public.guard_application_library_cutover_write();
create trigger cutover_write_guard before insert or update or delete on public.files
 for each row execute function public.guard_application_library_cutover_write();
create trigger cutover_write_guard before insert or update or delete on public.bid_events
 for each row execute function public.guard_application_library_cutover_write();
create trigger cutover_write_guard before insert or update or delete on public.retained_bid_daily_aggregates
 for each row execute function public.guard_application_library_cutover_write();
create trigger cutover_write_guard before insert or update or delete on public.bid_import_receipts
 for each row execute function public.guard_application_library_cutover_write();
create trigger cutover_write_guard before insert or update or delete on public.bid_purge_operations
 for each row execute function public.guard_application_library_cutover_write();

create or replace function public.reset_application_library(p_workspaces uuid[],p_expected_fingerprint text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scopes uuid[]; inventory jsonb; queued integer; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin' and not archived) then
  raise exception 'An active administrator is required for the reset audit';
 end if;
 select coalesce(array_agg(distinct x order by x),'{}') into scopes from unnest(coalesce(p_workspaces,'{}')) x;
 if cardinality(scopes)=0 then raise exception 'At least one workspace must be explicitly selected'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bidder-check-application-library-reset',0));
 lock table public.workspaces,public.candidate_profiles,public.resumes,public.bids,public.files,public.bid_events,
  public.retained_bid_daily_aggregates,public.bid_import_receipts,public.bid_purge_operations
  in access exclusive mode;
 inventory=public.application_library_inventory(scopes);
 if inventory->>'fingerprint' is distinct from p_expected_fingerprint then
  raise exception 'Application data changed after inventory; take a new inventory before reset';
 end if;
 perform set_config('bidder_check.reset_override','on',true);

 insert into public.storage_cleanup_tasks(operation_id,storage_path)
  select null,f.storage_path from public.files f where f.workspace_id=any(scopes) and f.storage_path is not null
   and not exists(select 1 from public.storage_cleanup_tasks t where t.storage_path=f.storage_path and t.completed_at is null);
 get diagnostics queued=row_count;

 update public.bid_import_receipts set result=jsonb_build_object('ids','[]'::jsonb,'reset',true)
  where (result->>'resume') in (select id::text from public.resumes where workspace_id=any(scopes))
   or actor_id in (
    select w.owner_id from public.workspaces w where w.id=any(scopes)
    union select b.user_id from public.bidders b where b.workspace_id=any(scopes)
   );
 update public.bid_purge_operations po set targets='[]'::jsonb,bidder_id=null
  where exists(
   select 1 from jsonb_array_elements(po.targets) target
    join public.bids b on b.id=(target->>'id')::uuid
    where b.workspace_id=any(scopes)
  ) or po.actor_id in (
   select w.owner_id from public.workspaces w where w.id=any(scopes)
   union select b.user_id from public.bidders b where b.workspace_id=any(scopes)
  );

 delete from public.bid_events e using public.bids b where e.bid_id=b.id and b.workspace_id=any(scopes);
 update public.bids set applied=false,evidence_file_id=null where workspace_id=any(scopes);
 update public.resumes set file_id=null where workspace_id=any(scopes);
 delete from public.files where workspace_id=any(scopes);
 delete from public.bids where workspace_id=any(scopes);
 delete from public.resumes where workspace_id=any(scopes);
 delete from public.candidate_profiles where workspace_id=any(scopes);
 delete from public.retained_bid_daily_aggregates where workspace_id=any(scopes);

 insert into public.application_library_reset_audits(actor_id,scope,workspace_count,profile_count,assignment_count,bid_count,file_count,event_count)
  values(p_actor,array_to_string(scopes,','),(inventory->>'workspaceCount')::integer,
   (inventory->>'profileCount')::integer,(inventory->>'assignmentCount')::integer,
   (inventory->>'bidCount')::integer,(inventory->>'fileCount')::integer,(inventory->>'eventCount')::integer);
 return inventory||jsonb_build_object('storageTasksQueued',queued,'deleted',true);
end $$;
revoke all on function public.reset_application_library(uuid[],text,uuid) from public,anon,authenticated;
grant execute on function public.reset_application_library(uuid[],text,uuid) to service_role;
