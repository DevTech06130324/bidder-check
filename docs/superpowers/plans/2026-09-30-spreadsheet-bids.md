# Spreadsheet bid editing and Google Sheets import

Authority: user-approved implementation plan, 2026-09-30.

Build on the shared TanStack bid table with compact gridlines, row numbers, sticky headers, inline text/dropdown editors, keyboard navigation, rectangular mouse/Shift selection, and TSV copy. Selection is copy-only and scoped to a page. Preserve ownership, immutable dates, proof-driven status, locked applied resumes, trash and earnings. Add Yesterday using Chicago calendar boundaries; defer refresh while editing.

Paste creates new bids only through a mapping/preview dialog. One bidder/resume and CT date per batch; admins choose client/bidder/resume, clients own bidder/resume, bidders own resume. Header toggle initially off; map columns to company/role/URL/source/arrangement/job status/Ignore. Shared defaults apply to blank mapped cells; required company/role/HTTP(S) URL. Edit/remove preview rows; fix every error before all-or-nothing import. Limits: 500 rows, 512 KiB clipboard. Handle quoted TSV, newlines, Unicode and empty cells without executing formulas/HTML. Detect duplicates including trash. Today uses actual server time; past imports use chosen CT midnight; created_at retains real time; future dates rejected. Successful imports are shown using their date/bidder/resume filters.

Backend: version-checked allowlisted cell RPC, structured errors/current row on conflicts, actor-scoped import receipts with payload binding and transactional retry-safe creation. Keep historical timestamps exclusive to import RPC. Audit mutations. Validate ownership and input again inside database.

Tasks:
1. Clipboard/mapping/date domain logic with tests.
2. Database RPCs, receipts, typed actions and regression tests.
3. Grid interactions and import UI, shared-page integration and browser tests.
4. Fresh whole-branch review, full checks, hosted staging journey, production release and smoke checks.

Verification: lint/typecheck/unit/database/browser/build; pasted Sheets values, mixed mapping, limits, rollback/duplicates/retries, permissions, stale edits, DST, selection/copy/navigation/mobile, unchanged screenshots and earnings. Staging before production.

Ruling: use the clean shared checkout on an isolated feature branch, preserving existing dependencies and deployment configuration. Release is already authorized by the user; no repeated approval prompts.
