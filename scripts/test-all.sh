#!/usr/bin/env bash
# Runs every automated check: service security tests (real MPC and passkeys) and the app build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▸ 1/2 Service tests: security of the two-part wallet, custody proof, relay quota"
cd "$ROOT/services"
[ -d node_modules ] || npm install
node --test tests/*.test.mjs

echo "▸ 2/2 App type-check and production build"
cd "$ROOT/app"
[ -d node_modules ] || npm install
npm run build

echo "All checks passed."
