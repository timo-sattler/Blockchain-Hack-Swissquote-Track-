#!/usr/bin/env bash
# Starts the whole demo: event hub, Swissquote share service, escrow agent and the app.
#   scripts/start-demo.sh            local only (http://localhost:5173)
#   scripts/start-demo.sh --tunnel   plus a public https link for phones, teammates and the projector
# Parts that are already running are left alone. Logs go to .demo-logs/. Stop with scripts/stop-demo.sh.
# Ports can be changed with HUB_PORT, SHARE_PORT, ESCROW_PORT and APP_PORT.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/.demo-logs"
mkdir -p "$LOGS"
export HUB_PORT="${HUB_PORT:-8787}" SHARE_PORT="${SHARE_PORT:-8790}" ESCROW_PORT="${ESCROW_PORT:-8791}"
APP_PORT="${APP_PORT:-5173}"
export HUB_URL="http://localhost:$HUB_PORT" SHARE_URL="http://localhost:$SHARE_PORT" ESCROW_URL="http://localhost:$ESCROW_PORT"

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

start() { # name port directory command...
  local name=$1 port=$2 dir=$3
  shift 3
  if listening "$port"; then
    echo "  ✓ $name already running on :$port"
    return
  fi
  (cd "$dir" && nohup "$@" >"$LOGS/$name.log" 2>&1 &)
  for _ in $(seq 1 80); do
    if listening "$port"; then
      echo "  ✓ $name started on :$port"
      return
    fi
    sleep 0.25
  done
  echo "  ✗ $name did not start. See $LOGS/$name.log"
  exit 1
}

[ -d "$ROOT/services/node_modules" ] || (cd "$ROOT/services" && npm install)
[ -d "$ROOT/app/node_modules" ] || (cd "$ROOT/app" && npm install)

echo "Starting the demo…"
start hub "$HUB_PORT" "$ROOT/services" node hub.mjs
start share-service "$SHARE_PORT" "$ROOT/services" node share-service.mjs
start escrow-agent "$ESCROW_PORT" "$ROOT/services" node escrow-agent.mjs
start app "$APP_PORT" "$ROOT/app" npx vite --port "$APP_PORT" --strictPort

# Address of a quick tunnel that already serves this app (cloudflared reports it on its metrics port).
running_tunnel() {
  local pid port host
  for pid in $(pgrep -f "cloudflared tunnel .*:$APP_PORT" 2>/dev/null); do
    for port in $(lsof -nP -a -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 { n = split($9, a, ":"); print a[n] }'); do
      host="$(curl -s --max-time 2 "http://127.0.0.1:$port/quicktunnel" | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p')"
      if [ -n "$host" ]; then
        echo "https://$host"
        return
      fi
    done
  done
}

find_cloudflared() {
  local candidate
  for candidate in "${CLOUDFLARED:-}" "$(command -v cloudflared 2>/dev/null)" "$HOME/.local/bin/cloudflared" /opt/homebrew/bin/cloudflared /usr/local/bin/cloudflared; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
}

PUBLIC=""
if [ "${1:-}" = "--tunnel" ]; then
  PUBLIC="$(running_tunnel)"
  if [ -n "$PUBLIC" ]; then
    echo "  ✓ tunnel already running"
  else
    CLOUDFLARED="$(find_cloudflared)"
    if [ -z "$CLOUDFLARED" ]; then
      echo "  ✗ cloudflared not found. Install it with one of:"
      echo "      brew install cloudflared   (if brew asks, first: sudo xcodebuild -license accept)"
      echo "      mkdir -p ~/.local/bin && curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz | tar -xz -C ~/.local/bin"
      echo "      Windows: winget install Cloudflare.cloudflared"
      exit 1
    fi
    # Vite listens on IPv6 (::1) or IPv4 depending on the machine; point the tunnel at the right one.
    if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN | grep -q '\[::1\]'; then TARGET="http://[::1]:$APP_PORT"; else TARGET="http://127.0.0.1:$APP_PORT"; fi
    : >"$LOGS/tunnel.log"
    (nohup "$CLOUDFLARED" tunnel --no-autoupdate --url "$TARGET" >"$LOGS/tunnel.log" 2>&1 &)
    for _ in $(seq 1 60); do
      PUBLIC="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true)"
      [ -n "$PUBLIC" ] && break
      sleep 0.5
    done
    if [ -n "$PUBLIC" ]; then echo "  ✓ tunnel started (new address: wallets made on an older address need 'Recover with your kit')"; else echo "  ✗ tunnel did not start. See $LOGS/tunnel.log"; fi
  fi
fi

TREASURY="$(curl -s "http://localhost:$SHARE_PORT/treasury" || true)"
ETH="$(printf '%s' "$TREASURY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).eth)}catch{}})')"
ADDRESS="$(printf '%s' "$TREASURY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).address)}catch{}})')"

echo
echo "  Wallet        http://localhost:$APP_PORT"
echo "  Presentation  http://localhost:$APP_PORT/present.html"
[ -n "$PUBLIC" ] && echo "  Public link   $PUBLIC   (passkeys are bound to this address: keep the tunnel running)"
echo "  Logs          $LOGS"
if [ -n "$ADDRESS" ]; then
  echo "  Treasury      $ADDRESS · ${ETH:-?} ETH"
  if [ "${ETH:-0}" = "0" ] || [ "$ETH" = "0.0" ]; then
    echo "                ↳ empty: free USDC transfers and the on-chain backup need Base Sepolia ETH here"
    echo "                  (https://portal.cdp.coinbase.com/products/faucet)"
  fi
fi
