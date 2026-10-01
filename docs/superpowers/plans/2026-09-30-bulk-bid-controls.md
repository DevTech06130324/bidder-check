# Bulk actions and cleaner table controls

Authority: user-approved plan in conversation, 2026-09-30. Base5bb9350.

Group page-heading action pairs; add independent checkbox selection across pages (current-page header toggle, clear on filter/sort/date/view changes, max500 selected). Bulk trash/restore all-or-nothing with row versions and existing role scope. Admin/client permanent selected deletion and Empty trash ignore table filters but honor role and embedded bidder scope. Confirmation type DELETE against an actor-bound 10-minute ID/version snapshot; repeat confirmation returns original result; reject changed snapshots. Remove bids/history/all associated screenshot file records atomically, queue physical Storage cleanup with immediate attempts, delayed verification, bounded retries and CRON_SECRET-protected daily cron. Preserve resumes, unrelated files, earnings semantics. Retain minimal audit and hash-only import receipts; old imports cannot resurrect deleted records.

Remove Default company/role/jobsite and header checkbox. Treat all pasted rows as data; keep Remote/Open defaults and all existing mapping/preview/limits. Stable refresh spinner in reserved space; retain rows/errors/drafts, skeleton initial only. All changes on shared Dashboard/Bids/Bidder Details.

Tasks: 1 backend regression tests/migration/actions/cleanup. 2 table controls and simplified import with browser tests. 3 fresh whole-branch review and full verification. 4 additive staging migrations, synthetic destructive workflows, production release/access smoke without purging customer data.
