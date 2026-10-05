-- A private PDF belongs to exactly the bidder assignment it was uploaded for.
-- Reusing identical file contents is allowed by uploading that content to the
-- target assignment; one file object is never reassigned across applications.
create function public.guard_resume_assignment_file() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.file_id is not null and not exists(
  select 1 from public.files f where f.id=new.file_id and f.kind='resume' and f.resume_id=new.id
   and f.workspace_id=new.workspace_id and f.bidder_id=new.bidder_id and f.finalized and f.mime='application/pdf'
 ) then raise exception 'Resume PDF must be verified for this bidder assignment'; end if;
 return new;
end $$;
create trigger guard_resume_assignment_file before insert or update of file_id,bidder_id,workspace_id on public.resumes
 for each row execute function public.guard_resume_assignment_file();
revoke all on function public.guard_resume_assignment_file() from public,anon,authenticated;
