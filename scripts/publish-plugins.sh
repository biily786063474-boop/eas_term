#!/usr/bin/env bash
# Explicit independent plugin publish. No host build, recursive SCP, archive
# overwrite or service reload. Read docs/verification/plugin-marketplace/publishing.md.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/publish-plugins.mjs "$@"
