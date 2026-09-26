# Live Page × Report Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A same-session explicit HTML report submission joins the existing live development preview in a two-row workspace, with independent in-app immersive maximize.

**Architecture:** Keep the live browser session and its loopback-only policy unchanged. Add a semantic MCP report submission that reuses existing file authorization and Frame artifact logic but does not force canvas mode; associate the resulting node with its owning AI leaf in an ephemeral renderer store. Render the validated report in the existing live-page surfaces, without deriving meaning from LLM reply text.

**Tech Stack:** Electron, React, Zustand, TypeScript, CSS, Node test runner, existing MCP gateway.

**Spec:** `docs/superpowers/specs/2026-09-25-live-page-report-split-design.md`

## Global Constraints

- Development preview remains loopback HTTP(S) only; report HTML remains an authorized project file. Never pass a `file://` report to `page_live_open`.
- Ordinary `canvas_open_html` retains its current canvas-navigation behavior. Only the explicit report tool and manual node action create a report association.
- Do not parse Claude/Codex/OMP reply text, filenames or HTML titles to infer report identity. Do not inject a long or plugin-specific default prompt.
- Do not modify `fsGuard` policy or `src/main/index.ts` registration order; update architecture maps in the same code commit.
- UI completion requires `npm run build`, full `npm run check`, and isolated application visual interaction via `open-app-verify`.

## Review Focus

1. Stale `agentLeafId` after an awaited file probe must reject, not attach another Frame's report — Task 2 test.
2. `canvas_open_html` and ordinary files must not enter dual view — Task 2 and Task 3 tests.
3. A second leaf's report must never appear under the first leaf's live page — Task 3 test.
4. Esc must exit only the currently maximized live/report region, not another overlay or pane maximization — Task 4 test.
5. Closing a report node or live session must remove the dual view without deleting the report file — Task 3 and Task 4 tests.

---

## File and Interface Map

| Unit | Responsibility |
|---|---|
| `mcp/workbench-tools.json`, `src/main/workbenchSchema.test.ts` | Common three-CLI report submission contract and schema assertions. |
| `src/renderer/src/features/canvas/openArtifact.ts`, `src/renderer/src/store/canvasSlice.ts`, `store/canvas/types.ts` | Add explicit `switchView`/`focus` options; `addWebNode` currently focuses unconditionally, so its opt-out must be wired through while preserving defaults. |
| `src/renderer/src/mcpHandler.ts` | Reuse guarded HTML submission; require same-session leaf identity for semantic report; publish association only after successful artifact creation. |
| `src/renderer/src/features/livePage/reportAssociation.ts`, `.test.ts` | Ephemeral leaf→report association, node existence reconciliation, manual marking. |
| `src/renderer/src/features/livePage/LivePagePanel.tsx`, `livePage.css` | Shared split/inline two-row composition, report preview, maximize and return controls. |
| `src/main/capabilityGuidance.ts`, `resources/plugins/eas-capabilities/guidance/canvas.md` | One short trigger rule, no duplicate long-lived instructions. |
| `docs/architecture/10-模块领地图.md` | New ownership and lifecycle notes. |

### Task 1: Semantic MCP contract and concise guidance

**Files:** Modify `mcp/workbench-tools.json`, `src/main/workbenchSchema.test.ts`, `src/main/capabilityGuidance.ts`, `src/main/capabilityGuidance.test.ts`, `resources/plugins/eas-capabilities/guidance/canvas.md`.

**Interfaces:** Produces tool name `canvas_publish_report`, input schema `{path:string}`, annotations `{readOnlyHint:false,destructiveHint:true,openWorldHint:true}`. Existing `canvas_open_html` is unchanged.

- [ ] **Step 1:** Add a failing schema test asserting the new tool exists exactly once with required string `path`, and that catalog count increases from 45 to 46. Add a failing guidance test asserting one `canvas_publish_report` trigger sentence and no unconditional `page_live_open` for reports.
- [ ] **Step 2:** Run `node --test src/main/workbenchSchema.test.ts src/main/capabilityGuidance.test.ts`; confirm the new assertions fail for missing tool/guidance.
- [ ] **Step 3:** Add the tool next to `canvas_open_html`; describe it as “本次产出的供用户阅读的本地 HTML 汇报页”, not a classifier. Add one short line to `buildCapabilityGuidance` only when workbench is enabled; update `canvas.md` to distinguish report from ordinary HTML and preserve submission-before-final rule.
- [ ] **Step 4:** Re-run targeted tests; inspect generated managed guidance and tool catalog for exact name, one trigger, and no duplicated long body.
- [ ] **Step 5:** Commit `feat: define explicit report publication tool`.

### Task 2: Authorized submission without view hijack

**Files:** Modify `src/renderer/src/features/canvas/openArtifact.ts`, `src/renderer/src/store/canvasSlice.ts`, `src/renderer/src/store/canvas/types.ts`, `src/renderer/src/mcpHandler.ts`; create `src/renderer/src/features/canvas/openArtifact.test.mjs`, `src/renderer/src/features/livePage/reportAssociation.ts`, `src/renderer/src/features/livePage/reportAssociation.test.ts`.

