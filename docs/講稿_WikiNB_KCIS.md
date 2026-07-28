# WikiNB for KCIS — 網站介紹講稿（條列版）

> 用途：向老師／資訊組／主管簡報時可照著念或投影  
> 線上站：https://zx50416.github.io/WikiNB-KCIS/  
> 本機登入測試：http://127.0.0.1:4322/WikiNB-KCIS/login  
> 更新日期：2026-07-28

---

## 一、開場：這是什麼

- WikiNB for KCIS 是**康橋國際學校專用的教學筆記知識庫 + AI 複習助理**。
- 一句話定位：**老師放筆記、學生依「哪位老師／哪一科」找得到、還能問 AI 複習**。
- 參考個人版 WikiNB 的「筆記 + 搜尋」思路，但**重新做成多老師、學校身分、康橋品牌**，不是把個人站直接放大。
- 姊妹站：康橋 AI 應用導航（https://zx50416.github.io/KCIS_AI_website/），本站專做教學筆記與複習。

---

## 二、產品目標（我們要解決什麼）

- 每位老師有**獨立資料夾**，互不覆蓋對方筆記。
- 每篇筆記固定兩個關鍵字：**老師名字** + **科目**（技術上另存 `teacher_id`、`subject_id`）。
- 老師可上傳／線上編輯 Markdown，內容進**校內 Google Shared Drive**（不是把老師全文推上公開 GitHub）。
- 學生登入後可瀏覽、搜尋，並用 AI（Gemini）依教材脈絡提問。
- **刻意不做**完整 LMS（點名、成績、作業繳交）——本站是知識庫 + 複習助理。

---

## 三、整體架構（講給技術／資訊組聽）

- **前端畫面**：GitHub Pages 靜態站（Astro 建置），網址含 base path `/WikiNB-KCIS/`。
- **後端 API（Auth）**：本機 Express（預設埠 **8790**），負責登入、權限、筆記讀寫、AI、同步。
- **筆記真實來源**：Google Shared Drive（服務帳號 JSON；密鑰只放 `auth/.env`，不進 git）。
- **本機 `wiki/`**：開發鏡像／快取；儲存時會寫本機 + Drive。
- **瀏覽器不直連** Gemini API、也不直連 Drive——一律經後端。
- **線上登入**：github.io（HTTPS）不能打本機 `http://127.0.0.1`，因此用 **Cloudflare Tunnel** 把 8790 暴露成 `https://….trycloudflare.com`，寫入 `config/sites.json` 的 `productionUrl`。
- **本機開發埠對照**（勿與個人 WikiNB 混用）：
  - KCIS：網站 **4322**、Auth **8790**
  - 個人 WikiNB：常見 **4321**／**8787**（可同時開，埠不同）

---

## 四、品牌與介面

- 康橋藍／紫主題（CSS 變數：`--kc-blue`、`--kc-purple`、`--kc-mist` 等）。
- 使用康橋 logo（`public/brand/kangchiao-logo.png`），**不用**個人 WikiNB 粉紅主題。
- 介面 **中英切換（i18n）**；筆記**正文維持老師原文**，不隨介面語言自動翻譯。
- 數學公式支援 **KaTeX**（`$…$`／`$$…$$`）。
- 首頁／導覽依角色變化（老師看「我的筆記」、學生看 Gemini 入口等）。

---

## 五、登入與身分

- 登入方式：**Email 六位數驗證碼（OTP）**，寄到學校信箱（SMTP）。
- 可登入對象：`@kcis.com.tw`（及核准測試信箱，由環境變數／roster 控管）。
- 角色：
  - 預設多數康橋信箱 → **學生**
  - `roster.json`／例外名單可標 **老師**／**管理員**
- 流程：輸入 Email → 收驗證碼 →（老師首次）填暱稱 → 登入成功頁。
- Session：本機 cookie；跨站（Pages → Tunnel）用 **Bearer token** + `COOKIE_SAMESITE=none`。
- 右上角顯示暱稱；可到暱稱頁修改。
- **暱稱 ≠ 資料夾 id**：改暱稱不會改 `teacher_id` 路徑，避免連結斷裂。
- 暱稱變更可同步到 wiki 顯示名／keywords／frontmatter（僅「自己的老師資料夾」，避免 admin 誤蓋老師暱稱）。
- 登入頁有**離線診斷說明**：正確本機網址、埠號對照、可複製指令、Tunnel 提示。
- 注意：開 `http://127.0.0.1:4322/` 根路徑會 404——一定要帶 `/WikiNB-KCIS/`（屬 Astro base 設計，不是壞掉）。

