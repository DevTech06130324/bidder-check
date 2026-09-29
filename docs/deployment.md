# Deployment handoff

The code is ready to build. The production Supabase project currently has no application schema installed. No production deployment is claimed until the checks below are completed.

## Required access

Use `.env.local` for local secrets; `.gitignore` excludes it. Keep secrets out of chat and Git.

| Setting                                | Purpose                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL (already provided locally)                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client key (already provided locally)                         |
| `SUPABASE_SECRET_KEY`                  | Auth invitations and trusted screenshot verification                 |
| `APP_URL`                              | Trusted application origin; localhost in development                 |
| `SUPABASE_ACCESS_TOKEN`                | Optional local deployment credential for Supabase Management API/CLI |
| `VERCEL_TOKEN`                         | Optional local deployment credential for Vercel CLI                  |

Management/deployment tokens are not runtime variables and must not be sent to browsers or installed in the Vercel application environment.

## Release order

1. Inspect the target project's current schema; apply the checked-in initial SQL migration to the empty application schema.
2. Configure a verified SMTP sender and email templates as shown in README. Enable email confirmation.
3. Provision an isolated staging Supabase project, apply the same migration, and configure staging URLs and SMTP.
4. Import the GitHub repository into Vercel: Next.js, root `./`, Node `22.x`, `npm run build`, default output. Use `main` for production.
5. Add the four runtime environment variables separately to Production and Preview; previews use staging credentials.
6. Set the production `APP_URL` and Supabase Site URL to the assigned Vercel/custom domain; add `/auth/confirm` and `/auth/callback` to the redirect allowlist. Redeploy if environment variables changed.
7. Register and verify `david.chan.mdev@gmail.com`; run `npm run admin:bootstrap -- david.chan.mdev@gmail.com` with the production secret configured locally.
8. Smoke-test client registration, invitations, reset links, two-client isolation, private resume downloads, screenshot application, client correction and reapplication. Check Vercel logs for server errors without logging profile/file contents.

Current automated coverage: 19 unit/database cases and 14 browser cases, plus lint/typecheck/build. Actual hosted SMTP, Storage HTTP and live Auth workflows remain release checks, not completed tests.
