-- Keep bulk imports within the API's 8-second statement budget by loading the
-- profile's existing reservation snapshot once and indexing lookup keys.
create index if not exists resumes_profile_lookup on public.resumes(profile_id,id);
create index if not exists bids_resume_company_role_norm on public.bids(
 resume_id,
 lower(regexp_replace(trim(company),'[[:space:]]+',' ','g')),
 lower(regexp_replace(trim(role_name),'[[:space:]]+',' ','g'))
);
create index if not exists bids_resume_company_norm on public.bids(
 resume_id,lower(regexp_replace(trim(company),'[[:space:]]+',' ','g'))
);
create index if not exists bids_normalized_url_profile_probe on public.bids(normalized_url,resume_id);

create or replace function public.validate_bid_import(p_resume uuid,p_date date,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r public.resumes; p public.candidate_profiles; item jsonb; n integer=0;
 errors jsonb='[]'; row_errors jsonb; normalized text; message text;
 company_norm text; role_norm text; pair_key text; field_name text;
 existing_urls jsonb='{}'; existing_pairs jsonb='{}'; existing_companies jsonb='{}';
 seen_urls jsonb='{}'; seen_pairs jsonb='{}'; provisional_counts jsonb='{}';
 prior_row integer; base_count integer; local_count integer;
begin
 select * into r from public.resumes where id=p_resume;
 if r.id is null or r.profile_id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 select * into p from public.candidate_profiles where id=r.profile_id;
 if r.archived or p.archived or exists(select 1 from public.bidders where user_id=r.bidder_id and archived) then raise exception 'Resume, profile or bidder archived'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.profile_id::text,0));
 if not exists(select 1 from public.files f where f.id=r.file_id and f.kind='resume' and f.finalized and f.mime='application/pdf') then raise exception 'Upload and verify a PDF resume before importing bids'; end if;
 if p_date is null or p_date>(clock_timestamp() at time zone 'America/Chicago')::date or p_date<'1900-01-01'::date then raise exception 'Choose a valid Added date that is not in the future'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2097152 then raise exception 'Import 1 to 500 rows within the payload limit'; end if;

 with profile_bids as materialized (
  select b.normalized_url, b.deleted_at,
   lower(regexp_replace(trim(b.company),'[[:space:]]+',' ','g')) company_key,
   lower(regexp_replace(trim(b.role_name),'[[:space:]]+',' ','g')) role_key
  from public.bids b join public.resumes rr on rr.id=b.resume_id
  where rr.profile_id=r.profile_id
 ),
 urls as (
  select normalized_url key,bool_or(deleted_at is not null) trashed from profile_bids group by normalized_url
 ),
 pairs as (
  select company_key||chr(31)||role_key key,bool_or(deleted_at is not null) trashed from profile_bids group by 1
 ),
 companies as (
  select company_key key,count(*)::integer bid_count from profile_bids group by company_key
 )
 select
  coalesce((select jsonb_object_agg(key,jsonb_build_object('trashed',trashed)) from urls),'{}'),
  coalesce((select jsonb_object_agg(key,jsonb_build_object('trashed',trashed)) from pairs),'{}'),
  coalesce((select jsonb_object_agg(key,to_jsonb(bid_count)) from companies),'{}')
 into existing_urls,existing_pairs,existing_companies;

 for item in select value from jsonb_array_elements(p_rows) loop
  n=n+1; row_errors='[]'; normalized=null;
  foreach field_name in array array['company','role_name','source','arrangement','job_status','url'] loop
   message=null;
   if field_name in ('company','role_name') and length(trim(coalesce(item->>field_name,''))) not between 1 and 200 then message='Required; maximum 200 characters'; end if;
   if field_name='source' and length(coalesce(item->>field_name,''))>200 then message='Maximum 200 characters'; end if;
   if field_name='arrangement' and coalesce(item->>field_name,'') not in ('remote','onsite','hybrid') then message='Choose remote, onsite or hybrid'; end if;
   if field_name='job_status' and coalesce(item->>field_name,'') not in ('open','closed') then message='Choose open or closed'; end if;
   if field_name='url' then
    begin normalized=public.normalize_job_url(item->>'url');
    exception when others then normalized=null; message='Enter a valid HTTP/HTTPS URL'; end;
    if length(coalesce(item->>'url',''))>4096 then normalized=null; message='Enter a valid HTTP/HTTPS URL (maximum 4096 characters)'; end if;
   end if;
   if message is not null then row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field',field_name,'code','invalid_value','message',message)); end if;
  end loop;

  company_norm=lower(regexp_replace(trim(coalesce(item->>'company','')),'[[:space:]]+',' ','g'));
  role_norm=lower(regexp_replace(trim(coalesce(item->>'role_name','')),'[[:space:]]+',' ','g'));
  pair_key=company_norm||chr(31)||role_norm;
  if normalized is not null then
   if exists(select 1 from unnest(p.restricted_links) rule where length(trim(rule))>0 and (position(lower(trim(rule)) in lower(coalesce(item->>'url','')))>0 or position(lower(trim(rule)) in lower(normalized))>0)) then
    row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','url','code','restricted_link','message','Job link matches a restricted link rule.'));
   end if;
   if existing_urls ? normalized then
    message=case when coalesce((existing_urls->normalized->>'trashed')::boolean,false) then 'This profile has the matching job in trash; restore the existing bid.' else 'This profile already has an application for this job.' end;
    row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','url','code',case when coalesce((existing_urls->normalized->>'trashed')::boolean,false) then 'url_in_trash' else 'duplicate_url' end,'message',message));
   elsif seen_urls ? normalized then
    prior_row=(seen_urls->>normalized)::integer;
    row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','url','code','batch_duplicate_url','message',format('Duplicate of row %s.',prior_row)));
   end if;
  end if;

  if existing_pairs ? pair_key then
   message=case when coalesce((existing_pairs->pair_key->>'trashed')::boolean,false) then 'This profile has the matching job in trash; restore the existing bid.' else 'This profile already has an application for this job.' end;
   row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','role_name','code','duplicate_company_role','message',message));
  elsif seen_pairs ? pair_key then
   prior_row=(seen_pairs->>pair_key)::integer;
   row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','role_name','code','batch_duplicate_company_role','message',format('Duplicate of row %s.',prior_row)));
  end if;
  if exists(select 1 from unnest(p.restricted_companies) rule where length(trim(rule))>0 and position(lower(trim(rule)) in lower(coalesce(item->>'company','')))>0) then
   row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','company','code','restricted_company','message','Company name matches a restricted company rule.'));
  end if;
  if exists(select 1 from unnest(p.restricted_roles) rule where length(trim(rule))>0 and position(lower(trim(rule)) in lower(coalesce(item->>'role_name','')))>0) then
   row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','role_name','code','restricted_role','message','Role title matches a restricted role rule.'));
  end if;
  base_count=coalesce((existing_companies->>company_norm)::integer,0);
  local_count=coalesce((provisional_counts->>company_norm)::integer,0);
  if base_count+local_count>=p.max_bids_per_company then
   row_errors=row_errors||jsonb_build_array(jsonb_build_object('row',n,'field','company','code','company_limit','message','This profile has reached its bid limit for this company.'));
  end if;

  if jsonb_array_length(row_errors)=0 then
   errors=errors||row_errors;
   seen_urls=seen_urls||jsonb_build_object(normalized,n);
   seen_pairs=seen_pairs||jsonb_build_object(pair_key,n);
   provisional_counts=jsonb_set(provisional_counts,array[company_norm],to_jsonb(coalesce((provisional_counts->>company_norm)::integer,0)+1),true);
  else errors=errors||row_errors; end if;
 end loop;
 return errors;
