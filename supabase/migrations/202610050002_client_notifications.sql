-- Scheduled plain-text messages, recipient inboxes and web-push delivery.
create table public.client_messages (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
 created_by uuid not null references public.profiles, title text not null check(length(trim(title)) between 1 and 120),
 body text not null check(length(trim(body)) between 1 and 4000), recipient_mode text not null check(recipient_mode in ('all','selected')),
 recipient_ids uuid[] not null default '{}', schedule_kind text not null check(schedule_kind in ('once','daily','weekly')),
 scheduled_at timestamptz, local_time time, weekdays smallint[] not null default '{}',
 status text not null default 'scheduled' check(status in ('draft','scheduled','active','paused','completed','cancelled')),
 next_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check((recipient_mode='all' and cardinality(recipient_ids)=0) or (recipient_mode='selected' and cardinality(recipient_ids)>0)),
 check((schedule_kind='once' and scheduled_at is not null) or (schedule_kind in ('daily','weekly') and local_time is not null)),
 check(schedule_kind<>'weekly' or cardinality(weekdays)>0)
);
create table public.message_occurrences (
 id uuid primary key default gen_random_uuid(), message_id uuid not null references public.client_messages on delete cascade,
 scheduled_for timestamptz not null, published_at timestamptz not null default clock_timestamp(), recipient_count integer not null default 0,
 unique(message_id,scheduled_for)
);
create table public.inbox_notifications (
 id uuid primary key default gen_random_uuid(), occurrence_id uuid not null references public.message_occurrences on delete cascade,
 user_id uuid not null references public.profiles on delete cascade, title text not null, body text not null,
 created_at timestamptz not null default clock_timestamp(), read_at timestamptz, unique(occurrence_id,user_id)
);
create index inbox_notifications_user on public.inbox_notifications(user_id,created_at desc);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 endpoint text not null unique, p256dh text not null, auth_secret text not null, created_at timestamptz not null default clock_timestamp(), last_used_at timestamptz
);
create table public.push_attempts (
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.inbox_notifications on delete cascade,
 subscription_id uuid not null references public.push_subscriptions on delete cascade, attempts integer not null default 0,
 next_attempt_at timestamptz not null default clock_timestamp(), lease_id uuid, lease_until timestamptz, delivered_at timestamptz, last_error text,
 unique(notification_id,subscription_id)
);
alter table public.client_messages enable row level security;
alter table public.message_occurrences enable row level security;
alter table public.inbox_notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_attempts enable row level security;
grant select on public.client_messages,public.message_occurrences,public.inbox_notifications to authenticated;
grant all on public.client_messages,public.message_occurrences,public.inbox_notifications,public.push_subscriptions,public.push_attempts to service_role;
create policy client_message_manager_read on public.client_messages for select to authenticated using(public.manages(workspace_id));
create policy message_occurrence_manager_read on public.message_occurrences for select to authenticated using(exists(select 1 from public.client_messages m where m.id=message_id and public.manages(m.workspace_id)));
create policy inbox_own_read on public.inbox_notifications for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and not p.archived));
revoke all on public.push_subscriptions,public.push_attempts from public,anon,authenticated;

create function public.message_occurrence_at(p_day date,p_time time) returns timestamptz language plpgsql immutable strict set search_path='' as $$
declare local_stamp timestamp=(p_day+p_time); approximate timestamptz; exact_first timestamptz; begin
 approximate=local_stamp at time zone 'America/Chicago';
 select min(t) into exact_first from generate_series(approximate-interval '2 hours',approximate+interval '2 hours',interval '1 minute') t where t at time zone 'America/Chicago'=local_stamp;
 -- Ambiguous fall-back minutes use the first instant; nonexistent spring minutes use Postgres' first valid mapped instant.
 return coalesce(exact_first,approximate);
end $$;

