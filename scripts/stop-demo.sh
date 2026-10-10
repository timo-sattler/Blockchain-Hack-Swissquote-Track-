#!/usr/bin/env bash
# Stops everything scripts/start-demo.sh started (hub, share service, escrow agent, app, tunnel).
# Wallet data in services/data/ is kept.
set -uo pipefail
HUB_PORT="${HUB_PORT:-8787}" SHARE_PORT="${SHARE_PORT:-8790}" ESCROW_PORT="${ESCROW_PORT:-8791}" APP_PORT="${APP_PORT:-5173}"
pkill -f "cloudflared tunnel .*:$APP_PORT" 2>/dev/null && echo "  ✓ tunnel stopped (the next one gets a new address)"
for entry in "hub:$HUB_PORT" "share-service:$SHARE_PORT" "escrow-agent:$ESCROW_PORT" "app:$APP_PORT"; do
  name=${entry%%:*}
  port=${entry##*:}
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)"
  if [ -n "$pids" ]; then
    kill $pids && echo "  ✓ $name stopped (:$port)"
  else
    echo "  · $name was not running (:$port)"
  fi
done
