-- Review before a bidder can upload proof, plus interview conversion tracking.
alter table public.bids
 add column review_status text not null default 'pending' check(review_status in ('pending','approved','rejected')),
 add column review_revision integer not null default 0 check(review_revision>=0),
 add column reviewed_by uuid references public.profiles,
 add column reviewed_at timestamptz,
 add column review_reason text,
 add column interview_scheduled boolean not null default false,
 add column interview_at timestamptz,
 add column interview_notes text not null default '',
 add column interview_updated_by uuid references public.profiles,
 add column interview_updated_at timestamptz;
update public.bids set review_status='approved',review_revision=1,reviewed_by=(select owner_id from public.workspaces w where w.id=bids.workspace_id),reviewed_at=created_at where applied;
alter table public.files add column review_revision integer;
alter table public.retained_bid_daily_aggregates add column interview_count bigint not null default 0 check(interview_count>=0), add column interview_tracking boolean not null default false;
create index bids_review_queue on public.bids(workspace_id,review_status,found_at desc) where deleted_at is null;

create or replace function public.prepare_file(p_kind text,p_target uuid,p_name text,p_mime text,p_size integer) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; b uuid; result uuid=gen_random_uuid(); review text; revision integer; begin
 if p_kind='resume' then select workspace_id,bidder_id into w,b from public.resumes where id=p_target and not archived; perform public.require_manager(w); if p_mime<>'application/pdf' then raise exception 'Resume assignments accept PDF files only'; end if;
 elsif p_kind='screenshot' then
  select workspace_id,bidder_id,review_status,review_revision into w,b,review,revision from public.bids where id=p_target and deleted_at is null;
  if not public.can_read(w,b) then raise exception 'Access denied'; end if;
  if review is distinct from 'approved' then raise exception 'Client approval is required before uploading a screenshot'; end if;
  if p_mime not in ('image/png','image/jpeg','image/webp') then raise exception 'Unsupported screenshot type'; end if;
 else raise exception 'Unsupported file kind'; end if;
 if w is null then raise exception 'Record not found'; end if;
 if p_size is null or p_size not between 1 and 10485760 then raise exception 'Choose a file up to 10 MB'; end if;
 insert into public.files(id,workspace_id,bidder_id,kind,resume_id,bid_id,filename,mime,size_bytes,storage_path,created_by,review_revision)
 values(result,w,b,p_kind,case when p_kind='resume' then p_target end,case when p_kind='screenshot' then p_target end,left(p_name,255),p_mime,p_size,w::text||'/'||b::text||'/'||result::text,auth.uid(),case when p_kind='screenshot' then revision end);
 return result;
end $$;

