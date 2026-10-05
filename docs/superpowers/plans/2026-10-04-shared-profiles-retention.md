# Shared profiles, bid restrictions, and retention

## Brief

Implement the approved design in the conversation dated 2026-10-04. Candidate details belong to a client-owned shared profile; bidder-specific contact details, PDF, and rate override belong to each assignment. Preserve workspaces/accounts, reset all existing resume, bid, evidence, and earnings/history data at production cutover as explicitly authorized. Add profile-wide duplicate/company/substring restrictions, row-level single-bid feedback, a review-and-import-allowed-rows spreadsheet flow, and automatic CT calendar-month retention with transactional daily count/earnings aggregation and durable private-file cleanup.

## Global constraints

- Never expose another bidder's assignment contact fields or PDF. All profile, assignment, bid, settings, history, and aggregate reads/writes stay within the actor's authorized workspace; admins may manage all workspaces.
- Database RPCs enforce ownership, shared-profile matching, rules, counts, uniqueness, and transaction boundaries. Client validation is explanatory only.
- Expand schema first; retain compatibility until the new application is deployed. Do not reset production before staging end-to-end verification.
- Retention preserves CT daily counts and qualifying earnings only. No job/company/title/link/evidence details survive automatic deletion.
- Storage object removal is durable and retryable; SQL deletion is not proof of physical object deletion.
- Preserve the existing bidder-visibility fix and all unrelated working-tree changes.
- Production reset remains within the explicit approval in the user's reset requirements and is only run after staging passes.

## Tasks

### Task 1 — Shared profile schema and authorization

**Produces:** additive migration, generated database types, DB tests for shared profile/assignment relationships and isolation.

1. Write failing PGlite tests for a profile shared by two bidders, one assignment per bidder/profile, manager ownership, and bidder isolation of peer assignments.
2. Add candidate profiles, profile restrictions, assignment `profile_id`, uniqueness/foreign-key constraints, policies, and narrowly scoped create/update/archive RPCs. Retain legacy resume fields for rollout compatibility.
3. Run DB tests and full unit suite; generate types and typecheck. Apply only to isolated staging after review.

**Expected:** tests prove shared profile reads while blocking cross-workspace writes and peer contact/PDF reads.

### Task 2 — Profile and assignment experience

**Produces:** Profiles navigation/page, shared profile CRUD/settings form, assignment create/edit with required email/phone/PDF, assignment-scoped file signing, bidder read-only rendering.

1. Write failing component/browser tests for profile creation/edit, multiple assignments, bidder read-only scope, and required private PDF.
2. Add workspace data loading and typed actions/RPC calls; reshape resume library and assignment form around shared profile details.
3. Run focused browser tests, full browser suite, lint, and typecheck.

**Expected:** client/admin manages shared details once; each authorized bidder sees only their assigned profile, own contact details, and own PDF.

### Task 3 — Profile-wide restrictions and reviewed bulk import

**Produces:** normalized policy validator, typed single-bid feedback, batch validation/review/import RPCs and UI.

1. Write failing domain and DB tests for literal case-insensitive substring checks, normalized identity, profile-wide duplicate rules, company limits, trash, within-batch reservations, stale review, and concurrent submissions.
2. Implement one database rule path used by save/edit/import; serialize writes per profile and provide stable reason codes without peer identity leakage.
3. Change import preview to retain source rows and show allowed/blocked reasons; allow corrections/removal and explicitly import the currently allowed subset atomically. Revalidate and return a fresh review if rules changed.
4. Run sheet/domain/database/browser suites, lint, and typecheck.

**Expected:** prohibited rows never persist; valid rows import once; changed concurrent state produces an updated review without partial writes.

### Task 4 — Retention aggregates and durable cleanup

**Produces:** minimal daily rollup table, bounded retention RPC/worker, scheduler route, dashboard/earnings aggregation, retention confirmation UI.

1. Write failing DB/domain tests for Chicago month subtraction, end-of-month/DST, latest-applied eligibility, unapplied/trash behavior, transactional aggregation/deletion, and idempotent reruns.
2. Implement policy preview counts and explicit confirmation when enabling/shortening retention; process eligible batches with row locks, transactional rollup, bid/event/file metadata deletion, and durable Storage tasks. Extend cleanup kind so screenshot and expired assignment PDFs can be removed safely.
3. Add authenticated scheduled route and staging schedule; report database deletion separately from pending Storage cleanup.
4. Update reporting reads to combine retained bids and historical aggregates once, preserving Found-date counts and first-applied earnings attribution.
5. Run DB/domain tests and a synthetic staging lifecycle including injected Storage failure and retry.

**Expected:** repeated retention runs do not double count; expired application details and files are removed while daily totals and earnings remain exact.

### Task 5 — Staging reset rehearsal, production reset, release

**Produces:** guarded reset script with exact preflight counts, operator log, production release, and post-release verification.

1. Add failing tests for reset scope before implementing it. Reset preserves profiles/auth users, bidder memberships, workspaces, account preferences, minimal replay receipts, and removes existing resumes, bids, events, earnings contributions, screenshot/resume objects, and stale cleanup metadata safely.
2. Rehearse against staging; verify retained accounts and empty assignment/bid state, physical object absence using explicit Storage not-found responses, clean signup/profile assignment, restrictions/import, and real-delay retention.
3. Before production execution, query and record exact target counts; require the script's production project guard and an explicit runtime confirmation token. Pause application writes and conflicting jobs, run the transaction, drain/verifiably retry Storage cleanup, then deploy/re-enable writes.
4. Verify admin/client/bidder routes and access, new profile/assignment creation, restrictions, bulk review, dashboard/earnings, and scheduler status. Never report cleanup complete if objects remain pending.
5. Run full verification, request final independent code review, address blocking findings, document deployment and reset counts without PII.

**Expected:** staging rehearsal passes before any production deletion; production contains no old resumes/bids or their files/history, while users/workspaces/settings remain available.

## Interfaces

- Candidate profile CRUD and restriction settings are separate from resume-assignment CRUD.
- Assignment input contains profile ID, bidder ID, email, phone, PDF file reference, and optional rate override.
- Bid validation returns row/field/reason code/message; import commit includes the reviewed allowed rows and actor-scoped request ID.
- Retention status reports eligible/deleted application counts and Storage cleanup state separately.
- Historical reporting reads daily aggregates keyed by CT date, workspace, profile, bidder, and assignment.

## Review focus

Tenant isolation for shared and assignment fields; RLS bypasses in security-definer RPCs; race conditions in duplicate/cap checks and import/retention; no PII in aggregates or deletion logs; proof replacement versus retention clock and earnings date; reset project guards, retry/idempotency, and physical Storage verification.
