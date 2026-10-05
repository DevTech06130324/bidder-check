-- Read-only, scoped inventory and a one-transaction reset for the authorized
-- legacy application cutover. The function never deletes accounts/workspaces.
create table public.application_library_reset_audits (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.profiles,
 scope text not null,
 workspace_count integer not null,
 profile_count integer not null,
 assignment_count integer not null,
 bid_count integer not null,
 file_count integer not null,
 event_count integer not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.application_library_reset_audits enable row level security;
revoke all on public.application_library_reset_audits from public,anon,authenticated;
grant all on public.application_library_reset_audits to service_role;

create function public.application_library_inventory(p_workspaces uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scopes uuid[]; workspace_count integer; profile_count integer; assignment_count integer;
 bid_count integer; file_count integer; event_count integer; pending_upload_count integer; fingerprint text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 select coalesce(array_agg(distinct x order by x),'{}') into scopes from unnest(coalesce(p_workspaces,'{}')) x;
 if cardinality(scopes)=0 then raise exception 'At least one workspace must be explicitly selected'; end if;
 select count(*)::integer into workspace_count from public.workspaces where id=any(scopes);
 if workspace_count<>cardinality(scopes) then raise exception 'A selected workspace no longer exists'; end if;
 select count(*)::integer into profile_count from public.candidate_profiles where workspace_id=any(scopes);
 select count(*)::integer into assignment_count from public.resumes where workspace_id=any(scopes);
 select count(*)::integer into bid_count from public.bids where workspace_id=any(scopes);
 select count(*)::integer into file_count from public.files where workspace_id=any(scopes);
 select count(*)::integer into pending_upload_count from public.files where workspace_id=any(scopes) and not finalized;
 select count(*)::integer into event_count from public.bid_events e join public.bids b on b.id=e.bid_id where b.workspace_id=any(scopes);
 select encode(sha256(convert_to(
  array_to_string(scopes,',')||E'\n'||
  coalesce((select string_agg(id::text,',' order by id) from public.candidate_profiles where workspace_id=any(scopes)),'')||E'\n'||
  coalesce((select string_agg(id::text||':'||coalesce(file_id::text,''),',' order by id) from public.resumes where workspace_id=any(scopes)),'')||E'\n'||
  coalesce((select string_agg(id::text||':'||version::text||':'||coalesce(evidence_file_id::text,''),',' order by id) from public.bids where workspace_id=any(scopes)),'')||E'\n'||
  coalesce((select string_agg(id::text||':'||storage_path||':'||kind, E'\n' order by id) from public.files where workspace_id=any(scopes)),'')||E'\n'||
  coalesce((select string_agg(e.id::text||':'||e.bid_id::text,',' order by e.id) from public.bid_events e join public.bids b on b.id=e.bid_id where b.workspace_id=any(scopes)),''),
  'UTF8')),'hex') into fingerprint;
 return jsonb_build_object('workspaceCount',workspace_count,'profileCount',profile_count,
  'assignmentCount',assignment_count,'bidCount',bid_count,'fileCount',file_count,
  'pendingUploadCount',pending_upload_count,'eventCount',event_count,'fingerprint',fingerprint);
end $$;

create function public.reset_application_library(p_workspaces uuid[],p_expected_fingerprint text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scopes uuid[]; inventory jsonb; queued integer; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin' and not archived) then
  raise exception 'An active administrator is required for the reset audit';
 end if;
 select coalesce(array_agg(distinct x order by x),'{}') into scopes from unnest(coalesce(p_workspaces,'{}')) x;
 if cardinality(scopes)=0 then raise exception 'At least one workspace must be explicitly selected'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bidder-check-application-library-reset',0));
 lock table public.candidate_profiles,public.resumes,public.bids,public.files,public.bid_events,
  public.retained_bid_daily_aggregates,public.bid_import_receipts,public.bid_purge_operations
  in access exclusive mode;
 inventory=public.application_library_inventory(scopes);
 if inventory->>'fingerprint' is distinct from p_expected_fingerprint then
  raise exception 'Application data changed after inventory; take a new inventory before reset';
 end if;

 -- Keep durable cleanup work before removing either completed or unfinished file rows.
 insert into public.storage_cleanup_tasks(operation_id,storage_path)
  select null,f.storage_path from public.files f where f.workspace_id=any(scopes) and f.storage_path is not null
   and not exists(select 1 from public.storage_cleanup_tasks t where t.storage_path=f.storage_path and t.completed_at is null);
 get diagnostics queued=row_count;

 -- Scrub retry/deletion snapshots while their original assignment and bid
 -- ownership can still be resolved. Keep only fingerprints/counts/audit keys.
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

revoke all on function public.application_library_inventory(uuid[]),public.reset_application_library(uuid[],text,uuid) from public,anon,authenticated;
grant execute on function public.application_library_inventory(uuid[]) to service_role;
grant execute on function public.reset_application_library(uuid[],text,uuid) to service_role;
