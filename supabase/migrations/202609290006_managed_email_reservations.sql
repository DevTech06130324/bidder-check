-- Move the consumed provisioning reservation with its Auth account. Otherwise a
-- later registration at the old email would reuse the existing Auth UUID.
create or replace function public.sync_auth_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email is distinct from old.email then
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(new.email)),0));
  if exists(select 1 from public.invitations where email=lower(new.email) and id<>new.id) then raise exception 'Email is reserved for another account'; end if;
  update public.invitations set email=lower(new.email) where id=new.id;
  update public.profiles set email=lower(new.email) where id=new.id;
 end if;
 return new;
end $$;
