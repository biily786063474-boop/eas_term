# Excel engineering and update acceptance — 2026-09-21

## Scope and release gate

Candidate only; default local store remains Excel 1.0.1. Production application,
public registry and CDN unchanged. Native candidate built at
`/tmp/eas-excel-plugin-20260921-audited` with qualified Go 1.26.8, Excelize 2.11.0,
x/text upgraded to 0.39.0. Three platform binaries built, only macOS arm64 executed.
**Security audit is not clean. Do not publish this candidate.**

## Security evidence

Official govulncheck 1.8.0, database timestamp in scanner.txt.
Initial source audit found two reachable reports (original output retained):
- https://pkg.go.dev/vuln/GO-2026-5970 — x/text invalid-input loop. Upgrade 0.38.0 → 0.39.0 removes this source finding.
- https://pkg.go.dev/vuln/GO-2026-6452 — Excelize negative shared-string index panic; report lists no fixed version. XML preflight now rejects negative, overflowing, nonnumeric shared-string indices before the engine opens the workbook, including entity-encoded negatives. Five red cases then green; this is a local mitigation, **not an upstream fix or a zero-vulnerability scan**.

Final source scan exits 3 with one reachable report (6452); four additional
module reports have no source-reachable call paths in this program. Binary scans
of the stripped distributed binaries report five findings across Excelize and
x/crypto (6355, 6354, 6303, 5932). Keep those outputs verbatim; do not suppress or
assert they are false positives. Source and binary findings differ; release
requires resolving/documenting binary reachability and remaining upstream risk.
The engine exposes neither SSH nor OpenPGP APIs, but that alone is not proof of
an unaffected binary. Watchdog and preflight are containment, not an OS sandbox.

## Functional verification

- Node package/connector/worker tests: 13 passed.
- Go preflight and engine tests + vet passed; actual stdio candidate verifier passed.
- Actual isolated application update verifier: 62 checks passed, same application process.
  Installed real 1.0.1, configured via native-dialog adapter and real safeStorage,
  connected real old three-tool host, refused replacement while host active,
  stopped that isolated host by vault lock, rejected corrupt candidate hash,
  updated via market confirmation to native 1.1.0, preserved credential bytes,
  ran six tools through Claude/Codex/OMP shim subprocesses, revoked/re-authorized.
- `verify-excel-update-rollback.mjs`: production replacement function, complete real
  old/new Excel trees, injected rename failure **after moving old tree**. Every old
  file hash restored and temporary trees cleaned; subsequent retry succeeded.
  This is filesystem fault injection, not application-process crash recovery.
- Initial UI verifier timeouts were fixture races: clicking refresh-disabled update
  button, then toggling an already-open configuration panel closed. Fixed verifier
  waits for enabled button and only opens a closed panel; no product guard weakened.
- Configured screenshot inspected: six tools and retained folder authorization.

No actual model CLI inference, Windows execution, Excel GUI refresh/rendering,
production HTTPS/CDN deployment, power-loss recovery or signing verification.

Final full regression: `npm run check` exit 0; 3,446 tests total, 3,428 passed,
18 skipped, zero failures. Full output retained in full-check.txt.
