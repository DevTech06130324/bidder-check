-- Enforce candidate-profile-wide application restrictions in the database.
-- Advisory locks serialize submissions across all bidder assignments.
create or replace function public.candidate_bid_issues(
 p_profile uuid,p_bid uuid,p_company text,p_role text,p_url text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.candidate_profiles; normalized text; issue jsonb='[]'; existing_company text; existing_count integer; begin
 select * into p from public.candidate_profiles where id=p_profile;
 if p.id is null then
  return jsonb_build_array(jsonb_build_object('field','resume_id','code','profile_missing','message','The shared candidate profile is unavailable.'));
 end if;
 if p.archived and p_bid is null then
  issue=issue||jsonb_build_array(jsonb_build_object('field','resume_id','code','profile_archived','message','This profile is archived and cannot receive new bids.'));
 end if;
 normalized=public.normalize_job_url(p_url);
 if exists(select 1 from unnest(p.restricted_companies) rule where length(trim(rule))>0 and position(lower(trim(rule)) in lower(coalesce(p_company,'')))>0) then
  issue=issue||jsonb_build_array(jsonb_build_object('field','company','code','restricted_company','message','Company name matches a restricted company rule.'));
 end if;
 if exists(select 1 from unnest(p.restricted_roles) rule where length(trim(rule))>0 and position(lower(trim(rule)) in lower(coalesce(p_role,'')))>0) then
  issue=issue||jsonb_build_array(jsonb_build_object('field','role_name','code','restricted_role','message','Role title matches a restricted role rule.'));
 end if;
 if exists(select 1 from unnest(p.restricted_links) rule where length(trim(rule))>0 and (position(lower(trim(rule)) in lower(coalesce(p_url,'')))>0 or position(lower(trim(rule)) in lower(normalized))>0)) then
  issue=issue||jsonb_build_array(jsonb_build_object('field','url','code','restricted_link','message','Job link matches a restricted link rule.'));
 end if;
 if exists(
  select 1 from public.bids b join public.resumes r on r.id=b.resume_id
  where r.profile_id=p_profile and b.id is distinct from p_bid and b.normalized_url=normalized
 ) then
  if exists(select 1 from public.bids b join public.resumes r on r.id=b.resume_id where r.profile_id=p_profile and b.id is distinct from p_bid and b.normalized_url=normalized and b.deleted_at is not null) then
   issue=issue||jsonb_build_array(jsonb_build_object('field','url','code','url_in_trash','message','This profile has the matching job in trash; restore the existing bid.'));
  else
   issue=issue||jsonb_build_array(jsonb_build_object('field','url','code','duplicate_url','message','This profile already has an application for this job.'));
  end if;
 end if;
 if exists(
  select 1 from public.bids b join public.resumes r on r.id=b.resume_id
  where r.profile_id=p_profile and b.id is distinct from p_bid
   and lower(regexp_replace(trim(b.company),'[[:space:]]+',' ','g'))=lower(regexp_replace(trim(coalesce(p_company,'')),'[[:space:]]+',' ','g'))
   and lower(regexp_replace(trim(b.role_name),'[[:space:]]+',' ','g'))=lower(regexp_replace(trim(coalesce(p_role,'')),'[[:space:]]+',' ','g'))
 ) then
  issue=issue||jsonb_build_array(jsonb_build_object('field','role_name','code','duplicate_company_role','message','This profile already has an application for this job.'));
 end if;
 if p_bid is not null then select company into existing_company from public.bids where id=p_bid; end if;
 if p_bid is null or lower(regexp_replace(trim(existing_company),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(trim(coalesce(p_company,'')),'[[:space:]]+',' ','g')) then
  select count(*)::integer into existing_count from public.bids b join public.resumes r on r.id=b.resume_id
   where r.profile_id=p_profile and b.id is distinct from p_bid and lower(regexp_replace(trim(b.company),'[[:space:]]+',' ','g'))=lower(regexp_replace(trim(coalesce(p_company,'')),'[[:space:]]+',' ','g'));
  if existing_count>=p.max_bids_per_company then
   issue=issue||jsonb_build_array(jsonb_build_object('field','company','code','company_limit','message','The company limit for bids on this profile has been reached.'));
  end if;
 end if;
 return issue;
end $$;

create or replace function public.save_bid(p_id uuid,p_resume uuid,p_company text,p_role text,p_url text,p_source text,p_arrangement text,p_status text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.resumes; old public.bids; result uuid; normalized text; issues jsonb; begin
 select * into r from public.resumes where id=p_resume;
 if r.id is null or r.profile_id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.profile_id::text,0));
 if not exists(select 1 from public.files f where f.id=r.file_id and f.kind='resume' and f.finalized and f.mime='application/pdf') then raise exception 'Upload and verify a PDF resume before adding bids'; end if;
 if length(trim(coalesce(p_company,''))) not between 1 and 200 or length(trim(coalesce(p_role,''))) not between 1 and 200 then raise exception 'Company and role are required'; end if;
 if p_arrangement not in ('remote','onsite','hybrid') or p_status not in ('open','closed') then raise exception 'Choose valid work and job statuses'; end if;
 normalized=public.normalize_job_url(p_url);
 if p_id is null then
  if r.archived or exists(select 1 from public.bidders where user_id=r.bidder_id and archived) then raise exception 'Resume or bidder archived'; end if;
  issues=public.candidate_bid_issues(r.profile_id,null,trim(p_company),trim(p_role),p_url);
  if jsonb_array_length(issues)>0 then raise exception '%',issues->0->>'message'; end if;
  insert into public.bids(workspace_id,bidder_id,resume_id,company,role_name,url,normalized_url,source,arrangement,job_status)
   values(r.workspace_id,r.bidder_id,r.id,trim(p_company),trim(p_role),trim(p_url),normalized,coalesce(p_source,''),p_arrangement,p_status) returning id into result;
  insert into public.bid_events(bid_id,actor_id,event) values(result,auth.uid(),'created');
 else
  select * into old from public.bids where id=p_id for update;
  if old.id is null or not public.can_read(old.workspace_id,old.bidder_id) or old.workspace_id<>r.workspace_id or old.bidder_id<>r.bidder_id then raise exception 'Access denied'; end if;
  if old.deleted_at is not null then raise exception 'Restore this bid from trash before editing'; end if;
  if old.resume_id<>r.id and (old.first_applied_at is not null or r.archived) then raise exception 'Cannot change this resume assignment'; end if;
  issues=public.candidate_bid_issues(r.profile_id,old.id,trim(p_company),trim(p_role),p_url);
  if jsonb_array_length(issues)>0 then raise exception '%',issues->0->>'message'; end if;
  update public.bids set resume_id=r.id,company=trim(p_company),role_name=trim(p_role),url=trim(p_url),normalized_url=normalized,source=coalesce(p_source,''),arrangement=p_arrangement,job_status=p_status,version=version+1 where id=p_id returning id into result;
  insert into public.bid_events(bid_id,actor_id,event,details) values(result,auth.uid(),'edited',jsonb_build_object('before',to_jsonb(old),'after',(select to_jsonb(b) from public.bids b where id=result)));
 end if;
 return result;
end $$;

create or replace function public.update_bid_cell(p_bid uuid,p_field text,p_value text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bids; updated public.bids; r public.resumes; value text=trim(p_value); normalized text; issues jsonb; company_value text; role_value text; url_value text; profile uuid; begin
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
 if b.deleted_at is not null then raise exception 'Restore this bid from trash before editing'; end if;
 if p_field is null or p_field not in ('company','role_name','url','source','arrangement','job_status','resume_id') then raise exception 'Field is not editable'; end if;
 if p_version is null or b.version<>p_version then return jsonb_build_object('conflict',true,'row',to_jsonb(b)); end if;
 if value is null then raise exception 'A value is required'; end if;
 if p_field in ('company','role_name') and length(value) not between 1 and 200 then raise exception 'Required; maximum 200 characters'; end if;
 if p_field='source' and length(value)>200 then raise exception 'Maximum 200 characters'; end if;
 if p_field='arrangement' and value not in ('remote','onsite','hybrid') then raise exception 'Choose remote, onsite or hybrid'; end if;
 if p_field='job_status' and value not in ('open','closed') then raise exception 'Choose open or closed'; end if;
 company_value=case when p_field='company' then value else b.company end;
 role_value=case when p_field='role_name' then value else b.role_name end;
 url_value=case when p_field='url' then value else b.url end;
 normalized=public.normalize_job_url(url_value);
 select * into r from public.resumes where id=case when p_field='resume_id' then value::uuid else b.resume_id end;
 if r.id is null or r.profile_id is null or r.workspace_id<>b.workspace_id or r.bidder_id<>b.bidder_id or r.archived then raise exception 'Choose an active resume assigned to this bidder'; end if;
 if r.id<>b.resume_id and b.first_applied_at is not null then raise exception 'Resume is locked after first application'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.profile_id::text,0));
 issues=case when p_field in ('company','role_name','url','resume_id') then public.candidate_bid_issues(r.profile_id,b.id,company_value,role_value,url_value) else '[]'::jsonb end;
 if jsonb_array_length(issues)>0 then raise exception '%',issues->0->>'message'; end if;
 if not exists(select 1 from public.files f where f.id=r.file_id and f.kind='resume' and f.finalized and f.mime='application/pdf') then raise exception 'Upload and verify a PDF resume before adding bids'; end if;
 update public.bids set company=company_value,role_name=role_value,url=url_value,normalized_url=normalized,source=case when p_field='source' then value else source end,arrangement=case when p_field='arrangement' then value else arrangement end,job_status=case when p_field='job_status' then value else job_status end,resume_id=case when p_field='resume_id' then r.id else resume_id end,version=version+1 where id=b.id returning * into updated;
 insert into public.bid_events(bid_id,actor_id,event,details) values(b.id,auth.uid(),'edited',jsonb_build_object('field',p_field,'before',to_jsonb(b),'after',to_jsonb(updated)));
 return jsonb_build_object('ok',true,'row',to_jsonb(updated));
