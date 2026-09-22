# WPS real acceptance — pending

User explicitly requested WPS desktop acceptance on 2026-09-21.
No WPS MCP or installed WPS found in application inventory, application directories or Spotlight.
Official page https://mac.wps.cn/ links to:
https://package.mac.wpscdn.cn/mac_wps_pkg/wps_installer/WPS_Office_Installer.zip
Downloaded to ~/Downloads/Eas-Term-WPS-verification/; session 99441 exited 0.
Installer passes codesign --verify --deep --strict and spctl: accepted, Notarized Developer ID, Zhuhai Kingsoft Office Software Co.,Ltd (YK4WKE5WAM).
CUA opened installer; license/privacy checkbox remains unchecked. User action-time confirmation requested via question card. Installation has NOT started.

Pending checks using a copy of native-acceptance.xlsx:
1. Open without repair warning; Data!E2 = 60.
2. Both chart series visible, Chinese and ampersand legends intact.
3. Refresh pivot: East 40, West 20, total 60.
4. Save locally, close and reopen; retain values and objects.
5. Real native candidate MCP reads WPS-saved file, updates source, recalculates and preserves chart/pivot. Do not weaken safety guards for compatibility.
None of these desktop checks has passed yet. Official compatibility marketing is not evidence.

2026-09-22: User explicitly confirmed EULA/privacy and installation. CUA checked agreement and started installer; subsequent official installer reports latest WPS already installed. /Applications/wpsoffice.app exists and actual WPS home opened. Initially dismissed account window; WPS custom file-dialog input did not work (clipboard timeout), so cancelled it and used Finder Open With for the exact test copy. Finder showed WPS already the default association; agent did not request changing it. Opening wps-roundtrip.xlsx presents account-login QR window again. User is asked to complete native login; no workbook grid/formula/chart/pivot yet verified. No purchase or password collection. Original native-acceptance.xlsx preserved; wps-roundtrip.xlsx is test copy.

## Real WPS acceptance outcome — 2026-09-22

Actual WPS 12.1.28496 macOS arm64 UI was operated through CUA after user login.
- Opened original candidate-generated test copy without a repair warning.
- Data E2 formula bar showed =SUM(B2:B4), grid displayed 60.
- Charts displayed two column series with Chinese/ampersand labels intact.
- Pivot displayed East 40 / West 20 / total 60, native field panel present.
- Saved in WPS and closed. Real candidate MCP read the saved file and calculated 60.
- Updated B2 from 10 to 40 through native MCP. WPS reopened with chart 40/20/30 and pivot East70/West20/total90, but formula E2 incorrectly displayed stale60.

This was a genuine failed acceptance, not waived. cache-diagnosis.txt shows WPS added a cached <v>60</v>; update retained it with unchanged calcId. cache-red.txt reproduces the bug through the real WPS-saved fixture. Failed workbook is preserved separately.

Fix: after update, invalidate all formula caches using the pinned library's UpdateLinkedValue, restore calculation properties and set FullCalcOnLoad/ForceFullCalc. No manual formula result was written and no file safety guard was weakened.

Candidate /tmp/eas-excel-plugin-20260922-wps1 rebuilt all targets. Go tests/vet, packed stdio, actual isolated application upgrade passed (session37219 exit0); cache-fix-regression.txt. Intel/Windows execution still unverified.

Same WPS-saved input was copied as wps-fixed.xlsx and updated through the new candidate MCP. Actual WPS screenshots in conversation show:
- Pivot East70/West20/total90 on reopen.
- Data E2 =SUM(B2:B4) now displays90, matching source40/20/30.
- Both chart series and Chinese labels retained, amount bars40/20/30.
- WPS save/close, native readback returns cachedResult90 plus pivot70/20/90 (wps-fixed-readback.json).
- Final explicit Finder path open of wps-fixed.xlsx again shows E2 formula and90.

One intermediate reopen targeted the old wps-roundtrip.xlsx, NOT the fixed file; its observation was excluded. Exact filename was reselected and verified before final conclusion.

Scope: this local WPS fixture's create/read/update/formula/chart/pivot and save/reopen interoperability passed after the fix. Not proof of every XLSX feature, every formula, older WPS versions, Microsoft Excel GUI, Windows, actual model inference, or publication. Pivot value-field caption was blank in this fixture although its totals and native field mapping were correct; caption UX remains a follow-up, not hidden by this pass.