create function public.next_message_occurrence(p_after timestamptz,p_time time,p_weekdays smallint[],p_daily boolean) returns timestamptz language plpgsql immutable strict set search_path='' as $$
declare local_day date=(p_after at time zone 'America/Chicago')::date; candidate date; offset_day integer; stamp timestamptz; begin
 for offset_day in 0..7 loop
  candidate=local_day+offset_day;
  if (p_daily or extract(dow from candidate)::integer=any(p_weekdays)) then
   stamp=public.message_occurrence_at(candidate,p_time); if stamp>p_after then return stamp; end if;
  end if;
 end loop;
 return null;
end $$;

create function public.save_client_message(p_id uuid,p_workspace uuid,p_title text,p_body text,p_mode text,p_recipients uuid[],p_kind text,p_scheduled_at timestamptz,p_local_time time,p_weekdays smallint[],p_draft boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare msg public.client_messages; next_stamp timestamptz; begin
 if p_workspace is null or not public.manages(p_workspace) then raise exception 'Access denied'; end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 120 or length(trim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'Title and message are required'; end if;
 if p_mode not in ('all','selected') or p_kind not in ('once','daily','weekly') then raise exception 'Choose valid recipients and schedule'; end if;
 if p_mode='selected' and (coalesce(cardinality(p_recipients),0)=0 or exists(select 1 from unnest(p_recipients) u where not exists(select 1 from public.bidders b join public.profiles p on p.id=b.user_id where b.user_id=u and b.workspace_id=p_workspace and not b.archived and not p.archived))) then raise exception 'Every selected bidder must be active in this workspace'; end if;
 if p_kind='once' and p_scheduled_at is null then raise exception 'Choose a send time'; end if;
 if p_kind='weekly' and coalesce(cardinality(p_weekdays),0)=0 then raise exception 'Choose at least one weekday'; end if;
 if p_kind='weekly' and exists(select 1 from unnest(p_weekdays) d where d not between 0 and 6) then raise exception 'Choose valid weekdays'; end if;
 if p_id is not null then
  select * into msg from public.client_messages where id=p_id for update;
  if msg.id is null or msg.workspace_id<>p_workspace or not public.manages(msg.workspace_id) or msg.status not in ('draft','scheduled','paused','active') then raise exception 'Only a draft or active schedule can be edited'; end if;
 end if;
 if p_kind='once' then next_stamp=p_scheduled_at;
 else next_stamp=public.next_message_occurrence(clock_timestamp()-interval '1 second',p_local_time,coalesce(p_weekdays,'{}'),p_kind='daily'); end if;
 insert into public.client_messages(id,workspace_id,created_by,title,body,recipient_mode,recipient_ids,schedule_kind,scheduled_at,local_time,weekdays,status,next_at,updated_at)
 values(coalesce(p_id,gen_random_uuid()),p_workspace,auth.uid(),trim(p_title),trim(p_body),p_mode,case when p_mode='selected' then p_recipients else '{}' end,p_kind,p_scheduled_at,p_local_time,coalesce(p_weekdays,'{}'),case when p_draft then 'draft' when p_kind='once' then 'scheduled' else 'active' end,case when p_draft then null else next_stamp end,clock_timestamp())
 on conflict(id) do update set title=excluded.title,body=excluded.body,recipient_mode=excluded.recipient_mode,recipient_ids=excluded.recipient_ids,schedule_kind=excluded.schedule_kind,scheduled_at=excluded.scheduled_at,local_time=excluded.local_time,weekdays=excluded.weekdays,status=case when public.client_messages.status='paused' and not p_draft then 'paused' else excluded.status end,next_at=case when public.client_messages.status='paused' and not p_draft then null else excluded.next_at end,updated_at=clock_timestamp()
 returning * into msg;
 return msg.id;
end $$;

create function public.set_message_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare m public.client_messages; upcoming timestamptz; begin select * into m from public.client_messages where id=p_id for update; if m.id is null or not public.manages(m.workspace_id) then raise exception 'Access denied'; end if;
 if p_status not in ('active','paused','cancelled') or m.status in ('completed','cancelled') then raise exception 'Invalid message status'; end if;
 if p_status='active' and m.status='draft' then
  upcoming=case when m.schedule_kind='once' then m.scheduled_at else public.next_message_occurrence(clock_timestamp()-interval '1 second',m.local_time,m.weekdays,m.schedule_kind='daily') end;
  update public.client_messages set status=case when schedule_kind='once' then 'scheduled' else 'active' end,next_at=upcoming,updated_at=clock_timestamp() where id=p_id;
 else update public.client_messages set status=p_status,updated_at=clock_timestamp() where id=p_id; end if;
end $$;

create function public.process_due_messages(p_now timestamptz default clock_timestamp(),p_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.client_messages; due_stamp timestamptz; latest_due date; local_today date; occurrence uuid; sent integer=0; recipients integer; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 for m in select * from public.client_messages where status in ('scheduled','active') and next_at<=p_now order by next_at,id for update skip locked limit least(greatest(p_limit,1),500) loop
  due_stamp=m.next_at;
  if m.schedule_kind='once' then
   insert into public.message_occurrences(message_id,scheduled_for) values(m.id,due_stamp) on conflict(message_id,scheduled_for) do nothing returning id into occurrence;
   if occurrence is not null then
    insert into public.inbox_notifications(occurrence_id,user_id,title,body)
    select occurrence,b.user_id,m.title,m.body from public.bidders b join public.profiles p on p.id=b.user_id join public.profiles owner on owner.id=(select owner_id from public.workspaces where id=m.workspace_id)
    where b.workspace_id=m.workspace_id and not b.archived and not p.archived and not owner.archived and (m.recipient_mode='all' or b.user_id=any(m.recipient_ids)) on conflict do nothing;
    get diagnostics recipients=row_count; update public.message_occurrences set recipient_count=recipients where id=occurrence; sent=sent+1;
   end if;
   update public.client_messages set status='completed',next_at=null,updated_at=p_now where id=m.id;
  else
   local_today=(p_now at time zone 'America/Chicago')::date;
   if m.schedule_kind='daily' then latest_due=local_today; if public.message_occurrence_at(latest_due,m.local_time)>p_now then latest_due=latest_due-1; end if;
   else select max(d::date) into latest_due from generate_series(local_today-7,local_today,interval '1 day') d where extract(dow from d)::integer=any(m.weekdays) and public.message_occurrence_at(d::date,m.local_time)<=p_now; end if;
   due_stamp=public.message_occurrence_at(latest_due,m.local_time);
   insert into public.message_occurrences(message_id,scheduled_for) values(m.id,due_stamp) on conflict(message_id,scheduled_for) do nothing returning id into occurrence;
   if occurrence is not null then
    insert into public.inbox_notifications(occurrence_id,user_id,title,body)
    select occurrence,b.user_id,m.title,m.body from public.bidders b join public.profiles p on p.id=b.user_id join public.profiles owner on owner.id=(select owner_id from public.workspaces where id=m.workspace_id)
    where b.workspace_id=m.workspace_id and not b.archived and not p.archived and not owner.archived and (m.recipient_mode='all' or b.user_id=any(m.recipient_ids)) on conflict do nothing;
    get diagnostics recipients=row_count; update public.message_occurrences set recipient_count=recipients where id=occurrence; sent=sent+1;
   end if;
   update public.client_messages set next_at=public.next_message_occurrence(p_now,m.local_time,m.weekdays,m.schedule_kind='daily'),updated_at=p_now where id=m.id;
  end if;
 end loop;
 return jsonb_build_object('occurrences',sent);
end $$;

create function public.mark_notification_read(p_id uuid,p_read boolean) returns void language plpgsql security definer set search_path='' as $$
begin update public.inbox_notifications set read_at=case when p_read then clock_timestamp() end where id=p_id and user_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and not archived); if not found then raise exception 'Notification not found'; end if; end $$;
create function public.save_push_subscription(p_endpoint text,p_p256dh text,p_auth text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not archived) then raise exception 'Access denied'; end if;
 if length(p_endpoint)>2048 or length(p_p256dh)>256 or length(p_auth)>256 or p_endpoint not like 'https://%' then raise exception 'Invalid push subscription'; end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_secret) values(auth.uid(),p_endpoint,p_p256dh,p_auth) on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth_secret=excluded.auth_secret returning id into result; return result; end $$;
create function public.delete_push_subscription(p_endpoint text) returns void language sql security definer set search_path='' as $$ delete from public.push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint $$;
create function public.delete_all_push_subscriptions() returns void language sql security definer set search_path='' as $$ delete from public.push_subscriptions where user_id=auth.uid() $$;
create function public.queue_notification_pushes() returns integer language plpgsql security definer set search_path='' as $$
declare count_rows integer; begin if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 insert into public.push_attempts(notification_id,subscription_id) select n.id,s.id from public.inbox_notifications n join public.push_subscriptions s on s.user_id=n.user_id join public.profiles p on p.id=n.user_id where n.created_at>=s.created_at and not p.archived on conflict do nothing; get diagnostics count_rows=row_count; return count_rows; end $$;
create function public.claim_push_attempts(p_limit integer default 100) returns table(attempt_id uuid,lease_id uuid,notification_id uuid,endpoint text,p256dh text,auth_secret text,title text,body text,user_id uuid) language plpgsql security definer set search_path='' as $$
declare lease uuid=gen_random_uuid(); begin if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 return query with picked as (select a.id from public.push_attempts a where a.delivered_at is null and a.next_attempt_at<=clock_timestamp() and (a.lease_until is null or a.lease_until<clock_timestamp()) order by a.next_attempt_at for update skip locked limit least(greatest(p_limit,1),500)), leased as (update public.push_attempts a set lease_id=lease,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 from picked where a.id=picked.id returning a.*)
 select l.id,l.lease_id,n.id,s.endpoint,s.p256dh,s.auth_secret,n.title,n.body,n.user_id from leased l join public.inbox_notifications n on n.id=l.notification_id join public.push_subscriptions s on s.id=l.subscription_id join public.profiles p on p.id=n.user_id where not p.archived; end $$;
create function public.finish_push_attempt(p_attempt uuid,p_lease uuid,p_error text,p_expired boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare a public.push_attempts; begin if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 select * into a from public.push_attempts where id=p_attempt for update; if a.id is null or a.lease_id<>p_lease then return; end if;
 if p_error is null then update public.push_attempts set delivered_at=clock_timestamp(),lease_id=null,lease_until=null,last_error=null where id=a.id;
 elsif p_expired then delete from public.push_subscriptions where id=a.subscription_id; delete from public.push_attempts where id=a.id;
 else update public.push_attempts set next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer)),lease_id=null,lease_until=null,last_error=left(p_error,500) where id=a.id; end if;
end $$;

revoke all on function public.message_occurrence_at(date,time),public.next_message_occurrence(timestamptz,time,smallint[],boolean),public.save_client_message(uuid,uuid,text,text,text,uuid[],text,timestamptz,time,smallint[],boolean),public.set_message_status(uuid,text),public.process_due_messages(timestamptz,integer),public.mark_notification_read(uuid,boolean),public.save_push_subscription(text,text,text),public.delete_push_subscription(text),public.delete_all_push_subscriptions(),public.queue_notification_pushes(),public.claim_push_attempts(integer),public.finish_push_attempt(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.save_client_message(uuid,uuid,text,text,text,uuid[],text,timestamptz,time,smallint[],boolean),public.set_message_status(uuid,text),public.mark_notification_read(uuid,boolean),public.save_push_subscription(text,text,text),public.delete_push_subscription(text),public.delete_all_push_subscriptions() to authenticated;
grant execute on function public.message_occurrence_at(date,time),public.next_message_occurrence(timestamptz,time,smallint[],boolean),public.process_due_messages(timestamptz,integer),public.queue_notification_pushes(),public.claim_push_attempts(integer),public.finish_push_attempt(uuid,uuid,text,boolean) to service_role;