---

## 六、筆記內容模型

- 路徑：`wiki/teachers/{teacher_id}/{subject_id}/某篇.md`
- Frontmatter 含：`teacher`、`teacher_id`、`subject`、`subject_id`、`keywords`（兩項）、`status`（如 published／draft）等。
- 科目／處室來自科目目錄（catalog），儲存時自動補齊資料夾與 `_meta.json`。
- 另有 `wiki/index.md` 人讀索引（刪除／更名時會嘗試更新連結）。

---

## 七、老師：新增／編輯／管理筆記

- **+ Add note**：進入筆記工作流程（上傳或線上編輯）。
- **線上編輯器（`/editor`）**：
  - 新建或開啟既有 `.md`
  - 雲端列表合併「本機 + Drive」
  - 工具列／貼上可插入圖片
  - 圖片上傳 API → 存 `wiki/.../assets` 與 `public/wiki/.../assets`（供頁面顯示）
- **我的筆記（`/my-notes`）**：
  - 列出自己所有科目筆記
  - 標示儲存位置：**本機／Drive／已同步**
  - **View**：開「即時筆記頁」（見下節，解決舊靜態 404）
  - **Edit**：進編輯器
  - **Delete**：先刪本機再刪 Drive，並更新索引；刪除有倒數確認防誤觸
  - **同步雲端→本機**：把 Drive 上的 `.md` 拉回本機鏡像
- **重新命名（`/rename`）**：改檔名與交叉連結（本機端）。
- 老師導覽 CTA 導向「我的筆記」；首頁有醒目「+ Add note」。

---

## 八、致命問題修復：為什麼以前會 404、現在怎麼做

- **舊問題**：我的筆記看得到新檔、編輯也正常，但「View／WikiNB 靜態頁」404。
- **原因**：
  - 列表讀的是 **Auth 即時 API（本機+Drive）**
  - 舊 View 連的是 **GitHub Pages／Astro 建置當下的靜態 HTML**
  - Drive 模式下「同步」以前幾乎是空轉、**不會**自動把老師筆記 git push 上 Pages
- **現行解法**：
  - 新增 **即時筆記頁** `/note?teacherId=&subjectId=&slug=`，登入後由 Auth 讀內容並前端渲染 Markdown＋KaTeX
  - 我的筆記 View 改連即時頁
  - WikiNB 搜尋在 Auth 在線時**合併即時目錄**（標 `live`），點進去也是即時頁
  - 讀 Drive 時可**鏡像回本機**；「同步雲端→本機」會真的 pull
  - 幽靈檔（Drive 列得出但讀不到）不再進列表
- **請這樣講給聽眾**：筆記真相在 Drive／後端；靜態 Pages 是外殼；**即時頁才是新增後立刻可看的入口**。

---

## 九、WikiNB 瀏覽與搜尋

- 搜尋頁可依老師、科目、標題、內文關鍵字篩選。
- 靜態索引來自建置時掃描 `wiki/`（示範筆記、已部署內容）。
- 登入且後端在線時，會再合併**即時目錄**與老師自己的 list-all，避免「剛存好卻搜不到」。
- 筆記頁支援相關筆記、同老師篩選等導覽。
- 展開預覽＋點標題進入專頁（即時或靜態，依來源而定）。

---

## 十、AI 複習助理（Gemini × KCIS）

- 入口：`/codex`（導覽上學生端常顯示為 Gemini × KCIS）。
- 後端接 **Gemini**（API key 只在伺服器 `.env`）。
- 串流回應（streaming），適合長解答。
- 系統提示：可依 wiki 筆記脈絡複習，也可延伸說明與一般問答（依實作調整）。
- 歡迎例句可隨介面中／英切換。
- 未登入或 Auth 離線時會顯示連線提示。

---

## 十一、部署與維運工具（操作向）

- **本機一鍵登入通路**：`./host/local-login-mac.sh`（確保 Auth + Astro）。
- **診斷**：`./host/doctor-mac.sh`（檢查 8790／4322、productionUrl、印出正確登入網址）。
- **線上主機**：`./host/one-command-mac.sh`（Auth + Tunnel + 寫入 productionUrl／`.env`）。
- Tunnel 指令（務必對準 **8790**，不是舊文件裡的 8788）：  
  `cloudflared tunnel --url http://127.0.0.1:8790`
