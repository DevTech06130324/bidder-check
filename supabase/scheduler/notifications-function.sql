-- Requires pg_net and Vault secrets configured in the project.
create or replace function public.invoke_notification_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare target text; secret text; bypass text; req bigint; begin
 select decrypted_secret into target from vault.decrypted_secrets where name='notification_worker_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='notification_worker_secret';
 select decrypted_secret into bypass from vault.decrypted_secrets where name='notification_worker_bypass';
 if target is null or secret is null then raise exception 'Notification worker scheduler secrets are not configured'; end if;
 select net.http_post(url:=target,headers:=jsonb_build_object('authorization','Bearer '||secret)||case when bypass is null then '{}'::jsonb else jsonb_build_object('x-vercel-protection-bypass',bypass) end,body:='{}'::jsonb,timeout_milliseconds:=55000) into req;
 return req;
end $$;
revoke all on function public.invoke_notification_worker() from public,anon,authenticated;
