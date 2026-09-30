# Bidder Check implementation ledger

Authority: the user-approved implementation plan in this conversation, 2026-09-28.

## Sequence

- [x] Foundation and authentication
- [x] Tenant security and management
- [x] Resume management
- [x] Bid workflow
- [x] Dashboard and earnings
- [x] Local verification (20 unit/database tests; 14 desktop/mobile browser tests; lint, typecheck and production build)
- [x] Initial production/staging migrations, admin bootstrap and Vercel deployment
- [x] Direct-account update: eight hosted workflow checks passed; production release ready

## Decisions and evidence

- Empty repository; no baseline tests or existing user files. Feature branch created in the existing workspace because there is no initial commit to base a linked worktree on.
- Public signup is always client; database invitation lookup alone provisions bidder roles.
- Shared interfaces: auth profiles -> workspace access -> resumes -> bids -> earnings. Ownership and financial transitions are enforced in PostgreSQL, not inferred from UI visibility.
- Missing deployment credentials will be reported precisely; local implementation continues independently.
- Ruling: privileged file finalization is required in addition to Auth administration. The server downloads bytes using the caller's JWT, validates the signature/size, then records SHA-256 through a service-only function. An authenticated client must never be able to assert its own content hash. Cost: verified uploads also require the server secret.
- Ruling: Docker is installed but its daemon is unavailable. Database tests execute the real migration in PGlite with Supabase Auth/Storage schema equivalents. Cost: hosted email delivery, Storage HTTP behavior and multi-connection PostgreSQL concurrency still require staging smoke tests.
- Ruling: component browser tests use a separate Vite fixture application, never a production demo/auth bypass. Cost: these verify UI behavior, not live authenticated Supabase workflows.
- Pinned TanStack Table to version 8 and Zod to version 4 to match the implemented APIs. Node 22 is pinned for deployment and available through the local dev dependency.
- Independent review found four issues, all fixed with regression coverage: premature invitation acceptance/resend failure; cross-workspace reservation race (email advisory lock plus ownership-guarded upsert); raw RPC URL canonicalization bypass; browser/server timezone mismatch.
- Browser accessibility tests exposed insufficient muted-text/avatar contrast; tokens were corrected. Playwright's test teardown requires unsandboxed process cleanup on this Windows host; the completed run exited successfully with 14/14 tests passing.
- Deployment access supplied: initial schema installed in production and isolated staging, all eight application tables have RLS, and storage is private. Production is https://bidder-check.vercel.app; staging is https://bidder-check-staging.vercel.app.
- Designated initial administrator: david.chan.mdev@gmail.com. Bootstrap requires an existing verified account; no password is generated or committed.
- Reviewer deferred hosted Auth/email, Storage HTTP, deployment configuration, production concurrency/performance, and screenshot semantic authenticity. Ruling: staging verifies hosted integrations; screenshots are checked for actual bytes, file signature and exact rejected-content reuse, not semantic proof of a real application.
- User revised onboarding: no SMTP, no bidder invitations, initial bidder password `123456`, and immediate client signup without email verification. Settings supports password changes. Password recovery guidance refers users to their manager/administrator.
- Hosted testing discovered that bidders could unapply their own bids. Migration 002 now requires manager authorization and a correction reason; the bidder UI hides that control. Regression tests fail before the fix and pass after it.
- Migration 003 provisions bidders using a manager-reserved UUID passed through server-only Auth `createUser(id)`. Supabase applies custom app metadata after inserting the user, so trigger authorization cannot depend on it. Public signup cannot select an Auth ID or use editable metadata to claim a reservation.
- Follow-up security review found no blocker in the new account flow. Production has zero legacy unconfirmed bidder accounts, so the old invitation conversion concern does not apply.
- Full hosted Playwright journey passed on Vercel staging (2026-09-29): immediate signup; direct bidder creation/default-password login/password change; private resume upload/download; invalid screenshot rejection; screenshot application; direct HTTP tenant/storage/role restrictions; correction/new proof/original rate/concurrent retry behavior; earnings and archival. Synthetic users/files were removed afterward. Local report: `test-results/hosted-smoke.json` (ignored).
- Production migrations 001–003 and immediate-signup configuration applied successfully. Git commit `ffd5474` is deployed READY in both environments; production deployment `dpl_4rJ8zXEdvLHPVYx72AkmES2sRcKF`. Local CLI uploads encountered connection timeouts, so release used the existing GitHub integration. No SMTP setup is required.

## Approval and daily workflow update ? 2026-09-29

- Implemented migrations 004?006: approval state, tenant restrictions, account audit, transactional email synchronization, recoverable bid trash, immutable Found time, and atomic verified screenshot application.
- Existing clients remain approved; public clients start pending. Account editing, approval/rejection, reset confirmation and Client ? Bidders hierarchy are available in Users.
- Chicago Today / All / Custom table query is independent of reporting. Expanded columns include signed visible-row previews and inline screenshot upload. Trash is excluded from reporting and keeps evidence/history for restoration.
- Review identified stale account reservations after email changes. Reproduced in PostgreSQL tests; migration 006 moves the reservation with its Auth account. Browser tests identified a TanStack render loop; memoized filtered rows resolve it.
- Final local verification: 32 unit/database tests, 16 desktop/mobile browser tests, lint/type checking and production build passed. Hosted staging passed all 13 checkpoints and cleaned its generated data. See docs/deployment.md for release identifiers.
