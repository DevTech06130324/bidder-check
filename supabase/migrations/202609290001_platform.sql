-- All mutations go through narrowly-scoped RPCs. Tables are SELECT-only to users.
create table public.profiles (
 id uuid primary key references auth.users(id), email text not null, display_name text not null default '',
 role text not null check(role in ('admin','client','bidder')), archived boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references public.profiles,
 name text not null default 'My workspace', timezone text not null default 'America/Chicago', created_at timestamptz not null default now()
);
create table public.bidders (
 user_id uuid primary key references public.profiles, workspace_id uuid not null references public.workspaces,
 default_rate_cents integer check(default_rate_cents between 0 and 100000000), archived boolean not null default false,
 unique(user_id,workspace_id)
);
create table public.invitations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces,
 email text not null, display_name text not null, default_rate_cents integer check(default_rate_cents between 0 and 100000000),
 expires_at timestamptz not null default now()+interval '7 days', accepted_at timestamptz, created_at timestamptz not null default now(), unique(email)
);
create table public.resumes (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces, bidder_id uuid not null,
 identifier text not null check(length(trim(identifier)) between 1 and 100), candidate_name text not null,
 email text not null default '', phone text not null default '', address text not null default '', links text not null default '', instructions text not null default '',
 rate_override_cents integer check(rate_override_cents between 0 and 100000000), file_id uuid,
 archived boolean not null default false, created_at timestamptz not null default now(),
 foreign key(bidder_id,workspace_id) references public.bidders(user_id,workspace_id), unique(workspace_id,identifier), unique(id,workspace_id,bidder_id)
);
create table public.bids (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bidder_id uuid not null, resume_id uuid not null,
 company text not null check(length(trim(company)) between 1 and 200), role_name text not null check(length(trim(role_name)) between 1 and 200),
 url text not null, normalized_url text not null, source text not null default '',
 arrangement text not null check(arrangement in ('remote','onsite','hybrid')), job_status text not null default 'open' check(job_status in ('open','closed')),
 applied boolean not null default false, found_at timestamptz not null default now(), applied_at timestamptz, first_applied_at timestamptz,
 rate_cents integer check(rate_cents between 0 and 100000000), evidence_file_id uuid, rejected_hashes text[] not null default '{}',
 version integer not null default 0, created_at timestamptz not null default now(),
 foreign key(resume_id,workspace_id,bidder_id) references public.resumes(id,workspace_id,bidder_id),
 unique(resume_id,normalized_url), check(not applied or (evidence_file_id is not null and rate_cents is not null and applied_at is not null))
);
create table public.files (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, bidder_id uuid not null,
 kind text not null check(kind in ('resume','screenshot')), resume_id uuid references public.resumes, bid_id uuid references public.bids,
 filename text not null, mime text not null, size_bytes integer not null check(size_bytes between 1 and 10485760),
 storage_path text not null unique, sha256 text, finalized boolean not null default false,
 created_by uuid not null references public.profiles, created_at timestamptz not null default now(),
 foreign key(bidder_id,workspace_id) references public.bidders(user_id,workspace_id),
 check((kind='resume' and resume_id is not null and bid_id is null) or (kind='screenshot' and bid_id is not null and resume_id is null))
);
alter table public.bids add foreign key(evidence_file_id) references public.files;
alter table public.resumes add foreign key(file_id) references public.files;
create table public.bid_events (
 id uuid primary key default gen_random_uuid(), bid_id uuid not null references public.bids, actor_id uuid not null references public.profiles,
 event text not null, reason text, file_id uuid references public.files, created_at timestamptz not null default now()
);
create index bids_workspace_found on public.bids(workspace_id, found_at desc);
create index bids_bidder_found on public.bids(bidder_id, found_at desc);
create index bid_events_bid on public.bid_events(bid_id,created_at);
create index resumes_bidder on public.resumes(bidder_id);

