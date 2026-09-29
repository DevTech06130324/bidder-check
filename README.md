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

Apply `supabase/migrations/202609290001_platform.sql` to a **new/empty project** using the Supabase CLI (`supabase login`, `supabase link --project-ref YOUR_REF`, `supabase db push`) or SQL editor. The supplied production project ref is `aizorlyfggwbewetnwqm`. Inspect an existing database before applying this initial migration. Never apply production migrations as part of the Vercel build.

Enable email confirmation and configure custom SMTP (default deployment choice: Resend with a verified sender domain). Set Site URL to the deployed app origin and allowlist `/auth/confirm` and `/auth/callback` for production, staging and localhost as appropriate. Each preview must use staging Supabase credentials, never production.

Customize the Supabase email templates to use these links. `.SiteURL` must match the app environment:

```html
<!-- Confirm signup -->
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup"
  >Confirm email</a
>
<!-- Invite user -->
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite"
  >Accept invitation</a
>
<!-- Reset password -->
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery"
  >Reset password</a
>
```

Client registrations create their own workspace. Bidder invitations are reserved in the database before Auth sends the email; database ownership records, not editable user metadata, determine their role. An email cannot belong to more than one client or role. Users removed from the workspace are archived, preserving history. New accounts in Auth must be created after the migration is installed.

Register and verify `david.chan.mdev@gmail.com`, then run:

```sh
npm run admin:bootstrap -- david.chan.mdev@gmail.com
```

The script refuses unknown, unverified, and bidder accounts. It does not use a first-user administrator shortcut.

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

Database tests execute the actual migration in PGlite PostgreSQL with test equivalents of Supabase's Auth and Storage schemas and `auth.uid()`. They exercise RLS with an `authenticated` database role. This does not simulate Supabase Auth email delivery or the hosted Storage HTTP service. Those require a staging end-to-end smoke test.

Browser tests exercise real authentication pages and the workspace components using synthetic fixtures in an isolated Vite server (`tests/preview`). Fixture mutation handlers deliberately refuse writes. This verifies layout, filters, navigation, theme changes and accessibility; it does not replace a hosted authenticated workflow test. The production app never serves these fixtures. On restricted Windows hosts, browser tests may need permission to stop their own server processes.

`node scripts/generate-types.mjs` generates TypeScript types from the executable migration without Docker. After a local Supabase startup, `npm run db:types` can regenerate from the live schema.

## Vercel

Import `DevTech06130324/bidder-check`, select Next.js, root `./`, build `npm run build`, default output directory, Node 22. Add the four environment variables separately to Production and Preview. Use isolated staging Supabase for Preview. Set `APP_URL` to the corresponding trusted origin. Apply migrations before publishing the app. Production branch is `main`.

Before launch verify: client confirmation, bidder invitation/password setup, tenant isolation with two clients, resume download, screenshot upload/application, client correction/reapplication, and admin reporting. Check Vercel runtime logs without logging personal profile fields or file contents. Roll back application deployments through Vercel; database migrations require separately reviewed forward fixes.

Paid templates, scraping, job auto-apply, payroll, and payment transfers are outside this release.
