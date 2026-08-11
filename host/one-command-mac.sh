#!/usr/bin/env bash
# 一次性：啟動 Auth + Tunnel，自動寫入 productionUrl／.env，並提示一行 push
# 用法（整段貼到終端機即可）：
#   cd "/Users/kaine/Desktop/Projects/WikiNB_for_KCIS" && ./host/one-command-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8790}"
LOG_DIR="$ROOT/host/.run"
mkdir -p "$LOG_DIR"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
AUTH_LOG="$LOG_DIR/auth.log"

echo ""
echo "=========================================="
echo " WikiNB KCIS — 主機一鍵啟動（Mac）"
echo " 專案：$ROOT"
echo "=========================================="
echo ""

if [[ ! -f auth/.env ]]; then
  echo "❌ 缺少 auth/.env"
  echo "   先執行：cp auth/.env.example auth/.env  再填 SMTP／密鑰"
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "→ 尚未安裝 cloudflared，嘗試：brew install cloudflared"
  if ! command -v brew >/dev/null 2>&1; then
    echo "❌ 沒有 Homebrew。請先安裝：https://brew.sh"
    exit 1
  fi
  brew install cloudflared
fi

auth_ok() {
  curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1
}

start_auth() {
  echo "→ 啟動 Auth（背景）…"
  # 清掉舊的同埠程序（若有）
  if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    kill $(lsof -tiTCP:"$PORT" -sTCP:LISTEN) 2>/dev/null || true
    sleep 1
  fi
  (
    cd "$ROOT"
    export HOST=0.0.0.0
    export PORT="$PORT"
    export FRONTEND_ORIGINS=https://wikinb.kcis.kainnne.com,https://kainnne.github.io,https://zx50416.github.io,http://127.0.0.1:4322,http://localhost:4322
    export COOKIE_SAMESITE=none
    # AUTH_BASE_URL 由 .env 讀取（稍後會寫入 Tunnel 網址）
    nohup npm run auth >>"$AUTH_LOG" 2>&1 &
    echo $! >"$LOG_DIR/auth.pid"
  )
  for i in {1..30}; do
    if auth_ok; then
      echo "✓ Auth 已在 http://127.0.0.1:${PORT}"
      return 0
    fi
    sleep 0.5
  done
  echo "❌ Auth 啟動失敗，請看：$AUTH_LOG"
  tail -n 40 "$AUTH_LOG" || true
  exit 1
}

if auth_ok; then
  echo "✓ Auth 已在執行"
else
  start_auth
fi

echo "→ 啟動 Cloudflare Tunnel（取得 HTTPS 網址）…"
: >"$TUNNEL_LOG"
nohup cloudflared tunnel --url "http://127.0.0.1:${PORT}" >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
echo $TUNNEL_PID >"$LOG_DIR/tunnel.pid"

TUNNEL_URL=""
for i in {1..60}; do
  # -a：tunnel.log 若被當成 binary，grep 會吐出 “Binary file … matches” 寫壞 productionUrl
  TUNNEL_URL="$(grep -aEo 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "❌ Tunnel 掛掉了，請看：$TUNNEL_LOG"
    cat "$TUNNEL_LOG"
    exit 1
  fi
  sleep 0.5
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "❌ 等不到 Tunnel 網址，請看：$TUNNEL_LOG"
  tail -n 50 "$TUNNEL_LOG" || true
  exit 1
fi

echo "✓ Tunnel：$TUNNEL_URL"

echo "→ 寫入 config/sites.json（productionUrl）…"
python3 - "$ROOT/config/sites.json" "$TUNNEL_URL" <<'PY'
import json, sys
path, url = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data.setdefault("auth", {})["productionUrl"] = url.rstrip("/")
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("ok", path)
PY

echo "→ 寫入 auth/.env（AUTH_BASE_URL、COOKIE_SAMESITE）…"
python3 - "$ROOT/auth/.env" "$TUNNEL_URL" <<'PY'
import re, sys
from pathlib import Path
path, url = Path(sys.argv[1]), sys.argv[2].rstrip("/")
text = path.read_text(encoding="utf-8")

def upsert(text, key, value):
    line = f"{key}={value}"
    pat = re.compile(rf"(?m)^\s*#?\s*{re.escape(key)}=.*$")
    if pat.search(text):
        return pat.sub(line, text, count=1)
    return text.rstrip() + "\n" + line + "\n"

text = upsert(text, "AUTH_BASE_URL", url)
text = upsert(text, "COOKIE_SAMESITE", "none")
text = upsert(
    text,
    "FRONTEND_ORIGINS",
    "https://zx50416.github.io,http://127.0.0.1:4322,http://localhost:4322",
)
path.write_text(text, encoding="utf-8")
print("ok", path)
PY

echo "→ 用新設定重啟 Auth…"
start_auth

PUSH_CMD="cd \"$ROOT\" && git add config/sites.json && git commit -m \"Set Auth productionUrl for host tunnel\" && git push origin master"
printf '%s\n' "$PUSH_CMD" >"$LOG_DIR/push-once.sh"
chmod +x "$LOG_DIR/push-once.sh"

echo ""
echo "=========================================="
echo " 主機已就緒（Auth + Tunnel 在背景執行）"
echo ""
echo " 下一步：開「另一個」終端機視窗，貼上下面整段（不要貼在還在跑的這個視窗）："
echo ""
echo "bash \"$LOG_DIR/push-once.sh\""
echo ""
echo " 或直接貼："
echo "$PUSH_CMD"
echo ""
echo " ⏳ 請等約 1 分鐘，再強制重新整理登入頁（Cmd+Shift+R）："
echo " https://zx50416.github.io/WikiNB-KCIS/login"
echo " 停止主機：./host/stop-mac.sh"
echo "=========================================="
echo ""

# 預設自動 push（交接最省事）；若只要本機可設 SKIP_PUSH=1
if [[ "${SKIP_PUSH:-}" != "1" ]]; then
  echo "→ 自動更新線上站（git push）…"
  if eval "$PUSH_CMD"; then
    echo "✓ 已 push。"
    echo ""
    echo " ⏳ 請等約 1 分鐘，再強制重新整理登入頁（Cmd+Shift+R）："
    echo " https://zx50416.github.io/WikiNB-KCIS/login"
  else
    echo "⚠ 自動 push 失敗。請開新終端機執行："
    echo "bash \"$LOG_DIR/push-once.sh\""
  fi
fi

echo ""
echo "✓ 完成。此視窗可關閉；Auth／Tunnel 仍在背景。"
echo "  （不再卡住等輸入——先前貼 git 沒反應，就是卡在日誌畫面。）"
exit 0
