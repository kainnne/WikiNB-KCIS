#!/usr/bin/env bash
# 本機登入測試：確保 Auth(:8790) + Astro(:4322) 都起來，並印出正確網址
# 用法：cd "/Users/kaine/Desktop/Projects/WikiNB_for_KCIS" && ./host/local-login-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT_AUTH="${PORT:-8790}"
PORT_DEV="${DEV_PORT:-4322}"
LOG_DIR="$ROOT/host/.run"
mkdir -p "$LOG_DIR"
LOGIN_URL="http://127.0.0.1:${PORT_DEV}/WikiNB-KCIS/login"

auth_ok() { curl -sf "http://127.0.0.1:${PORT_AUTH}/api/health" >/dev/null 2>&1; }
dev_ok() {
  local code
  code="$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "$LOGIN_URL" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]]
}

echo ""
echo "=========================================="
echo " WikiNB KCIS — 本機登入啟動"
echo "=========================================="
echo ""

if [[ ! -f auth/.env ]]; then
  echo "❌ 缺少 auth/.env（先：cp auth/.env.example auth/.env 再填 SMTP）"
  exit 1
fi

if ! auth_ok; then
  echo "→ 啟動 Auth（埠 ${PORT_AUTH}）…"
  (
    cd "$ROOT"
    export HOST=0.0.0.0
    export PORT="$PORT_AUTH"
    export COOKIE_SAMESITE="${COOKIE_SAMESITE:-lax}"
    export FRONTEND_ORIGINS="http://127.0.0.1:${PORT_DEV},http://localhost:${PORT_DEV},https://wikinb.kcis.kainnne.com,https://kainnne.github.io,https://zx50416.github.io"
    nohup npm run auth >>"$LOG_DIR/auth.log" 2>&1 &
    echo $! >"$LOG_DIR/auth.pid"
  )
  for i in {1..40}; do
    auth_ok && break
    sleep 0.4
  done
  if ! auth_ok; then
    echo "❌ Auth 啟動失敗，請看：$LOG_DIR/auth.log"
    tail -n 40 "$LOG_DIR/auth.log" || true
    exit 1
  fi
  echo "✓ Auth 已啟動"
else
  echo "✓ Auth 已在執行"
fi

if ! dev_ok; then
  echo "→ 啟動網站（埠 ${PORT_DEV}）…"
  (
    cd "$ROOT"
    nohup npm run dev >>"$LOG_DIR/dev.log" 2>&1 &
    echo $! >"$LOG_DIR/dev.pid"
  )
  for i in {1..60}; do
    dev_ok && break
    sleep 0.5
  done
  if ! dev_ok; then
    echo "❌ 網站啟動失敗，請看：$LOG_DIR/dev.log"
    tail -n 40 "$LOG_DIR/dev.log" || true
    exit 1
  fi
  echo "✓ 網站已啟動"
else
  echo "✓ 網站已在執行"
fi

echo ""
echo "請用瀏覽器開啟（整段複製）："
echo "  $LOGIN_URL"
echo ""
echo "若仍失敗：Cmd+Shift+R 強制重新整理；或跑 ./host/doctor-mac.sh"
echo "線上 github.io 登入另需 Tunnel：./host/one-command-mac.sh"
echo ""
