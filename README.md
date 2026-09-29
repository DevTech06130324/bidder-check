# Bidder Check

A Next.js + Supabase workspace for clients, bidders, resume profiles, applications, and USD earnings. UI uses shadcn/ui and Aceternity Background Beams.

## Run locally

Use Node 22 LTS and npm. On Windows use `npm.cmd` / `npx.cmd` if PowerShell blocks npm scripts.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `APP_URL`. Never expose the secret with a `NEXT_PUBLIC_` prefix. It is used only for Auth administration and server-verified file finalization. Ordinary data reads, mutations, uploads and downloads use the user's JWT and RLS.

## Supabase setup

Apply all checked-in migrations in order using the Supabase CLI (`supabase login`, `supabase link --project-ref YOUR_REF`, `supabase db push`). The initial migration requires an empty application schema. Production is `aizorlyfggwbewetnwqm`; isolated staging is `kdmvludtvhuuewmhurpw`. Never apply production migrations as part of the Vercel build.

Email confirmation is disabled, as requested. Client registration immediately signs the user into a new workspace. SMTP is not required. In Users, clients/admins add a bidder by name and email, with initial password `123456`. Bidders can change their password through Settings → Change password (new passwords require 8–128 characters). Share initial credentials directly. Forgotten-password guidance directs users to their client/administrator; no recovery email is sent.

Bidder creation first reserves the email under the signed-in manager's database permissions, then uses server-only Auth administration to create the account with the reserved UUID. Public signup cannot select an Auth user ID or consume this reservation; editable signup metadata cannot assign roles. The legacy `invitations` table stores these account-creation reservations, and failed creation can be retried from Pending accounts. An email cannot belong to multiple clients or roles. Removing users archives them and preserves history.

Set each environment's Site URL to its deployed origin. Preview uses staging credentials, never production. Do not push the local `supabase/config.toml` unchanged to production because its Site URL is localhost.

Register the designated administrator, then run the explicit bootstrap:

```sh
npm run admin:bootstrap -- david.chan.mdev@gmail.com
```

The script refuses unknown, unconfirmed, and bidder accounts. With email confirmation disabled, Supabase confirms new accounts automatically. It does not use a first-user administrator shortcut. `david.chan.mdev@gmail.com` has already been bootstrapped in production.

## Earnings and evidence

The first application records the effective rate (resume override or bidder default) and its reporting timestamp. Applied bids with verified evidence count once. Corrections remove earnings; reapplication requires a screenshot whose SHA-256 differs from all rejected screenshots for that bid, restoring the original rate and reporting date. All transitions lock the bid row. Private objects cannot be overwritten by users. The server downloads the actual uploaded bytes under the caller's JWT, checks size and file signature, then records their hash using a narrowly scoped privileged function. Signed download links expire after 60 seconds.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Database tests execute all migrations in PGlite PostgreSQL with test equivalents of Supabase's Auth and Storage schemas and `auth.uid()`. They exercise RLS with an `authenticated` database role. Hosted Auth and Storage HTTP are checked separately by `scripts/hosted-smoke.mjs`.

Browser tests exercise real authentication pages and the workspace components using synthetic fixtures in an isolated Vite server (`tests/preview`). Fixture mutation handlers deliberately refuse writes. This verifies layout, filters, navigation, theme changes and accessibility; it does not replace a hosted authenticated workflow test. The production app never serves these fixtures. On restricted Windows hosts, browser tests may need permission to stop their own server processes.

`node scripts/generate-types.mjs` generates TypeScript types from the executable migration without Docker. After a local Supabase startup, `npm run db:types` can regenerate from the live schema.

For real staging workflows, set staging keys in ignored `.env.staging`, run the application against those credentials on port 3002, then run `node --env-file=.env.staging scripts/hosted-smoke.mjs`. `SMOKE_APP_URL` can target the deployed staging app; protected previews also need `SMOKE_VERCEL_BYPASS`. The script refuses the production database, creates synthetic accounts, and removes its own accounts/files afterward. Reports are saved in ignored `test-results/`.

## Vercel

Import `DevTech06130324/bidder-check`, select Next.js, root `./`, build `npm run build`, default output directory, Node 22. Add the four environment variables separately to Production and Preview. Use isolated staging Supabase for Preview. Set `APP_URL` to the corresponding trusted origin. Apply migrations before publishing the app. Production branch is `main`.

Before launch verify: immediate client signup, bidder creation/default-password login/password change, tenant isolation with two clients, resume download, screenshot upload/application, client correction/reapplication, and admin reporting. Check Vercel runtime logs without logging personal profile fields or file contents. Roll back application deployments through Vercel; database migrations require separately reviewed forward fixes.

Paid templates, scraping, job auto-apply, payroll, and payment transfers are outside this release.
