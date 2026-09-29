-- Auth writes app metadata after INSERT, so an INSERT trigger cannot use it.
-- Admin createUser supports a caller-selected UUID; public signup does not.
-- Reuse the manager's reservation UUID as the server-provisioned Auth identity.
create or replace function public.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations; begin
 select * into inv from public.invitations where email=lower(new.email) and accepted_at is null for update;
 if inv.id is not null then
  if new.id<>inv.id or inv.expires_at<=now() then raise exception 'This email is reserved for a managed account'; end if;
  if not exists(select 1 from public.workspaces w join public.profiles p on p.id=w.owner_id where w.id=inv.workspace_id and not p.archived) then raise exception 'Workspace is inactive'; end if;
  insert into public.profiles(id,email,display_name,role) values(new.id,new.email,inv.display_name,'bidder');
  insert into public.bidders(user_id,workspace_id,default_rate_cents) values(new.id,inv.workspace_id,inv.default_rate_cents);
  if new.email_confirmed_at is not null then update public.invitations set accepted_at=now() where id=inv.id; end if;
 else
  insert into public.profiles(id,email,display_name,role) values(new.id,new.email,left(coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),100),'client');
  insert into public.workspaces(owner_id) values(new.id);
 end if;
 return new;
end $$;
