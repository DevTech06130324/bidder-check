-- Configure once per environment as the Supabase project owner.
-- Store all values in Vault before scheduling:
--   select vault.create_secret('https://<deployment-host>/api/cron/notifications','notification_worker_url');
--   select vault.create_secret('<same value as Vercel NOTIFICATION_WORKER_SECRET>','notification_worker_secret');
--   -- Staging only, if Vercel deployment protection is enabled:
--   select vault.create_secret('<protection bypass secret>','notification_worker_bypass');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;
select cron.schedule('bidder-check-notifications','* * * * *','select public.invoke_notification_worker()');

-- Monitor worker responses:
-- select status,return_message,start_time from cron.job_run_details order by start_time desc limit 20;
-- select status_code,error_msg,created from net._http_response order by created desc limit 20;
