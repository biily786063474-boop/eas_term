# CLI brand assets

These images are bundled locally; rendering a CLI selector makes no network request.

- `claude.png`: Claude's official website favicon, retrieved 2026-09-07 from https://cdn.sanity.io/images/4zrzovbb/claude-com/369b14e80ac643cc09dccd581ccb91f82b559190-32x32.png (declared by https://claude.com/).
- `openai.png`: OpenAI's official GitHub organization avatar, retrieved 2026-09-07 from https://github.com/openai.png?size=64. Codex uses this OpenAI brand mark, not a custom imitation or a Codex app icon.
- Local/bundled harness: `CliBrandIcon` imports `build/icon.png`, the source app icon used for Eas-Term packaging, so it stays aligned with the app.

Unknown external CLIs retain a generic terminal icon until an authentic brand asset is supplied.
