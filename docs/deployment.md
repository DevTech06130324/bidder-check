# Deployment handoff

Production is deployed at https://bidder-check.vercel.app and isolated Preview at https://bidder-check-staging.vercel.app. Production uses Supabase `aizorlyfggwbewetnwqm`; staging uses `kdmvludtvhuuewmhurpw`. Both have the application schema and private Storage. The designated account `david.chan.mdev@gmail.com` has been assigned the admin role.

The direct-account onboarding update is awaiting its final hosted smoke test and production release. It replaces emailed bidder invitations with manager-created accounts (initial password `123456`), supports password changes in Settings, and signs clients in immediately after registration. SMTP is outside the revised scope.

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

1. Inspect migration history; apply checked-in migrations in order with `supabase db push`. Do not rerun the initial SQL over an existing schema.
2. Set `auth.email.enable_confirmations = false`. Keep SMTP disabled. Configure the environment's Site URL without overwriting unrelated provider settings.
3. Keep staging and production data isolated; apply and test migrations on staging first.
4. Import the GitHub repository into Vercel: Next.js, root `./`, Node `22.x`, `npm run build`, default output. Use `main` for production.
5. Add the four runtime environment variables separately to Production and Preview; previews use staging credentials.
6. Set the production `APP_URL` and Supabase Site URL to the assigned Vercel/custom domain; add `/auth/confirm` and `/auth/callback` to the redirect allowlist. Redeploy if environment variables changed.
7. Admin bootstrap is already complete. For another explicitly authorized administrator, register the account first, then run the bootstrap command with its email.
8. Run `scripts/hosted-smoke.mjs` against staging: immediate signup, direct bidder creation, initial-password login/change, two-client isolation, private downloads, invalid/valid screenshot uploads, correction/reapplication, retry idempotency and archival. The script cleans its synthetic users and files. Check deployment logs without logging profile/file contents.

Current local verification: 20 unit/database cases and 14 browser cases, plus lint/typecheck/build. Initial hosted verification confirmed Auth sessions, resume upload/download, and screenshot applications. The complete updated onboarding/earnings journey is the remaining release check. Email delivery is intentionally not tested or required.
