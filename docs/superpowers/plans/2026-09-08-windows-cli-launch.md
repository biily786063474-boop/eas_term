# Windows official npm CLI launch compatibility

Spec: docs/superpowers/specs/2026-09-07-builtin-capability-bundle-handoff.md

## Global Constraints

Preserve user rules, third-party plugins, disabled settings, authentication and approval policies. Never use shell:true or execute/parse batch command contents. Never automatically install or enable updates. Preserve existing dirty work. No new outbound service dependency. Keep startup registration order and fsGuard boundaries. Update architecture diagrams with code. Changes must be shared across managed AI and PTY and consistent with installation detection. No paid generation tests without quote approval.

### Task 1: Resolve native and official npm Windows CLI entries safely

Fix reproduced Windows npm-only Codex/Claude launch failure. Current PTY resolver rejects .cmd immediately, and AI config preflight/direct spawning cannot execute batch files. Default-off native update feature is not a fallback.

Implement a shared resolver returning executable command, prefix arguments and strictly scoped interpreter environment as needed. Native executables remain native. For known official npm Codex/Claude packages, locate package bin metadata from the installation adjacent to the discovered shim, validate package identity, bin type, realpath containment and actual file before executing with a trusted Node runner. Do not interpret shim text; unknown wrappers fail explicitly. Support native-only, npm-only, mixed PATH, Chinese/spaces, and platform case rules. Do not silently run a different version behind an unsupported first PATH entry unless documented behavior preserves ordinary resolution semantics. Avoid enabling ELECTRON_RUN_AS_NODE on an arbitrary native CLI; apply only to owned interpreter launch. Keep exact argv incl quotes, &, |, ^, %, ! and newlines. Preserve process cancellation and leases.

Wire the same resolution into PTY launch, Codex configuration preflight and actual invocation, Claude AI invocation, and appropriate availability/version probing to prevent installed-but-unlaunchable states. Reuse existing Node runner rather than inventing another runtime. If upstream npm package now contains a native executable, prefer safely validated native resolution with verified package metadata; support published official JS bin layouts too. Unsupported/corrupt packages fail before model mutation with actionable error.

First write failing tests for the reproduced paths, then implement and run focused tests/typecheck. Add Windows CI checks that execute real child processes with representative official package fixtures (clearly identified as fixtures, not model acceptance); test argv preservation, rejection paths and cancellation. Read official package source/metadata where needed. Do not run paid calls or alter global configurations. Do not commit unrelated files; root owns final package rebuilds and release evidence. Report exact changes/tests/limitations, and commit only this task's code/tests/architecture/workflow changes.
