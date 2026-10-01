-- Requires pg_net (schema net) and Supabase Vault (vault.decrypted_secrets).
-- Not a migration: extensions and secrets are configured per environment.
-- Idempotent; safe to re-run.
create or replace function public.invoke_storage_cleanup() returns bigint language plpgsql security definer set search_path='' as $$
declare target text; secret text; bypass text; req bigint; begin
 -- Idle minutes make no HTTP request.
 if not public.has_due_storage_cleanup() then return null; end if;
 select decrypted_secret into target from vault.decrypted_secrets where name='storage_cleanup_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='storage_cleanup_secret';
 select decrypted_secret into bypass from vault.decrypted_secrets where name='storage_cleanup_bypass';
 if target is null or secret is null then raise exception 'Storage cleanup scheduler secrets are not configured'; end if;
 select net.http_get(
  url:=target,
  headers:=jsonb_build_object('authorization','Bearer '||secret)||case when bypass is null then '{}'::jsonb else jsonb_build_object('x-vercel-protection-bypass',bypass) end,
  timeout_milliseconds:=55000
 ) into req;
 return req;
end $$;
revoke all on function public.invoke_storage_cleanup() from public,anon,authenticated;
