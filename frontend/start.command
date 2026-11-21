#!/bin/bash
set -e
cd "$(dirname "$0")"
ORIGIN_NODE="$(command -v node || true)"
if [ -z "$ORIGIN_NODE" ]; then
  ORIGIN_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$ORIGIN_NODE" ]; then
  echo 'Install Node.js 24 LTS first, then run npm ci in the repository root and frontend/.'
  read -r -p 'Press Enter to close.'
  exit 1
fi
export PATH="$(dirname "$ORIGIN_NODE"):$PATH"
"$ORIGIN_NODE" scripts/dev-local.mjs
