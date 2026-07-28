#!/usr/bin/env bash
# 診斷本機登入能否用（不改資料、不 push）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT_AUTH="${PORT:-8790}"
PORT_DEV="${DEV_PORT:-4322}"
LOGIN_URL="http://127.0.0.1:${PORT_DEV}/WikiNB-KCIS/login"
AUTH_URL="http://127.0.0.1:${PORT_AUTH}/api/health"

echo ""
echo "=========================================="
echo " WikiNB KCIS — 登入診斷"
echo " 專案：$ROOT"
echo "=========================================="
echo ""
echo "正確本機登入網址（請複製整段）："
echo "  $LOGIN_URL"
echo "注意：http://127.0.0.1:${PORT_DEV}/ 會 404（一定要有 /WikiNB-KCIS/），這是正常的。"
echo "不要開錯：個人 WikiNB 是另一專案（常見 4321／8787）。"
echo "KCIS 埠號：網站 4322、Auth 8790。"
echo ""

ok_auth=0
ok_dev=0
if curl -sf "$AUTH_URL" >/dev/null 2>&1; then
  echo "OK Auth 健康：$AUTH_URL"
  ok_auth=1
else
  echo "FAIL Auth 未連線（應為埠 ${PORT_AUTH}）"
  echo "  修復：cd \"$ROOT\" && npm run auth"
fi

http_code="000"
http_code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$LOGIN_URL" 2>/dev/null || true)"
http_code="${http_code:-000}"
if [[ "$http_code" == "200" ]]; then
  echo "OK 網站登入頁可開：$LOGIN_URL"
  ok_dev=1
else
  echo "FAIL 網站登入頁打不開（HTTP ${http_code}，應為埠 ${PORT_DEV}）"
  echo "  修復：另開終端機 cd \"$ROOT\" && npm run dev"
fi

PROD="$(python3 - <<'PY'
import json
from pathlib import Path
p = Path("config/sites.json")
try:
    u = json.loads(p.read_text(encoding="utf-8")).get("auth", {}).get("productionUrl", "")
except Exception:
    u = ""
print(u or "")
PY
)"

if [[ -n "$PROD" ]]; then
  if curl -sf "${PROD%/}/api/health" >/dev/null 2>&1; then
    echo "OK Tunnel／productionUrl 可用：$PROD"
  else
    echo "WARN productionUrl 目前連不上：$PROD"
    echo "  github.io 線上登入會失敗；本機測試請用上面的 $LOGIN_URL"
    echo "  線上修復：先 npm run auth，再 cloudflared tunnel --url http://127.0.0.1:${PORT_AUTH}"
    echo "  然後更新 sites.json 的 productionUrl 並 push"
  fi
else
  echo "WARN 尚未設定 productionUrl（只影響 github.io 線上登入）"
fi

echo ""
if [[ "$ok_auth" -eq 1 && "$ok_dev" -eq 1 ]]; then
  echo "結論：本機登入通路正常。請用瀏覽器開："
  echo "  $LOGIN_URL"
  echo "然後強制重新整理（Cmd+Shift+R）。"
  exit 0
fi

echo "結論：還不能測登入。請先把上面標 FAIL 的項目修好。"
echo "一鍵本機（Auth + 網站）："
echo "  cd \"$ROOT\" && ./host/local-login-mac.sh"
exit 1
