alter table public.bids add column deleted_at timestamptz;
alter table public.bids add column deleted_by uuid references public.profiles;
alter table public.bid_events add column details jsonb;
create index bids_active_found on public.bids(found_at desc) where deleted_at is null;

drop function public.save_bid(uuid,uuid,text,text,text,text,text,text,timestamptz);
create function public.save_bid(p_id uuid,p_resume uuid,p_company text,p_role text,p_url text,p_source text,p_arrangement text,p_status text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.resumes; old public.bids; result uuid; normalized text; begin
 select * into r from public.resumes where id=p_resume;
 if r.id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 normalized=public.normalize_job_url(p_url);
 perform pg_advisory_xact_lock(hashtextextended(r.id::text||normalized,0));
 if exists(select 1 from public.bids where resume_id=r.id and normalized_url=normalized and id is distinct from p_id and deleted_at is not null) then raise exception 'This URL is in trash; restore the matching bid'; end if;
 if p_id is null then
  if r.archived or exists(select 1 from public.bidders where user_id=r.bidder_id and archived) then raise exception 'Resume or bidder archived'; end if;
  insert into public.bids(workspace_id,bidder_id,resume_id,company,role_name,url,normalized_url,source,arrangement,job_status)
  values(r.workspace_id,r.bidder_id,r.id,trim(p_company),trim(p_role),trim(p_url),normalized,p_source,p_arrangement,p_status) returning id into result;
  insert into public.bid_events(bid_id,actor_id,event) values(result,auth.uid(),'created');
 else
  select * into old from public.bids where id=p_id for update;
  if old.id is null or not public.can_read(old.workspace_id,old.bidder_id) or old.workspace_id<>r.workspace_id or old.bidder_id<>r.bidder_id then raise exception 'Access denied'; end if;
  if old.deleted_at is not null then raise exception 'Restore this bid from trash before editing'; end if;
  if old.resume_id<>r.id and (old.first_applied_at is not null or r.archived) then raise exception 'Cannot change this resume assignment'; end if;
  update public.bids set resume_id=r.id,company=trim(p_company),role_name=trim(p_role),url=trim(p_url),normalized_url=normalized,source=p_source,arrangement=p_arrangement,job_status=p_status,version=version+1 where id=p_id returning id into result;
  insert into public.bid_events(bid_id,actor_id,event,details) values(result,auth.uid(),'edited',jsonb_build_object('before',to_jsonb(old),'after',(select to_jsonb(b) from public.bids b where b.id=result)));
 end if;
 return result;
end $$;
create function public.trash_bid(p_bid uuid,p_deleted boolean) returns void language plpgsql security definer set search_path='' as $$
declare b public.bids; begin
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
 if p_deleted is null then raise exception 'Trash state required'; end if;
 if (b.deleted_at is not null)=p_deleted then return; end if;
 update public.bids set deleted_at=case when p_deleted then clock_timestamp() end,deleted_by=case when p_deleted then auth.uid() end,version=version+1 where id=b.id;
 insert into public.bid_events(bid_id,actor_id,event) values(b.id,auth.uid(),case when p_deleted then 'trashed' else 'restored' end);
end $$;

-- Finalization is only callable after the server downloads and validates actual bytes.
-- Recheck the authenticated actor here, then lock bid BEFORE file in every transition.
create function public.finalize_verified_file(p_id uuid,p_sha text,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare f public.files; b public.bids; rate integer; stamp timestamptz; begin
 if p_actor is null or p_sha is null or p_sha !~ '^[a-f0-9]{64}$' then raise exception 'Invalid verified upload'; end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 select * into f from public.files where id=p_id;
 if f.id is null or f.created_by<>p_actor or not public.can_read(f.workspace_id,f.bidder_id) then raise exception 'Access denied'; end if;
 if f.kind='screenshot' then
  select * into b from public.bids where id=f.bid_id for update;
  if b.deleted_at is not null then raise exception 'Restore this bid from trash before uploading'; end if;
 else
  perform public.require_manager(f.workspace_id);
  perform 1 from public.resumes where id=f.resume_id and not archived for update;
  if not found then raise exception 'Resume is archived'; end if;
 end if;
 select * into f from public.files where id=p_id for update;
 if f.finalized then
  if f.sha256 is distinct from p_sha then raise exception 'Immutable file'; end if;
  return;
 end if;
 if f.kind='screenshot' then
  if p_sha=any(b.rejected_hashes) then raise exception 'Upload new proof; this screenshot was previously rejected'; end if;
  select coalesce(b.rate_cents,r.rate_override_cents,m.default_rate_cents) into rate from public.resumes r join public.bidders m on m.user_id=r.bidder_id where r.id=b.resume_id;
  if rate is null then raise exception 'Ask your client to configure a bid rate first'; end if;
  stamp=clock_timestamp();
  update public.files set sha256=p_sha,finalized=true where id=f.id;
  update public.bids set applied=true,evidence_file_id=f.id,rate_cents=rate,applied_at=stamp,first_applied_at=coalesce(first_applied_at,stamp),version=version+1 where id=b.id;
  insert into public.bid_events(bid_id,actor_id,event,file_id) values(b.id,p_actor,case when b.applied then 'proof_replaced' else 'applied' end,f.id);
 else
  update public.files set sha256=p_sha,finalized=true where id=f.id;
  update public.resumes set file_id=f.id where id=f.resume_id;
 end if;
end $$;
-- Remove the old split transaction path, including privileged callers.
drop function public.finalize_file(uuid,text);
create or replace function public.set_applied(p_bid uuid,p_applied boolean,p_file uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare b public.bids; f public.files; begin
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
 if p_applied is distinct from false then raise exception 'Upload a screenshot to apply automatically'; end if;
 perform public.require_manager(b.workspace_id);
 if b.deleted_at is not null then raise exception 'Restore this bid from trash before correcting'; end if;
 if length(trim(coalesce(p_reason,'')))=0 then raise exception 'A correction reason is required'; end if;
 if not b.applied then return; end if;
 select * into f from public.files where id=b.evidence_file_id;
 update public.bids set applied=false,rejected_hashes=array_append(rejected_hashes,f.sha256),version=version+1 where id=b.id;
 insert into public.bid_events(bid_id,actor_id,event,reason,file_id) values(b.id,auth.uid(),'unapplied',left(p_reason,1000),f.id);
end $$;

create function public.guard_bid_upload() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.bid_id is not null then
  perform 1 from public.bids where id=new.bid_id and deleted_at is null for update;
  if not found then raise exception 'Restore this bid from trash before uploading'; end if;
 end if;
 return new;
end $$;
create trigger guard_bid_upload before insert on public.files for each row execute function public.guard_bid_upload();
revoke all on function public.save_bid(uuid,uuid,text,text,text,text,text,text),public.trash_bid(uuid,boolean),public.finalize_verified_file(uuid,text,uuid),public.guard_bid_upload() from public,anon,authenticated;
grant execute on function public.save_bid(uuid,uuid,text,text,text,text,text,text),public.trash_bid(uuid,boolean) to authenticated;
grant execute on function public.finalize_verified_file(uuid,text,uuid) to service_role;
