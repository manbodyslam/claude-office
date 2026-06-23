#!/usr/bin/env bash
#
# deploy.sh — build the Office frontend and restart the backend in one step.
#
# Usage:
#   ./deploy.sh            build + restart + health check
#   ./deploy.sh --no-build just restart (e.g. after editing server/*.mjs only)
#
set -euo pipefail
cd "$(dirname "$0")"

SERVICE=claude-office.service
BACKEND=http://127.0.0.1:3336

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

if [ "${1:-}" != "--no-build" ]; then
  step "Building frontend (vite)"
  npx vite build
else
  step "Skipping build (--no-build)"
fi

step "Restarting $SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE" >/dev/null && echo "service: active" || { echo "service FAILED to start"; journalctl -u "$SERVICE" -n 15 --no-pager; exit 1; }

step "Health check"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BACKEND/health" || echo 000)
echo "backend $BACKEND/health -> HTTP $CODE"
[ "$CODE" = "200" ] || { echo "WARNING: backend health not 200"; exit 1; }

ASSET=$(grep -oE 'index-[A-Za-z0-9_]+\.js' dist/index.html | head -1)
step "Deployed OK"
echo "live asset: $ASSET"
echo "open: https://72.62.66.39:8443/office/  (auto-reload will pick up the new build within ~45s)"
