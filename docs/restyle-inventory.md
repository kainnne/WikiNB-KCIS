# 粉紫玻璃改版清單（2026-11-24）

依 `docs/DESIGN-RULES.md` 改外觀。文字、功能、流程、API、登入一律不變。下表列出每一頁會出現的畫面狀態，以及負責的樣式檔。

## 共用

| 元件 | 狀態 | 樣式位置 |
|---|---|---|
| 頁首 `Header.astro`（所有頁） | 一般、hover／按住、目前頁（KCIS AI 在 /codex 時用康橋紫）、選單展開、選單項目（AI Tools 卡、WikiNB、上傳、我的文件、帳號名稱＋部門、登出、檢查中／登入）、語言切換（玻璃軌道＋白色滑塊）、手機橫式變矮 | `Header.astro` `<style>` |
| 背景 `DecorBackground.astro` | 紙底 #fbf2f6＋淡粉紫徑向；移除藍色光球 | `global.css .kc-decor` |
| 帳號對話框 `SchoolAccount.astro` | 輸入 email、輸入驗證碼（DM Mono 字距）、錯誤訊息、送出中（disabled）、帳號（名稱、部門、儲存、登出）、確認登出、關閉鈕、底部提示（成功或錯誤） | `school-account.css` |
| 按鈕 | 主要（粉色膠囊）、次要／ghost（白玻璃膠囊）、hover 上移、按下內凹、disabled、focus 外框 | `global.css` |
| 標籤 | `tag-badge`（白玻璃）、`tag-keyword`（玫瑰紫色調玻璃） | `global.css` |
| 文件內容 `.wiki-content` | 標題、段落、連結、`[[wiki 連結]]`、清單、引言、行內程式碼、程式碼區塊、表格、圖片、PDF 頁圖、details、KaTeX（行內、區塊、錯誤） | `global.css` |
| 閱讀器 | 卡片內展開、全螢幕 dialog（背景、標題列、複製、放大／還原）、手機版 | `global.css` |

## 各頁

| 頁面 | 狀態 | 樣式位置 |
|---|---|---|
| `/`（index） | 標題 WikiNB、KCIS AI 入口（本頁唯一深色玻璃）、首頁搜尋、最近更新：載入中、未登入（隱藏）、讀取失敗、沒有文件、文件卡片（三種玻璃色調、依序飛入、游標反光） | `index.astro`、`HomeSearch.astro`、`RecentDocuments.astro` |
| `/codex`（KCIS AI） | 語言對話框；未登入提示卡；離線提示卡＋重試；聊天面板：歡迎訊息、建議問題（兩張色調卡＋重新整理鈕）、使用者泡泡（淡玫瑰玻璃）、助理泡泡（白玻璃，含 markdown／表格／程式碼／KaTeX／來源連結）、串流中（空泡泡隱藏、計時器）、系統行（DM Mono）、錯誤泡泡＋重試、停止鈕、完成時間；輸入列（玻璃膠囊＋粉色送出鈕）；全螢幕；手機直式、手機橫式（輸入列保持在第一屏）、鍵盤（dvh＋`interactive-widget=resizes-content`） | `codex.css`、`codex.astro` |
| `/search` | 標題、搜尋框（SVG 放大鏡）、結果說明、未登入提示、載入中、資料夾列（展開時箭頭用康橋紫）、文件列、展開內容（載入中、失敗＋重試）、空結果 | `search.astro`、`SearchBar.astro`、`global.css` |
| `/notes`、`/editor`（上傳） | 兩張選擇卡（選中時康橋紫邊）、未登入老師提示、拖放區（一般、拖曳中、上傳中 disabled）、關鍵字欄、作者標籤、已選檔案列（就緒、上傳中、已上傳＋查看、失敗）、格式錯誤訊息、上傳／清除鈕、說明面板（Prompt 文字框、複製／已複製／複製失敗、步驟、Kuse 連結） | `DocumentUpload.astro` |
| `/my-notes` | 標題＋上傳鈕、未登入提示、載入中、搜尋框、文件卡（交錯色調）、沒有文件、閱讀器（返回、複製、放大、下載 Markdown）、較早筆記 | `SchoolLibrary.astro` |
| `/note` | 檢查登入中、未登入提示、錯誤卡、文件：標籤、標題、檔名、下載、內容卡、底部連結、全螢幕閱讀 | `note.astro`、`global.css` |
| `/nickname` | 玻璃卡、錯誤（玫瑰）、已儲存（康橋青點綴）、輸入框、儲存、返回連結 | `nickname.astro` |
| `/login`、`/login/setup`、`/login/success`、`/student-login` | 置中的登入鈕＋帳號對話框 | `login.astro` |
| `/404` | 玻璃卡、404 用康橋紫大數字、返回鈕 | `404.astro` |
| `/wiki/*` | 轉址中的玻璃卡（有 JS 時立即轉走） | `wiki/[...slug].astro` |
| `/library`、`/teachers`、`/student`、`/students`、`/rename` | 只做轉址，沒有畫面 | — |

## 未使用但仍跟著新色票

`WikiCard.astro`、`SchoolLibrary` 的非 mine 模式（角色篩選、側邊 AI 問答）目前沒有頁面使用；它們的 class 一樣改成玻璃樣式。
