-- Expand the original per-bidder resume model into shared client profiles and
-- bidder-specific resume assignments. Legacy columns remain during rollout.
create table public.candidate_profiles (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces on delete cascade,
 identifier text not null check(length(trim(identifier)) between 1 and 100),
 candidate_name text not null check(length(trim(candidate_name)) between 1 and 100),
 address text not null default '',
 links text not null default '',
 instructions text not null default '',
 max_bids_per_company integer not null default 3 check(max_bids_per_company between 1 and 1000),
 restricted_companies text[] not null default '{}',
 restricted_roles text[] not null default '{}',
 restricted_links text[] not null default '{}',
 retention_months integer default 3 check(retention_months between 1 and 120),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,identifier),
 unique(id,workspace_id)
);
alter table public.candidate_profiles enable row level security;
revoke all on public.candidate_profiles from public,anon,authenticated;
grant select on public.candidate_profiles to authenticated;
grant all on public.candidate_profiles to service_role;

-- Existing data gets a 1:1 profile mapping. The approved production reset later
/* Later reset this legacy data, preserving users, bidders, and workspaces. */
insert into public.candidate_profiles(workspace_id,identifier,candidate_name,address,links,instructions)
select workspace_id,identifier,candidate_name,address,links,instructions
from public.resumes order by created_at,id;

alter table public.resumes add column profile_id uuid;
update public.resumes r set profile_id=p.id from public.candidate_profiles p
where p.workspace_id=r.workspace_id and p.identifier=r.identifier;
alter table public.resumes add constraint resumes_profile_workspace_fk
 foreign key(profile_id,workspace_id) references public.candidate_profiles(id,workspace_id);
alter table public.resumes add constraint resumes_profile_bidder_unique unique(profile_id,bidder_id);
create index resumes_profile on public.resumes(profile_id,bidder_id);
alter table public.resumes drop constraint if exists resumes_workspace_id_identifier_key;

create policy candidate_profile_read on public.candidate_profiles for select to authenticated using (
 public.manages(workspace_id) or exists(
  select 1 from public.resumes r where r.profile_id=candidate_profiles.id and r.workspace_id=candidate_profiles.workspace_id
   and r.bidder_id=auth.uid() and not r.archived and public.can_read(r.workspace_id,r.bidder_id)
 )
);

