#!/usr/bin/env bash
# 把本機 Auth :8790 暴露成 HTTPS，讓 github.io 能登入
set -euo pipefail

# KCIS Auth 固定 8790（個人 WikiNB 才是 8787／8788，勿混用）
PORT="${PORT:-8790}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "尚未安裝 cloudflared。"
  echo "Mac 安裝（需你確認）：brew install cloudflared"
  echo "或見：https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
  exit 1
fi

echo "=== Cloudflare Quick Tunnel → http://127.0.0.1:${PORT} ==="
echo "請先在另一個終端機執行：npm run auth（埠 8790）"
echo ""
echo "Tunnel 啟動後會顯示 https://xxxx.trycloudflare.com"
echo "接著："
echo "  1) 把該網址寫進 config/sites.json → auth.productionUrl"
echo "  2) 寫進 auth/.env → AUTH_BASE_URL=該網址"
echo "  3) 重啟 Auth，git commit + push（更新 Pages）"
echo "正式長期請改用 Named Tunnel（固定網址），見 docs/HOST_DEPLOY.md"
echo ""

exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
