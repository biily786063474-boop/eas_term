# Excel security audit follow-up — 2026-09-21

This follows the initial audit, not a replacement for its historical evidence.
No advisory is suppressed, database edited, or scanner exit 3 rewritten to success.

## Dependency changes

x/crypto 0.53.0 → 0.56.0 removes SSH advisories 6355/6354/6303 at module level.
Its minimum versions also advance x/net to 0.57.0 and x/text to 0.41.0.
Excelize stays at 2.11.0; do NOT downgrade to the earlier fix commit pseudo-version.
`go mod verify` succeeds. New licenses and hashes are rebuilt into the candidate.

## Why stripped-binary and source reports differ

Installed official govulncheck 1.8.0 source,
`internal/vulncheck/binary.go`, lines 107–112, explicitly falls back to all known
vulnerable symbols at **go.mod-level precision** when PkgSymbols is empty. The
release binaries are built with `-s -w`; extract outputs are retained as evidence.
Therefore a heading saying “Vulnerable symbols found” is not by itself proof those
symbols are linked in this stripped binary. Source import graph contains only
x/crypto/md4 and x/crypto/ripemd160, not SSH or OpenPGP.
A separate non-stripped build is scanned to cross-check this; production build
flags are NOT changed merely to make the scanner look green.

## Excelize finding: finer scope than the initial report

The database reports no known fixed version for GO-2026-6452, but the verified
2.11.0 module's `cell.go` already contains the negative/out-of-range check from
upstream fix 93f0b3caed37f21ef5079e3259c6c21dcfe68453 (2026-06-21).
The fix commit resolves to v2.10.2-0.20260621025955-93f0b3caed37, earlier than 2.11.0.

New real-XLSX regressions inject -1, -2147483648 and 999999 into a valid shared-string
cell. Calling the pinned library directly, WITHOUT our preflight, returns an
invalid-index error (not panic); the production Process path rejects them too.
This proves the **in-memory cell-read path**, not every upstream code path.

Important: upstream `rows.go/getFromStringItem` still lacks an explicit lower-bound
check in its temporary shared-string-file path. Do not broadly claim the whole
library is unaffected. Our engine sets XML spill threshold equal to the complete
expanded archive limit (32 MiB), and preflights indices before OpenReader. Both
protections remain intact. A general-purpose upstream “zero vulnerability” claim
is not justified; this candidate retains a documented security release hold until
all remaining paths/exception scope have been reviewed.

Sources:
- https://pkg.go.dev/vuln/GO-2026-6452
- https://github.com/qax-os/excelize/commit/93f0b3caed37f21ef5079e3259c6c21dcfe68453
- https://pkg.go.dev/vuln/GO-2026-6355
- local checksum-verified golang.org/x/vuln@v1.8.0/internal/vulncheck/binary.go

Candidate is not published; default local plugin remains 1.0.1. GUI Excel refresh,
Windows execution, actual model CLI inference and production delivery are not
covered by dependency regression or an isolated app/shim test.

Observed scan results after upgrade: source and non-stripped macOS arm64 build
report one finding (6452); each of the three stripped binaries reports two
(6452 + OpenPGP 5932). Extracted symbol counts/package names are summarized in
symbol-summary.json, with full original extract files retained. The absence of
OpenPGP in the diagnostic binary corroborates the source import graph; it does
not silently turn the stripped scans' exit 3 into exit 0.

Actual isolated application old→candidate update passed 62 checks again with the
upgraded dependencies. It still tests shim subprocesses, not actual model inference.

## Additional red→green finding while expanding the regression

The first full Process check failed: 999999 was accepted by bulk GetRows even
though direct GetCellValue returns an error. This was NOT counted as success;
original failed output is invalid-index-read-red.txt. Preflight now counts actual
`si` children in the canonical shared-string table and compares the largest cell
index after examining all parts, independent of ZIP entry order. Negative, invalid,
overflow and out-of-table indices are rejected before every read/calculate/update/
chart/pivot operation. Final direct-library + five-operation regressions are in
upstream-regression.txt. Retain the old negative-index guard too.

The post-fix package is `/tmp/eas-excel-plugin-20260921-security3`; security2 scan
results describe the same dependency versions, but its package predates this
additional preflight fix and is not the current candidate. No zero-scan claim.

Final security3 validation: Go 21 top-level tests + vet, 13 Node adapter tests,
three-platform build, real stdio and 62 isolated-app update checks passed. Full
root regression: 3,446 total / 3,428 passed / 18 skipped / zero failures. Final
source scan and all three final distributed-binary scans were repeated after the
upper-bound fix; outputs final-*.txt still report source=1, stripped binaries=2,
exit 3. Remaining findings are documented, not waived or declared clean.

## Temporary SST applicability closure (2026-09-21)

Production `workbookReadOptions()` keeps both expansion limits at 32 MiB.
Pinned Excelize lib.go ReadZipReader rejects cumulative expanded size above
UnzipSizeLimit before considering any individual part for temporary-file spill;
spill requires its size strictly greater than UnzipXMLSizeLimit. A single part
cannot exceed the equal total limit without rejection first. Preflight additionally
checks actual decompressed bytes, and rejects invalid shared-string indices.

`TestProductionOptionsPreventSharedStringSpill` opens a valid 17 MiB SST fixture
with the exact production options and observes zero temporary files. Its positive
control lowers XML threshold to 1 KiB and observes temporary files for the same
fixture, so the negative observation is meaningful. Original output:
`sst-spill-control.txt`. Do not lower the XML threshold independently.

This closes the identified temporary-SST applicability question **for the current
plugin configuration**, not for arbitrary Excelize clients. Existing source and
stripped-binary scan exit 3 findings remain retained; this is not a clean scan or
a claim of general vulnerability absence. OpenPGP applicability remains scoped by
the prior actual import/symbol evidence.

Fresh candidate `/tmp/eas-excel-plugin-20260921-security4`: full Go tests and vet,
Node adapter tests, three target builds, packed stdio and actual isolated app
old-to-new update (62 checks) passed, command exit 0. Evidence:
`sst-final-verification.txt`; configured.png inspected. Cross-platform execution,
real model CLI inference and real Excel workbook acceptance are not implied.