end $$;

create function public.import_bids_reviewed(
 p_resume uuid,p_date date,p_rows jsonb,p_source_rows integer[],p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r public.resumes; receipt public.bid_import_receipts; fingerprint text; payload jsonb;
 errors jsonb; item_errors jsonb; item jsonb; skipped jsonb='[]'; valid_rows jsonb='[]';
 valid_sources integer[]='{}'; source_row integer; n integer=0; ids uuid[]='{}'; result jsonb;
 stamp timestamptz; request_lock bigint;
begin
 if auth.uid() is null or p_request is null then raise exception 'Import request ID required'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 or coalesce(array_length(p_source_rows,1),0)<>jsonb_array_length(p_rows) then raise exception 'Import 1 to 500 mapped rows'; end if;
 if exists(select 1 from unnest(p_source_rows) x where x is null or x<1) or cardinality(p_source_rows)<>cardinality(array(select distinct x from unnest(p_source_rows) x)) then raise exception 'Import source row numbers are invalid'; end if;
 select * into r from public.resumes where id=p_resume;
 if r.id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 payload=jsonb_build_object('resume',p_resume,'date',p_date,'rows',p_rows,'source_rows',p_source_rows);
 fingerprint=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 request_lock=hashtextextended(auth.uid()::text||p_request::text,0);
 perform pg_advisory_xact_lock(request_lock);
 select * into receipt from public.bid_import_receipts where actor_id=auth.uid() and request_id=p_request;
 if receipt.request_id is not null then
  if receipt.payload_hash<>fingerprint then raise exception 'This request ID was already used with different content'; end if;
  select count(*)::integer into n from jsonb_array_elements_text(receipt.result->'ids') x where not exists(select 1 from public.bids where id=x.value::uuid);
  return case when n=0 then receipt.result else receipt.result||jsonb_build_object('purgedCount',n) end;
 end if;

 perform pg_advisory_xact_lock(hashtextextended(r.profile_id::text,0));
 errors=public.validate_bid_import(p_resume,p_date,p_rows);
 for item in select value from jsonb_array_elements(p_rows) loop
  n=n+1; source_row=p_source_rows[n];
  select coalesce(jsonb_agg(value- 'row' || jsonb_build_object('row',source_row)),'[]') into item_errors
   from jsonb_array_elements(errors) where (value->>'row')::integer=n;
  if jsonb_array_length(item_errors)>0 then skipped=skipped||jsonb_build_array(jsonb_build_object('sourceRow',source_row,'reasons',item_errors));
  else valid_rows=valid_rows||jsonb_build_array(item); valid_sources=array_append(valid_sources,source_row); end if;
 end loop;
 if jsonb_array_length(valid_rows)=0 then return jsonb_build_object('ids','[]'::jsonb,'sourceRows','[]'::jsonb,'skipped',skipped,'date',p_date,'bidder',r.bidder_id,'resume',r.id); end if;

 stamp=case when p_date=(clock_timestamp() at time zone 'America/Chicago')::date then clock_timestamp() else p_date::timestamp at time zone 'America/Chicago' end;
 with input as materialized (
  select value item,ordinality::integer ordinal from jsonb_array_elements(valid_rows) with ordinality
 ), inserted as (
  insert into public.bids(workspace_id,bidder_id,resume_id,company,role_name,url,normalized_url,source,arrangement,job_status,found_at)
  select r.workspace_id,r.bidder_id,r.id,trim(n.item->>'company'),trim(n.item->>'role_name'),trim(n.item->>'url'),public.normalize_job_url(n.item->>'url'),coalesce(n.item->>'source',''),n.item->>'arrangement',n.item->>'job_status',stamp
  from input n order by n.ordinal
  returning id,normalized_url
 ), events as (
  insert into public.bid_events(bid_id,actor_id,event,details)
  select i.id,auth.uid(),'imported',jsonb_build_object('request_id',p_request,'added_date',p_date)
  from inserted i
  returning bid_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'sourceRow',valid_sources[n.ordinal]) order by n.ordinal),'[]') into result
 from input n join inserted i on i.normalized_url=public.normalize_job_url(n.item->>'url')
 where (select count(*) from events)>=0;
 select coalesce(array_agg((elements.value->>'id')::uuid order by (elements.value->>'sourceRow')::integer),'{}') into ids from jsonb_array_elements(result) as elements(value);
 result=jsonb_build_object('ids',to_jsonb(ids),'sourceRows',to_jsonb(valid_sources),'skipped',skipped,'date',p_date,'bidder',r.bidder_id,'resume',r.id);
 insert into public.bid_import_receipts(actor_id,request_id,payload_hash,result) values(auth.uid(),p_request,fingerprint,result);
 return result;
end $$;

revoke all on function public.import_bids_reviewed(uuid,date,jsonb,integer[],uuid) from public,anon;
grant execute on function public.import_bids_reviewed(uuid,date,jsonb,integer[],uuid) to authenticated;
