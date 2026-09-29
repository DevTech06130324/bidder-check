-- Bidder accounts are provisioned by a manager without sending email.
-- The legacy invitations table holds a trusted account-creation reservation.
-- Only service-controlled Auth app metadata can consume that reservation.
create or replace function public.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations; provision text; begin
 provision := new.raw_app_meta_data->>'bidder_provisioning_id';
 select * into inv from public.invitations where email=lower(new.email) and accepted_at is null for update;
 if inv.id is not null then
  if provision is distinct from inv.id::text or inv.expires_at<=now() then raise exception 'This email is reserved for a managed account'; end if;
  if not exists(select 1 from public.workspaces w join public.profiles p on p.id=w.owner_id where w.id=inv.workspace_id and not p.archived) then raise exception 'Workspace is inactive'; end if;
  insert into public.profiles(id,email,display_name,role) values(new.id,new.email,inv.display_name,'bidder');
  insert into public.bidders(user_id,workspace_id,default_rate_cents) values(new.id,inv.workspace_id,inv.default_rate_cents);
  if new.email_confirmed_at is not null then update public.invitations set accepted_at=now() where id=inv.id; end if;
 else
  if provision is not null then raise exception 'Account reservation is missing or already used'; end if;
  insert into public.profiles(id,email,display_name,role) values(new.id,new.email,left(coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),100),'client');
  insert into public.workspaces(owner_id) values(new.id);
 end if;
 return new;
end $$;

create or replace function public.set_applied(p_bid uuid,p_applied boolean,p_file uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare b public.bids; f public.files; rate integer; begin
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
 if p_applied then
  if b.applied then return; end if;
  select * into f from public.files where id=p_file and bid_id=b.id and kind='screenshot' and finalized;
  if f.id is null or f.sha256 is null then raise exception 'Upload a valid screenshot first'; end if;
  if f.sha256=any(b.rejected_hashes) then raise exception 'Upload new proof; this screenshot was previously rejected'; end if;
  select coalesce(b.rate_cents,r.rate_override_cents,m.default_rate_cents) into rate from public.resumes r join public.bidders m on m.user_id=r.bidder_id where r.id=b.resume_id;
  if rate is null then raise exception 'Ask your client to configure a bid rate first'; end if;
  update public.bids set applied=true,evidence_file_id=f.id,rate_cents=rate,applied_at=now(),first_applied_at=coalesce(first_applied_at,now()),version=version+1 where id=b.id;
  insert into public.bid_events(bid_id,actor_id,event,file_id) values(b.id,auth.uid(),'applied',f.id);
 else
  perform public.require_manager(b.workspace_id);
  if not b.applied then return; end if;
  if length(trim(coalesce(p_reason,'')))=0 then raise exception 'A correction reason is required'; end if;
  select * into f from public.files where id=b.evidence_file_id;
  update public.bids set applied=false,rejected_hashes=array_append(rejected_hashes,f.sha256),version=version+1 where id=b.id;
  insert into public.bid_events(bid_id,actor_id,event,reason,file_id) values(b.id,auth.uid(),'unapplied',left(p_reason,1000),f.id);
 end if;
end $$;

-- Hosted Supabase grants table writes by default. All writes must use our RPCs.
revoke insert,update,delete,truncate,references,trigger on public.profiles,public.workspaces,public.bidders,public.invitations,public.resumes,public.bids,public.files,public.bid_events from anon,authenticated;
