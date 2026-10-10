#!/usr/bin/env bash
# Runs every automated check: contract tests, service security tests, app type-check and build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORGE="$(command -v forge || echo "$HOME/.foundry/bin/forge")"

echo "▸ 1/3 Contract tests (Foundry)"
cd "$ROOT/contracts"
[ -d node_modules ] || npm install
"$FORGE" test

echo "▸ 2/3 Service security tests (real MPC, passkeys, local RPC stub)"
cd "$ROOT/services"
[ -d node_modules ] || npm install
node --test tests/*.test.mjs

echo "▸ 3/3 App type-check and production build"
cd "$ROOT/app"
[ -d node_modules ] || npm install
npm run build

echo "All checks passed."
