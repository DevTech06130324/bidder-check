create table public.bid_import_receipts (
 actor_id uuid not null references public.profiles,
 request_id uuid not null,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table public.bid_import_receipts enable row level security;
grant select on public.bid_import_receipts to authenticated;
grant all on public.bid_import_receipts to service_role;
create policy own_import_receipts on public.bid_import_receipts for select to authenticated using(actor_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and not archived and approval_status='approved') and exists(select 1 from public.resumes where id=(payload->>'resume')::uuid and public.can_read(workspace_id,bidder_id)));

create function public.update_bid_cell(p_bid uuid,p_field text,p_value text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bids; updated public.bids; r public.resumes; value text=trim(p_value); normalized text; begin
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
 normalized=b.normalized_url;
 if p_field='url' then
  if length(value)>8192 then raise exception 'URL is too long'; end if;
  normalized=public.normalize_job_url(value);
 end if;
 if p_field='resume_id' then
  select * into r from public.resumes where id=value::uuid;
  if r.id is null or r.workspace_id<>b.workspace_id or r.bidder_id<>b.bidder_id or r.archived then raise exception 'Choose an active resume assigned to this bidder'; end if;
  if r.id<>b.resume_id and b.first_applied_at is not null then raise exception 'Resume is locked after first application'; end if;
 end if;
 if exists(select 1 from public.bids where resume_id=case when p_field='resume_id' then r.id else b.resume_id end and normalized_url=normalized and id<>b.id) then
  if exists(select 1 from public.bids where resume_id=case when p_field='resume_id' then r.id else b.resume_id end and normalized_url=normalized and id<>b.id and deleted_at is not null) then raise exception 'This URL is in trash; restore the matching bid'; end if;
  raise exception 'This URL already exists for this resume';
 end if;
 update public.bids set
 company=case when p_field='company' then value else company end,
 role_name=case when p_field='role_name' then value else role_name end,
 url=case when p_field='url' then value else url end, normalized_url=normalized,
 source=case when p_field='source' then value else source end,
 arrangement=case when p_field='arrangement' then value else arrangement end,
 job_status=case when p_field='job_status' then value else job_status end,
 resume_id=case when p_field='resume_id' then r.id else resume_id end,
 version=version+1 where id=b.id returning * into updated;
 insert into public.bid_events(bid_id,actor_id,event,details) values(b.id,auth.uid(),'edited',jsonb_build_object('field',p_field,'before',to_jsonb(b),'after',to_jsonb(updated)));
 return jsonb_build_object('ok',true,'row',to_jsonb(updated));
end $$;

create function public.validate_bid_import(p_resume uuid,p_date date,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resumes; item jsonb; n integer=0; errors jsonb='[]'; f text; normalized text; seen text[]='{}'; prior public.bids; message text; begin
 select * into r from public.resumes where id=p_resume;
 if r.id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 if r.archived or exists(select 1 from public.bidders where user_id=r.bidder_id and archived) then raise exception 'Resume or bidder archived'; end if;
 if p_date is null or p_date>(clock_timestamp() at time zone 'America/Chicago')::date or p_date<'1900-01-01'::date then raise exception 'Choose a valid Added date that is not in the future'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Rows must be an array'; end if;
 if jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2097152 then raise exception 'Import 1 to 500 rows within the payload limit'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  n=n+1;
  if jsonb_typeof(item)<>'object' then
   errors=errors||jsonb_build_object('row',n,'field','url','message','Invalid row'); continue;
  end if;
  for f in select jsonb_object_keys(item) loop
   if f not in ('company','role_name','url','source','arrangement','job_status') or jsonb_typeof(item->f)<>'string' then
    errors=errors||jsonb_build_object('row',n,'field',f,'message','Unsupported field or value');
   end if;
  end loop;
  foreach f in array array['company','role_name','source','arrangement','job_status','url'] loop
   message=null;
   if f in ('company','role_name') and length(trim(coalesce(item->>f,''))) not between 1 and 200 then message='Required; maximum 200 characters'; end if;
   if f='source' and length(coalesce(item->>f,''))>200 then message='Maximum 200 characters'; end if;
   if f='arrangement' and coalesce(item->>f,'') not in ('remote','onsite','hybrid') then message='Choose remote, onsite or hybrid'; end if;
   if f='job_status' and coalesce(item->>f,'') not in ('open','closed') then message='Choose open or closed'; end if;
   if f='url' then
    begin
     if length(coalesce(item->>f,'')) not between 1 and 8192 then raise exception 'Invalid URL'; end if;
     normalized=public.normalize_job_url(item->>f);
     if normalized=any(seen) then message='Duplicate URL within this import';
     else
      select * into prior from public.bids where resume_id=p_resume and normalized_url=normalized;
      if prior.id is not null then message=case when prior.deleted_at is not null then 'URL is in trash; restore the existing bid' else 'URL already exists for this resume' end; end if;
     end if;
     seen=array_append(seen,normalized);
    exception when others then message='Enter a valid HTTP/HTTPS URL'; end;
   end if;
   if message is not null then errors=errors||jsonb_build_object('row',n,'field',f,'message',message); end if;
  end loop;
 end loop;
 return errors;
end $$;

create function public.import_bids(p_resume uuid,p_date date,p_rows jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resumes; payload jsonb; receipt public.bid_import_receipts; errors jsonb; item jsonb; ids uuid[]='{}'; bid uuid; stamp timestamptz; result jsonb; n integer=0; begin
 if auth.uid() is null or p_request is null then raise exception 'Import request ID required'; end if;
 select * into r from public.resumes where id=p_resume;
 if r.id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 payload=jsonb_build_object('resume',p_resume,'date',p_date,'rows',p_rows);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 select * into receipt from public.bid_import_receipts where actor_id=auth.uid() and request_id=p_request;
 if receipt.request_id is not null then
  if receipt.payload<>payload then raise exception 'This request ID was already used with different content'; end if;
  return receipt.result;
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
 insert into public.bid_import_receipts(actor_id,request_id,payload,result) values(auth.uid(),p_request,payload,result);
 return result;
end $$;
revoke all on function public.update_bid_cell(uuid,text,text,integer),public.validate_bid_import(uuid,date,jsonb),public.import_bids(uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.update_bid_cell(uuid,text,text,integer),public.validate_bid_import(uuid,date,jsonb),public.import_bids(uuid,date,jsonb,uuid) to authenticated;
