-- Bidder detail screens need historical counts only for that bidder's resume
-- assignments. Keep the broad count RPC for the resume library.
create function public.resume_bid_counts_for_bidder(p_bidder uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare workspace_id uuid;
begin
  select b.workspace_id into workspace_id
    from public.bidders b where b.user_id=p_bidder;
  if workspace_id is null then raise exception 'Bidder not found'; end if;
  perform public.require_manager(workspace_id);
  return (
    select coalesce(jsonb_object_agg(summary.resume_id::text,summary.bid_count),'{}'::jsonb)
      from (
        select r.id resume_id,count(b.id)::integer bid_count
          from public.resumes r left join public.bids b on b.resume_id=r.id
          where r.bidder_id=p_bidder group by r.id
      ) summary
  );
end $$;
revoke all on function public.resume_bid_counts_for_bidder(uuid) from public,anon;
grant execute on function public.resume_bid_counts_for_bidder(uuid) to authenticated;

do $migration$
declare
  function_source text;
  changed_source text;
begin
  function_source := pg_get_functiondef('public.save_resume_assignment(uuid,uuid,uuid,text,text,uuid,integer)'::regprocedure);
  changed_source := replace(
    function_source,
    'file_id=coalesce(p_file,file_id)',
    'file_id=case when current_row.bidder_id is distinct from p_bidder then p_file else coalesce(p_file,file_id) end'
  );
  if changed_source = function_source then
    raise exception 'Could not update assignment file ownership on bidder changes';
  end if;
  execute changed_source;
end
$migration$;