end $$;

create or replace function public.validate_bid_import(p_resume uuid,p_date date,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resumes; p public.candidate_profiles; item jsonb; n integer=0; errors jsonb='[]'; f text; normalized text; message text; company_norm text; role_norm text; seen_urls text[]='{}'; seen_pairs text[]='{}'; company_counts jsonb='{}'; base_count integer; local_count integer; item_issues jsonb; issue jsonb; begin
 select * into r from public.resumes where id=p_resume;
 if r.id is null or r.profile_id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 select * into p from public.candidate_profiles where id=r.profile_id;
 if r.archived or p.archived or exists(select 1 from public.bidders where user_id=r.bidder_id and archived) then raise exception 'Resume, profile or bidder archived'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.profile_id::text,0));
 if not exists(select 1 from public.files f where f.id=r.file_id and f.kind='resume' and f.finalized and f.mime='application/pdf') then raise exception 'Upload and verify a PDF resume before importing bids'; end if;
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
  for issue in select value from jsonb_array_elements(item_issues) loop
   errors=errors||jsonb_build_array(issue||jsonb_build_object('row',n));
  end loop;
  if jsonb_array_length(item_issues)=0 then
   seen_urls=array_append(seen_urls,normalized); seen_pairs=array_append(seen_pairs,company_norm||chr(31)||role_norm);
   company_counts=jsonb_set(company_counts,array[company_norm],to_jsonb(local_count+1),true);
  end if;
 end loop;
 return errors;
