-- Trash stops reserving duplicate keys and company capacity. Restoration is
-- validated against current rules while the shared profile is serialized.
do $migration$
declare
  function_source text;
  changed_source text;
begin
  function_source := pg_get_functiondef('public.candidate_bid_issues(uuid,uuid,text,text,text)'::regprocedure);
  changed_source := replace(
    function_source,
    'where r.profile_id=p_profile and b.id is distinct from p_bid and b.normalized_url=normalized',
    'where r.profile_id=p_profile and b.deleted_at is null and b.id is distinct from p_bid and b.normalized_url=normalized'
  );
  changed_source := replace(
    changed_source,
    'where r.profile_id=p_profile and b.id is distinct from p_bid' || E'\n   and lower(regexp_replace(trim(b.company)',
    'where r.profile_id=p_profile and b.deleted_at is null and b.id is distinct from p_bid' || E'\n   and lower(regexp_replace(trim(b.company)'
  );
  changed_source := replace(
    changed_source,
    'where r.profile_id=p_profile and b.id is distinct from p_bid and lower(regexp_replace(trim(b.company)',
    'where r.profile_id=p_profile and b.deleted_at is null and b.id is distinct from p_bid and lower(regexp_replace(trim(b.company)'
  );
  if changed_source = function_source then
    raise exception 'Could not update active-only bid validation; migration source no longer matches';
  end if;
  execute changed_source;

  function_source := pg_get_functiondef('public.validate_bid_import(uuid,date,jsonb)'::regprocedure);
  changed_source := replace(
    function_source,
    'where rr.profile_id=r.profile_id',
    'where rr.profile_id=r.profile_id and b.deleted_at is null'
  );
  if changed_source = function_source then
    raise exception 'Could not update active-only import validation; migration source no longer matches';
  end if;
  changed_source := replace(
    changed_source,
    'URL now exists; check active bids and trash, then retry',
    'URL now exists on an active application; review the updated rows and retry'
  );
  execute changed_source;
end
$migration$;

-- The historical uniqueness rule included Trash. Keep uniqueness within an
-- assignment for active rows, with profile-wide checks under the profile lock.
alter table public.bids drop constraint if exists bids_resume_id_normalized_url_key;
drop index if exists public.bids_resume_id_normalized_url_key;
create unique index if not exists bids_active_resume_normalized_url_key
  on public.bids(resume_id, normalized_url)
  where deleted_at is null;
create index if not exists bids_active_normalized_url_resume
  on public.bids(normalized_url, resume_id)
  where deleted_at is null;
create index if not exists bids_active_resume_company_role
  on public.bids(
    resume_id,
    lower(regexp_replace(trim(company),'[[:space:]]+',' ','g')),
    lower(regexp_replace(trim(role_name),'[[:space:]]+',' ','g'))
  ) where deleted_at is null;
create index if not exists bids_active_resume_company
  on public.bids(
    resume_id,
    lower(regexp_replace(trim(company),'[[:space:]]+',' ','g'))
  ) where deleted_at is null;

create or replace function public.trash_bid(p_bid uuid,p_deleted boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  b public.bids;
  profile_id uuid;
  issues jsonb;
begin
  select r.profile_id into profile_id
    from public.bids current_bid join public.resumes r on r.id=current_bid.resume_id
    where current_bid.id=p_bid;
  if profile_id is null then raise exception 'Access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(profile_id::text,0));
  select * into b from public.bids where id=p_bid for update;
  if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
  if p_deleted is null then raise exception 'Trash state required'; end if;
  if (b.deleted_at is not null)=p_deleted then return; end if;
  if not p_deleted then
    issues=public.candidate_bid_issues(profile_id,null,b.company,b.role_name,b.url);
    if jsonb_array_length(issues)>0 then
      raise exception 'Restoration blocked' using detail=jsonb_build_object(
        'bidId',b.id,'issues',issues
      )::text;
    end if;
  end if;
  update public.bids
    set deleted_at=case when p_deleted then clock_timestamp() end,
        deleted_by=case when p_deleted then auth.uid() end,
        version=version+1
    where id=b.id;
  insert into public.bid_events(bid_id,actor_id,event)
    values(b.id,auth.uid(),case when p_deleted then 'trashed' else 'restored' end);
end $$;

create or replace function public.bulk_bid_state(p_targets jsonb,p_deleted boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare
  target jsonb;
  b public.bids;
  profile_record record;
  issues jsonb;
  restoration_issues jsonb='[]';
  n integer=0;
begin
  if p_deleted is null or p_targets is null or jsonb_typeof(p_targets)<>'array'
      or jsonb_array_length(p_targets) not between 1 and 500 then
    raise exception 'Select 1 to 500 bids';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_targets))<>jsonb_array_length(p_targets) then
    raise exception 'Duplicate targets';
  end if;

  -- Lock every affected profile in the same deterministic order as creation
  -- and then acquire bid rows. This serializes capacity checks across bidders.
  for profile_record in
    select distinct r.profile_id
      from jsonb_array_elements(p_targets) targets(value)
      join public.bids current_bid on current_bid.id=(targets.value->>'id')::uuid
      join public.resumes r on r.id=current_bid.resume_id
      order by r.profile_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(profile_record.profile_id::text,0));
  end loop;

  for target in select value from jsonb_array_elements(p_targets) order by value->>'id' loop
    select * into b from public.bids where id=(target->>'id')::uuid for update;
    if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
    if (target->>'version')::integer is distinct from b.version then
      raise exception 'A selected bid changed. Refresh and select it again';
    end if;
    if (b.deleted_at is not null)=p_deleted then raise exception 'A selected bid is no longer in this view'; end if;
  end loop;

  -- Changes are in one transaction. If any later target conflicts, the
  -- exception rolls the whole batch back, including earlier restorations.
  for target in select value from jsonb_array_elements(p_targets) order by value->>'id' loop
    select * into b from public.bids where id=(target->>'id')::uuid;
    if not p_deleted then
      select r.profile_id into profile_record
        from public.resumes r where r.id=b.resume_id;
      issues=public.candidate_bid_issues(profile_record.profile_id,null,b.company,b.role_name,b.url);
      if jsonb_array_length(issues)>0 then
        restoration_issues=restoration_issues||jsonb_build_array(jsonb_build_object(
          'bidId',b.id,'issues',issues
        ));
      else
        update public.bids
          set deleted_at=null,deleted_by=null,version=version+1
          where id=b.id;
        insert into public.bid_events(bid_id,actor_id,event)
          values(b.id,auth.uid(),'restored');
        n=n+1;
      end if;
    else
      update public.bids
        set deleted_at=clock_timestamp(),deleted_by=auth.uid(),version=version+1
        where id=b.id;
      insert into public.bid_events(bid_id,actor_id,event)
        values(b.id,auth.uid(),'trashed');
      n=n+1;
    end if;
  end loop;
  if jsonb_array_length(restoration_issues)>0 then
    raise exception 'Restoration blocked' using detail=jsonb_build_object(
      'restorationIssues',restoration_issues
    )::text;
  end if;
  return n;
end $$;

revoke all on function public.trash_bid(uuid,boolean),public.bulk_bid_state(jsonb,boolean) from public,anon;
grant execute on function public.trash_bid(uuid,boolean),public.bulk_bid_state(jsonb,boolean) to authenticated;
