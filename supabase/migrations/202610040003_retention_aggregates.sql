-- Preserve reporting totals before expired application details are removed.
create table public.retained_bid_daily_aggregates (
 workspace_id uuid not null references public.workspaces on delete cascade,
 profile_id uuid not null references public.candidate_profiles on delete cascade,
 bidder_id uuid not null references public.bidders(user_id) on delete cascade,
 resume_id uuid not null references public.resumes on delete cascade,
 report_day date not null,
 metric text not null check(metric in ('found','applied_activity','earning')),
 record_count bigint not null default 0 check(record_count>=0),
 earned_cents bigint not null default 0 check(earned_cents>=0),
 created_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,profile_id,bidder_id,resume_id,report_day,metric)
);
alter table public.retained_bid_daily_aggregates enable row level security;
revoke all on public.retained_bid_daily_aggregates from public,anon,authenticated;
grant select on public.retained_bid_daily_aggregates to authenticated;
grant all on public.retained_bid_daily_aggregates to service_role;
create policy retained_bid_aggregate_read on public.retained_bid_daily_aggregates for select to authenticated using(public.can_read(workspace_id,bidder_id));
create function public.candidate_retention_cutoff(p_now timestamptz,p_months integer) returns timestamptz language sql immutable strict set search_path='' as $$
 select ((p_now at time zone 'America/Chicago')-make_interval(months=>p_months)) at time zone 'America/Chicago'
$$;

-- Retention screenshot cleanup tasks have no user purge-operation owner.
alter table public.storage_cleanup_tasks alter column operation_id drop not null;

create function public.process_candidate_retention(p_limit integer default 500) returns jsonb language plpgsql security definer set search_path='' as $$
declare profile record; bid record; cutoff timestamptz; batch_limit integer=least(greatest(coalesce(p_limit,500),1),2000); deleted_total integer=0; storage_count integer=0; queued integer; found_day date; applied_day date; earned_day date; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 for profile in select id,workspace_id,retention_months from public.candidate_profiles where retention_months is not null order by id loop
  exit when deleted_total>=batch_limit;
  perform pg_advisory_xact_lock(hashtextextended(profile.id::text,0));
  cutoff=public.candidate_retention_cutoff(clock_timestamp(),profile.retention_months);
  for bid in
   select b.id,b.workspace_id,b.bidder_id,b.resume_id,b.found_at,b.applied_at,b.first_applied_at,b.rate_cents,b.deleted_at,b.evidence_file_id
   from public.bids b join public.resumes r on r.id=b.resume_id
   where r.profile_id=profile.id and b.applied and b.applied_at<cutoff
   order by b.applied_at,b.id for update of b skip locked limit least(batch_limit-deleted_total,200)
  loop
   -- Recheck under the profile and bid locks; a proof replacement resets applied_at.
   if bid.deleted_at is null then
    found_day=(bid.found_at at time zone 'America/Chicago')::date;
    applied_day=(bid.applied_at at time zone 'America/Chicago')::date;
    earned_day=(bid.first_applied_at at time zone 'America/Chicago')::date;
    insert into public.retained_bid_daily_aggregates(workspace_id,profile_id,bidder_id,resume_id,report_day,metric,record_count,earned_cents)
     values(bid.workspace_id,profile.id,bid.bidder_id,bid.resume_id,found_day,'found',1,0)
     on conflict(workspace_id,profile_id,bidder_id,resume_id,report_day,metric) do update set record_count=public.retained_bid_daily_aggregates.record_count+1;
    insert into public.retained_bid_daily_aggregates(workspace_id,profile_id,bidder_id,resume_id,report_day,metric,record_count,earned_cents)
     values(bid.workspace_id,profile.id,bid.bidder_id,bid.resume_id,applied_day,'applied_activity',1,0)
     on conflict(workspace_id,profile_id,bidder_id,resume_id,report_day,metric) do update set record_count=public.retained_bid_daily_aggregates.record_count+1;
    insert into public.retained_bid_daily_aggregates(workspace_id,profile_id,bidder_id,resume_id,report_day,metric,record_count,earned_cents)
     values(bid.workspace_id,profile.id,bid.bidder_id,bid.resume_id,earned_day,'earning',1,coalesce(bid.rate_cents,0))
     on conflict(workspace_id,profile_id,bidder_id,resume_id,report_day,metric) do update set record_count=public.retained_bid_daily_aggregates.record_count+1,earned_cents=public.retained_bid_daily_aggregates.earned_cents+excluded.earned_cents;
   end if;
   insert into public.storage_cleanup_tasks(operation_id,storage_path)
    select null,f.storage_path from public.files f where f.bid_id=bid.id and f.kind='screenshot';
   get diagnostics queued=row_count; storage_count=storage_count+queued;
   delete from public.bid_events where bid_id=bid.id;
   update public.bids set evidence_file_id=null,applied=false where id=bid.id;
   delete from public.files where bid_id=bid.id and kind='screenshot';
   delete from public.bids where id=bid.id;
   deleted_total=deleted_total+1;
  end loop;
 end loop;
 return jsonb_build_object('deletedApplications',deleted_total,'storageTasksQueued',storage_count,'limit',batch_limit);
end $$;
revoke all on function public.candidate_retention_cutoff(timestamptz,integer),public.process_candidate_retention(integer) from public,anon,authenticated;
grant execute on function public.candidate_retention_cutoff(timestamptz,integer) to authenticated,service_role;
grant execute on function public.process_candidate_retention(integer) to service_role;

create function public.retention_cleanup_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'pending',count(*) filter(where completed_at is null),
  'waitingForRemoval',count(*) filter(where completed_at is null and first_removed_at is null),
  'verificationPending',count(*) filter(where completed_at is null and first_removed_at is not null),
  'processing',count(*) filter(where completed_at is null and lease_until>clock_timestamp()),
  'failed',count(*) filter(where completed_at is null and last_error is not null)
 ) from public.storage_cleanup_tasks where operation_id is null
$$;
revoke all on function public.retention_cleanup_status() from public,anon,authenticated;
grant execute on function public.retention_cleanup_status() to service_role;

create function public.retained_aggregate_summary(p_from date default null,p_to date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into result
 from public.retained_bid_daily_aggregates a
 where (p_from is null or a.report_day>=p_from) and (p_to is null or a.report_day<=p_to)
  and public.can_read(a.workspace_id,a.bidder_id);
 return result;
end $$;
revoke all on function public.retained_aggregate_summary(date,date) from public,anon;
grant execute on function public.retained_aggregate_summary(date,date) to authenticated;
