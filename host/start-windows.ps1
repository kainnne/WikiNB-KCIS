# WikiNB KCIS — Windows 部署主機（未來）
# 在 PowerShell：
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\host\start-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== WikiNB KCIS Host (Windows) ==="
Write-Host "專案：$Root"
Write-Host ""

if (-not (Test-Path "auth\.env")) {
  Write-Host "缺少 auth\.env — 請先複製 auth\.env.example 為 auth\.env 並填寫"
  exit 1
}

$env:HOST = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$env:COOKIE_SAMESITE = if ($env:COOKIE_SAMESITE) { $env:COOKIE_SAMESITE } else { "none" }
$env:FRONTEND_ORIGINS = if ($env:FRONTEND_ORIGINS) { $env:FRONTEND_ORIGINS } else { "https://wikinb.kcis.kainnne.com,https://kainnne.github.io,https://zx50416.github.io" }

Write-Host "1) 啟動 Auth API（連這台 Windows 的 Codex CLI）…"
Write-Host "   另開視窗執行 Tunnel：.\host\tunnel-windows.ps1"
Write-Host ""

npm run auth
