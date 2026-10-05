create or replace function public.review_bids(p_targets jsonb,p_status text,p_reason text default '') returns integer
language plpgsql security definer set search_path='' as $$
declare target record; bid_row public.bids; changed integer:=0; ids uuid[];
begin
 if jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets)=0 or jsonb_array_length(p_targets)>500 then raise exception 'Select between 1 and 500 bids'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Choose approved or rejected'; end if;
 if p_status='rejected' and length(trim(coalesce(p_reason,'')))=0 then raise exception 'A rejection reason is required'; end if;
 select array_agg((x->>'id')::uuid order by (x->>'id')::uuid) into ids from jsonb_array_elements(p_targets) x;
 if cardinality(ids)<>(select count(distinct i) from unnest(ids) i) then raise exception 'Duplicate bid selected'; end if;
 for target in select (x->>'id')::uuid id,(x->>'version')::integer version from jsonb_array_elements(p_targets) x order by (x->>'id')::uuid loop
   select * into bid_row from public.bids where id=target.id for update;
   if not found then raise exception 'One or more selected bids are inaccessible'; end if;
   if not public.manages(bid_row.workspace_id) then raise exception 'One or more selected bids are inaccessible'; end if;
   if bid_row.deleted_at is not null or bid_row.applied then raise exception 'Only active, unapplied bids can be reviewed'; end if;
   if bid_row.version<>target.version then raise exception 'A selected bid changed. Refresh and review the current rows.'; end if;
 end loop;
 for target in select (x->>'id')::uuid id from jsonb_array_elements(p_targets) x order by (x->>'id')::uuid loop
   update public.bids set review_status=p_status,review_revision=review_revision+1,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_reason=case when p_status='rejected' then left(trim(p_reason),1000) else null end,version=version+1 where id=target.id returning * into bid_row;
   insert into public.bid_events(bid_id,actor_id,event,reason,details) values(bid_row.id,auth.uid(),case when p_status='approved' then 'review_approved' else 'review_rejected' end,bid_row.review_reason,jsonb_build_object('revision',bid_row.review_revision));
   changed:=changed+1;
 end loop;
 return changed;
end $$;
revoke all on function public.review_bids(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.review_bids(jsonb,text,text) to authenticated;

-- Active applications can be tracked from rollout onward. Pre-feature retained
-- aggregates remain interview_tracking=false and are reported as excluded.
alter table public.bids add column interview_tracking boolean not null default true;
alter table public.retained_bid_daily_aggregates add column tracked_count bigint not null default 0 check(tracked_count>=0);

create or replace function public.process_candidate_retention(p_limit integer default 500) returns jsonb language plpgsql security definer set search_path='' as $$
declare profile record; bid record; cutoff timestamptz; batch_limit integer=least(greatest(coalesce(p_limit,500),1),2000); deleted_total integer=0; storage_count integer=0; queued integer; found_day date; applied_day date; earned_day date; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 for profile in select id,workspace_id,retention_months from public.candidate_profiles where retention_months is not null order by id loop
  exit when deleted_total>=batch_limit;
  perform pg_advisory_xact_lock(hashtextextended(profile.id::text,0));
  cutoff=public.candidate_retention_cutoff(clock_timestamp(),profile.retention_months);
  for bid in
   select b.id,b.workspace_id,b.bidder_id,b.resume_id,b.found_at,b.applied_at,b.first_applied_at,b.rate_cents,b.deleted_at,b.evidence_file_id,b.interview_scheduled,b.interview_tracking
   from public.bids b join public.resumes r on r.id=b.resume_id
   where r.profile_id=profile.id and b.applied and b.applied_at<cutoff
   order by b.applied_at,b.id for update of b skip locked limit least(batch_limit-deleted_total,200)
  loop
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
    insert into public.retained_bid_daily_aggregates(workspace_id,profile_id,bidder_id,resume_id,report_day,metric,record_count,earned_cents,interview_count,interview_tracking,tracked_count)
     values(bid.workspace_id,profile.id,bid.bidder_id,bid.resume_id,earned_day,'earning',1,coalesce(bid.rate_cents,0),case when bid.interview_scheduled then 1 else 0 end,bid.interview_tracking,case when bid.interview_tracking then 1 else 0 end)
     on conflict(workspace_id,profile_id,bidder_id,resume_id,report_day,metric) do update set record_count=public.retained_bid_daily_aggregates.record_count+1,earned_cents=public.retained_bid_daily_aggregates.earned_cents+excluded.earned_cents,interview_count=public.retained_bid_daily_aggregates.interview_count+excluded.interview_count,tracked_count=public.retained_bid_daily_aggregates.tracked_count+excluded.tracked_count,interview_tracking=public.retained_bid_daily_aggregates.interview_tracking or excluded.interview_tracking;
   end if;
   insert into public.storage_cleanup_tasks(operation_id,storage_path) select null,f.storage_path from public.files f where f.bid_id=bid.id and f.kind='screenshot';
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
revoke all on function public.process_candidate_retention(integer) from public,anon,authenticated;
grant execute on function public.process_candidate_retention(integer) to service_role;