create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and not archived)
$$;
create function public.manages(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or exists(select 1 from public.workspaces w1 join public.profiles p on p.id=w1.owner_id where w1.id=w and p.id=auth.uid() and not p.archived)
$$;
create function public.can_read(w uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.manages(w) or exists(select 1 from public.bidders m join public.profiles p on p.id=m.user_id join public.workspaces ws on ws.id=m.workspace_id join public.profiles owner on owner.id=ws.owner_id where m.workspace_id=w and m.user_id=b and b=auth.uid() and not m.archived and not p.archived and not owner.archived)
$$;
create function public.require_manager(w uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not public.manages(w) then raise exception 'Access denied'; end if; end $$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.bidders enable row level security;
alter table public.invitations enable row level security;
alter table public.resumes enable row level security;
alter table public.bids enable row level security;
alter table public.files enable row level security;
alter table public.bid_events enable row level security;
create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin() or exists(select 1 from public.bidders b where b.user_id=profiles.id and public.manages(b.workspace_id)));
create policy workspace_read on public.workspaces for select to authenticated using(public.manages(id) or exists(select 1 from public.bidders b where b.workspace_id=id and public.can_read(id,b.user_id)));
create policy bidder_read on public.bidders for select to authenticated using(public.can_read(workspace_id,user_id));
create policy invitation_read on public.invitations for select to authenticated using(public.manages(workspace_id));
create policy resume_read on public.resumes for select to authenticated using(public.can_read(workspace_id,bidder_id));
create policy bid_read on public.bids for select to authenticated using(public.can_read(workspace_id,bidder_id));
create policy file_read on public.files for select to authenticated using(public.can_read(workspace_id,bidder_id));
create policy event_read on public.bid_events for select to authenticated using(exists(select 1 from public.bids b where b.id=bid_id and public.can_read(b.workspace_id,b.bidder_id)));
grant usage on schema public to authenticated,service_role;
grant select on public.profiles,public.workspaces,public.bidders,public.invitations,public.resumes,public.bids,public.files,public.bid_events to authenticated;
grant all on public.profiles,public.workspaces,public.bidders,public.invitations,public.resumes,public.bids,public.files,public.bid_events to service_role;

create function public.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations; begin
 select * into inv from public.invitations where email=lower(new.email) and accepted_at is null and expires_at>now() for update;
 if inv.id is not null then
  insert into public.profiles(id,email,display_name,role) values(new.id,new.email,inv.display_name,'bidder');
  insert into public.bidders(user_id,workspace_id,default_rate_cents) values(new.id,inv.workspace_id,inv.default_rate_cents);
  if new.email_confirmed_at is not null then update public.invitations set accepted_at=now() where id=inv.id; end if;
 else
  insert into public.profiles(id,email,display_name,role) values(new.id,new.email,left(coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),100),'client');
  insert into public.workspaces(owner_id) values(new.id);
 end if;
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.on_auth_user();
create function public.on_auth_confirmed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and old.email_confirmed_at is null then
  update public.invitations i set accepted_at=now() where i.email=lower(new.email) and exists(select 1 from public.bidders b where b.user_id=new.id and b.workspace_id=i.workspace_id);
 end if;
 return new;
end $$;
create trigger on_auth_email_confirmed after update of email_confirmed_at on auth.users for each row execute function public.on_auth_confirmed();

create function public.invite_bidder(p_workspace uuid,p_email text,p_name text,p_rate integer) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; existing_id uuid; begin
 perform public.require_manager(p_workspace);
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)),0));
 if p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(trim(p_name))=0 then raise exception 'Valid name and email required'; end if;
 select id into existing_id from public.profiles where lower(email)=lower(trim(p_email));
 if existing_id is not null and not exists(select 1 from public.bidders b join auth.users u on u.id=b.user_id where b.user_id=existing_id and b.workspace_id=p_workspace and u.email_confirmed_at is null and not b.archived) then raise exception 'This email already has an account'; end if;
 if exists(select 1 from public.invitations where email=lower(trim(p_email)) and workspace_id<>p_workspace) then raise exception 'This email is already invited'; end if;
 insert into public.invitations(workspace_id,email,display_name,default_rate_cents) values(p_workspace,lower(trim(p_email)),trim(p_name),p_rate)
 on conflict(email) do update set expires_at=now()+interval '7 days',display_name=excluded.display_name,default_rate_cents=excluded.default_rate_cents where invitations.workspace_id=excluded.workspace_id returning id into result;
 if result is null then raise exception 'This email is already invited'; end if;
 if existing_id is not null then
  update public.profiles set display_name=trim(p_name) where id=existing_id;
  update public.bidders set default_rate_cents=p_rate where user_id=existing_id;
 end if;
 return result;
