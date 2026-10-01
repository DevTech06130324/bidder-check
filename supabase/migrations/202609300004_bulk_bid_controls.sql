-- Confirmation snapshots contain IDs/versions only and are erased on completion.
create table public.bid_purge_operations (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles,
 scope text not null, bidder_id uuid, targets jsonb not null, count integer not null,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
 completed_at timestamptz
);
create table public.storage_cleanup_tasks (
 id uuid primary key default gen_random_uuid(), operation_id uuid not null references public.bid_purge_operations,
 storage_path text, attempts integer not null default 0, first_removed_at timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 lease_id uuid, lease_until timestamptz, last_error text
);
create index cleanup_due on public.storage_cleanup_tasks(next_attempt_at) where completed_at is null;
alter table public.bid_purge_operations enable row level security;
alter table public.storage_cleanup_tasks enable row level security;
grant all on public.bid_purge_operations,public.storage_cleanup_tasks to service_role;

create function public.bulk_bid_state(p_targets jsonb,p_deleted boolean) returns integer language plpgsql security definer set search_path='' as $$
declare b public.bids; target jsonb; n integer=0; begin
 if p_deleted is null or p_targets is null or jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets) not between 1 and 500 then raise exception 'Select 1 to 500 bids'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_targets))<>jsonb_array_length(p_targets) then raise exception 'Duplicate targets'; end if;
 for target in select value from jsonb_array_elements(p_targets) order by value->>'id' loop
  select * into b from public.bids where id=(target->>'id')::uuid for update;
  if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
  if (target->>'version')::integer is distinct from b.version then raise exception 'A selected bid changed. Refresh and select it again'; end if;
 end loop;
 for target in select value from jsonb_array_elements(p_targets) order by value->>'id' loop
  perform public.trash_bid((target->>'id')::uuid,p_deleted); n=n+1;
 end loop;
 return n;
end $$;

create function public.prepare_bid_purge(p_mode text,p_targets jsonb,p_bidder uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare targets jsonb; op public.bid_purge_operations; b public.bids; target jsonb; scope_name text; begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','client') and not archived and approval_status='approved') then raise exception 'Manager access denied'; end if;
 if p_bidder is not null and not exists(select 1 from public.bidders where user_id=p_bidder and public.manages(workspace_id)) then raise exception 'Access denied'; end if;
 if p_mode='selected' then
  if p_targets is null or jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets) not between 1 and 500 then raise exception 'Select 1 to 500 bids'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_targets))<>jsonb_array_length(p_targets) then raise exception 'Duplicate targets'; end if;
  for target in select value from jsonb_array_elements(p_targets) order by value->>'id' loop
   select * into b from public.bids where id=(target->>'id')::uuid for update;
   if b.id is null or not public.manages(b.workspace_id) or (p_bidder is not null and b.bidder_id<>p_bidder) then raise exception 'Access denied'; end if;
   if b.deleted_at is null or b.version is distinct from (target->>'version')::integer then raise exception 'A selected bid changed. Refresh and select it again'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',value->>'id','version',(value->>'version')::integer) order by value->>'id') into targets from jsonb_array_elements(p_targets);
 elsif p_mode='all' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version) order by id),'[]') into targets from public.bids where deleted_at is not null and public.manages(workspace_id) and (p_bidder is null or bidder_id=p_bidder);
 else raise exception 'Invalid deletion scope'; end if;
 if jsonb_array_length(targets)=0 then raise exception 'No eligible bids in trash'; end if;
 scope_name=case when p_mode='selected' then 'Selected trashed bids' when p_bidder is not null then 'All trash for this bidder' when public.is_admin() then 'All platform trash' else 'All trash in your workspace' end;
 -- Discard abandoned, expired snapshots; completed minimal audit remains.
 delete from public.bid_purge_operations where actor_id=auth.uid() and completed_at is null and expires_at<clock_timestamp();
 insert into public.bid_purge_operations(actor_id,scope,bidder_id,targets,count) values(auth.uid(),scope_name,p_bidder,targets,jsonb_array_length(targets)) returning * into op;
 return jsonb_build_object('id',op.id,'count',op.count,'scope',op.scope,'expiresAt',op.expires_at);
end $$;

