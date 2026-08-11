#!/usr/bin/env bash
# WikiNB KCIS — 在「部署主機」啟動 Auth + Codex（目前：Mac；未來可搬到 Windows）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== WikiNB KCIS Host (Mac) ==="
echo "專案：$ROOT"
echo ""

if [[ ! -f auth/.env ]]; then
  echo "缺少 auth/.env — 請先：cp auth/.env.example auth/.env 並填寫"
  exit 1
fi

# 主機模式：給 Pages 跨站 cookie 用（Tunnel HTTPS 時）
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8790}"
export COOKIE_SAMESITE="${COOKIE_SAMESITE:-none}"
export FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-https://wikinb.kcis.kainnne.com,https://kainnne.github.io,https://zx50416.github.io,http://127.0.0.1:4322,http://localhost:4322}"

echo "1) 啟動 Auth API（埠 ${PORT}）…"
echo "   本機測試登入：http://127.0.0.1:4322/WikiNB-KCIS/login（另需 npm run dev）"
echo "   線上站 Tunnel：./host/tunnel-mac.sh（務必對準 ${PORT}，不是 8788）"
echo ""

npm run auth
