create function public.dashboard_performance(
 p_from date,p_to date,p_workspace uuid default null,p_bidder uuid default null,
 p_profile uuid default null,p_group text default 'profile'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text; report jsonb;
begin
 if auth.uid() is null then raise exception 'Access denied'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'Choose a reporting range of 1 to 366 days'; end if;
 if p_group not in ('profile','bidder','assignment') then raise exception 'Invalid reporting group'; end if;
 select role into role_name from public.profiles where id=auth.uid() and not archived;
 if role_name is null then raise exception 'Access denied'; end if;
 if role_name='bidder' then
  if p_bidder is not null and p_bidder<>auth.uid() then raise exception 'Access denied'; end if;
  if p_workspace is not null and not exists(select 1 from public.bidders b where b.user_id=auth.uid() and b.workspace_id=p_workspace and not b.archived) then raise exception 'Access denied'; end if;
  if p_profile is not null and not exists(select 1 from public.resumes r where r.bidder_id=auth.uid() and r.profile_id=p_profile and not r.archived) then raise exception 'Access denied'; end if;
 else
  if p_workspace is not null then perform public.require_manager(p_workspace); end if;
  if p_bidder is not null and not exists(select 1 from public.bidders b where b.user_id=p_bidder and (p_workspace is null or b.workspace_id=p_workspace) and public.manages(b.workspace_id)) then raise exception 'Access denied'; end if;
  if p_profile is not null and not exists(select 1 from public.candidate_profiles cp where cp.id=p_profile and (p_workspace is null or cp.workspace_id=p_workspace) and public.manages(cp.workspace_id)) then raise exception 'Access denied'; end if;
 end if;

 with live as materialized (
  select b.*,r.profile_id,(b.found_at at time zone 'America/Chicago')::date found_day,
   (b.applied_at at time zone 'America/Chicago')::date applied_day,
   (b.first_applied_at at time zone 'America/Chicago')::date first_day,
   coalesce(b.rate_cents,0) earned
  from public.bids b join public.resumes r on r.id=b.resume_id
  where b.deleted_at is null and public.can_read(b.workspace_id,b.bidder_id)
   and (p_workspace is null or b.workspace_id=p_workspace)
   and (p_bidder is null or b.bidder_id=p_bidder)
   and (p_profile is null or r.profile_id=p_profile)
 ), history as materialized (
  select a.* from public.retained_bid_daily_aggregates a
  where public.can_read(a.workspace_id,a.bidder_id)
   and (p_workspace is null or a.workspace_id=p_workspace)
   and (p_bidder is null or a.bidder_id=p_bidder)
   and (p_profile is null or a.profile_id=p_profile)
 ), days as (
  select d::date report_day from generate_series(p_from,p_to,interval '1 day') d
 ), found_days as (
  select found_day date_key,count(*) found_count,count(*) filter(where applied) found_applied
  from live where found_day between p_from and p_to group by found_day
 ), applied_activity as (
  select applied_day date_key,count(*) applied_count from live where applied and applied_day between p_from and p_to group by applied_day
 ), earnings as (
  select first_day date_key,count(*) earning_count,count(*) filter(where interview_scheduled)::bigint interview_count,
   sum(earned)::bigint earned_cents from live where applied and first_day between p_from and p_to group by first_day
 ), hist as (
  select report_day date_key,
   sum(record_count) filter(where metric='found')::bigint found_count,
   sum(record_count) filter(where metric='found')::bigint found_applied,
   sum(record_count) filter(where metric='applied_activity')::bigint applied_count,
   sum(record_count) filter(where metric='earning')::bigint earning_count,
   sum(earned_cents) filter(where metric='earning')::bigint earned_cents,
   sum(tracked_count) filter(where metric='earning')::bigint tracked_count,
   sum(interview_count) filter(where metric='earning')::bigint interview_count
  from history where report_day between p_from and p_to group by report_day
 ), series as (
  select d.report_day,
   coalesce(f.found_count,0)+coalesce(h.found_count,0) found_total,
   coalesce(f.found_applied,0)+coalesce(h.found_applied,0) found_applied,
   coalesce(a.applied_count,0)+coalesce(h.applied_count,0) applied,
   coalesce(e.earned_cents,0)+coalesce(h.earned_cents,0) earnings_cents,
   coalesce(e.earning_count,0)+coalesce(h.earning_count,0) earnings_count,
   coalesce(e.earning_count,0)+coalesce(h.tracked_count,0) tracked_count,
   coalesce(e.interview_count,0)+coalesce(h.interview_count,0) interview_count
  from days d left join found_days f on f.date_key=d.report_day left join applied_activity a on a.date_key=d.report_day
   left join earnings e on e.date_key=d.report_day left join hist h on h.date_key=d.report_day
 ), review as (
  select count(*) filter(where review_status='pending')::bigint pending,
   count(*) filter(where review_status='approved' and not applied)::bigint approved_unapplied,
   count(*) filter(where review_status='rejected')::bigint rejected
  from live where deleted_at is null
 ), sources as (
  select coalesce(nullif(trim(source),''),'Other') label,count(*)::bigint value from live
  where found_day between p_from and p_to group by 1 order by 2 desc limit 10
 ), live_groups as (
  select case p_group when 'profile' then l.profile_id::text when 'bidder' then l.bidder_id::text else l.profile_id::text||':'||l.bidder_id::text end key,
   l.profile_id,l.bidder_id,count(*)::bigint applied_count,
   count(*) filter(where l.interview_scheduled)::bigint interviews,0::bigint historical_count,0::bigint historical_interviews
  from live l where l.applied and l.first_day between p_from and p_to group by 1,2,3
 ), retained_groups as (
  select case p_group when 'profile' then h.profile_id::text when 'bidder' then h.bidder_id::text else h.profile_id::text||':'||h.bidder_id::text end key,
   h.profile_id,h.bidder_id,0::bigint applied_count,0::bigint interviews,
   sum(h.tracked_count)::bigint historical_count,sum(h.interview_count)::bigint historical_interviews
  from history h where h.metric='earning' and h.report_day between p_from and p_to and h.tracked_count>0 group by 1,2,3
 ), groups_union as (
  select * from live_groups union all select * from retained_groups
 ), groups_final as (
  select g.key,g.profile_id,g.bidder_id,sum(g.applied_count+g.historical_count)::bigint applied,
   sum(g.interviews+g.historical_interviews)::bigint interviews,
   case p_group when 'profile' then cp.identifier when 'bidder' then bp.display_name else cp.identifier||' · '||bp.display_name end label
  from groups_union g left join public.candidate_profiles cp on cp.id=g.profile_id
   left join public.profiles bp on bp.id=g.bidder_id group by g.key,g.profile_id,g.bidder_id,cp.identifier,bp.display_name
 )
 select jsonb_build_object(
  'daily',coalesce((select jsonb_agg(jsonb_build_object('date',s.report_day,'found',s.found_total,'foundApplied',s.found_applied,'applied',s.applied,'earningsCents',s.earnings_cents,'earningsCount',s.earnings_count) order by s.report_day) from series s),'[]'),
  'totals',(select jsonb_build_object('found',coalesce(sum(s.found_total),0),'foundApplied',coalesce(sum(s.found_applied),0),'appliedActivity',coalesce(sum(s.applied),0),'earningsCents',coalesce(sum(s.earnings_cents),0),'earningsCount',coalesce(sum(s.earnings_count),0),'trackedApplications',coalesce(sum(s.tracked_count),0),'trackedInterviews',coalesce(sum(s.interview_count),0)) from series s),
  'review',(select to_jsonb(review) from review),
  'sources',coalesce((select jsonb_agg(jsonb_build_object('label',label,'value',value)) from sources),'[]'),
  'groups',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'applied',applied,'interviews',interviews,'conversion',case when applied=0 then null else round(interviews::numeric*100/applied,1) end) order by applied desc,label) from groups_final),'[]')
 ) into report;
 return report;
end $$;

revoke all on function public.dashboard_performance(date,date,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.dashboard_performance(date,date,uuid,uuid,uuid,text) to authenticated;