end $$;

create or replace function public.import_bids(p_resume uuid,p_date date,p_rows jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resumes; payload jsonb; receipt public.bid_import_receipts; errors jsonb; item jsonb; ids uuid[]='{}'; bid uuid; stamp timestamptz; result jsonb; n integer=0; purged integer=0; fingerprint text; begin
 if auth.uid() is null or p_request is null then raise exception 'Import request ID required'; end if;
 select * into r from public.resumes where id=p_resume;
 if r.id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 payload=jsonb_build_object('resume',p_resume,'date',p_date,'rows',p_rows); fingerprint=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 select * into receipt from public.bid_import_receipts where actor_id=auth.uid() and request_id=p_request;
 if receipt.request_id is not null then
  if receipt.payload_hash<>fingerprint then raise exception 'This request ID was already used with different content'; end if;
  select count(*)::integer into purged from jsonb_array_elements_text(receipt.result->'ids') x where not exists(select 1 from public.bids where id=x.value::uuid);
  return case when purged=0 then receipt.result else receipt.result||jsonb_build_object('purgedCount',purged) end;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(r.profile_id::text,0));
 errors=public.validate_bid_import(p_resume,p_date,p_rows);
 if jsonb_array_length(errors)>0 then return jsonb_build_object('errors',errors); end if;
 stamp=case when p_date=(clock_timestamp() at time zone 'America/Chicago')::date then clock_timestamp() else p_date::timestamp at time zone 'America/Chicago' end;
 for item in select value from jsonb_array_elements(p_rows) loop
  n=n+1;
  insert into public.bids(workspace_id,bidder_id,resume_id,company,role_name,url,normalized_url,source,arrangement,job_status,found_at)
   values(r.workspace_id,r.bidder_id,r.id,trim(item->>'company'),trim(item->>'role_name'),trim(item->>'url'),public.normalize_job_url(item->>'url'),coalesce(item->>'source',''),item->>'arrangement',item->>'job_status',stamp) returning id into bid;
  ids=array_append(ids,bid); insert into public.bid_events(bid_id,actor_id,event,details) values(bid,auth.uid(),'imported',jsonb_build_object('request_id',p_request,'added_date',p_date));
 end loop;
 result=jsonb_build_object('ids',ids,'date',p_date,'bidder',r.bidder_id,'resume',r.id);
 insert into public.bid_import_receipts(actor_id,request_id,payload_hash,result) values(auth.uid(),p_request,fingerprint,result);
 return result;
end $$;

