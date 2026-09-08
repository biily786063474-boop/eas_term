# Windows Diagnostic Build Implementation Plan

> Execute sequentially with superpowers:executing-plans; user-approved single-agent work.

**Goal:** Deliver a private Windows diagnostic NSIS installer with consent-based report upload.
**Architecture:** An isolated diagnostic build collects only structured allowlisted data, uses a bounded local journal, and sends user-approved gzip reports to a separate loopback receiver behind the existing HTTPS host.
**Tech Stack:** Electron / TypeScript / Node test runner / Python 3.6-compatible HTTP service / Windows Actions.
**Spec:** ../specs/2026-09-08-windows-diagnostic-build-design.md (user approved 2026-09-08).

## Constraints
No website/Release/update publication; isolated appId/name/userData; no conversation, terminal, credential or raw path capture. Local journal <=10 MiB; report <=1 MiB raw/256 KiB compressed; server <=100 MiB and 14-day retention. Confirm every upload. Do not alter existing dirty work.

## Tasks
- [x] 1. Baseline: freeze v0.4.85 in isolated worktree, run existing tests; preserve evidence.
- [x] 2. Write failing tests in src/main/diagnostics/core.test.ts for allowlist, exception scrubbing, rotation, lifecycle and report limits; implement core.ts and journal.ts. Run focused tests.
- [x] 3. Write receiver tests in deploy/diagnostics/test_receiver.py for validation, gzip bounds, duplicates, retention and cap; implement receiver.py and restricted systemd/nginx deployment assets. Run Python tests.
- [x] 4. Add tested transport.ts (timeout, response bounds, no redirects, identical retries); integrate main diagnostics/index.ts with index.ts, agentChat/session.ts, omp/launch.ts and pty.ts. Add preload bridge and settings entry reusing native confirmation UI. Test stage wiring and rejection without upload. Export only to a main-owned userData path.
- [x] 5. Add diagnostic-only build identity and disable updater/anonymous telemetry for that identity; add private branch Windows workflow that cannot publish. Add CI verification script for startup marker, cancel/confirm, export, structured events. Run typecheck, full tests, build and real UI verification.
- [x] 6. Deploy isolated receiver only after reviewing host state and existing config; back up exact vhost, validate nginx -t, compare sites before/after, use synthetic report to verify retrieval. Record rollback instructions.
- [x] 7. Push diagnostic branch only, use Windows CI (no tag/main push), retrieve artifact exe and SHA256, record test limits and deliver local installer path.

Every implementation task starts with failing tests. Update architecture 01/10/13 with source changes. Do not mark completed until actual runtime/CI evidence exists. Production receiver credentials never enter files or chat.
