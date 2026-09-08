# Composer mentions implementation plan

**Goal:** Apply the approved Review 02 composer design to both startup and active conversations across all three transports.
**Architecture:** Keep candidate parsing, source mapping and placement pure; load existing read-only APIs in a renderer source module; share one picker between both composers. Preserve chips expansion, transport, approvals, session restart, store ownership, and startup registration order.
**Spec:** docs/prototype/2026-09-07-chat-mentions-notes.md and Figma xgXySVpD0pfr0eBw2738Zq / 26:1596.

- [x] Add regression tests for caret-local replacement, email/path boundaries, quoted paths, candidate identity/dedup, dictionary aliases, local command capability filtering, viewport placement and source failure isolation.
- [x] Implement composerCandidates.ts and composerSources.ts, using existing dictionary bundle/userTerms, skillLibrary, recentFiles and plugin lists. No new IPC or outgoing network. Files use the existing bounded scanner; browser references include only existing Eas-Term web nodes. Unconnected plugin/app entries must explain why they cannot activate a connection.
- [x] Replace SlashPicker with categorized, keyboard-scrollable portal, dictionary preview, independent loading/error/retry states, focus gating and live anchor tracking. Preserve IME and normal send shortcuts. Common slash actions use existing controls; never forward unsupported native TUI commands.
- [x] Wire both composers, preserve preload/send/failure restoration semantics, expose @ and / buttons and exact expanded-message preview.
- [x] Run focused regression, full npm run check, production build. Start isolated verify-app instance and exercise all three CLI startup surfaces, active composer, candidate selection, empty/error/retry, IME, sending interception, narrow widths and themes. Record exact limitations; update architecture map with the change.

Baseline: 346 related tests pass on 6749990. Implementation isolated in .worktrees/composer-mentions, branch feat/composer-mentions. Existing main workspace modifications retained.

Implementation note: nativeSlash is the only new optional capability field (shared type + Claude adapter); no IPC registration/transport changes. User dictionary identity is shared with DictView. Independent review found and closed user-term normalization and startup native capability omissions. Verification details live in docs/verification/composer/README.md.
