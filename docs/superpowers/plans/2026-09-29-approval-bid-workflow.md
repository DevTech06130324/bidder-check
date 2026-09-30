# Approval, account management, and bid workflow

Approved implementation scope: pending public client registration; admin approval/rejection; account create/edit/archive/restore and confirmed password resets without email; client-to-bidder hierarchy; recoverable bid trash; server-owned timestamps displayed in Chicago time; atomic screenshot-driven application and replacement; expanded daily bid table; reporting exclusions; full automated and hosted staging verification before production release.

Rules: existing clients remain approved. Admin-created clients are approved. Archived parents block descendants. Never trust signup metadata for permissions. Bidder ownership is fixed. Default/reset managed password is `123456`. Preserve first application earning date and rate, reject rejected proof hashes, lock resume after application, retain duplicate URL protection through trash. Only managers correct applied status with a reason.

Sequence:
1. Database migrations, authorization, audit and regression tests.
2. Approval routing, account management and hierarchy.
3. Atomic verified uploads, immutable Found date, screenshot replacement.
4. Chicago daily table, private previews, trash and restore.
5. Reporting, tests, documentation, branch review, staging and production release.

Verification: lint, generated types/typecheck, unit/database tests, browser tests, production build; hosted staging approval/account/file/earnings workflows; production access and routing checks.

Execution ruling: use the clean shared checkout on isolated branch `codex/approval-bid-workflow`; preserve the existing environment and installed dependencies. No edits to previously applied migrations. No SMTP. No new user approval is required for the already approved release sequence.