create function public.bid_purge_status(p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.bid_purge_operations; pending integer; verifying integer; failed integer; begin
 select * into op from public.bid_purge_operations where id=p_operation;
 if op.id is null or op.actor_id<>auth.uid() or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','client') and not archived and approval_status='approved') then raise exception 'Access denied'; end if;
 if op.bidder_id is not null and not exists(select 1 from public.bidders where user_id=op.bidder_id and public.manages(workspace_id)) then raise exception 'Access denied'; end if;
 select count(*) filter(where completed_at is null),count(*) filter(where completed_at is null and first_removed_at is not null),count(*) filter(where completed_at is null and last_error is not null) into pending,verifying,failed from public.storage_cleanup_tasks where operation_id=op.id;
 return jsonb_build_object('id',op.id,'scope',op.scope,'deletedCount',case when op.completed_at is not null then op.count else 0 end,'pendingFiles',pending,'verifyingFiles',verifying,'failedFiles',failed);
end $$;

create function public.confirm_bid_purge(p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.bid_purge_operations; target jsonb; b public.bids; ids uuid[]; begin
 perform public.bid_purge_status(p_operation);
 select * into op from public.bid_purge_operations where id=p_operation for update;
 if op.completed_at is not null then return jsonb_build_object('id',op.id,'deletedCount',op.count); end if;
 if op.expires_at<clock_timestamp() then raise exception 'Confirmation expired. Prepare a new confirmation'; end if;
 for target in select value from jsonb_array_elements(op.targets) order by value->>'id' loop
  select * into b from public.bids where id=(target->>'id')::uuid for update;
  if b.id is null or not public.manages(b.workspace_id) or b.deleted_at is null or b.version is distinct from (target->>'version')::integer then raise exception 'Trash changed. Prepare a new confirmation'; end if;
 end loop;
 select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(op.targets);
 insert into public.storage_cleanup_tasks(operation_id,storage_path) select op.id,storage_path from public.files where bid_id=any(ids) and kind='screenshot';
 delete from public.bid_events where bid_id=any(ids);
 update public.bids set evidence_file_id=null,applied=false where id=any(ids);
 delete from public.files where bid_id=any(ids) and kind='screenshot';
 delete from public.bids where id=any(ids);
 update public.bid_purge_operations set completed_at=clock_timestamp(),targets='[]' where id=op.id;
 return jsonb_build_object('id',op.id,'deletedCount',op.count);
end $$;

create function public.recent_bid_purges() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb='[]'; op record; begin
 for op in select o.id from public.bid_purge_operations o where o.actor_id=auth.uid() and o.completed_at is not null and exists(select 1 from public.storage_cleanup_tasks t where t.operation_id=o.id and t.completed_at is null) order by o.completed_at desc loop
  result=result||jsonb_build_array(public.bid_purge_status(op.id));
 end loop;
 return result;
end $$;

-- Workers claim bounded leases; an immediate removal is followed by a delayed
-- verification after the 120-second upload timeout and 60-second URL lifetime.
create function public.claim_storage_cleanup(p_operation uuid default null,p_limit integer default 50) returns setof public.storage_cleanup_tasks language sql security definer set search_path='' as $$
 update public.storage_cleanup_tasks set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1
 where id in (select id from public.storage_cleanup_tasks where completed_at is null and next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()) and (p_operation is null or operation_id=p_operation) order by next_attempt_at,id for update skip locked limit least(greatest(p_limit,1),100)) returning *;
$$;
create function public.finish_storage_cleanup(p_task uuid,p_lease uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
declare t public.storage_cleanup_tasks; begin
 select * into t from public.storage_cleanup_tasks where id=p_task and lease_id=p_lease and completed_at is null for update;
 if t.id is null then return; end if;
 if p_success then
  if t.first_removed_at is null then
   update public.storage_cleanup_tasks set first_removed_at=clock_timestamp(),next_attempt_at=clock_timestamp()+interval '5 minutes',last_error=null,lease_id=null,lease_until=null where id=t.id;
  else
   update public.storage_cleanup_tasks set completed_at=clock_timestamp(),storage_path=null,last_error=null,lease_id=null,lease_until=null where id=t.id;
  end if;
 else
  update public.storage_cleanup_tasks set last_error='Storage removal failed; retry pending',next_attempt_at=clock_timestamp()+interval '1 minute',lease_id=null,lease_until=null where id=t.id;
 end if;
end $$;
create function public.retry_bid_cleanup(p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.bid_purge_status(p_operation);
 -- A retry may bypass failure backoff, never the in-flight verification delay.
 update public.storage_cleanup_tasks set next_attempt_at=clock_timestamp() where operation_id=p_operation and completed_at is null and last_error is not null;
 return public.bid_purge_status(p_operation);
end $$;

revoke all on function public.bulk_bid_state(jsonb,boolean),public.prepare_bid_purge(text,jsonb,uuid),public.confirm_bid_purge(uuid),public.bid_purge_status(uuid),public.recent_bid_purges(),public.retry_bid_cleanup(uuid),public.claim_storage_cleanup(uuid,integer),public.finish_storage_cleanup(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.bulk_bid_state(jsonb,boolean),public.prepare_bid_purge(text,jsonb,uuid),public.confirm_bid_purge(uuid),public.bid_purge_status(uuid),public.recent_bid_purges(),public.retry_bid_cleanup(uuid) to authenticated;
grant execute on function public.claim_storage_cleanup(uuid,integer),public.finish_storage_cleanup(uuid,uuid,boolean) to service_role;

-- Retry receipts retain a fingerprint, never copied job descriptions or URLs.
drop policy own_import_receipts on public.bid_import_receipts;
alter table public.bid_import_receipts add column payload_hash text;
update public.bid_import_receipts set payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
alter table public.bid_import_receipts alter column payload_hash set not null;
alter table public.bid_import_receipts drop column payload;
create policy own_import_receipts on public.bid_import_receipts for select to authenticated using(actor_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and not archived and approval_status='approved') and exists(select 1 from public.resumes where id=(result->>'resume')::uuid and public.can_read(workspace_id,bidder_id)));

create or replace function public.import_bids(p_resume uuid,p_date date,p_rows jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resumes; payload jsonb; receipt public.bid_import_receipts; errors jsonb; item jsonb; ids uuid[]='{}'; bid uuid; stamp timestamptz; result jsonb; n integer=0; purged integer=0; fingerprint text; begin
 if auth.uid() is null or p_request is null then raise exception 'Import request ID required'; end if;
 select * into r from public.resumes where id=p_resume;
 if r.id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 payload=jsonb_build_object('resume',p_resume,'date',p_date,'rows',p_rows);
 fingerprint=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 select * into receipt from public.bid_import_receipts where actor_id=auth.uid() and request_id=p_request;
 if receipt.request_id is not null then
  if receipt.payload_hash<>fingerprint then raise exception 'This request ID was already used with different content'; end if;
  select count(*)::integer into purged from jsonb_array_elements_text(receipt.result->'ids') x where not exists(select 1 from public.bids where id=x.value::uuid);
  return case when purged=0 then receipt.result else receipt.result||jsonb_build_object('purgedCount',purged) end;
 end if;
 errors=public.validate_bid_import(p_resume,p_date,p_rows);
 if jsonb_array_length(errors)>0 then return jsonb_build_object('errors',errors); end if;
 -- Use normalized order so concurrent pastes with different tracking parameters cannot reverse lock order.
 for item in select value from jsonb_array_elements(p_rows) order by public.normalize_job_url(value->>'url') loop
  perform pg_advisory_xact_lock(hashtextextended(r.id::text||public.normalize_job_url(item->>'url'),0));
 end loop;
 errors=public.validate_bid_import(p_resume,p_date,p_rows);
 if jsonb_array_length(errors)>0 then return jsonb_build_object('errors',errors); end if;
 stamp=case when p_date=(clock_timestamp() at time zone 'America/Chicago')::date then clock_timestamp() else p_date::timestamp at time zone 'America/Chicago' end;
 begin
  for item in select value from jsonb_array_elements(p_rows) loop
   n=n+1;
   insert into public.bids(workspace_id,bidder_id,resume_id,company,role_name,url,normalized_url,source,arrangement,job_status,found_at)
   values(r.workspace_id,r.bidder_id,r.id,trim(item->>'company'),trim(item->>'role_name'),trim(item->>'url'),public.normalize_job_url(item->>'url'),coalesce(item->>'source',''),item->>'arrangement',item->>'job_status',stamp) returning id into bid;
   ids=array_append(ids,bid);
   insert into public.bid_events(bid_id,actor_id,event,details) values(bid,auth.uid(),'imported',jsonb_build_object('request_id',p_request,'added_date',p_date));
  end loop;
 exception when unique_violation then
  return jsonb_build_object('errors',jsonb_build_array(jsonb_build_object('row',n,'field','url','message','URL now exists; check active bids and trash, then retry')));
 end;
 result=jsonb_build_object('ids',ids,'date',p_date,'bidder',r.bidder_id,'resume',r.id);
 insert into public.bid_import_receipts(actor_id,request_id,payload_hash,result) values(auth.uid(),p_request,fingerprint,result);
 return result;
end $$;
