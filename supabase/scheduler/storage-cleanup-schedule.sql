-- Run after storage-cleanup-function.sql, once per environment, as the project owner.
-- Required Vault secrets (create separately; never commit values):
--   select vault.create_secret('https://<deployment-host>/api/cron/storage-cleanup','storage_cleanup_url');
--   select vault.create_secret('<same value as the deployment CRON_SECRET>','storage_cleanup_secret');
--   -- Staging only, when deployment protection is enabled:
--   select vault.create_secret('<protection bypass secret>','storage_cleanup_bypass');
-- To rotate, use vault.update_secret(...) with the id from vault.secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- Re-scheduling with an existing name replaces that job, so this stays idempotent.
select cron.schedule('storage-cleanup','* * * * *','select public.invoke_storage_cleanup()');

-- Monitoring:
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
--   select status_code, error_msg, created from net._http_response where status_code is distinct from 200 order by created desc limit 20;
