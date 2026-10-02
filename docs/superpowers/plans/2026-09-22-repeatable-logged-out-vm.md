# Repeatable Logged-Out VM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reusable macOS test instance that starts each new Eas-Term installation trial without prior application login or Claude Code / Codex installation.

**Architecture:** Finish the already-created Tart VM's local OS setup, install only a pinned Eas-Term test build, verify clean app/CLI state, then clone the stopped VM as a preserved baseline. A host-side launcher creates a uniquely named copy-on-write VM per trial and opens it; old trials remain untouched.

**Tech Stack:** Tart 2.37.0, Apple Virtualization Framework, macOS 26.6.2 guest, zsh, Python 3 standard library for test harness, local screenshots and HTML evidence.

**Spec:** `docs/superpowers/specs/2026-09-22-repeatable-logged-out-vm-design.md`

## Global Constraints

- Never import host account, app data, keychain, CLI config, home directory or projects into guest.
- Do not share folders or clipboard: `tart run NAME --no-clipboard --no-audio` and no `--dir`.
- Do not collect or store guest local-account password in chat, source, script, screenshot or log.
- Never delete another VM, a running VM, or the baseline. Deletion of a named trial requires separate explicit user confirmation.
- “Always logged out” means each **new trial** starts logged out; a trial retains its own changes until closed.
- Never call the environment end-to-end verified until two separate trial clones boot and both show the expected clean state.

## Review Focus

1. `tart clone` failing after creating a partial destination: launcher reports its name and retains it for inspection, never blindly retries same name.
2. Existing trial running: launcher creates a different name and does not stop/rewrite the first trial.
3. Baseline running or absent: launcher refuses to clone, with an actionable message.
4. Low disk space: launcher refuses before cloning and does not prune unrelated Tart VMs.
5. Host-installed CLI bleeding into guest: guest check uses actual terminal command lookup, not only Eas-Term UI.

---

### Task 1: Finish and verify guest preparation

**Files:**
- Modify: `docs/verification/clean-machine/README.md`
- Create: `docs/verification/clean-machine/baseline-manifest.md`
- Evidence: `docs/verification/clean-machine/guest-clean-state.png`

**Interfaces:** Produces an initialized stopped source VM named `eas-clean-macos-20260922` and a manifest containing guest OS version, Eas-Term package path/version/hash, and clean-state assertions.

- [ ] **Step 1:** User completes guest's macOS setup using a local account, skipping Apple ID, iCloud, Migration Assistant, and optional data sync. Agent does not type/read password.
- [ ] **Step 2:** Inspect guest desktop with read-only Computer Use state; if it remains on setup or login screen, record exact page and stop this task.
- [ ] **Step 3:** Select pinned macOS arm64 Eas-Term build, calculate `shasum -a 256 <package>`, transfer only that package to guest (no shared host home/project/keychain), install it and record package identity in manifest.
- [ ] **Step 4:** In guest verify `command -v claude`, `command -v codex`, and `command -v omp` all return nonzero; if any exist, record output and do not seal baseline.
- [ ] **Step 5:** Open guest Eas-Term and observe first-run/install UI without logging into any provider. Save screenshot and record actual UI, not inferred state.
- [ ] **Step 6:** Shut down source VM cleanly; verify `tart list` reports stopped. Commit only task-owned docs and evidence, not unrelated dirty files.

### Task 2: Create and protect baseline

**Files:**
- Create: `docs/verification/clean-machine/baseline-check.sh`
- Test: `docs/verification/clean-machine/test-baseline-check.py`
- Modify: `docs/verification/clean-machine/README.md`

**Interfaces:** Consumes Task 1 stopped source VM; produces stopped `eas-install-baseline` with recorded source manifest.

- [ ] **Step 1:** Write `unittest` cases for source missing, source running, baseline existing, and valid stopped source; inject fake `tart list --format json` output into a shell-independent parser so tests do not create VMs.
- [ ] **Step 2:** Run `python3 -m unittest docs/verification/clean-machine/test-baseline-check.py`; expect the tests to fail because checker is absent.
- [ ] **Step 3:** Implement `baseline-check.sh` using exact VM names and Tart state checks; reject any existing baseline instead of overwriting.
- [ ] **Step 4:** Rerun tests; require all pass. Execute `tart clone eas-clean-macos-20260922 eas-install-baseline` only after manifest and clean-state evidence exist.
- [ ] **Step 5:** Check `tart list` shows both VMs stopped and baseline 50GB. Record `du`/`df` rather than assuming APFS clone costs zero bytes. Commit task-owned script, tests, docs.

### Task 3: One-click unique trial launcher

**Files:**
- Create: `docs/verification/clean-machine/start-new-test.command`
- Create: `docs/verification/clean-machine/list-tests.command`
- Create: `docs/verification/clean-machine/test-trial-launcher.py`
- Modify: `docs/verification/clean-machine/README.md`

**Interfaces:** Consumes stopped `eas-install-baseline`; produces `eas-install-test-YYYYMMDD-HHMMSS` and starts it with isolation flags. Existing trials are never mutated.

- [ ] **Step 1:** Test fresh name creation, name collision refusal, missing/running baseline refusal, low-space refusal, clone error propagation, and run arguments. Use a fake `tart` executable injected through `PATH` and a temporary test directory; assert no `delete` call occurs.
- [ ] **Step 2:** Run `python3 -m unittest docs/verification/clean-machine/test-trial-launcher.py`; expect failure because scripts do not exist.
- [ ] **Step 3:** Implement launcher: exact baseline check; `df` available-space floor of 25 GiB; `TART_NO_AUTO_PRUNE=1 tart clone`; unique timestamp plus random suffix; if clone fails, print destination name and exit nonzero; on success `exec tart run "$name" --no-clipboard --no-audio`. No `--dir`.
- [ ] **Step 4:** Implement read-only listing of `eas-install-test-` names and states; no implicit cleanup. Run tests and `zsh -n` for both scripts; require pass.
- [ ] **Step 5:** Commit only these scripts, tests and documentation.

### Task 4: Live two-trial isolation verification and handoff

**Files:**
- Create: `docs/verification/clean-machine/trial-1.png`
- Create: `docs/verification/clean-machine/trial-2.png`
- Modify: `docs/verification/clean-machine/README.md`
- Modify: `docs/prototype/2026-09-22-clean-machine.html`
- Modify: `memory/agent_clean-machine-2026-09-22.md`

**Interfaces:** Produces user-visible trial launcher and a documented result; does not assert product CLI install success unless separately executed.

- [ ] **Step 1:** Run `start-new-test.command`; `tart list` must show new running trial. Inspect actual guest Eas-Term first-run and CLI absence; capture trial 1.
- [ ] **Step 2:** Close trial 1 cleanly. Run launcher again; require a different name and screenshot showing initial app/CLI state, independently of trial 1.
- [ ] **Step 3:** If test 2 is not clean, mark acceptance failed, preserve both trial disks and logs, inspect baseline before modifying anything.
- [ ] **Step 4:** Update local HTML report with exact validated states and artifacts. Open report in existing Eas-Term Frame, no duplicate nodes or hosted artifact.
- [ ] **Step 5:** Report clear boundary: resettable environment complete or not, then enumerate which real Claude/Codex installation/login/error flows have and have not yet been verified.
