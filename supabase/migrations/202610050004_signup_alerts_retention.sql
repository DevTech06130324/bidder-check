-- Give new shared candidate profiles a two-calendar-month retention default.
-- Existing rows keep their current settings.
alter table public.candidate_profiles alter column retention_months set default 2;

-- Admin-created client identities are reserved in the database so Auth's
-- INSERT trigger can distinguish trusted provisioning from public signup.
create table public.client_provisions (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
alter table public.client_provisions enable row level security;
revoke all on public.client_provisions from public,anon,authenticated;
grant all on public.client_provisions to service_role;
create function public.reserve_client_account(p_email text,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare provision public.client_provisions; normalized text=lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'Access denied'; end if;
  if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(trim(coalesce(p_name,''))) not between 1 and 100 then
    raise exception 'Enter a valid client name and email';
  end if;
  select * into provision from public.client_provisions where email=normalized for update;
  if provision.id is not null then
    if provision.consumed_at is not null then raise exception 'This email already has a managed account'; end if;
    update public.client_provisions set display_name=left(trim(p_name),100) where id=provision.id;
    return provision.id;
  end if;
  if exists(select 1 from auth.users where lower(email)=normalized)
     or exists(select 1 from public.profiles where lower(email)=normalized)
     or exists(select 1 from public.invitations where email=normalized and accepted_at is null) then
    raise exception 'This email is already in use or reserved';
  end if;
  insert into public.client_provisions(email,display_name,created_by)
    values(normalized,left(trim(p_name),100),auth.uid()) returning * into provision;
  return provision.id;
end $$;
revoke all on function public.reserve_client_account(text,text) from public,anon;
grant execute on function public.reserve_client_account(text,text) to authenticated;

-- Reuse the authenticated inbox for one durable approval alert per admin.
alter table public.inbox_notifications
  alter column occurrence_id drop not null,
  add column kind text not null default 'message' check (kind in ('message','client_signup')),
  add column client_id uuid references public.profiles(id) on delete cascade,
  add column href text,
  add column resolved_at timestamptz,
  add constraint inbox_notification_kind_target check (
    (kind='message' and occurrence_id is not null and client_id is null)
    or (kind='client_signup' and occurrence_id is null and client_id is not null and href is not null)
  );
create unique index inbox_signup_once_per_admin
  on public.inbox_notifications(user_id,client_id) where kind='client_signup';
create index inbox_unresolved_signup on public.inbox_notifications(user_id,created_at desc)
  where kind='client_signup' and resolved_at is null;

drop policy inbox_own_read on public.inbox_notifications;
create policy inbox_own_read on public.inbox_notifications for select to authenticated using (
  user_id=auth.uid() and exists (
    select 1 from public.profiles p where p.id=auth.uid() and not p.archived
      and ((kind='message' and p.role='bidder') or (kind='client_signup' and p.role='admin'))
  )
);

create or replace function public.mark_notification_read(p_id uuid,p_read boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.inbox_notifications n
    set read_at=case when p_read then clock_timestamp() else null end
    where n.id=p_id and n.user_id=auth.uid()
      and (p_read or n.resolved_at is null)
      and exists(select 1 from public.profiles p where p.id=auth.uid() and not p.archived
        and ((n.kind='message' and p.role='bidder') or (n.kind='client_signup' and p.role='admin')));
  if not found then raise exception 'Notification not found or resolved'; end if;
end $$;
revoke all on function public.mark_notification_read(uuid,boolean) from public,anon;
grant execute on function public.mark_notification_read(uuid,boolean) to authenticated;

create or replace function public.resolve_client_signup_alerts() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.approval_status<>'pending' or new.archived)
     and (old.approval_status='pending' and not old.archived) then
    update public.inbox_notifications
      set resolved_at=coalesce(resolved_at,clock_timestamp()),
          read_at=coalesce(read_at,clock_timestamp())
      where client_id=new.id and kind='client_signup' and resolved_at is null;
  end if;
  return new;
end $$;
create trigger resolve_client_signup_alerts
  after update of approval_status,archived on public.profiles
  for each row execute function public.resolve_client_signup_alerts();
revoke all on function public.resolve_client_signup_alerts() from public,anon,authenticated;

-- Public signup stays pending and publishes its alert in the same transaction.
-- Admin-created accounts carry a trusted service-role marker and skip the alert.
create or replace function public.on_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  inv public.invitations;
  provision public.client_provisions;
  v_display_name text;
begin
  select * into inv from public.invitations
    where email=lower(new.email) and accepted_at is null for update;
  if inv.id is not null then
    if new.id<>inv.id or inv.expires_at<=now() then
      raise exception 'This email is reserved for a managed account';
    end if;
    if not exists(select 1 from public.workspaces w join public.profiles p on p.id=w.owner_id
      where w.id=inv.workspace_id and not p.archived and p.approval_status='approved') then
      raise exception 'Workspace is inactive';
    end if;
    insert into public.profiles(id,email,display_name,role)
      values(new.id,lower(new.email),inv.display_name,'bidder');
    insert into public.bidders(user_id,workspace_id,default_rate_cents)
      values(new.id,inv.workspace_id,inv.default_rate_cents);
    if new.email_confirmed_at is not null then
      update public.invitations set accepted_at=now() where id=inv.id;
    end if;
  else
    -- Auth app metadata is server-only, while user metadata is signup-controlled.
    if new.raw_app_meta_data->>'bidder_provisioning_id' is not null
       or new.raw_user_meta_data->>'bidder_provisioning_id' is not null then
      raise exception 'Account reservation is missing or already used';
    end if;
    select * into provision from public.client_provisions where email=lower(new.email) for update;
    if provision.id is not null and (provision.id<>new.id or provision.consumed_at is not null) then
      raise exception 'This email is reserved for a managed account';
    end if;
    v_display_name := left(coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),100);
    insert into public.profiles(id,email,display_name,role,approval_status)
      values(new.id,lower(new.email),coalesce(provision.display_name,v_display_name),'client',case when provision.id is not null then 'approved' else 'pending' end);
    insert into public.workspaces(owner_id) values(new.id);
    if provision.id is not null then
      update public.client_provisions set consumed_at=clock_timestamp() where id=provision.id;
    else
      insert into public.inbox_notifications(user_id,title,body,kind,client_id,href)
      select p.id,'Client registration needs review',
        v_display_name||' ('||lower(new.email)||') signed up on '||
        to_char(clock_timestamp() at time zone 'America/Chicago','Mon FMDD, YYYY FMHH12:MI AM')||' CT.',
        'client_signup',new.id,'/users?tab=pending&highlight='||new.id::text
      from public.profiles p where p.role='admin' and not p.archived
      on conflict (user_id,client_id) where kind='client_signup' do nothing;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.on_auth_user() from public,anon,authenticated;

-- Do not queue unresolved alerts to the wrong role or after a resolution.
create or replace function public.queue_notification_pushes() returns integer
language plpgsql security definer set search_path='' as $$
declare count_rows integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
  insert into public.push_attempts(notification_id,subscription_id)
  select n.id,s.id from public.inbox_notifications n
    join public.push_subscriptions s on s.user_id=n.user_id
    join public.profiles p on p.id=n.user_id
  where n.created_at>=s.created_at and n.resolved_at is null and not p.archived
    and ((n.kind='message' and p.role='bidder') or (n.kind='client_signup' and p.role='admin'))
  on conflict do nothing;
  get diagnostics count_rows=row_count;
  return count_rows;
end $$;

create or replace function public.claim_push_attempts(p_limit integer default 100)
returns table(attempt_id uuid,lease_id uuid,notification_id uuid,endpoint text,p256dh text,
  auth_secret text,title text,body text,user_id uuid)
language plpgsql security definer set search_path='' as $$
declare lease uuid=gen_random_uuid();
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
  return query
  with picked as (
    select a.id from public.push_attempts a
      join public.inbox_notifications n on n.id=a.notification_id
      join public.profiles p on p.id=n.user_id
    where a.delivered_at is null and a.next_attempt_at<=clock_timestamp()
      and (a.lease_until is null or a.lease_until<clock_timestamp())
      and not p.archived and n.resolved_at is null
      and ((n.kind='message' and p.role='bidder') or (n.kind='client_signup' and p.role='admin'))
    order by a.next_attempt_at for update of a skip locked
    limit least(greatest(p_limit,1),500)
  ), leased as (
    update public.push_attempts a set lease_id=lease,
      lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1
    from picked where a.id=picked.id returning a.*
  )
  select l.id,l.lease_id,n.id,s.endpoint,s.p256dh,s.auth_secret,n.title,n.body,n.user_id
    from leased l join public.inbox_notifications n on n.id=l.notification_id
    join public.push_subscriptions s on s.id=l.subscription_id
    join public.profiles p on p.id=n.user_id
    where not p.archived and n.resolved_at is null
      and ((n.kind='message' and p.role='bidder') or (n.kind='client_signup' and p.role='admin'));
end $$;

revoke all on function public.queue_notification_pushes(),public.claim_push_attempts(integer)
  from public,anon,authenticated;
grant execute on function public.queue_notification_pushes(),public.claim_push_attempts(integer)
  to service_role;