**Interfaces:** `openArtifact(frameId,pane,options?:{switchView?:boolean;focus?:boolean})` defaults both flags to true. `addWebNode(frameId,url,options?:{focus?:boolean})` defaults focus to true and passes the opt-out through the canvas store type. `publishReport({leafId,frameId,nodeId,path})` records only a validated submission. `reportForLeaf(leafId,frames)` returns an association only when that node still exists in that Frame with the same normalized file URL.

- [ ] **Step 1:** Write red tests for default `openArtifact` behavior, `{switchView:false,focus:false}`, same-file reuse, association scope and disappearance when the node is removed. Add a handler test or isolated harness case for stale `agentLeafId` after `probePaths` and ordinary `canvas_open_html` not publishing.
- [ ] **Step 2:** Run targeted tests and record expected failures before changing production code.
- [ ] **Step 3:** In `mcpHandler`, share the guarded HTML path between both tools: `safePath`, `probePaths`, `isDir` rejection, second `resolveFrame(ctx)` check. Require `ctx.agentLeafId` for automatic association; call `openArtifact(...,{switchView:false,focus:false})` only for the report tool, then publish association and return `nodeId`, `reused`, `frameId`. Pass `focus:false` into `addWebNode` (currently it focuses unconditionally). Keep ordinary HTML on the existing default path. Manual marking accepts an existing HTML web node ID, not a user-typed path.
- [ ] **Step 4:** Re-run targeted tests; verify a report published while `viewMode==='split'` leaves that mode unchanged and does not focus a hidden canvas node.
- [ ] **Step 5:** Commit `feat: associate authorized report artifacts with AI leaves`.

### Task 3: Two-row live/report presentation and lifecycle

**Files:** Modify `src/renderer/src/features/livePage/LivePagePanel.tsx`, `livePage.css`, `livePageStore.ts`, `livePageSelection.ts`; add focused `reportPresentation.test.ts` and an isolated UI verification script.

**Interfaces:** A presentation selector consumes `LivePageState | undefined`, `reportForLeaf(...)`, current view mode and active leaf; returns `single | dual | hidden`, never a report from another leaf. Report content uses the existing authorized webview path; only one visible report guest is mounted per owner. Existing `PageContent` continues to display frames from the same `LivePageState`.

- [ ] **Step 1:** Write red selector tests for no report, matching owner, wrong leaf, removed node, closed live session, and reopened session. Add a static/DOM test that dual mode contains top and bottom regions and a divider.
- [ ] **Step 2:** Run targeted tests to confirm red.
- [ ] **Step 3:** Render dual mode in split drawer and the canvas chat host; use `minmax()`/ResizeObserver for narrow sizes, a keyboard-operable divider with min heights, and the existing 440ms drawer transition. Ensure hidden/unselected surfaces unmount report guest and retain only metadata; if a local file is removed, display a bounded error instead of an old frame. Avoid a second dev-browser session.
- [ ] **Step 4:** Re-run tests; in isolated Electron verify the real report appears under the actual dev screenshot, no blank region before first frame, different leaf has no wrong report, and switch to/from canvas does not duplicate permanent guests.
- [ ] **Step 5:** Commit `feat: present live development and report pages together`.

### Task 4: Independent immersive maximize, manual fallback and final verification

**Files:** Modify `src/renderer/src/features/livePage/LivePagePanel.tsx`, `src/renderer/src/features/livePage/livePage.css`, `src/renderer/src/features/canvas/stageMenu.ts`, `docs/architecture/10-模块领地图.md`; create `src/renderer/src/features/livePage/livePageMaximize.test.ts` and extend the isolated UI verification script from Task 3.

**Interfaces:** Local presentation mode `'dual'|'live-max'|'report-max'`; entering max preserves owner, report path and divider ratio; Esc restores dual only if this view owns the active `fullscreenOverlay`. A manual “作为汇报页显示” action accepts only an existing HTML node in its owning Frame.

- [ ] **Step 1:** Write red state transition tests for each maximize button, Esc return, popout coexistence, another fullscreen overlay, removed report node, and close. Add a red manual-mark test rejecting non-HTML and mismatched leaf/Frame.
- [ ] **Step 2:** Run targeted tests to confirm red.
- [ ] **Step 3:** Add labeled maximize/return buttons to each region; use one in-app fixed overlay, preserve child state while hiding the other, restore focus on return, and respect reduced motion. Add the manual fallback in the existing HTML node menu, routed through the same association validator. Update the architecture map with new identity and cleanup boundaries.
- [ ] **Step 4:** Run `npm run check` and `npm run build`; open an isolated app and verify split and canvas, both maximize modes, Esc, return, resize, light/dark, reduced motion, manual report selection, leaf switching, close/reopen, and no second dev session. Record any unverified Windows/online CLI cases explicitly.
- [ ] **Step 5:** Request one whole-branch code review; fix Critical/Important findings, rerun tests/build and visual checks; commit the final implementation and verification record. Do not merge, publish or replace the installed app without a separate integration decision.
