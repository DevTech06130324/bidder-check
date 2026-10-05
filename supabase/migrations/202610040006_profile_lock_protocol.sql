-- All changes which can affect a profile's bid eligibility, and all retention
-- deletions, share the same advisory transaction lock used by bid writes.
create or replace function public.update_candidate_profile_rules(
 p_profile uuid,p_company_limit integer,p_retention_months integer,p_companies text[],p_roles text[],p_links text[],p_confirm_eligible integer default null
) returns void language plpgsql security definer set search_path='' as $$
declare w uuid; old_months integer; eligible integer; preview jsonb; v_companies text[]; v_roles text[]; v_links text[]; begin
 select workspace_id into w from public.candidate_profiles where id=p_profile;
 perform public.require_manager(w);
 perform pg_advisory_xact_lock(hashtextextended(p_profile::text,0));
 select workspace_id into w from public.candidate_profiles where id=p_profile for update;
 if w is null then raise exception 'Candidate profile not found'; end if;
 perform public.require_manager(w);
 if p_company_limit not between 1 and 1000 or (p_retention_months is not null and p_retention_months not between 1 and 120) then raise exception 'Company limit or retention period is invalid'; end if;
 select retention_months into old_months from public.candidate_profiles where id=p_profile;
 if p_retention_months is not null and (old_months is null or p_retention_months<old_months) then
  preview=public.candidate_retention_preview(p_profile,p_retention_months);
  eligible=(preview->>'eligible')::integer;
  if eligible>0 and p_confirm_eligible is distinct from eligible then raise exception 'Retention change affects % applied bids. Review the count and confirm again.',eligible; end if;
 end if;
 if exists(select 1 from unnest(coalesce(p_companies,'{}')||coalesce(p_roles,'{}')||coalesce(p_links,'{}')) x where length(trim(x)) not between 1 and 200) then raise exception 'Restriction values must contain 1 to 200 characters'; end if;
 select coalesce(array_agg(v order by first_ord),'{}') into v_companies from (select lower(trim(v)) v,min(ord) first_ord from unnest(coalesce(p_companies,'{}')) with ordinality q(v,ord) group by lower(trim(v))) s;
 select coalesce(array_agg(v order by first_ord),'{}') into v_roles from (select lower(trim(v)) v,min(ord) first_ord from unnest(coalesce(p_roles,'{}')) with ordinality q(v,ord) group by lower(trim(v))) s;
 select coalesce(array_agg(v order by first_ord),'{}') into v_links from (select lower(trim(v)) v,min(ord) first_ord from unnest(coalesce(p_links,'{}')) with ordinality q(v,ord) group by lower(trim(v))) s;
 update public.candidate_profiles cp set max_bids_per_company=p_company_limit,retention_months=p_retention_months,restricted_companies=v_companies,restricted_roles=v_roles,restricted_links=v_links,updated_at=clock_timestamp() where cp.id=p_profile;
end $$;