- 腳本已修正：讀 tunnel log 時用 `grep -a`，避免把「Binary file … matches」誤寫進 `productionUrl`。
- npm scripts 摘要：`npm run auth`、`npm run dev`、`npm run host:doctor`、`npm run host:local`、`npm run host:one`。
- 停止主機：`./host/stop-mac.sh`（若環境有提供）。
- Quick Tunnel 網址**每次重開可能改變**；改了就要更新 `productionUrl` 並部署／推 Pages，線上站才對得上。

---

## 十二、資安與治理（簡短但要講）

- 密鑰、SMTP、Drive 服務帳號、Gemini key：**只放本機 `auth/.env`，禁止 commit**。
- 老師筆記目標放在 **Shared Drive**，避免把全校教材全文堆在公開 repo。
- 預核／roster 控管誰是老師；勿對真實同仁信箱亂打測試 OTP（見 `docs/NO_TEST_OTP_EMAIL.md`）。
- Pages **禁止**設計成直連本機 HTTP Auth（mixed content／資安架構）。
- 學生／老師權限分離：寫入僅老師；讀即時筆記需登入。

---

## 十三、目前能力總表（簡報可投影）

| 能力 | 狀態 |
|------|------|
| 康橋品牌靜態站 + 搜尋 + KaTeX + i18n | ✅ |
| Email OTP 登入、暱稱、角色（學生／老師／管理員） | ✅ |
| 老師上傳／線上編輯 MD、圖片、我的筆記、刪除、重新命名 | ✅ |
| Google Shared Drive 讀寫 + 本機鏡像 | ✅ |
| 即時筆記頁＋搜尋 live 合併（解決新增後 404） | ✅ |
| 同步雲端→本機（真實 pull） | ✅ |
| Gemini 串流複習頁 | ✅ |
| GitHub Pages 公開 UI | ✅ |
| Mac + Cloudflare Tunnel 線上登入 | ✅（過渡；網址可能變） |
| 固定 Named Tunnel／正式雲端後端（如 Cloud Run） | 🔜 建議下一步 |
| RAG 向量檢索、完整稽核後台 | 🔜 路線圖 |

---

## 十四、給聽眾的使用路徑（操作演示稿）

1. **本機測試（最穩）**  
   - 終端機：`./host/local-login-mac.sh` 或分別 `npm run auth` + `npm run dev`  
   - 瀏覽器開：http://127.0.0.1:4322/WikiNB-KCIS/login  
   - Cmd+Shift+R 強制重新整理  
2. **老師**：登入 → 新增筆記 → 我的筆記 → View（即時頁）→ WikiNB 搜尋應看得到（live）  
3. **學生**：登入 → WikiNB 搜尋／瀏覽 → Gemini 複習  
4. **線上 github.io**：需本機 Auth + Tunnel 且 `productionUrl` 正確；否則用本機登入頁

---

## 十五、收束：為什麼值得試用

- **校內語境**：康橋品牌、學校信箱、老師／科目結構，不是泛用雲端硬碟。
- **一個閉環**：老師筆記 → 可搜尋知識庫 → AI 依教材複習。
- **資料放對地方**：UI 可公開展示；筆記與金鑰留在校內／私有後端。
- **已可演示**：登入、編輯、即時閱讀、搜尋、Gemini——不是純構想。
- **務實推廣建議**：先 2～5 位老師小範圍試用；同時把 Tunnel／後端穩定度當優先（比再堆功能更影響習慣）。

---

## 十六、講者備註（自己看、可略過投影）

- 演示前先跑 `./host/doctor-mac.sh`，確認 Auth／網站都 OK。
- 若 github.io 登不進去：多半是 Tunnel 掛了或 `productionUrl` 過期，不是前端壞掉。
- 勿承諾「全校已可 7×24 無主機登入」——目前線上登入仍依賴主機＋Tunnel（或未來正式雲端）。
- 文件入口：`docs/REQUIREMENTS_AND_TECH.md`、`docs/20260722_architecture_pages_drive_otp.md`、`docs/HOST_DEPLOY.md`、`docs/TECH_STANDARD_HOST_AUTH_CODEX.md`。

---

*本講稿依專案現況整理，涵蓋架構、登入、Drive、編輯器、即時筆記／404 修復、搜尋 live、Gemini、主機工具與推廣建議。*
