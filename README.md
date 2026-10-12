# WikiNB KCIS

校內登入後共享的文件庫與資料問答。正式入口：https://wikinb.kcis.kainnne.com/ 。個人 `wikinb.kainnne.com` 是獨立專案。

## 開發中的新流程（2026-10-08）

- 登入集中在 AI Tools 右上角：只輸入信箱與 OTP，暱稱預設為信箱 @ 前字串；使用 HttpOnly session。除兩個指定測試帳號外，不接受一般 Gmail。前端僅保存介面狀態，權限由 API 判斷。
- 信箱 local-part 開頭為 s/j 加恰好五位數字時預設學生，其餘為老師；名單可覆寫。唯一管理員為 `kainnne@kcis.com.tw`。
- 上傳分為 `teachers`、`students`，各四類：`academic`、`extracurricular`、`ai-resolved`、`ai-articles`。依檔名／可抽取文字規則分類，不用 LLM。
- 教師上傳限 PDF、MD、DOCX、TXT，單檔 12 MB；學生可閱讀但不能上傳。WikiNB 介面可在選單切換中文／英文（論壇仍為英文），只提供檔案拖曳／選取，不提供線上編輯。後台自動保存原檔與轉換後 Markdown；PDF 另保存版面圖像及解析資訊。Keywords 固定包含當下暱稱與「教職員／學生」，另可新增最多 12 個 keywords（各 40 字），不能由檔案 metadata 冒用作者。圖片與無文字 PDF不代表已 OCR。AI 使用有界的搜尋／閱讀工具，不執行文件指令或本機 shell。舊 Wiki／檔案／學生 API 保留相容；本機 Codex 呼叫不開放，Git 同步須由指定管理員明確啟用。
- 所有新資料都經 `/api/library` 校內 session 檢查後共享，不以公開靜態檔提供。舊課堂資料保留原權限，不自動改為全校公開。
- 論壇解決紀錄由具秘密金鑰的服務匯入，版本保留；Worker 每五分鐘送出待同步佇列，失敗保留並重試；同題更新沿用文件 ID、舊版留在 versions，重複送達不新增文件。管理員隱藏／還原會同步，普通帳號不能刪除。

## 交付與儲存邊界

Astro 前端可部署於 Cloudflare Pages 或 GitHub Pages；現有 Express、PDF/DOCX 解析需要持續運行的 Node 主機，不能直接視為純 Pages／免費 Worker 專案。可使用主任指定的主機與 KCIS DNS，設定穩定 HTTPS API、前端來源 CORS 與部署 URL 即可。

`LIBRARY_DATA_DIR` 可指定文件儲存位置，預設 `data/library/`；manifest 不含依賴原電腦的絕對文件路徑，搬移後讀取已測試。帳號／名單在 `auth/data/`，也須作為持久資料備份。單一 Node 程序負責文件寫入；多副本部署前需改資料庫／物件儲存協調。

新共享資料目前保存於指定伺服器目錄，尚未接入 Drive 鏡像。既有 Drive 設定不代表新資料已同步。交付 source、lockfiles、設定範例；不要交付 `.env`、secret JSON、私人規則、`node_modules` 或真實資料。2026-10-02 AI Tools ZIP 未包含此 WikiNB 專案，本輪未建立新 ZIP。

## 本機與驗證

```sh
npm ci
npm ci --prefix auth
npm run auth
PUBLIC_BASE_PATH=/ npm run dev
npm test --prefix auth
# 同時提供論壇 source 路徑，啟用真實 HTTP 跨服務同步測試：
KCIS_FORUM_ROOT=/path/to/forum-api npm test --prefix auth
PUBLIC_BASE_PATH=/ npm run build
```

前端 4322、API 8790。`auth/.env.school.example` 提供新部署設定。先設定 `SESSION_SECRET`、SMTP 與 AI 金鑰，公開使用前接正式 HTTPS API。不要對同仁寄測試 OTP。建置後會排除舊公開文件資產，避免校內檔案被靜態發布。

線上已接共用登入試用；舊 WikiNB 介面恢復中。2026-10-08 更新 Gemini key 後，真實合成文件搜尋、讀取、回答與來源引用已通過；模型暫時 503 會在同一個 45 秒期限內重試最多兩次。