create or replace function public.finalize_verified_file(p_id uuid,p_sha text,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare f public.files; b public.bids; rate integer; stamp timestamptz; begin
 if p_actor is null or p_sha is null or p_sha !~ '^[a-f0-9]{64}$' then raise exception 'Invalid verified upload'; end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 select * into f from public.files where id=p_id;
 if f.id is null or f.created_by<>p_actor or not public.can_read(f.workspace_id,f.bidder_id) then raise exception 'Access denied'; end if;
 if f.kind='screenshot' then
  select * into b from public.bids where id=f.bid_id for update;
  if b.id is null or b.deleted_at is not null then raise exception 'Restore this bid from trash before uploading'; end if;
  if b.review_status<>'approved' or f.review_revision is distinct from b.review_revision then raise exception 'Client approval changed. Request approval before uploading new proof'; end if;
 else
  perform public.require_manager(f.workspace_id); perform 1 from public.resumes where id=f.resume_id and not archived for update;
  if not found then raise exception 'Resume is archived'; end if;
 end if;
 select * into f from public.files where id=p_id for update;
 if f.finalized then if f.sha256 is distinct from p_sha then raise exception 'Immutable file'; end if; return; end if;
 if f.kind='screenshot' then
  if p_sha=any(b.rejected_hashes) then raise exception 'Upload new proof; this screenshot was previously rejected'; end if;
  select coalesce(b.rate_cents,r.rate_override_cents,m.default_rate_cents) into rate from public.resumes r join public.bidders m on m.user_id=r.bidder_id where r.id=b.resume_id;
  if rate is null then raise exception 'Ask your client to configure a bid rate first'; end if;
  stamp=clock_timestamp(); update public.files set sha256=p_sha,finalized=true where id=f.id;
  update public.bids set applied=true,evidence_file_id=f.id,rate_cents=coalesce(rate_cents,rate),applied_at=stamp,first_applied_at=coalesce(first_applied_at,stamp),version=version+1 where id=b.id;
  insert into public.bid_events(bid_id,actor_id,event,file_id) values(b.id,p_actor,case when b.applied then 'proof_replaced' else 'applied' end,f.id);
 else update public.files set sha256=p_sha,finalized=true where id=f.id; update public.resumes set file_id=f.id where id=f.resume_id; end if;
end $$;

create function public.review_bid(p_bid uuid,p_status text,p_reason text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare initial public.bids; b public.bids; profile uuid; begin
 select * into initial from public.bids where id=p_bid; if initial.id is null then raise exception 'Bid not found'; end if;
 select profile_id into profile from public.resumes where id=initial.resume_id; perform pg_advisory_xact_lock(hashtextextended(profile::text,0));
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or not public.manages(b.workspace_id) then raise exception 'Access denied'; end if;
 if b.version<>p_version then return jsonb_build_object('conflict',true,'row',to_jsonb(b)); end if;
 if b.deleted_at is not null or b.applied then raise exception 'Only active, unapplied bids can be reviewed'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Choose approved or rejected'; end if;
 if p_status='rejected' and length(trim(coalesce(p_reason,'')))=0 then raise exception 'A rejection reason is required'; end if;
 update public.bids set review_status=p_status,review_revision=review_revision+1,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_reason=case when p_status='rejected' then left(trim(p_reason),1000) else null end,version=version+1 where id=b.id returning * into b;
 insert into public.bid_events(bid_id,actor_id,event,reason,details) values(b.id,auth.uid(),case when p_status='approved' then 'review_approved' else 'review_rejected' end,b.review_reason,jsonb_build_object('revision',b.review_revision));
 return jsonb_build_object('conflict',false,'row',to_jsonb(b));
end $$;

create function public.resubmit_bid(p_bid uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bids; begin
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or b.bidder_id<>auth.uid() or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
 if b.version<>p_version then return jsonb_build_object('conflict',true,'row',to_jsonb(b)); end if;
 if b.deleted_at is not null or b.applied or b.review_status<>'rejected' then raise exception 'Only an active rejected bid can be resubmitted'; end if;
 update public.bids set review_status='pending',review_revision=review_revision+1,reviewed_by=null,reviewed_at=null,review_reason=null,version=version+1 where id=b.id returning * into b;
 insert into public.bid_events(bid_id,actor_id,event) values(b.id,auth.uid(),'review_resubmitted');
 return jsonb_build_object('conflict',false,'row',to_jsonb(b));
end $$;

create function public.set_bid_interview(p_bid uuid,p_scheduled boolean,p_at timestamptz,p_notes text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare b public.bids; begin
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or not public.manages(b.workspace_id) then raise exception 'Access denied'; end if;
 if b.deleted_at is not null then raise exception 'Restore this bid before changing interview status'; end if;
 if p_scheduled and not b.applied then raise exception 'Only applied bids can have an interview invitation'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Interview notes can contain at most 2000 characters'; end if;
 if not p_scheduled and b.interview_scheduled and length(trim(coalesce(p_reason,'')))=0 then raise exception 'A correction reason is required'; end if;
 update public.bids set interview_scheduled=p_scheduled,interview_at=case when p_scheduled then p_at end,interview_notes=case when p_scheduled then coalesce(p_notes,'') else '' end,interview_updated_by=auth.uid(),interview_updated_at=clock_timestamp(),version=version+1 where id=b.id;
 insert into public.bid_events(bid_id,actor_id,event,reason,details) values(b.id,auth.uid(),case when p_scheduled then 'interview_scheduled' else 'interview_cleared' end,case when p_scheduled then null else left(trim(p_reason),1000) end,jsonb_build_object('interview_at',p_at,'interview_notes',case when p_scheduled then p_notes else null end));
end $$;

-- Centralize identity re-review so both the full-form and spreadsheet RPCs obey it.
create function public.guard_bid_identity_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.company is distinct from old.company or new.role_name is distinct from old.role_name or new.normalized_url is distinct from old.normalized_url or new.resume_id is distinct from old.resume_id then
  if old.applied and not public.manages(old.workspace_id) then raise exception 'Applied bid details can only be corrected by a client or admin'; end if;
  new.review_revision=old.review_revision+1;
  if public.manages(old.workspace_id) then new.review_status='approved'; new.reviewed_by=auth.uid(); new.reviewed_at=clock_timestamp(); new.review_reason=null;
  else new.review_status='pending'; new.reviewed_by=null; new.reviewed_at=null; new.review_reason=null; end if;
 end if;
 return new;
end $$;
create function public.guard_manager_bid_create() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.manages(new.workspace_id) then new.review_status='approved'; new.review_revision=greatest(new.review_revision,1); new.reviewed_by=auth.uid(); new.reviewed_at=clock_timestamp(); end if;
 return new;
end $$;
create trigger manager_bid_create_review before insert on public.bids for each row execute function public.guard_manager_bid_create();
create trigger bid_identity_re_review before update of company,role_name,normalized_url,resume_id on public.bids for each row execute function public.guard_bid_identity_review();

create or replace function public.guard_bid_upload() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bids; begin
 if new.bid_id is not null then
  select * into b from public.bids where id=new.bid_id and deleted_at is null for update;
  if not found then raise exception 'Restore this bid from trash before uploading'; end if;
  if b.review_status<>'approved' or new.review_revision is distinct from b.review_revision then raise exception 'Client approval is required before uploading a screenshot'; end if;
 end if;
 return new;
end $$;
create or replace trigger guard_bid_upload before insert on public.files for each row execute function public.guard_bid_upload();

revoke all on function public.prepare_file(text,uuid,text,text,integer),public.finalize_verified_file(uuid,text,uuid),public.review_bid(uuid,text,text,integer),public.resubmit_bid(uuid,integer),public.set_bid_interview(uuid,boolean,timestamptz,text,text),public.guard_bid_identity_review(),public.guard_manager_bid_create(),public.guard_bid_upload() from public,anon,authenticated;
grant execute on function public.prepare_file(text,uuid,text,text,integer),public.review_bid(uuid,text,text,integer),public.resubmit_bid(uuid,integer),public.set_bid_interview(uuid,boolean,timestamptz,text,text) to authenticated;
grant execute on function public.finalize_verified_file(uuid,text,uuid) to service_role;
