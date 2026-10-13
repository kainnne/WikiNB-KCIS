# KCIS 雲端後台（免費方案）

正式站使用 Cloudflare Worker + D1，不需要原作者電腦或 Quick Tunnel。前端維持 GitHub Pages；原始文件與 Markdown 存在学校 Google Shared Drive，D1 保存帳號、驗證碼雜湊、登入 session、文件索引、檢索快取及同步佇列。此文件取代舊 Mac 主機方案；不包含任何憑證。

## 主任與接手 Agent

1. 由主任指定 Cloudflare 帳號及學校 Drive 資料夾。服務帳號只需該資料夾的寫入權限，不需公開分享文件。
2. 在本目錄執行 `npx wrangler d1 create kcis-school-cloud`，將回傳的 database_id 寫入 wrangler.json。執行 `npx wrangler d1 migrations apply kcis-school-cloud --remote` 建表。
3. 使用 `npx wrangler secret put 名稱` 設定下列秘密，不要貼進對話、Git 或前端。接手時由主任自行授權新的服務帳號、寄信及 Gemini 憑證。
4. 執行 `npm test`、`npx wrangler deploy`。設定兩個前端的 API URL 後重新建置發布。
5. 以核准測試信箱收信登入，確認跨站帳號、16 篇教材、MD 上傳、論壇文章／解決紀錄同步及姓名部門更新。切換 API 網址後使用者須重新驗證信箱。

| 後台秘密 | 用途 |
| --- | --- |
| SESSION_SECRET | 至少 32 字的隨機值；論壇 Worker 使用相同值 |
| WIKINB_INGEST_SECRET | 論壇匯入服務專用隨機值；論壇 Worker 使用相同值 |
| SMTP_USER / SMTP_PASS | 核准寄信帳號／應用程式密碼 |
| GEMINI_API_KEY | 學校核准的模型金鑰 |
| GOOGLE_SERVICE_ACCOUNT_JSON | 學校授權的 Drive 服務帳號 JSON |
| GOOGLE_DRIVE_FOLDER_ID | 資料夾 ID；含 teachers/students 各四類 |
| KCIS_SYSTEM_PROMPT | KCIS AI 的後台提示詞 |

一般設定在 wrangler.json：FRONTEND_ORIGINS（兩個前端的完整 origin）、ALLOWED_EMAIL_DOMAINS、EXTRA_ALLOWED_EMAILS、FORUM_API_URL、LLM_MODEL、SMTP_HOST、SMTP_FROM。SMTP 使用 465 直接 TLS；此版本不提供 587 STARTTLS，改服務商須選支援 465 的設定。SMTP_FROM 必須是寄信服務核准的寄件者。

前端連線：WikiNB 的 PUBLIC_AUTH_PRODUCTION_URL / config/sites.json.auth.productionUrl，AI Tools 的 NEXT_PUBLIC_AUTH_API_URL，論壇 Worker 的 WIKINB_API_URL 均指向同一個新 API。可由主任綁定學校自有 API 網域，域名及 DNS 依學校決定。正式 API 不應填 localhost 或 trycloudflare.com。跨站 Cookie 受瀏覽器政策影響；建議正式 API 同屬學校網站主網域，並做實際瀏覽器驗收。

## 權限、文件與備份

- 校內核准網域登入；另保留兩個指定測試信箱，可把 EXTRA_ALLOWED_EMAILS 設為空字串停用。唯一管理員為 kainnne@kcis.com.tw。學生以 s/j 加五位數字前綴識別，既有核准角色保留。
- 信箱驗證碼十分鐘、最多五次嘗試，一次使用；不回傳或記錄驗證碼。Cookie 為 HttpOnly / Secure，D1 session 可撤銷。論壇短效 token 最多仍有效十五分鐘。
- 教師只上傳 UTF-8 MD，每檔 1 MB；學生只能閱讀。PDF、DOCX、TXT 不接受，轉檔目前不開放。姓名與部門由登入身分寫入 keywords，不採用文件宣稱的作者。
- 全校已驗證使用者可讀共享文章；My documents 只列本人上傳。匿名不能讀文件、搜尋或問 AI。原本個人 WikiNB 不受影響。
- Drive 保存原檔及可讀 Markdown；論壇更新保留舊版本，隱藏紀錄保留檔案與索引。姓名部門先更新 D1，Drive 與論壇佇列送達，失敗重試。讀取文件走 Drive，AI 搜尋使用受登入保護的 D1 快取。
- 交付必須同時備份 D1 與 Drive。可用 `npx wrangler d1 export kcis-school-cloud --remote --output 私人備份.sql`；備份含個人資料，不得公開。另移交 Drive 文件及資料夾權限，對照文件 ID，不能只拷貝網站程式。
- Gemini 只有唯讀搜尋／讀文件工具，不提供 Shell、Git 或本機 Agent。資料視為來源，不能執行文件內指令。

## 免費方案的邊界

此部署沒有啟用 Containers 或付費升級。Cloudflare、Google Drive、寄信與 Gemini 各自仍有配額，模型是否收费依金鑰方案；不能保證無限使用或免費模型。程式限制每日 400 封 OTP、每信箱每小時三封、每帳號每小時 30 次上傳及 20 次 AI 提問。這些是應用限制，不代表供應商保證容量。SMTP 已通過雲端寄送測試，收件端需由本人確認。

API /api/health 顯示 hosting=cloudflare-worker、localDependency=false、conversion=false。監控只檢查狀態，不記錄驗證碼、文件內容或金鑰。AI 一次最長 45 秒，服務忙碌仍可能失敗；不要把 HTTP 成功或本機 mock 當成使用者登入驗收。