create or replace function public.validate_bid_import(p_resume uuid,p_date date,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resumes; p public.candidate_profiles; item jsonb; n integer=0; errors jsonb='[]'; f text; normalized text; message text; company_norm text; role_norm text; seen_urls text[]='{}'; seen_pairs text[]='{}'; company_counts jsonb='{}'; base_count integer; local_count integer; item_issues jsonb; issue jsonb; begin
 select * into r from public.resumes where id=p_resume;
 if r.id is null or r.profile_id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.profile_id::text,0));
 select * into p from public.candidate_profiles where id=r.profile_id;
 if r.archived or p.archived or exists(select 1 from public.bidders where user_id=r.bidder_id and archived) then raise exception 'Resume, profile or bidder archived'; end if;
 if not exists(select 1 from public.files f0 where f0.id=r.file_id and f0.kind='resume' and f0.finalized and f0.mime='application/pdf') then raise exception 'Upload and verify a PDF resume before importing bids'; end if;
 if p_date is null or p_date>(clock_timestamp() at time zone 'America/Chicago')::date or p_date<'1900-01-01'::date then raise exception 'Choose a valid Added date that is not in the future'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2097152 then raise exception 'Import 1 to 500 rows within the payload limit'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  n=n+1;
  foreach f in array array['company','role_name','source','arrangement','job_status','url'] loop
   message=null;
   if f in ('company','role_name') and length(trim(coalesce(item->>f,''))) not between 1 and 200 then message='Required; maximum 200 characters'; end if;
   if f='source' and length(coalesce(item->>f,''))>200 then message='Maximum 200 characters'; end if;
   if f='arrangement' and coalesce(item->>f,'') not in ('remote','onsite','hybrid') then message='Choose remote, onsite or hybrid'; end if;
   if f='job_status' and coalesce(item->>f,'') not in ('open','closed') then message='Choose open or closed'; end if;
   if f='url' then begin normalized=public.normalize_job_url(item->>f); exception when others then normalized=null; message='Enter a valid HTTP/HTTPS URL'; end; end if;
   if message is not null then errors=errors||jsonb_build_array(jsonb_build_object('row',n,'field',f,'code','invalid_value','message',message)); end if;
  end loop;
  if jsonb_array_length(errors)>0 and exists(select 1 from jsonb_array_elements(errors) e where (e->>'row')::integer=n) then continue; end if;
  normalized=public.normalize_job_url(item->>'url');
  company_norm=lower(regexp_replace(trim(item->>'company'),'[[:space:]]+',' ','g'));
  role_norm=lower(regexp_replace(trim(item->>'role_name'),'[[:space:]]+',' ','g'));
  item_issues=public.candidate_bid_issues(r.profile_id,null,item->>'company',item->>'role_name',item->>'url');
  if normalized=any(seen_urls) then item_issues=item_issues||jsonb_build_array(jsonb_build_object('field','url','code','batch_duplicate_url','message','Another allowed row already uses this job URL.')); end if;
  if (company_norm||chr(31)||role_norm)=any(seen_pairs) then item_issues=item_issues||jsonb_build_array(jsonb_build_object('field','role_name','code','batch_duplicate_company_role','message','Another allowed row already has this company and role.')); end if;
  select count(*)::integer into base_count from public.bids b join public.resumes rr on rr.id=b.resume_id where rr.profile_id=r.profile_id and lower(regexp_replace(trim(b.company),'[[:space:]]+',' ','g'))=company_norm;
  local_count=coalesce((company_counts->>company_norm)::integer,0);
  if base_count+local_count>=p.max_bids_per_company then item_issues=item_issues||jsonb_build_array(jsonb_build_object('field','company','code','company_limit','message','This profile has reached its bid limit for this company.')); end if;
  for issue in select value from jsonb_array_elements(item_issues) loop errors=errors||jsonb_build_array(issue||jsonb_build_object('row',n)); end loop;
  if jsonb_array_length(item_issues)=0 then
   seen_urls=array_append(seen_urls,normalized); seen_pairs=array_append(seen_pairs,company_norm||chr(31)||role_norm);
   company_counts=jsonb_set(company_counts,array[company_norm],to_jsonb(local_count+1),true);
  end if;
 end loop;
 return errors;
end $$;

create or replace function public.process_candidate_retention(p_limit integer default 500) returns jsonb language plpgsql security definer set search_path='' as $$
declare profile record; bid record; cutoff timestamptz; batch_limit integer=least(greatest(coalesce(p_limit,500),1),2000); deleted_total integer=0; storage_count integer=0; queued integer; found_day date; applied_day date; earned_day date; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 for profile in select id from public.candidate_profiles order by id loop
  exit when deleted_total>=batch_limit;
  perform pg_advisory_xact_lock(hashtextextended(profile.id::text,0));
  select * into profile from public.candidate_profiles where id=profile.id for update;
  if profile.id is null or profile.retention_months is null then continue; end if;
  cutoff=public.candidate_retention_cutoff(clock_timestamp(),profile.retention_months);
  for bid in
   select b.id,b.workspace_id,b.bidder_id,b.resume_id,b.found_at,b.applied_at,b.first_applied_at,b.rate_cents,b.deleted_at,b.evidence_file_id
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
revoke all on function public.process_candidate_retention(integer) from public,anon,authenticated;
grant execute on function public.process_candidate_retention(integer) to service_role;

create or replace function public.archive_candidate_profile(p_profile uuid,p_archived boolean) returns void
 language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 select workspace_id into w from public.candidate_profiles where id=p_profile;
 perform public.require_manager(w);
 perform pg_advisory_xact_lock(hashtextextended(p_profile::text,0));
 select workspace_id into w from public.candidate_profiles where id=p_profile for update;
 if w is null then raise exception 'Candidate profile not found'; end if;
 update public.candidate_profiles set archived=p_archived,updated_at=clock_timestamp() where id=p_profile;
end $$;
revoke all on function public.archive_candidate_profile(uuid,boolean) from public,anon;
grant execute on function public.archive_candidate_profile(uuid,boolean) to authenticated;