end $$;
create function public.update_bidder(p_bidder uuid,p_name text,p_rate integer,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 select workspace_id into w from public.bidders where user_id=p_bidder;
 perform public.require_manager(w);
 if length(trim(p_name))=0 then raise exception 'Name required'; end if;
 update public.bidders set default_rate_cents=p_rate,archived=p_archived where user_id=p_bidder;
 update public.profiles set display_name=trim(p_name),archived=p_archived where id=p_bidder;
end $$;
create function public.update_client(p_client uuid,p_name text,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Access denied'; end if;
 update public.profiles set display_name=trim(p_name),archived=p_archived where id=p_client and role='client';
end $$;
create function public.save_settings(p_name text,p_workspace uuid,p_workspace_name text,p_timezone text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and not archived) then raise exception 'Access denied'; end if;
 if length(trim(p_name))=0 then raise exception 'Name required'; end if;
 update public.profiles set display_name=left(trim(p_name),100) where id=auth.uid();
 if p_workspace is not null then
  perform public.require_manager(p_workspace);
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
  update public.workspaces set name=left(trim(p_workspace_name),100),timezone=p_timezone where id=p_workspace;
 end if;
end $$;
create function public.save_resume(p_id uuid,p_workspace uuid,p_bidder uuid,p_identifier text,p_name text,p_email text,p_phone text,p_address text,p_links text,p_instructions text,p_rate integer) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 perform public.require_manager(p_workspace);
 if not exists(select 1 from public.bidders where user_id=p_bidder and workspace_id=p_workspace and not archived) then raise exception 'Choose an active bidder'; end if;
 if p_id is null then
  insert into public.resumes(workspace_id,bidder_id,identifier,candidate_name,email,phone,address,links,instructions,rate_override_cents)
  values(p_workspace,p_bidder,trim(p_identifier),p_name,p_email,p_phone,p_address,p_links,p_instructions,p_rate) returning id into result;
 else
  update public.resumes set identifier=trim(p_identifier),candidate_name=p_name,email=p_email,phone=p_phone,address=p_address,links=p_links,instructions=p_instructions,rate_override_cents=p_rate
  where id=p_id and workspace_id=p_workspace and bidder_id=p_bidder and not archived returning id into result;
  if result is null then raise exception 'Resume not found or archived'; end if;
 end if;
 return result;
end $$;
create function public.archive_resume(p_id uuid,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare w uuid; begin
 select workspace_id into w from public.resumes where id=p_id;
 perform public.require_manager(w);
 update public.resumes set archived=p_archived where id=p_id;
end $$;

create function public.url_decode(s text) returns text language plpgsql immutable set search_path='' as $$
declare bytes bytea=''::bytea; i integer=1; c text; begin
 while i<=length(s) loop
  c=substring(s from i for 1);
  if c='%' and substring(s from i+1 for 2) ~ '^[A-Fa-f0-9]{2}$' then bytes=bytes||decode(substring(s from i+1 for 2),'hex');i=i+3;
  else bytes=bytes||convert_to(case when c='+' then ' ' else c end,'UTF8');i=i+1; end if;
 end loop;
 return convert_from(bytes,'UTF8');
end $$;
create function public.url_encode(s text) returns text language plpgsql immutable set search_path='' as $$
declare bytes bytea=convert_to(s,'UTF8'); result text=''; n integer; begin
 for i in 0..length(bytes)-1 loop
  n=get_byte(bytes,i);
  if (n between 48 and 57) or (n between 65 and 90) or (n between 97 and 122) or n in (42,45,46,95) then result=result||chr(n);
  elsif n=32 then result=result||' ';
  else result=result||'%'||upper(lpad(to_hex(n),2,'0'));end if;
 end loop;
 return replace(result,' ','+');
end $$;
-- Match URL/URLSearchParams canonicalization for normal HTTP(S) job URLs.
create function public.normalize_job_url(u text) returns text language plpgsql immutable set search_path='' as $$
declare base text; query text; authority text; path text; scheme text; host text; part text; parts text[]='{}'; segments text[]; idx integer; begin
 u=split_part(trim(u),'#',1);
 if length(u)>4096 or u !~* '^https?://[^/?#[:space:]@]+([/?]|$)' or position(chr(92) in u)>0 then raise exception 'Valid HTTP(S) job URL required'; end if;
 base=split_part(u,'?',1); authority=substring(base from '(?i)^https?://[^/]+');
 scheme=lower(split_part(authority,':',1));host=lower(substring(authority from position('://' in authority)+3));
 if host !~ '^([a-z0-9.-]+|\[[a-f0-9:]+\])(:[0-9]+)?$' then raise exception 'Use an ASCII or encoded domain name'; end if;
 if scheme='https' then host=regexp_replace(host,':0*443$','');else host=regexp_replace(host,':0*80$','');end if;
 path=substring(base from length(authority)+1);
 segments=string_to_array(case when path='' then '/' else path end,'/');
 for idx in 2..coalesce(array_length(segments,1),1) loop
  part=segments[idx];
  if replace(lower(part),'%2e','.')='..' then parts=parts[1:greatest(coalesce(array_length(parts,1),0)-1,0)];if idx=array_length(segments,1) then parts=array_append(parts,'');end if;
  elsif replace(lower(part),'%2e','.')='.' then if idx=array_length(segments,1) then parts=array_append(parts,'');end if;
  else parts=array_append(parts,part);end if;
 end loop;
 base=scheme||'://'||host||'/'||coalesce(array_to_string(parts,'/'),'');
 if position('?' in u)>0 then
  select string_agg(public.url_encode(k)||'='||public.url_encode(v),'&' order by k collate "C",ord) into query from (
   select public.url_decode(split_part(param,'=',1)) k,public.url_decode(case when position('=' in param)>0 then substring(param from position('=' in param)+1) else '' end) v,ord
   from unnest(string_to_array(substring(u from position('?' in u)+1),'&')) with ordinality as q(param,ord) where param<>''
  ) q where lower(k) !~ '^utm_' and lower(k) not in ('gclid','fbclid','msclkid');
 end if;
 return base||case when query is null or query='' then '' else '?'||query end;
end $$;
create function public.save_bid(p_id uuid,p_resume uuid,p_company text,p_role text,p_url text,p_source text,p_arrangement text,p_status text,p_found timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.resumes; old public.bids; result uuid; begin
 select * into r from public.resumes where id=p_resume;
 if r.id is null or not public.can_read(r.workspace_id,r.bidder_id) then raise exception 'Access denied'; end if;
 if p_id is null then
  if r.archived or exists(select 1 from public.bidders where user_id=r.bidder_id and archived) then raise exception 'Resume or bidder archived'; end if;
  insert into public.bids(workspace_id,bidder_id,resume_id,company,role_name,url,normalized_url,source,arrangement,job_status,found_at)
  values(r.workspace_id,r.bidder_id,r.id,trim(p_company),trim(p_role),trim(p_url),public.normalize_job_url(p_url),p_source,p_arrangement,p_status,coalesce(p_found,now())) returning id into result;
 else
  select * into old from public.bids where id=p_id for update;
  if old.id is null or not public.can_read(old.workspace_id,old.bidder_id) or old.workspace_id<>r.workspace_id or old.bidder_id<>r.bidder_id then raise exception 'Access denied'; end if;
  if old.resume_id<>r.id and (old.first_applied_at is not null or r.archived) then raise exception 'Cannot change this resume assignment'; end if;
  update public.bids set resume_id=r.id,company=trim(p_company),role_name=trim(p_role),url=trim(p_url),normalized_url=public.normalize_job_url(p_url),source=p_source,arrangement=p_arrangement,job_status=p_status,found_at=coalesce(p_found,found_at),version=version+1 where id=p_id returning id into result;
 end if;
 return result;
end $$;
create function public.prepare_file(p_kind text,p_target uuid,p_name text,p_mime text,p_size integer) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; b uuid; result uuid=gen_random_uuid(); begin
 if p_kind='resume' then
  select workspace_id,bidder_id into w,b from public.resumes where id=p_target and not archived;
  perform public.require_manager(w);
  if p_mime not in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'Unsupported resume type'; end if;
 elsif p_kind='screenshot' then
  select workspace_id,bidder_id into w,b from public.bids where id=p_target;
  if not public.can_read(w,b) then raise exception 'Access denied'; end if;
  if p_mime not in ('image/png','image/jpeg','image/webp') then raise exception 'Unsupported screenshot type'; end if;
 else raise exception 'Unsupported file kind'; end if;
 if w is null then raise exception 'Record not found'; end if;
 insert into public.files(id,workspace_id,bidder_id,kind,resume_id,bid_id,filename,mime,size_bytes,storage_path,created_by)
 values(result,w,b,p_kind,case when p_kind='resume' then p_target end,case when p_kind='screenshot' then p_target end,left(p_name,255),p_mime,p_size,w::text||'/'||b::text||'/'||result::text,auth.uid());
 return result;
end $$;
-- Executable only by the trusted server after downloading and hashing the actual object.
create function public.finalize_file(p_id uuid,p_sha text) returns void language plpgsql security definer set search_path='' as $$
declare f public.files; begin
 if p_sha !~ '^[a-f0-9]{64}$' then raise exception 'Invalid content hash'; end if;
 select * into f from public.files where id=p_id for update;
 if f.id is null then raise exception 'File not found'; end if;
 if f.finalized then
  if f.sha256<>p_sha then raise exception 'Immutable file'; end if;
  return;
 end if;
 update public.files set sha256=p_sha,finalized=true where id=p_id;
 if f.kind='resume' then update public.resumes set file_id=f.id where id=f.resume_id; end if;
end $$;
create function public.set_applied(p_bid uuid,p_applied boolean,p_file uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
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
  if not b.applied then return; end if;
  if public.manages(b.workspace_id) and length(trim(coalesce(p_reason,'')))=0 then raise exception 'A correction reason is required'; end if;
  select * into f from public.files where id=b.evidence_file_id;
  update public.bids set applied=false,rejected_hashes=array_append(rejected_hashes,f.sha256),version=version+1 where id=b.id;
  insert into public.bid_events(bid_id,actor_id,event,reason,file_id) values(b.id,auth.uid(),'unapplied',left(p_reason,1000),f.id);
 end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('private-files','private-files',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create policy private_file_read on storage.objects for select to authenticated using(bucket_id='private-files' and exists(select 1 from public.files f where f.storage_path=name and public.can_read(f.workspace_id,f.bidder_id)));
create policy private_file_insert on storage.objects for insert to authenticated with check(bucket_id='private-files' and exists(select 1 from public.files f where f.storage_path=name and f.created_by=auth.uid() and not f.finalized and public.can_read(f.workspace_id,f.bidder_id) and (f.kind='screenshot' or public.manages(f.workspace_id))));

-- No generic table writes and no public function execution.
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(),public.manages(uuid),public.can_read(uuid,uuid) to authenticated;
grant execute on function public.invite_bidder(uuid,text,text,integer), public.update_bidder(uuid,text,integer,boolean), public.update_client(uuid,text,boolean),public.save_settings(text,uuid,text,text),public.save_resume(uuid,uuid,uuid,text,text,text,text,text,text,text,integer),public.archive_resume(uuid,boolean),public.save_bid(uuid,uuid,text,text,text,text,text,text,timestamptz),public.prepare_file(text,uuid,text,text,integer),public.set_applied(uuid,boolean,uuid,text) to authenticated;
grant execute on function public.finalize_file(uuid,text) to service_role;
