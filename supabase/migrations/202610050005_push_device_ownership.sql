-- A device reassignment must not carry queued messages from its former owner.
create function public.reset_reassigned_push_device() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.user_id<>new.user_id or old.p256dh<>new.p256dh or old.auth_secret<>new.auth_secret then
    delete from public.push_attempts where subscription_id=old.id;
    new.created_at=clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.reset_reassigned_push_device() from public,anon,authenticated;
create trigger reset_reassigned_push_device before update of user_id,p256dh,auth_secret
  on public.push_subscriptions for each row execute function public.reset_reassigned_push_device();

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
      join public.push_subscriptions s on s.id=a.subscription_id and s.user_id=n.user_id
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
    join public.push_subscriptions s on s.id=l.subscription_id and s.user_id=n.user_id
    join public.profiles p on p.id=n.user_id
    where not p.archived and n.resolved_at is null
      and ((n.kind='message' and p.role='bidder') or (n.kind='client_signup' and p.role='admin'));
end $$;

revoke all on function public.queue_notification_pushes(),public.claim_push_attempts(integer)
  from public,anon,authenticated;
grant execute on function public.queue_notification_pushes(),public.claim_push_attempts(integer)
  to service_role;
