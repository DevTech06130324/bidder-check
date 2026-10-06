-- Allow managers to record a verified application manually while retaining the
-- same rate snapshot, first-application attribution, and audit trail.
alter table public.bids add column application_method text;
update public.bids set application_method='screenshot' where applied;
alter table public.bids add constraint bids_application_method_check
  check (application_method is null or application_method in ('screenshot','manual'));

do $$ declare old_constraint text; begin
  select c.conname into old_constraint
  from pg_constraint c
  where c.conrelid='public.bids'::regclass and c.contype='c'
    and lower(pg_get_constraintdef(c.oid)) like '%evidence_file_id is not null%';
  if old_constraint is not null then
    execute format('alter table public.bids drop constraint %I', old_constraint);
  end if;
end $$;

alter table public.bids add constraint bids_application_state_check check (
  not applied or (
    rate_cents is not null and applied_at is not null and
    ((application_method='screenshot' and evidence_file_id is not null) or application_method='manual')
  )
);

-- Keep the default Today page and trash view ordered without scanning all
-- workspace history; resume counts and earnings reports also have narrow paths.
create index if not exists bids_active_found_page
  on public.bids(found_at desc,id) where deleted_at is null;
create index if not exists bids_trash_found_page
  on public.bids(found_at desc,id) where deleted_at is not null;
create index if not exists bids_resume_history_count
  on public.bids(resume_id);
create index if not exists bids_live_earnings_report
  on public.bids(first_applied_at desc,workspace_id,bidder_id,resume_id)
  where applied and deleted_at is null;

create function public.mark_screenshot_application() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.applied and new.evidence_file_id is not null then
    new.application_method='screenshot';
  end if;
  return new;
end $$;
create trigger mark_screenshot_application
before insert or update of applied,evidence_file_id on public.bids
for each row execute function public.mark_screenshot_application();

create table public.manual_application_receipts (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_id)
);
alter table public.manual_application_receipts enable row level security;
revoke all on public.manual_application_receipts from public,anon,authenticated;

create function public.resume_bid_counts() returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(summary.resume_id::text,summary.bid_count),'{}'::jsonb)
  from (select b.resume_id,count(*) as bid_count from public.bids b
    where public.can_read(b.workspace_id,b.bidder_id) group by b.resume_id) summary
$$;
grant execute on function public.resume_bid_counts() to authenticated;

