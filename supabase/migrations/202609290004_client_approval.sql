-- Grandfather existing accounts; only new public clients start pending.
alter table public.profiles add column approval_status text not null default 'approved'
 check(approval_status in ('pending','approved','rejected'));
alter table public.profiles add column approval_reason text;
alter table public.profiles add column reviewed_at timestamptz;
alter table public.profiles add column reviewed_by uuid references public.profiles;
create unique index profiles_email_unique on public.profiles(lower(email));

create table public.account_events (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.profiles,
 actor_id uuid not null references public.profiles, event text not null, reason text,
 created_at timestamptz not null default now()
);
alter table public.account_events enable row level security;
revoke all on public.account_events from anon,authenticated;
grant select on public.account_events to authenticated;
grant all on public.account_events to service_role;

create or replace function public.manages(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or exists(select 1 from public.workspaces ws join public.profiles p on p.id=ws.owner_id
 where ws.id=w and p.id=auth.uid() and not p.archived and p.approval_status='approved')
$$;
create or replace function public.can_read(w uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.manages(w) or exists(select 1 from public.bidders m join public.profiles p on p.id=m.user_id
 join public.workspaces ws on ws.id=m.workspace_id join public.profiles owner on owner.id=ws.owner_id
 where m.workspace_id=w and m.user_id=b and b=auth.uid() and not m.archived and not p.archived
 and not owner.archived and owner.approval_status='approved')
$$;
create function public.can_manage_account(p_account uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_account and p.role<>'admin'
 and (public.is_admin() or (p.role='bidder' and exists(select 1 from public.bidders b where b.user_id=p.id and public.manages(b.workspace_id)))))
$$;
create policy account_event_read on public.account_events for select to authenticated using(public.can_manage_account(account_id));

create or replace function public.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations; begin
 select * into inv from public.invitations where email=lower(new.email) and accepted_at is null for update;
 if inv.id is not null then
  if new.id<>inv.id or inv.expires_at<=now() then raise exception 'This email is reserved for a managed account'; end if;
  if not exists(select 1 from public.workspaces w join public.profiles p on p.id=w.owner_id where w.id=inv.workspace_id and not p.archived and p.approval_status='approved') then raise exception 'Workspace is inactive'; end if;
  insert into public.profiles(id,email,display_name,role) values(new.id,lower(new.email),inv.display_name,'bidder');
  insert into public.bidders(user_id,workspace_id,default_rate_cents) values(new.id,inv.workspace_id,inv.default_rate_cents);
  if new.email_confirmed_at is not null then update public.invitations set accepted_at=now() where id=inv.id; end if;
 else
  insert into public.profiles(id,email,display_name,role,approval_status) values(new.id,lower(new.email),left(coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),100),'client','pending');
  insert into public.workspaces(owner_id) values(new.id);
 end if;
 return new;
end $$;

create function public.review_client(p_client uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Access denied'; end if;
 if p_status not in ('approved','rejected') or p_status is null then raise exception 'Invalid approval status'; end if;
 if p_status='rejected' and length(trim(coalesce(p_reason,'')))=0 then raise exception 'A rejection reason is required'; end if;
 perform 1 from public.profiles where id=p_client and role='client' for update;
 if not found then raise exception 'Client not found'; end if;
 update public.profiles set approval_status=p_status,approval_reason=case when p_status='rejected' then left(trim(p_reason),1000) end,
 reviewed_at=now(),reviewed_by=auth.uid() where id=p_client;
 insert into public.account_events(account_id,actor_id,event,reason) values(p_client,auth.uid(),p_status,p_reason);
end $$;

-- An Auth email change and its profile update commit or fail together.
create function public.sync_auth_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email is distinct from old.email then
  if exists(select 1 from public.invitations where email=lower(new.email) and accepted_at is null and id<>new.id) then raise exception 'Email is reserved for another account'; end if;
  update public.profiles set email=lower(new.email) where id=new.id;
 end if;
 return new;
end $$;
create trigger sync_profile_email after update of email on auth.users for each row execute function public.sync_auth_email();

create function public.record_account_event(p_account uuid,p_event text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage_account(p_account) then raise exception 'Access denied'; end if;
 if p_event not in ('updated','password_reset','created') then raise exception 'Invalid event'; end if;
 insert into public.account_events(account_id,actor_id,event) values(p_account,auth.uid(),p_event);
end $$;
revoke all on function public.can_manage_account(uuid),public.review_client(uuid,text,text),public.sync_auth_email(),public.record_account_event(uuid,text) from public,anon,authenticated;
grant execute on function public.can_manage_account(uuid),public.review_client(uuid,text,text),public.record_account_event(uuid,text) to authenticated;

create or replace function public.update_bidder(p_bidder uuid,p_name text,p_rate integer,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare b public.bidders; begin
 select * into b from public.bidders where user_id=p_bidder for update;
 if b.user_id is null then raise exception 'Bidder not found'; end if;
 perform public.require_manager(b.workspace_id);
 if length(trim(coalesce(p_name,'')))=0 then raise exception 'Name required'; end if;
 update public.bidders set default_rate_cents=p_rate,archived=p_archived where user_id=p_bidder;
 update public.profiles set display_name=left(trim(p_name),100),archived=p_archived where id=p_bidder;
 insert into public.account_events(account_id,actor_id,event) values(p_bidder,auth.uid(),case when p_archived<>b.archived then case when p_archived then 'archived' else 'restored' end else 'updated' end);
end $$;
create or replace function public.update_client(p_client uuid,p_name text,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; begin
 if not public.is_admin() then raise exception 'Access denied'; end if;
 select * into p from public.profiles where id=p_client and role='client' for update;
 if p.id is null then raise exception 'Client not found'; end if;
 if length(trim(coalesce(p_name,'')))=0 then raise exception 'Name required'; end if;
 update public.profiles set display_name=left(trim(p_name),100),archived=p_archived where id=p_client;
 insert into public.account_events(account_id,actor_id,event) values(p_client,auth.uid(),case when p_archived<>p.archived then case when p_archived then 'archived' else 'restored' end else 'updated' end);
end $$;
