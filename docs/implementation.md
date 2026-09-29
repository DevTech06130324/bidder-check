# Bidder Check implementation ledger

Authority: the user-approved implementation plan in this conversation, 2026-09-28.

## Sequence

- [x] Foundation and authentication
- [x] Tenant security and management
- [x] Resume management
- [x] Bid workflow
- [x] Dashboard and earnings
- [x] Local verification (19 unit/database tests; 14 desktop/mobile browser tests; lint, typecheck and production build)
- [ ] Hosted migration, SMTP configuration, admin bootstrap and Vercel deployment (credentials required)

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
- Read-only hosted check: supplied Supabase endpoint is reachable, but `public.profiles` is absent (PGRST205). Supabase CLI lacks an access token and Vercel CLI is logged out. No hosted resources were mutated.
- Designated initial administrator: david.chan.mdev@gmail.com. Bootstrap requires an existing verified account; no password is generated or committed.
- Reviewer deferred hosted Auth/email, Storage HTTP, deployment configuration, production concurrency/performance, and screenshot semantic authenticity. Ruling: staging verifies hosted integrations; screenshots are checked for actual bytes, file signature and exact rejected-content reuse, not semantic proof of a real application.
