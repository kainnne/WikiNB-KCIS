# WikiNB for KCIS — Agent 規則

## 專案是什麼

康橋（KCIS）教學筆記知識庫 + AI 複習助理（Codex）。

- 多老師資料夾：`wiki/teachers/{teacher_id}/{subject_id}/`
- 固定 keywords：**老師名字** + **科目**
- 品牌：康橋校徽 `public/brand/kangchiao-logo.png`；介面照 [`docs/DESIGN-RULES.md`](docs/DESIGN-RULES.md)（粉紫玻璃，2026-11-24 起）
- 詳細規格：`docs/REQUIREMENTS_AND_TECH.md`

## 目前階段

- ✅ 靜態瀏覽／搜尋、i18n、KaTeX
- ✅ **Email 驗證碼登入**（OTP；到 `/login/success`）；暱稱可改（資料夾 id 不變）
- ✅ `@kcis.com.tw` 預設學生；roster／例外信箱標老師
- ✅ Wiki 儲存層改接 **Google Shared Drive**（需服務帳號 JSON；見 `docs/20260722_architecture_pages_drive_otp.md`）
- ✅ Codex／Gemini：Gemini key 已進後端 `.env`（串流聊天下一階段）
- ✅ GitHub Pages：https://zx50416.github.io/WikiNB-KCIS/
- ✅ 主機架構（過渡：Mac + Tunnel）  
  **架構定稿（2026-07-22）：** [`docs/20260722_architecture_pages_drive_otp.md`](./docs/20260722_architecture_pages_drive_otp.md)  
  **技術守則：** [`docs/TECH_STANDARD_HOST_AUTH_CODEX.md`](./docs/TECH_STANDARD_HOST_AUTH_CODEX.md)  
  **操作手冊：** [`docs/HOST_DEPLOY.md`](./docs/HOST_DEPLOY.md)

## 改內容時

1. 筆記放在正確老師／科目資料夾
2. frontmatter 含 `teacher`、`teacher_id`、`subject`、`subject_id`、`keywords`（兩項）、`status`
3. 更新 `wiki/index.md`（若需要人讀目錄）
4. 網站程式以 `src/lib/wiki.ts` 為讀取單一來源
5. 密鑰只放 `auth/.env`，勿 commit
6. 動到登入／部署／Codex 時遵守 `TECH_STANDARD_HOST_AUTH_CODEX.md`（禁止 Pages 直連 HTTP 本機 Auth）
7. **禁止亂發測試驗證信** → [`docs/NO_TEST_OTP_EMAIL.md`](./docs/NO_TEST_OTP_EMAIL.md)（勿對同仁真實信箱打 OTP API）

## 品牌

- 2026-11-24 起（Kaine 指定）：KCIS 介面統一改為粉紫玻璃，照 [`docs/DESIGN-RULES.md`](docs/DESIGN-RULES.md)；舊的「康橋藍、勿用粉紅主題」規則作廢。
- 校徽照用；康橋紫 `#900080` 只用於 KCIS 識別。

## 本地指令

```bash
npm install
npm run auth:install
cp auth/.env.example auth/.env   # 填 SMTP／密鑰（勿 commit）
npm run auth                     # http://127.0.0.1:8788（開發）
npm run dev                      # http://127.0.0.1:4321/WikiNB-KCIS/
# 正式主機（職員可從 Pages 登入）：
# ./host/start-mac.sh  +  ./host/tunnel-mac.sh
# 並設定 config/sites.json → auth.productionUrl
```

**線上站：** https://zx50416.github.io/WikiNB-KCIS/  
**本機專案資料夾：** `/Users/kaine/Desktop/Projects/WikiNB_for_KCIS`  
職員登入／Codex = Pages + 主機 HTTPS Tunnel，不是只跑 `npm run auth`。
