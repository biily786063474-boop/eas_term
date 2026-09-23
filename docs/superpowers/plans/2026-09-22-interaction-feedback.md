# Interaction Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the confirmed hover, pressed, disclosure, keyboard, and reduced-motion feedback gaps without adding global decorative animation.

**Architecture:** Extend the existing feature-local CSS for representative controls. Use a small shared disclosure-presence primitive only where content currently unmounts instantly; preserve existing ownership and avoid a global button reset. Keep the app's click-to-create spark restricted to its existing canvas event.

**Tech Stack:** React, TypeScript, CSS, Node test runner, isolated Electron/CDP verification.

**Spec:** `docs/reports/2026-09-22-interaction-feedback-audit.html`

## Global Constraints

- Do not touch `src/main/index.ts` startup order, persistence, sandbox, or the active Tart installation task.
- No `transition: all`, no invented progress percentage, no all-click spark.
- Respect `prefers-reduced-motion`; preserve state feedback in reduced-motion mode.
- Work in the existing `fix/plugin-update-release-20260922` worktree; do not merge, push, or release as part of this task.

## Review Focus

- Fast open-close-open must not unmount visible content or leave it stuck.
- Hidden controls must become visible under keyboard focus.
- Busy/disabled controls must not suggest that they remain clickable.
- Large lists must not remain mounted solely for an animation.
- Dark and light themes, plus reduced-motion mode, must keep discernible states.

---

### Task 1: Pressed and focus feedback

**Files:** `canvas/canvas.css`, `workspace/workspace.css`, `agentChat/agentChat.css`, feature-level CSS test.

- [x] Write a failing contract test for the representative selectors and reduced-motion rules.
- [x] Add short, bounded pressed states and focus-visible rings to Frame start/header, settings, and chat actions.
- [x] Run targeted tests and typecheck.

### Task 2: Disclosure continuity

**Files:** `ui/motion/`, `terminal/TerminalTodoPanel.tsx`, `terminal/terminal.css`, `agentChat/MessageList.tsx`, `agentChat/agentChat.css`, tests.

- [x] Write a failing test for disclosure timing and rapid reversal.
- [x] Animate short terminal todo and potentially long tool output without keeping the latter mounted after exit.
- [x] Add `aria-expanded` / `aria-controls`, focus handoff, and reduced-motion behavior.
- [x] Run targeted tests and typecheck.

### Task 3: Hover-only actions and broader disclosure semantics

**Files:** `terminal/terminal.css`, `canvas/CanvasSkillPanel.tsx`, tests.

- [x] Write a failing test for focus-within visibility and expanded semantics.
- [x] Add keyboard/touch discoverability without making desktop rows visually crowded.
- [x] Run targeted tests.

### Task 4: Full verification and documentation

- [x] Run `npm run check` and `npm run build` (the final full check is recorded in `/tmp/eas-interaction-final-check.log`).
- [x] Open isolated Electron instances; exercise Frame pressed/focus, Skill fast reversal, terminal todo, dark/light and reduced-motion. AI tool details remain unverified with real execution data.
- [x] Update the audit with implemented vs remaining findings and update architecture documentation for the shared primitive.
- [x] Review the worktree diff for accidental unrelated changes; report unverified paths honestly.