## 共用登入、暱稱與交接設定

AI Tools 使用 `/api/auth/send-code` → `/login-with-code`，首次與既有帳號均不要求輸入名稱。預設暱稱為信箱 @ 前字串；若與既有暱稱衝突則自動加序號。修改時可使用 2–20 字的中文、英文字母、數字、底線或句點，所有帳號不可撞名。登入後點右上角暱稱即可修改；登出先確認，成功後顯示狀態。WikiNB 的登入／帳號連結會返回原頁；本機入口連本機 WikiNB，不跳到正式站。

**正式站未完成的部分**：主任需提供持續運作的 Node 主機、固定 HTTPS API 網址與 DNS 授權。AI Tools `NEXT_PUBLIC_AUTH_API_URL`、WikiNB `PUBLIC_AUTH_PRODUCTION_URL` 或 `config/sites.json.auth.productionUrl`、後台 `AUTH_BASE_URL` 必須指向同一套服務。兩個前端改 URL 後都需重新建置；只更新 API key 不會接好線上登入。盡量讓 API 與兩個前端使用相同主網域，避免瀏覽器封鎖第三方 Cookie。CORS 用精確來源，不能代替校內信箱驗證。

對外可使用可選 `auth/public-gateway.js`；只轉送新版驗證碼登入、暱稱、登出、校內 library 與有 secret 保護的論壇匯入端點。舊 Wiki、Codex、Git、密碼／學生代碼等 API 不透過此閘道公開，原本本機 API 保留。設定 `SCHOOL_PRIVATE_API=http://127.0.0.1:8790`、`SCHOOL_PUBLIC_API_ORIGIN=https://核准的API網址`、`FRONTEND_ORIGINS=兩個正式前端origin`，執行 `node auth/public-gateway.js`（僅 listen 127.0.0.1:8791），再由有授權的 HTTPS 反向代理接入。主機重啟後需由服務管理器啟動兩個程序；關閉本機預覽不等於服務可持續上線。不要公開整個 8790，也不要把會變動的 Quick Tunnel 當成穩定交付。

使用者資料在 `auth/data/`，文件在 `LIBRARY_DATA_DIR`。HttpOnly Cookie 7 天，提供論壇的短效 JWT 15 分鐘；暱稱修改後後台會讀取最新使用者資料，登入頁會同步新 token。登出清除 Cookie 與目前頁面 token；已核發的 JWT 最長仍可存活到 15 分鐘期限，交付時不可宣稱即時撤銷所有舊 token。需即時撤銷時再實作共用的 token 撤銷儲存。

## SMTP 寄件設定（主任與 Agent）

`SMTP_FROM` 設定為 `康橋 AI Tools <ryanzhu@kainnne.com>`；SMTP 登入仍使用原 Gmail 帳號與憑證。2026-10-08 由本人完成 Gmail 寄件別名驗證，設定頁已顯示可設為預設／修改，外部寄件伺服器為 `smtp.porkbun.com:587`（TLS）。`ryanzhu` 的獨立 Google 帳號尚未啟用 Gmail 郵件服務；寄件別名與 Google 登入帳號是不同設定。網站實際寄件 From 尚須由本人登入收信驗收，不把 Gmail 別名驗證當成已收到網站郵件。主任可更换成學校寄信 SMTP；不要沿用原作者的憑證或把 SMTP 密碼放在前端／Git。

| 設定 | 接手時由主任提供 |
| --- | --- |
| SMTP_HOST／SMTP_PORT | 寄信服務地址；465 為直接 TLS，587 為 STARTTLS |
| SMTP_USER／SMTP_PASS | 實際寄信服務的登入帳號／專用憑證；只放後台環境變數 |
| SMTP_FROM | 使用者看到的寄件地址，須經郵件服務驗證或核准 Send As |
| DEV_LOG_CODE | 正式環境設 false，驗證碼不可寫入日誌 |
| SESSION_SECRET | 後台與論壇 Worker 共用的隨機 secret；更換會使既有 token 失效 |
| ALLOWED_EMAIL_DOMAINS | 核准的校內信箱網域；寄件信箱不因此取得使用者或管理員權限 |

