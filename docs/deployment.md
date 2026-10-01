# Deployment handoff

Production is deployed at https://bidder-check.vercel.app and isolated Preview at https://bidder-check-staging.vercel.app. Production uses Supabase `aizorlyfggwbewetnwqm`; staging uses `kdmvludtvhuuewmhurpw`. Both have the application schema and private Storage. The designated account `david.chan.mdev@gmail.com` has been assigned the admin role.

The direct-account onboarding update is live. It replaces emailed bidder invitations with manager-created accounts (initial password `123456`), supports password changes in Settings, and signs clients in immediately after registration. SMTP is outside the revised scope. Production and staging have migrations 001–003, with all eight tables under RLS and a private file bucket.

## Required access

Use `.env.local` for local secrets; `.gitignore` excludes it. Keep secrets out of chat and Git.

| Setting                                | Purpose                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL (already provided locally)                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client key (already provided locally)                         |
| `SUPABASE_SECRET_KEY`                  | Auth account creation and trusted screenshot verification            |
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

Verification on 2026-09-29: 20 unit/database cases, 14 desktop/mobile browser cases, lint, typecheck and production build all passed. The full hosted Vercel staging journey passed all eight workflow checkpoints: immediate signup; bidder creation/default-password login/password change; private resumes; invalid screenshot rejection; valid evidence and earnings; direct HTTP tenant/storage permissions; correction/new-proof/retry behavior; earnings and archival. Synthetic accounts/files were cleaned up. Email delivery is intentionally not tested or required.

Application commit `ffd5474` reached READY in production (`dpl_4rJ8zXEdvLHPVYx72AkmES2sRcKF`) and staging (`dpl_Bc3FTUdih6hF46PtxXDyMiJUCeVS`). Subsequent documentation/test-runner commits may create equivalent deployments through the GitHub integration.

Post-release production checks passed: protected routes redirect to login, updated signup/recovery pages render on mobile without overflow, Supabase reports immediate signup enabled, and the designated administrator remains active. Production checks were read-only; complete data-mutation journeys ran on staging.

## Approval and bid workflow release ? 2026-09-30

The new application is verified on staging at commit `a247b2d`, deployment `dpl_9vdxHy9Du3yZXQaN56yXekLB8D9Y`. Migrations 004, 005, 006 and 202609300001 add client approval, account/email synchronization, atomic evidence application, recoverable trash and blocked-account settings restrictions. Earlier immediate-workspace onboarding is superseded: public client sessions now land on approval status until approved; SMTP remains unnecessary.

Release validation: 32 unit/database tests, 16 desktop/mobile browser tests, lint/type checking and production build passed. All 13 hosted staging checkpoints passed: pending/signup restrictions; rejection/approval; admin client create/archive/restore; synchronized email and confirmed password resets; bidder creation/login/password change; private resumes; invalid screenshot rejection; automatic application and replacement; direct tenant/storage restrictions; correction/reapplication/rate/idempotency; trash/restoration; parent archival/restoration; individual archival and retained earnings. Synthetic staging accounts/files were cleaned up.

Post-release verification uses `node --env-file=.env.local scripts/production-smoke.mjs`. It checks the designated admin without editing it, creates one synthetic pending client, verifies approval routing and password change, then removes exactly that generated account. No customer records are changed and no email is sent.

## Spreadsheet bid workflow - 2026-09-30

The spreadsheet application at commit `276bd13` is verified on staging, deployment `dpl_7k1uyA9Fx9FAbbfcfS888Htg5uhV`, and assigned to https://bidder-check-staging.vercel.app. It adds inline field editing, copy-only rectangular selection, mapped Sheets imports, and Yesterday (CT). Migrations `202609300002_spreadsheet_bids.sql` and `202609300003_url_canonicalization.sql` add version-checked mutations, actor-scoped import receipts, transactional import validation, and canonical duplicate keys. The normalization migration aborts on a historical collision instead of deleting records.

Release checks: 44 unit/database tests and 34 desktop/mobile browser checks passed, plus lint, type checking and production build. Coverage includes a 500-row preview and database transaction, Unicode/multiline clipboard values, conflicts, focus, filtered row removal, permissions, receipts, Chicago midnight and DST boundaries. The full hosted staging run passed 14 checkpoints, including an actual past-date Sheets import and inline edit, simultaneous edits, concurrent retries, and complete duplicate-batch rollback. Existing account, proof, earnings, trash and archive journeys also passed. All synthetic staging users/files were removed.

The test runner uses network-appropriate assertion timeouts. An initial staging run successfully imported/edited rows but used an incorrect accessible-name locator for the separate Saved status; that locator was corrected. A subsequent run hit a five-second upload-verification assertion while the upload was still completing; a 45-second network assertion limit resolved it. These were test-runner corrections; the final full run exited successfully.

Production smoke checks also verify that pending accounts cannot call the new spreadsheet RPCs or read import receipts. No SMTP configuration or new runtime environment variables are required.

Production release: commit `85a755b` reached READY at deployment `dpl_8QKRL5KLJ4MZ32EuLmjmtkLExKuK` on https://bidder-check.vercel.app. Both spreadsheet migrations applied successfully. Post-release production checks passed: designated admin remains active, public metadata cannot grant approval/roles, pending accounts cannot access workspace data or spreadsheet RPCs/receipts, and approval routing, password change and sign-out work. The synthetic production verification account was removed. Later documentation-only commits may create equivalent deployments through Git integration.


## Bulk controls and permanent trash deletion

Migration `202609300004_bulk_bid_controls.sql` adds actor-bound confirmation snapshots, version-checked bulk actions, durable screenshot cleanup, and SHA-256 import receipt fingerprints. Apply on staging before production; completed import retries never recreate purged rows. Selected operations are capped at 500; Empty trash uses the full authorized scope, with fixed-bidder pages remaining scoped.

Set a distinct server-only `CRON_SECRET` in Preview and Production. `vercel.json` schedules `/api/cron/storage-cleanup` daily at 05:00 UTC. Preview does not automatically run Vercel cron: exercise the route with the staging bearer secret. The worker processes at most 50 files per call, leases tasks for two minutes, retains failed tasks, and requires a second successful removal at least five minutes after the first. Application deletion is immediate; screenshot cleanup stays pending until verified. Managers can retry pending work in the app. Resume objects are never enqueued. Large backlogs drain across bounded manual/daily passes.

Hosted smoke tests create their own staging accounts and purge only those synthetic applications. They simulate an upload finishing after the initial delete, invoke authenticated cron, verify its physical object is removed, and clean their own operation/task records. Production smoke checks pending-account denial for the new RPCs without purging customer data.

Verified staging release: commit `9b5b27c`, deployment `dpl_8zJb28uuw7JzzWcZCEu4NYEfWZNs`. All 16 hosted checkpoints passed and generated accounts/files were removed. Local verification: 51 unit/database cases, 40 browser cases, lint/type checking and production build. A fresh review's pending-cleanup discovery issue was fixed with a failing-then-passing regression before staging.
