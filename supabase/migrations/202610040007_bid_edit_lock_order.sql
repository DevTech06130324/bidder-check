-- Every bid mutation that participates in shared-profile restrictions takes
-- the profile advisory lock before locking a bid row. save_bid already follows
-- this order; this replacement fixes the spreadsheet cell RPC to match it.
create or replace function public.update_bid_cell(p_bid uuid,p_field text,p_value text,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 b public.bids; updated public.bids; r public.resumes; initial_bid public.bids;
 value text=trim(p_value); normalized text; issues jsonb; company_value text;
 role_value text; url_value text; requested_resume uuid; profile uuid;
begin
 -- The unlocked read only discovers which shared profile must be serialized.
 select * into initial_bid from public.bids where id=p_bid;
 if initial_bid.id is null or not public.can_read(initial_bid.workspace_id,initial_bid.bidder_id) then raise exception 'Access denied'; end if;
 if p_field is null or p_field not in ('company','role_name','url','source','arrangement','job_status','resume_id') then raise exception 'Field is not editable'; end if;

 if p_field='resume_id' then
  begin requested_resume=value::uuid; exception when others then raise exception 'Choose an active resume assigned to this bidder'; end;
 else
  requested_resume=initial_bid.resume_id;
 end if;
 select * into r from public.resumes where id=requested_resume;
 if r.id is null or r.profile_id is null or r.workspace_id<>initial_bid.workspace_id or r.bidder_id<>initial_bid.bidder_id or r.archived then raise exception 'Choose an active resume assigned to this bidder'; end if;
 profile=r.profile_id;
 perform pg_advisory_xact_lock(hashtextextended(profile::text,0));

 -- Writers for one bid now all acquire the profile lock, then the row lock.
 select * into b from public.bids where id=p_bid for update;
 if b.id is null or not public.can_read(b.workspace_id,b.bidder_id) then raise exception 'Access denied'; end if;
 if b.deleted_at is not null then raise exception 'Restore this bid from trash before editing'; end if;
 if p_version is null or b.version<>p_version then return jsonb_build_object('conflict',true,'row',to_jsonb(b)); end if;
 if b.resume_id<>initial_bid.resume_id then return jsonb_build_object('conflict',true,'row',to_jsonb(b)); end if;
 if b.workspace_id<>r.workspace_id or b.bidder_id<>r.bidder_id then raise exception 'Access denied'; end if;
 if value is null then raise exception 'A value is required'; end if;
 if p_field in ('company','role_name') and length(value) not between 1 and 200 then raise exception 'Required; maximum 200 characters'; end if;
 if p_field='source' and length(value)>200 then raise exception 'Maximum 200 characters'; end if;
 if p_field='arrangement' and value not in ('remote','onsite','hybrid') then raise exception 'Choose remote, onsite or hybrid'; end if;
 if p_field='job_status' and value not in ('open','closed') then raise exception 'Choose open or closed'; end if;

 company_value=case when p_field='company' then value else b.company end;
 role_value=case when p_field='role_name' then value else b.role_name end;
 url_value=case when p_field='url' then value else b.url end;
 normalized=public.normalize_job_url(url_value);
 if r.id<>b.resume_id and b.first_applied_at is not null then raise exception 'Resume is locked after first application'; end if;
 issues=case when p_field in ('company','role_name','url','resume_id') then public.candidate_bid_issues(r.profile_id,b.id,company_value,role_value,url_value) else '[]'::jsonb end;
 if jsonb_array_length(issues)>0 then raise exception '%',issues->0->>'message'; end if;
 if not exists(select 1 from public.files f where f.id=r.file_id and f.kind='resume' and f.finalized and f.mime='application/pdf') then raise exception 'Upload and verify a PDF resume before adding bids'; end if;
 update public.bids set company=company_value,role_name=role_value,url=url_value,normalized_url=normalized,source=case when p_field='source' then value else source end,arrangement=case when p_field='arrangement' then value else arrangement end,job_status=case when p_field='job_status' then value else job_status end,resume_id=case when p_field='resume_id' then r.id else resume_id end,version=version+1 where id=b.id returning * into updated;
 insert into public.bid_events(bid_id,actor_id,event,details) values(b.id,auth.uid(),'edited',jsonb_build_object('field',p_field,'before',to_jsonb(b),'after',to_jsonb(updated)));
 return jsonb_build_object('ok',true,'row',to_jsonb(updated));
end $$;

revoke all on function public.update_bid_cell(uuid,text,text,integer) from public,anon;
grant execute on function public.update_bid_cell(uuid,text,text,integer) to authenticated;