create function public.list_bids(p_query jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  page_index integer=greatest(0,least(100000,coalesce((p_query->>'pageIndex')::integer,0)));
  page_size integer=greatest(1,least(100,coalesce((p_query->>'pageSize')::integer,10)));
  sort_id text=coalesce(p_query->'sorting'->0->>'id','found_at');
  sort_desc boolean=coalesce((p_query->'sorting'->0->>'desc')::boolean,true);
  columns jsonb=coalesce(p_query->'columnFilters','{}'::jsonb);
  result jsonb;
begin
  if sort_id not in ('found_at','resume_id','company','role_name','url','bidder_id','source','applied','applied_at','arrangement','job_status','review_status','interview_scheduled','screenshot') then sort_id='found_at'; end if;
  with filtered as (
    select b.* from public.bids b
    left join public.resumes r on r.id=b.resume_id
    left join public.candidate_profiles cp on cp.id=r.profile_id
    where public.can_read(b.workspace_id,b.bidder_id)
      and ((coalesce((p_query->>'trash')::boolean,false) and b.deleted_at is not null) or
           (not coalesce((p_query->>'trash')::boolean,false) and b.deleted_at is null))
      and (nullif(p_query->>'scopeBidderId','') is null or b.bidder_id=(p_query->>'scopeBidderId')::uuid)
      and (nullif(p_query->>'bidder','') is null or p_query->>'bidder'='all' or b.bidder_id=(p_query->>'bidder')::uuid)
      and (nullif(p_query->>'resume','') is null or p_query->>'resume'='all' or b.resume_id=(p_query->>'resume')::uuid)
      and (nullif(p_query->>'source','') is null or p_query->>'source'='all' or b.source=p_query->>'source')
      and (nullif(p_query->>'arrangement','') is null or p_query->>'arrangement'='all' or b.arrangement=p_query->>'arrangement')
      and (nullif(p_query->>'job','') is null or p_query->>'job'='all' or b.job_status=p_query->>'job')
      and (nullif(p_query->>'rangeFrom','') is null or b.found_at >= (p_query->>'rangeFrom')::timestamptz)
      and (nullif(p_query->>'rangeTo','') is null or b.found_at < (p_query->>'rangeTo')::timestamptz)
      and (coalesce(p_query->>'search','')='' or position(lower(p_query->>'search') in lower(b.company||' '||b.role_name||' '||b.url))>0)
      and (coalesce(columns->>'company','')='' or position(lower(columns->>'company') in lower(b.company))>0)
      and (coalesce(columns->>'role_name','')='' or position(lower(columns->>'role_name') in lower(b.role_name))>0)
      and (coalesce(columns->>'url','')='' or position(lower(columns->>'url') in lower(b.url))>0)
      and (coalesce(columns->>'source','')='' or position(lower(columns->>'source') in lower(b.source))>0)
      and (coalesce(columns->>'bidder_id','')='' or position(lower(columns->>'bidder_id') in lower(b.bidder_id::text||' '||coalesce((select p.display_name from public.profiles p where p.id=b.bidder_id),'')))>0)
      and (coalesce(columns->>'resume_id','')='' or position(lower(columns->>'resume_id') in lower(coalesce(cp.identifier,'')||' '||coalesce(cp.candidate_name,'')||' '||coalesce(r.email,'')))>0)
      and (coalesce(columns->>'applied','')='' or b.applied=(columns->>'applied'='Applied'))
      and (coalesce(columns->>'review_status','')='' or b.review_status=columns->>'review_status')
      and (coalesce(columns->>'interview_scheduled','')='' or b.interview_scheduled=(columns->>'interview_scheduled'='Scheduled'))
      and (coalesce(columns->>'arrangement','')='' or b.arrangement=columns->>'arrangement')
      and (coalesce(columns->>'job_status','')='' or b.job_status=columns->>'job_status')
      and (coalesce(columns->>'screenshot','')='' or (b.evidence_file_id is not null)=(columns->>'screenshot'='Has screenshot'))
      and (not (columns ? 'found_at') or (
        coalesce(columns->'found_at'->>'presence','all')<>'empty' and
        (nullif(columns->'found_at'->>'from','') is null or (b.found_at at time zone 'America/Chicago')::date >= (columns->'found_at'->>'from')::date) and
        (nullif(columns->'found_at'->>'to','') is null or (b.found_at at time zone 'America/Chicago')::date <= (columns->'found_at'->>'to')::date)))
      and (not (columns ? 'applied_at') or (
        (coalesce(columns->'applied_at'->>'presence','all')<>'empty' or b.applied_at is null) and
        (coalesce(columns->'applied_at'->>'presence','all')<>'has' or b.applied_at is not null) and
        (nullif(columns->'applied_at'->>'from','') is null or (b.applied_at at time zone 'America/Chicago')::date >= (columns->'applied_at'->>'from')::date) and
        (nullif(columns->'applied_at'->>'to','') is null or (b.applied_at at time zone 'America/Chicago')::date <= (columns->'applied_at'->>'to')::date))
      )
  ), status_filtered as (
    select f.* from filtered f where coalesce(p_query->>'status','all')='all' or
      (p_query->>'status'='pending_review' and f.review_status='pending') or
      (p_query->>'status'='applied' and f.applied) or
      (p_query->>'status'='unapplied' and not f.applied)
  ), total as (select count(*)::integer as n from status_filtered),
  status_counts as (
    select count(*)::integer all_count,count(*) filter(where f.applied)::integer applied_count,
      count(*) filter(where not f.applied)::integer unapplied_count,
      count(*) filter(where f.review_status='pending')::integer pending_count from filtered f
  ),
  page as (
    select f.* from status_filtered f
    order by
      case when sort_id='found_at' and not sort_desc then f.found_at end asc,
      case when sort_id='found_at' and sort_desc then f.found_at end desc,
      case when sort_id='resume_id' and not sort_desc then f.resume_id::text end asc,
      case when sort_id='resume_id' and sort_desc then f.resume_id::text end desc,
      case when sort_id='company' and not sort_desc then f.company end asc,
      case when sort_id='company' and sort_desc then f.company end desc,
      case when sort_id='role_name' and not sort_desc then f.role_name end asc,
      case when sort_id='role_name' and sort_desc then f.role_name end desc,
      case when sort_id='url' and not sort_desc then f.url end asc,
      case when sort_id='url' and sort_desc then f.url end desc,
      case when sort_id='bidder_id' and not sort_desc then f.bidder_id::text end asc,
      case when sort_id='bidder_id' and sort_desc then f.bidder_id::text end desc,
      case when sort_id='source' and not sort_desc then f.source end asc,
      case when sort_id='source' and sort_desc then f.source end desc,
      case when sort_id='applied' and not sort_desc then f.applied end asc,
      case when sort_id='applied' and sort_desc then f.applied end desc,
      case when sort_id='applied_at' and not sort_desc then f.applied_at end asc nulls last,
      case when sort_id='applied_at' and sort_desc then f.applied_at end desc nulls last,
      case when sort_id='arrangement' and not sort_desc then f.arrangement end asc,
      case when sort_id='arrangement' and sort_desc then f.arrangement end desc,
      case when sort_id='job_status' and not sort_desc then f.job_status end asc,
      case when sort_id='job_status' and sort_desc then f.job_status end desc,
      case when sort_id='review_status' and not sort_desc then f.review_status end asc,
      case when sort_id='review_status' and sort_desc then f.review_status end desc,
      case when sort_id='interview_scheduled' and not sort_desc then f.interview_scheduled end asc,
      case when sort_id='interview_scheduled' and sort_desc then f.interview_scheduled end desc,
      case when sort_id='screenshot' and not sort_desc then (f.evidence_file_id is not null) end asc,
      case when sort_id='screenshot' and sort_desc then (f.evidence_file_id is not null) end desc,
      f.found_at desc,f.id asc
    limit page_size offset page_index*page_size
  ), sources as (
    select coalesce(jsonb_agg(source order by source),'[]'::jsonb) as values
    from (select distinct b.source from public.bids b where public.can_read(b.workspace_id,b.bidder_id) and b.source<>'' and (nullif(p_query->>'scopeBidderId','') is null or b.bidder_id=(p_query->>'scopeBidderId')::uuid)) q
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select n from total),'sources',(select values from sources),'statusCounts',(select jsonb_build_object('all',all_count,'applied',applied_count,'unapplied',unapplied_count,'pending_review',pending_count) from status_counts)) into result;
  return result;
