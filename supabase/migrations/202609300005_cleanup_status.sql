-- Additive: richer cleanup status and a cheap "is anything due?" probe for the scheduler.
-- Existing keys keep their meaning; failedFiles now excludes tasks a worker currently holds.
create or replace function public.bid_purge_status(p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.bid_purge_operations; stamp timestamptz=clock_timestamp(); pending integer; removing integer; verifying integer; processing integer; failed integer; next_at timestamptz; begin
 select * into op from public.bid_purge_operations where id=p_operation;
 if op.id is null or op.actor_id<>auth.uid() or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','client') and not archived and approval_status='approved') then raise exception 'Access denied'; end if;
 if op.bidder_id is not null and not exists(select 1 from public.bidders where user_id=op.bidder_id and public.manages(workspace_id)) then raise exception 'Access denied'; end if;
 select count(*) filter(where completed_at is null),
  count(*) filter(where completed_at is null and first_removed_at is null),
  count(*) filter(where completed_at is null and first_removed_at is not null),
  count(*) filter(where completed_at is null and lease_until>stamp),
  count(*) filter(where completed_at is null and (lease_until is null or lease_until<=stamp) and last_error is not null),
  min(next_attempt_at) filter(where completed_at is null and (lease_until is null or lease_until<=stamp))
 into pending,removing,verifying,processing,failed,next_at from public.storage_cleanup_tasks where operation_id=op.id;
 return jsonb_build_object('id',op.id,'scope',op.scope,'deletedCount',case when op.completed_at is not null then op.count else 0 end,'pendingFiles',pending,'awaitingRemovalFiles',removing,'verifyingFiles',verifying,'processingFiles',processing,'failedFiles',failed,'nextAttemptAt',next_at,'serverTime',stamp);
end $$;

create or replace function public.retry_bid_cleanup(p_operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.bid_purge_status(p_operation);
 -- A retry may bypass failure backoff, never the in-flight verification delay or a live lease.
 update public.storage_cleanup_tasks set next_attempt_at=clock_timestamp() where operation_id=p_operation and completed_at is null and last_error is not null and (lease_until is null or lease_until<clock_timestamp());
 return public.bid_purge_status(p_operation);
end $$;

-- Used by the scheduler so idle minutes make no HTTP request.
create function public.has_due_storage_cleanup() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.storage_cleanup_tasks where completed_at is null and next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()));
$$;
revoke all on function public.has_due_storage_cleanup() from public,anon,authenticated;
grant execute on function public.has_due_storage_cleanup() to service_role;