create function public.save_candidate_profile(
 p_id uuid,p_workspace uuid,p_identifier text,p_name text,p_address text,p_links text,p_instructions text
) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if p_workspace is null or length(trim(coalesce(p_identifier,''))) not between 1 and 100
  or length(trim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'Profile ID and candidate name are required'; end if;
 perform public.require_manager(p_workspace);
 if p_id is null then
  insert into public.candidate_profiles(workspace_id,identifier,candidate_name,address,links,instructions)
   values(p_workspace,trim(p_identifier),trim(p_name),coalesce(p_address,''),coalesce(p_links,''),coalesce(p_instructions,'')) returning id into result;
 else
  update public.candidate_profiles set identifier=trim(p_identifier),candidate_name=trim(p_name),address=coalesce(p_address,''),
   links=coalesce(p_links,''),instructions=coalesce(p_instructions,''),updated_at=clock_timestamp()
   where id=p_id and workspace_id=p_workspace and not archived returning id into result;
  if result is null then raise exception 'Profile not found or archived'; end if;
 end if;
 return result;
end $$;

create function public.update_candidate_profile_rules(
 p_profile uuid,p_company_limit integer,p_retention_months integer,p_companies text[],p_roles text[],p_links text[]
) returns void language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 select workspace_id into w from public.candidate_profiles where id=p_profile for update;
 perform public.require_manager(w);
 if p_company_limit not between 1 and 1000 or (p_retention_months is not null and p_retention_months not between 1 and 120) then
  raise exception 'Company limit or retention period is invalid';
 end if;
 if exists(select 1 from unnest(coalesce(p_companies,'{}')||coalesce(p_roles,'{}')||coalesce(p_links,'{}')) x where length(trim(x)) not between 1 and 200) then
  raise exception 'Restriction values must contain 1 to 200 characters';
 end if;
 update public.candidate_profiles set max_bids_per_company=p_company_limit,retention_months=p_retention_months,
  restricted_companies=coalesce(p_companies,'{}'),restricted_roles=coalesce(p_roles,'{}'),restricted_links=coalesce(p_links,'{}'),updated_at=clock_timestamp()
  where id=p_profile;
end $$;

create function public.archive_candidate_profile(p_profile uuid,p_archived boolean) returns void
 language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 select workspace_id into w from public.candidate_profiles where id=p_profile for update;
 perform public.require_manager(w);
 update public.candidate_profiles set archived=p_archived,updated_at=clock_timestamp() where id=p_profile;
end $$;

create function public.save_resume_assignment(
 p_id uuid,p_profile uuid,p_bidder uuid,p_email text,p_phone text,p_file uuid,p_rate integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.candidate_profiles; b public.bidders; result uuid; current_row public.resumes; begin
 select * into p from public.candidate_profiles where id=p_profile and not archived;
 if p.id is null then raise exception 'Choose an active profile'; end if;
 perform public.require_manager(p.workspace_id);
 select * into b from public.bidders where user_id=p_bidder and workspace_id=p.workspace_id and not archived;
 if b.user_id is null then raise exception 'Choose an active bidder in this workspace'; end if;
 if p_rate is not null and p_rate not between 0 and 100000000 then raise exception 'Rate is invalid'; end if;
 if length(trim(coalesce(p_email,'')))=0 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(trim(coalesce(p_phone,'')))=0 then
  raise exception 'Assignment email and phone are required';
 end if;
 if p_file is not null and (p_id is null or not exists(select 1 from public.files f where f.id=p_file and f.kind='resume' and f.finalized and f.workspace_id=p.workspace_id and f.bidder_id=p_bidder and f.resume_id=p_id)) then
  raise exception 'Choose a verified PDF assigned to this bidder';
 end if;
 if p_id is null then
  insert into public.resumes(workspace_id,bidder_id,profile_id,identifier,candidate_name,email,phone,address,links,instructions,file_id,rate_override_cents)
   values(p.workspace_id,p_bidder,p.id,p.identifier,p.candidate_name,lower(trim(p_email)),trim(p_phone),p.address,p.links,p.instructions,p_file,p_rate) returning id into result;
 else
  select * into current_row from public.resumes where id=p_id for update;
  if current_row.id is null or current_row.workspace_id<>p.workspace_id then raise exception 'Assignment not found'; end if;
  if (current_row.profile_id<>p.id or current_row.bidder_id<>p_bidder) and exists(select 1 from public.bids where resume_id=p_id) then
   raise exception 'An assignment with bid history cannot be moved';
  end if;
  update public.resumes set profile_id=p.id,bidder_id=p_bidder,identifier=p.identifier,candidate_name=p.candidate_name,
   email=lower(trim(p_email)),phone=trim(p_phone),address=p.address,links=p.links,instructions=p.instructions,
   file_id=coalesce(p_file,file_id),rate_override_cents=p_rate,archived=false where id=p_id returning id into result;
 end if;
 return result;
end $$;

create function public.archive_resume_assignment(p_id uuid,p_archived boolean) returns void
 language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 select workspace_id into w from public.resumes where id=p_id;
 perform public.require_manager(w);
 update public.resumes set archived=p_archived where id=p_id;
end $$;

revoke all on function public.save_candidate_profile(uuid,uuid,text,text,text,text,text),
 public.update_candidate_profile_rules(uuid,integer,integer,text[],text[],text[]),public.archive_candidate_profile(uuid,boolean),
 public.save_resume_assignment(uuid,uuid,uuid,text,text,uuid,integer),public.archive_resume_assignment(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.save_candidate_profile(uuid,uuid,text,text,text,text,text),
 public.update_candidate_profile_rules(uuid,integer,integer,text[],text[],text[]),public.archive_candidate_profile(uuid,boolean),
 public.save_resume_assignment(uuid,uuid,uuid,text,text,uuid,integer),public.archive_resume_assignment(uuid,boolean) to authenticated;
