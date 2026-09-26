# Pre-release Report Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explicit HTML report publication and preview path-safe on macOS and Windows, then prepare the next release metadata without publishing.

**Architecture:** Keep the renderer's project containment check but move its string normalization into a tested cross-platform pure helper. Emit canonical file URLs, and let the main process decode file URLs with Node's `fileURLToPath` before its existing realpath authorization. Preserve existing macOS behavior and all fsGuard boundaries.

**Tech Stack:** TypeScript, Electron IPC, Node test runner, existing release scripts.

**Spec:** `docs/superpowers/specs/2026-09-25-live-page-report-split-design.md`

## Global Constraints
- Do not change `fsGuard` policy or main registration order.
- Keep ordinary `canvas_open_html` behavior unchanged except correct Windows path handling.
- No tag, notarized distribution, upload, or website update in this task.
- Architecture map changes ship with code in the same commit.

## Review Focus
1. Windows `C:\\project\\report.html` and `C:/project/report.html` both remain within their project and generate `file:///C:/...`.
2. A different drive, sibling prefix, `..`, and UNC escape are rejected before any file read.
3. File URLs with spaces, Chinese characters, `#` or `?` decode to the intended path.
4. A project-external symlink remains rejected by the main-process validator.
5. macOS absolute and relative project paths retain current behavior.

## Task 1 — Cross-platform renderer paths
- [x] Add failing unit tests for path containment and file URL encoding, including Windows drive, UNC, traversal, sibling prefix and macOS paths.
- [x] Implement a pure helper; use it from `mcpHandler.safePath` and `store/shared.fileUrlOf` without changing default artifact actions.
- [x] Run focused tests and typecheck.

## Task 2 — Main-process report URL validation
- [x] Add a failing test for converting canonical file URLs back to native paths on Windows and macOS.
- [x] Change `ReportPreview` and manual report selection to pass URL rather than decode `URL.pathname`; main `fs:validateReport` uses `fileURLToPath` and keeps `guardPath`/`guardDir`/realpath containment.
- [x] Retain the existing project-external symlink case; run full check, build and isolated Mac feature test.

## Task 3 — Release metadata and final gate
- [x] Bump `package.json` / lockfile to the next version and add user-facing `CHANGELOG.md` entry with known limitations.
- [x] Run changelog check, build, full check, clean source inspection, and review diff.
- [x] Record successful notary profile read-only check (`eas-notary` and `aurora-notary` available); do not run public notarization or publish until a separate release instruction.

**Remaining release gate:** Run the new path tests and packaged feature test on Windows CI for this branch, then merge and repeat checks on latest `main`.