-- Shared profile rules normalize rules to trimmed, unique literal substrings.
drop function public.update_candidate_profile_rules(uuid,integer,integer,text[],text[],text[]);
create function public.candidate_retention_preview(p_profile uuid,p_months integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w uuid; n integer; cutoff timestamptz; begin
 select workspace_id into w from public.candidate_profiles where id=p_profile;
 perform public.require_manager(w);
 if p_months is null or p_months not between 1 and 120 then return jsonb_build_object('eligible',0); end if;
 cutoff=public.candidate_retention_cutoff(clock_timestamp(),p_months);
 select count(*)::integer into n from public.bids b join public.resumes r on r.id=b.resume_id
 where r.profile_id=p_profile and b.applied and b.applied_at<cutoff;
 return jsonb_build_object('eligible',n,'cutoff',cutoff);
end $$;
grant execute on function public.candidate_retention_preview(uuid,integer) to authenticated;

create or replace function public.update_candidate_profile_rules(
 p_profile uuid,p_company_limit integer,p_retention_months integer,p_companies text[],p_roles text[],p_links text[],p_confirm_eligible integer default null
) returns void language plpgsql security definer set search_path='' as $$
declare w uuid; old_months integer; eligible integer; preview jsonb; v_companies text[]; v_roles text[]; v_links text[]; begin
 select workspace_id into w from public.candidate_profiles where id=p_profile for update;
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

-- Keep the old RPC safe during client rollout by translating it into a
-- one-assignment shared profile. New application screens use typed RPCs above.
create or replace function public.save_resume(p_id uuid,p_workspace uuid,p_bidder uuid,p_identifier text,p_name text,p_email text,p_phone text,p_address text,p_links text,p_instructions text,p_rate integer) returns uuid language plpgsql security definer set search_path='' as $$
declare profile uuid; begin
 perform public.require_manager(p_workspace);
 if p_id is null then
  profile=public.save_candidate_profile(null,p_workspace,p_identifier,p_name,p_address,p_links,p_instructions);
  return public.save_resume_assignment(null,profile,p_bidder,p_email,p_phone,null,p_rate);
 end if;
 select profile_id into profile from public.resumes where id=p_id and workspace_id=p_workspace for update;
 if profile is null then raise exception 'Assignment profile not found'; end if;
 perform public.save_candidate_profile(profile,p_workspace,p_identifier,p_name,p_address,p_links,p_instructions);
 return public.save_resume_assignment(p_id,profile,p_bidder,p_email,p_phone,null,p_rate);
end $$;

create or replace function public.prepare_file(p_kind text,p_target uuid,p_name text,p_mime text,p_size integer) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; b uuid; result uuid=gen_random_uuid(); begin
 if p_kind='resume' then
  select workspace_id,bidder_id into w,b from public.resumes where id=p_target and not archived;
  perform public.require_manager(w);
  if p_mime<>'application/pdf' then raise exception 'Resume assignments accept PDF files only'; end if;
 elsif p_kind='screenshot' then
  select workspace_id,bidder_id into w,b from public.bids where id=p_target;
  if not public.can_read(w,b) then raise exception 'Access denied'; end if;
  if p_mime not in ('image/png','image/jpeg','image/webp') then raise exception 'Unsupported screenshot type'; end if;
 else raise exception 'Unsupported file kind'; end if;
 if w is null then raise exception 'Record not found'; end if;
 if p_size is null or p_size not between 1 and 10485760 then raise exception 'Choose a file up to 10 MB'; end if;
 insert into public.files(id,workspace_id,bidder_id,kind,resume_id,bid_id,filename,mime,size_bytes,storage_path,created_by)
 values(result,w,b,p_kind,case when p_kind='resume' then p_target end,case when p_kind='screenshot' then p_target end,left(p_name,255),p_mime,p_size,w::text||'/'||b::text||'/'||result::text,auth.uid());
 return result;
end $$;

revoke all on function public.candidate_bid_issues(uuid,uuid,text,text,text),public.save_bid(uuid,uuid,text,text,text,text,text,text),public.update_bid_cell(uuid,text,text,integer),public.validate_bid_import(uuid,date,jsonb),public.import_bids(uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.save_bid(uuid,uuid,text,text,text,text,text,text),public.update_bid_cell(uuid,text,text,integer),public.validate_bid_import(uuid,date,jsonb),public.import_bids(uuid,date,jsonb,uuid) to authenticated;
revoke all on function public.candidate_retention_preview(uuid,integer),public.update_candidate_profile_rules(uuid,integer,integer,text[],text[],text[],integer) from public,anon;
grant execute on function public.candidate_retention_preview(uuid,integer),public.update_candidate_profile_rules(uuid,integer,integer,text[],text[],text[],integer) to authenticated;