獨立 Google Workspace 帳號需該帳號的有效登入方式；別名方案需先由帳號本人在 Gmail 完成寄件地址驗證。主任可換成學校擁有的寄信服務，無須依賴原作者的 Gmail。Google 官方說明：[寄件別名](https://support.google.com/mail/answer/22370)、[應用程式寄信](https://support.google.com/a/answer/176600)。非 Google SMTP 也支援相同設定，不要硬編碼個人地址或把 Secret 貼入 Agent 對話。

交接驗收應確認：全新帳號只用信箱與驗證碼登入並取得預設暱稱 → 既有帳號重新登入 → 修改暱稱在 WikiNB／論壇更新 → 登出取消／確認 → 未登入無法讀取文件 → 非校內信箱拒絕 → 一次由本人操作的真實郵件寄送，查驗實際 From，而不只看 SMTP 回應。`auth/test/otp-http.test.js` 以隔離資料與模擬郵件驗證完整 HTTP 流程，不向同仁寄信；真實寄件別名、主機與 DNS 必須另行驗收。

## 舊版架構參考

下列文件描述原有老師／科目、課堂與暫時主機方案；與上述新流程不同時，以本節新流程與實作為準。

**主機部署（Mac → 未來 Windows + Codex）：** [docs/HOST_DEPLOY.md](./docs/HOST_DEPLOY.md)  
**技術守則（架構規範）：** [docs/TECH_STANDARD_HOST_AUTH_CODEX.md](./docs/TECH_STANDARD_HOST_AUTH_CODEX.md)  
**需求：** [docs/REQUIREMENTS_AND_TECH.md](./docs/REQUIREMENTS_AND_TECH.md)  
**登入：** [docs/AUTH_ROSTER_PASSWORD.md](./docs/AUTH_ROSTER_PASSWORD.md)  
**資安 × 加人：** [docs/SECURITY_AND_ONBOARDING.md](./docs/SECURITY_AND_ONBOARDING.md)


## 目前線上試用

2026-10-08 經使用者確認，兩個正式入口導向同一臨時 HTTPS 站：`https://eve-scientist-bidder-mount.trycloudflare.com/`（AI Tools），`/library/`（WikiNB）。論壇 Worker 已升級，使用同一 SESSION_SECRET 與匯入 secret；既有 D1 已備份並套用 0001–0006。來源與文件 API 都在同一 origin，避免跨站 Cookie 阻擋。

試用依賴本機 API 8790、限定閘道 8791 與 Cloudflare 通道持續運作，未設系統開機自啟動。通道重開可能換 URL，不能視為固定部署。撤換時同步更新兩個 GitHub repo 的公開建置變數、論壇 WIKINB_API_URL／ALLOWED_ORIGINS 與後台 AUTH_BASE_URL／FRONTEND_ORIGINS，重新建置前端。SCHOOL_PORTAL_STATIC_DIR 指向 AI Tools out，SCHOOL_WIKI_STATIC_DIR 指向已通過隱私檢查的 WikiNB dist。移交前換成學校固定主機／DNS；個人 WikiNB 主站未更動。


## 原介面恢復與頁內帳號操作（2026-10-08）

恢復既有首頁、搜尋、老師、筆記閱讀與 KCIS AI 頁；後續更新已將 notes／editor 改成只上傳文件，移除 Kuse prompt 與 KCIS AI 建議提問；新共享資料庫位於 `/library/`，不再替換所有功能頁。修改暱稱用目前頁面的 dialog，成功後更新導覽而不切頁；登出先確認並重新整理同一 URL，保留路徑與搜尋条件。AI Tools 各工具的帳號視窗也不再因修改暱稱返回首頁。

公開限定閘道預設維持原 API 範圍。新增 `ENABLE_SCHOOL_LEGACY_PREVIEW=true` 需取得使用者對舊 Wiki 功能公開試用的專項授權；每個舊 API 請求先以 `/api/auth/shared-session` 確認校內 OTP，再進原有角色／文件權限。只開白名單的讀取、匯入、上傳、重新命名與 Gemini。Git、刪除、舊登入與本機 CLI 不公開。未取得此授權前，原功能僅在本機測試，不能宣稱已在線上完整可用。

2026-10-08 已取得舊 Wiki API 限定試用授權，閘道已啟用 `ENABLE_SCHOOL_LEGACY_PREVIEW=true`。本機測試未登入筆記／模型 API 為 401，校內 OTP 為 200；Git／刪除／舊登入仍為 404。SMTP 連線與帳號驗證已通過（未寄測試郵件），實際 From 由本人收取網站驗證信確認。登入導航提示只存布林值，不保存新版 JWT。

## 本機文件上傳驗收（2026-10-08）

已使用隔離資料、合成 PDF／DOCX／MD／TXT 驗證轉換、原檔 byte equality、暱稱 keywords、學生拒絕與登入後讀取。`auth/test/forum-sync.test.js` 需設定 `KCIS_FORUM_ROOT`，會使用論壇的真實 handler／scheduled 與獨立 Express API，驗證 author resolve → durable outbox → HTTP ingest → 校內讀取／搜尋／下載，包含失敗重試、不重複、版本保留與 Agent search/read_document；未提供論壇 source 時此項顯示 skipped，不能當成跨服務已驗收。測試不寄信、不呼叫 LLM、不寫 Drive。

本輪預覽只更新 localhost:4322；使用隔離後台 localhost:8910 與資料目錄，不取代線上 8790／8791 試用。正式交接由主任指定 LIBRARY_DATA_DIR、持久資料備份與 API 網域；Markdown 下載也需校內登入。掃描型 PDF 保存原檔與圖像，尚無 OCR，不能宣稱已可全文檢索。

## KCIS AI latency and editable instructions (2026-10-08)

KCIS AI 行為設定放在 `auth/prompts/kcis-ai.md`，交接時隨後台原始碼提供，不載入個人 WikiNB 的身分或私人 Agent 規則。前端的建議提問維持移除。參考個人 WikiNB 的相關段落檢索與低思考量做法；主站未更動。

部署範例預設 `LLM_MODEL=gemini-3.1-flash-lite`、`GEMINI_THINKING_LEVEL=minimal`。後台仍以接手者的環境變數為準；舊 `.env` 若指定 `gemini-flash-latest`，須自行修改並重啟。只有本機預覽已換成固定的輕量模型，線上試用沒有重啟或部署。

一般提問最多提供 6,500 字相關來源，保留原有課堂權限；身分／招呼不讀文件。只有圖片、圖表或 PDF 頁面問題才提供既有授權附件。首段回覆 15 秒、整次串流 45 秒逾時；用 `AI_FIRST_TOKEN_TIMEOUT_MS`／`AI_REQUEST_TIMEOUT_MS` 設定。逾時顯示明確錯誤並結束請求；400／401／403／429／503 不默默發第二次請求。模型服務仍可能有延遲或暫時過載，這些限制不保證每次秒回。

`auth/test/ai-runtime.test.js` 驗證相關 Markdown、問候不攜教材、課堂權限、CRLF／尾端串流 frame、provider 錯誤及逾時。實際金鑰測試使用「你是誰」與獨立合成文件，不把 mock 測試當成真實模型答案。


## Account names and school roles (2026-10-08)

Sign-in requests only email and OTP. First-time users automatically receive the email local-part as their display name; a reserved name is given a numeric suffix without adding an onboarding step. Existing custom names are preserved. Users can edit to 2–20 Chinese/English letters, digits, underscores or periods; names are unique across email and legacy classroom accounts, case-insensitively with Unicode normalization. Confirming an IME composition does not submit the account form.

The sole administrator remains `kainnne@kcis.com.tw`. `chaos60649@gmail.com` is an explicit teacher exception; `st101031616@gmail.com` is an explicit student exception. These require the same OTP verification and school-library permissions as campus accounts. `EXTRA_ALLOWED_EMAILS` configures exact exceptions; set it to an empty value to disable them at handoff. The forum verifier uses the same setting. Other Gmail accounts are rejected. Campus student emails start with `s` or `j` plus exactly five digits (a sixth digit is rejected); roster role exceptions still apply.

Account keywords and new uploads include the current display name plus `教職員` or `學生`. The UI displays these role tags as Staff/Student; optional keywords cannot override them. Teacher-only uploads remain enforced. Existing document metadata is not bulk rewritten. `USERS_FILE` and `STUDENT_ACCOUNTS_FILE` allow isolated account stores; leave them unset for existing auth/data paths. Tests use isolated stores and mocked mail, including the two specified Gmail identities; no real OTP email is required by the test suite.

Only the localhost preview is restarted for this change. Live API/Workers, Drive contents and existing notes remain unchanged.


## 2026-10-09 school content update

Teacher article sharing in AI Forum delivers authenticated WikiNB copies through a durable queue. Forum posts/replies are no longer translated. Library folders are now `academic`, `extracurricular`, `ai-resolved`, `ai-articles` under both `teachers` and `students`; migration keeps original assets and a full backup. New question solutions retain uploader role.

The private curriculum is 16 Markdown units derived from the selected handwritten video transcript and identified workshop extensions. Source files: `school-content/teachers/ai-articles/`. Install with `LIBRARY_DATA_DIR=/your/private/library node scripts/install-school-content.mjs`; unchanged units are deduplicated and revised content retains old versions. Keep the source lessons out of public Git/static exports. Supply them with a private school handoff and separately transfer the private library database.

KCIS AI presents two of five suggested prompts and a Reset button. Teacher/admin learning shares the core syllabus and uses different practice contexts. A forum overview includes only synced forum records and states when none exist. See `auth/README.md` for routes, storage, migration recovery and receiving administrator settings.


## KCIS AI language and controls (2026-10-12)

KCIS AI 每次進入均顯示 Language：EN／中文，不儲存上次選擇。其他工具維持英文介面。當次選擇同步更新 AI 介面、五個推薦提示的文字版本及聊天請求 responseLanguage（en／zh-TW）；後台驗證值後用系統指示指定回覆語言。切換不翻譯原始文件，不改權限與教材來源範圍；英文課程提示也沿用相同教材檢索。兩個推薦按鈕與 Reset 保留原行為，送出／停止提供可讀的無障礙名稱與鍵盤焦點。

本次只更新本機預覽；8 項相關測試與 Astro build／私人資料排除通過，Gemini 請求格式以模擬外部傳輸驗證，未新增真實模型呼叫。桌面1280、平板768、手機390檢查無橫向溢出；語言選擇、提示填入、重新進入均通過。


## Shared account fields (2026-10-12)

All three account controls use the same English Account dialog with Name and Department. Department defaults to 教職員 or 學生 from the verified role, and is editable without changing permissions. Display names remain unique. Saving preserves the current tool, reader, filters and drafts. Clearing old login hints during a profile update no longer emits a signed-out event.

Configure FORUM_API_URL on the Node backend and apply Forum migration 0009 before publishing this update. The profile outbox beside USERS_FILE persists retries; account-profiles.json is part of LIBRARY_DATA_DIR and must move with the library. The shared SESSION_SECRET stays backend-only. Profile delivery uses signed identity and stable author hashes, including ownership references for older forum copies; it never guesses authors by name. Existing originals and immutable history remain, while current keywords and converted Markdown metadata update. A failed delivery is shown as pending. The two profile fields are validated together; stale concurrent edits are refused without overwriting the newer account.

46 tests passed (27 auth + 19 forum), including real isolated HTTP profile delivery and legacy-copy reconciliation. In the local synthetic run, updating 250 Markdown records took a median 81 ms and maximum 96 ms; account + library + local HTTP forum write took 20 ms. These are local measurements, not a hosted latency guarantee. Manual browser checks cover success/error states, unchanged URL, retained reader/draft/filter, shared fields, and account dialog at 1280/768/390 widths. Deployment includes the two KCIS frontends, the Forum Worker migration and the shared Node backend; personal WikiNB is unchanged.


## Header menu and interface language (2026-10-12)

WikiNB KCIS keeps KCIS AI and the menu toggle in the header. AI Tools, WikiNB, account name/department, sign-in/out and interface language are inside the menu. Name and department edits stay in the current page; signing out requires confirmation. Interface language defaults to English and is stored as kcis:interface-language. Switching language preserves the URL and drafts, and does not refresh the session or change the AI conversation language, current prompt pair or document text. This release preserves the existing homepage, chat and library layouts.
