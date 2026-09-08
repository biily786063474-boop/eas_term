Windows CI artifact acceptance for Eas-Term 0.4.85, source commit `9510ff29e94b143015691715f3e0bfbe16b1caa7`.

Source: [GitHub Actions run 34235219068](https://github.com/biily786063474-boop/eas_term/actions/runs/34235219068), job `102091069545`, branch `feat/builtin-capabilities`. The completed job succeeded; its Publish to Release step was skipped. This verification did not publish anything.

Reviewed job test output: 7 Windows capability contracts and 25 CLI/owned-process tests passed, with zero failed, cancelled, or skipped tests. The latter includes all 9 Windows integration fixtures: native Codex config/final execution, Claude PTY lease closing, direct config cancellation, outer launcher cancellation and parent disconnect during both config and execution, early disconnect, and invalid-install exit. `EAS_TEST_NODE_RUNNER` was the packaged `release/win-unpacked/Eas-Term.exe`, exercising Electron Node IPC. Packaged settings passed all 6 real UI/preload/main checks. Smoke passed app rendering, preload, node-pty terminal echo, IPC, actual dependency analysis, no renderer JS errors, screenshot, and bundled OMP 18.1.2 version probing.

The three downloaded ZIP archives were checked against the GitHub artifact `digest` values before extraction. Extraction rejected absolute/traversing paths, backslashes, drive/alternate-stream separators, duplicate names, and symbolic links, with uncompressed-size bounds. Artifact provenance, ZIP hashes, and selected extracted-file hashes are in `artifact-source-hashes.json`.

The installer is retained outside the repository at `/Users/biily/Eas-Term-release/0.4.85-prep/reviewed-9510ff2-windows/eas-term-win/Eas-Term-0.4.85-x64-setup.exe` (190,055,572 bytes).

Installer SHA-256: `eac9790f4491cee13d581bdf73ed559c91b52680420bb86fa80e2cd822706870`.

Only filtered JSON summaries and reviewed PNG screenshots were copied here. Raw job logs, artifact application logs, download URLs, credentials, and private profiles are not included. GitHub MCP supplied job/artifact metadata and job logs; its temporary materialization URL returned HTTP 403 locally, so ZIP bytes were retrieved through authenticated GitHub REST. The large installer ZIP used validated HTTP byte ranges, assembled in order, and matched the full GitHub digest. Temporary range files and URL were removed after verification.

Limits: the native CLI process tests are compiled PE protocol fixtures using representative official package layouts, not logged-in real Codex/Claude model acceptance. The runner reported Codex and Claude absent, and no model calls were made. The bundled OMP check exercised `--version`, not authenticated OMP conversation. ZIP digest verification does not independently establish Windows Authenticode trust or interactive installation. No extracted app.asar was supplied by these artifacts, so no Windows app.asar hash is claimed.