end $$;
revoke all on function public.list_bids(jsonb),public.resume_bid_counts() from public,anon;
grant execute on function public.list_bids(jsonb),public.resume_bid_counts() to authenticated;

create function public.reconcile_bid_targets(p_targets jsonb,p_trash boolean) returns uuid[]
language sql stable security invoker set search_path='' as $$
  select coalesce(array_agg(b.id order by b.id),'{}'::uuid[])
  from public.bids b join jsonb_array_elements(coalesce(p_targets,'[]'::jsonb)) t
    on b.id=(t.value->>'id')::uuid
  where public.can_read(b.workspace_id,b.bidder_id)
    and ((p_trash and b.deleted_at is not null) or (not p_trash and b.deleted_at is null))
$$;
revoke all on function public.reconcile_bid_targets(jsonb,boolean) from public,anon;
grant execute on function public.reconcile_bid_targets(jsonb,boolean) to authenticated;

create function public.earnings_performance(
  p_from date default null,p_to date default null,p_workspace uuid default null,
  p_bidder uuid default null,p_profile uuid default null,p_group text default 'bidder'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text; report jsonb;
begin
  if auth.uid() is null then raise exception 'Access denied'; end if;
  if p_group not in ('profile','bidder','assignment') then raise exception 'Invalid reporting group'; end if;
  if p_from is not null and p_to is not null and p_to<p_from then raise exception 'Choose a valid date range'; end if;
  select role into role_name from public.profiles where id=auth.uid() and not archived;
  if role_name is null then raise exception 'Access denied'; end if;
  if role_name='bidder' then
    if (p_bidder is not null and p_bidder<>auth.uid()) or (p_workspace is not null and not exists(select 1 from public.bidders b where b.user_id=auth.uid() and b.workspace_id=p_workspace and not b.archived)) then raise exception 'Access denied'; end if;
    if p_profile is not null and not exists(select 1 from public.resumes r where r.bidder_id=auth.uid() and r.profile_id=p_profile and not r.archived) then raise exception 'Access denied'; end if;
  else
    if p_workspace is not null then perform public.require_manager(p_workspace); end if;
    if p_bidder is not null and not exists(select 1 from public.bidders b where b.user_id=p_bidder and (p_workspace is null or b.workspace_id=p_workspace) and public.manages(b.workspace_id)) then raise exception 'Access denied'; end if;
    if p_profile is not null and not exists(select 1 from public.candidate_profiles cp where cp.id=p_profile and (p_workspace is null or cp.workspace_id=p_workspace) and public.manages(cp.workspace_id)) then raise exception 'Access denied'; end if;
  end if;
  with live as materialized (
    select b.id bid_id,b.bidder_id,r.id resume_id,r.profile_id,b.interview_scheduled,coalesce(b.rate_cents,0)::bigint cents,
      (b.first_applied_at at time zone 'America/Chicago')::date report_day
    from public.bids b join public.resumes r on r.id=b.resume_id
    where b.applied and b.deleted_at is null and b.first_applied_at is not null
      and public.can_read(b.workspace_id,b.bidder_id)
      and (p_workspace is null or b.workspace_id=p_workspace)
      and (p_bidder is null or b.bidder_id=p_bidder)
      and (p_profile is null or r.profile_id=p_profile)
      and (p_from is null or (b.first_applied_at at time zone 'America/Chicago')::date>=p_from)
      and (p_to is null or (b.first_applied_at at time zone 'America/Chicago')::date<=p_to)
  ), history as materialized (
    select a.* from public.retained_bid_daily_aggregates a
    where a.metric='earning' and public.can_read(a.workspace_id,a.bidder_id)
      and (p_workspace is null or a.workspace_id=p_workspace)
      and (p_bidder is null or a.bidder_id=p_bidder)
      and (p_profile is null or a.profile_id=p_profile)
      and (p_from is null or a.report_day>=p_from)
      and (p_to is null or a.report_day<=p_to)
  ), groups as (
    select case p_group when 'profile' then l.profile_id::text when 'bidder' then l.bidder_id::text else l.resume_id::text end key,
      l.bidder_id,l.resume_id,l.profile_id,count(*)::bigint app_count,sum(l.cents)::bigint earned_cents,
      count(*) filter(where l.interview_scheduled)::bigint interviews,count(*)::bigint tracked_count,0::bigint retained_count,0::bigint retained_tracked
    from live l
    group by 1,2,3,4
    union all
    select case p_group when 'profile' then h.profile_id::text when 'bidder' then h.bidder_id::text else h.resume_id::text end key,
      h.bidder_id,h.resume_id,h.profile_id,0::bigint,0::bigint,0::bigint,0::bigint,sum(h.record_count)::bigint,sum(h.tracked_count)::bigint
    from history h group by 1,2,3,4
  ), grouped as (
    select g.key,sum(g.app_count+g.retained_count)::bigint app_count,
      sum(g.earned_cents)::bigint earned_cents,
      sum(g.interviews)::bigint interviews,sum(g.tracked_count+g.retained_tracked)::bigint tracked_count,
      max(case p_group when 'bidder' then coalesce(bp.display_name,'Bidder') else coalesce(cp.identifier,'Profile') end) label,
      max(case p_group when 'bidder' then coalesce(bp.email,'') when 'profile' then coalesce(cp.candidate_name,'Candidate') else coalesce(cp.candidate_name,'Candidate')||' · '||coalesce(bp.display_name,'Bidder') end) sub
    from groups g left join public.profiles bp on bp.id=g.bidder_id
      left join public.candidate_profiles cp on cp.id=g.profile_id
    group by g.key
  ), live_totals as (
    select count(*)::bigint app_count,coalesce(sum(cents),0)::bigint earned_cents,
      count(distinct resume_id)::bigint resume_count,count(*)::bigint tracked_count,
      count(*) filter(where l.interview_scheduled)::bigint interview_count
    from live l
  ), history_totals as (
    select coalesce(sum(record_count),0)::bigint app_count,coalesce(sum(earned_cents),0)::bigint earned_cents,
      count(distinct resume_id)::bigint resume_count,coalesce(sum(tracked_count),0)::bigint tracked_count,
      coalesce(sum(interview_count),0)::bigint interview_count,coalesce(sum(greatest(record_count-tracked_count,0)),0)::bigint excluded_count
    from history
  ), resume_union as (
    select resume_id from live union select resume_id from history where record_count>0
  )
  select jsonb_build_object(
    'totals',(select jsonb_build_object('count',l.app_count+h.app_count,'cents',l.earned_cents+h.earned_cents,'resumes',(select count(distinct resume_id) from resume_union),'retainedCount',h.app_count,'trackedApplications',l.tracked_count+h.tracked_count,'trackedInterviews',l.interview_count+h.interview_count,'excludedInterviewCount',h.excluded_count) from live_totals l cross join history_totals h),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',key,'label',label,'sub',sub,'count',app_count,'cents',earned_cents,'applied',tracked_count,'interviews',interviews) order by earned_cents desc,label) from grouped),'[]'::jsonb)
  ) into report;
  return report;
end $$;
revoke all on function public.earnings_performance(date,date,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.earnings_performance(date,date,uuid,uuid,uuid,text) to authenticated;

create or replace function public.manual_apply_bids(
  p_targets jsonb,
  p_applied_at timestamptz,
  p_reason text,
  p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid=auth.uid();
  target_count integer;
  unique_count integer;
  fingerprint text;
  prior public.manual_application_receipts;
  b public.bids;
  target jsonb;
  profile_id uuid;
  rate integer;
  applied_count integer=0;
  unchanged_count integer=0;
  actual_stamp timestamptz=clock_timestamp();
  outcome jsonb;
begin
  if actor is null then raise exception 'Sign in to apply bids'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id=actor and p.role in ('admin','client') and not p.archived
      and (p.role='admin' or p.approval_status='approved')
  ) then raise exception 'Only active clients and admins can manually apply bids'; end if;
  if jsonb_typeof(p_targets) is distinct from 'array' then raise exception 'Select bids to apply'; end if;
  target_count=jsonb_array_length(p_targets);
  if target_count<1 or target_count>500 then raise exception 'Select between 1 and 500 bids'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'A reason is required (up to 1000 characters)'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_applied_at is null or p_applied_at>actual_stamp then raise exception 'Applied time cannot be in the future'; end if;

  select count(distinct value->>'id') into unique_count from jsonb_array_elements(p_targets);
  if unique_count<>target_count then raise exception 'A bid was selected more than once'; end if;
  fingerprint=md5(jsonb_build_object(
    'targets',(select jsonb_agg(value order by value->>'id') from jsonb_array_elements(p_targets)),
    'applied_at',p_applied_at,'reason',trim(p_reason)
  )::text);
  select * into prior from public.manual_application_receipts where actor_id=actor and request_id=p_request;
  if prior.actor_id is not null then
    if prior.fingerprint<>fingerprint then raise exception 'This request id was already used for different content'; end if;
    return prior.result;
  end if;

  -- Use the profile lock shared by imports, edits, reviews, and retention.
  for profile_id in
    select distinct r.profile_id
    from jsonb_array_elements(p_targets) t
    join public.bids x on x.id=(t.value->>'id')::uuid
    join public.resumes r on r.id=x.resume_id
    order by r.profile_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(profile_id::text,0));
  end loop;

  -- Lock bids in a stable order after profile locks, matching the established
  -- profile-then-bid lock order used by review, imports, and retention.
  perform 1 from public.bids x
  join jsonb_array_elements(p_targets) t on x.id=(t.value->>'id')::uuid
  order by x.id for update of x;

  for target in select value from jsonb_array_elements(p_targets) loop
    if coalesce(target->>'version','') !~ '^[0-9]+$' then raise exception 'Selected bids changed. Refresh and try again'; end if;
    select * into b from public.bids where id=(target->>'id')::uuid;
    if b.id is null or not public.manages(b.workspace_id) then raise exception 'A selected bid is unavailable'; end if;
    if b.version<>(target->>'version')::integer then raise exception 'A selected bid changed. Refresh and try again'; end if;
    if b.deleted_at is not null then raise exception 'Restore selected bids from trash before applying'; end if;
    if p_applied_at<b.found_at then raise exception 'Applied time cannot be earlier than a bid’s Found time'; end if;
    if b.first_applied_at is not null and p_applied_at<b.first_applied_at then raise exception 'Reapplication cannot precede the first application time'; end if;
    if not b.applied then
      select coalesce(b.rate_cents,r.rate_override_cents,m.default_rate_cents) into rate
      from public.resumes r join public.bidders m on m.user_id=r.bidder_id
      where r.id=b.resume_id and r.bidder_id=b.bidder_id and r.workspace_id=b.workspace_id;
      if rate is null then raise exception 'Configure a rate before manually applying every selected bid'; end if;
      update public.bids set applied=true,application_method='manual',evidence_file_id=null,
        rate_cents=coalesce(rate_cents,rate),applied_at=p_applied_at,
        first_applied_at=coalesce(first_applied_at,p_applied_at),review_status='approved',
        review_revision=review_revision+1,reviewed_by=actor,reviewed_at=actual_stamp,
        review_reason=null,version=version+1
      where id=b.id returning * into b;
      insert into public.bid_events(bid_id,actor_id,event,reason,details)
      values(b.id,actor,'application_manual',left(trim(p_reason),1000),jsonb_build_object(
        'applied_at',p_applied_at,'operation_at',actual_stamp,'application_method','manual',
        'review_revision',b.review_revision
      ));
      applied_count=applied_count+1;
    else
      unchanged_count=unchanged_count+1;
    end if;
  end loop;

  outcome=jsonb_build_object('applied',applied_count,'unchanged',unchanged_count);
  insert into public.manual_application_receipts(actor_id,request_id,fingerprint,result)
  values(actor,p_request,fingerprint,outcome);
  return outcome;
end $$;

revoke all on function public.manual_apply_bids(jsonb,timestamptz,text,uuid) from public,anon;
grant execute on function public.manual_apply_bids(jsonb,timestamptz,text,uuid) to authenticated;
revoke all on function public.mark_screenshot_application() from public,anon,authenticated;
