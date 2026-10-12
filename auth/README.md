# WikiNB KCIS Auth

目前使用 Email OTP 登入，首次暱稱自動取自信箱 @ 前字串；舊密碼流程只保留相容。最新流程見根目錄 README。

驗證碼寄信由環境變數設定；目前 From 為 `ryanzhu@kainnne.com` 的已核准 Gmail 寄件別名。SMTP 驗證帳號與 From 可不同；詳細交接與驗收見根目錄 README，勿把個人 SMTP 憑證帶入公開包。

```bash
cp .env.example .env   # 填入 SMTP 應用程式密碼、SESSION_SECRET
npm install
npm start
```

預設：http://127.0.0.1:8788

## Teacher document upload and forum delivery

`POST /api/library/upload` accepts PDF, MD, DOCX and TXT only (12 MiB), with `filename`, `contentBase64`, and optional `keywords` array. Requires a verified school teacher/admin; students may read shared documents. The server prepends the current display name to keywords and validates optional tags. Originals, generated `content.md`, conversion reports and PDF layout assets remain in `LIBRARY_DATA_DIR`. `GET /api/library/files/:id/markdown` downloads converted Markdown with the same school authentication as reading/original downloads. There is no browser text editor.

Run `KCIS_FORUM_ROOT=/path/to/forum-api npm test` from auth to include the isolated real HTTP forum-to-library integration test. It exercises the actual forum scheduled job, authenticated reads, failed delivery retry, deduplication and preserved versions. The production forum cron runs every five minutes; secrets and API URL must be configured by the receiving school. No Drive mirror is implied by successful ingestion.

## KCIS AI runtime

Keep `auth/prompts/kcis-ai.md` with the backend. It defines school identity, language matching, document evidence and boundaries; no personal WikiNB persona is imported. Configure `LLM_MODEL=gemini-3.1-flash-lite`, `GEMINI_THINKING_LEVEL=minimal`, `AI_FIRST_TOKEN_TIMEOUT_MS=15000`, `AI_REQUEST_TIMEOUT_MS=45000` in the receiving server environment. Existing `.env` model overrides are preserved; restart the API after changing runtime variables. General chat retrieves matching Markdown excerpts (6,500-character budget) and only visual/PDF-page questions attach authorized media. Identity/greetings carry no documents. A stream error or deadline ends the request instead of silently restarting inference.


## Account names and school roles (2026-10-08)

Sign-in requests only email and OTP. First-time users automatically receive the email local-part as their display name; a reserved name is given a numeric suffix without adding an onboarding step. Existing custom names are preserved. Users can edit to 2–20 Chinese/English letters, digits, underscores or periods; names are unique across email and legacy classroom accounts, case-insensitively with Unicode normalization. Confirming an IME composition does not submit the account form.

The sole administrator remains `kainnne@kcis.com.tw`. `chaos60649@gmail.com` is an explicit teacher exception; `st101031616@gmail.com` is an explicit student exception. These require the same OTP verification and school-library permissions as campus accounts. `EXTRA_ALLOWED_EMAILS` configures exact exceptions; set it to an empty value to disable them at handoff. The forum verifier uses the same setting. Other Gmail accounts are rejected. Campus student emails start with `s` or `j` plus exactly five digits (a sixth digit is rejected); roster role exceptions still apply.

Account keywords and new uploads include the current display name plus `教職員` or `學生`. The UI displays these role tags as Staff/Student; optional keywords cannot override them. Teacher-only uploads remain enforced. Existing document metadata is not bulk rewritten. `USERS_FILE` and `STUDENT_ACCOUNTS_FILE` allow isolated account stores; leave them unset for existing auth/data paths. Tests use isolated stores and mocked mail, including the two specified Gmail identities; no real OTP email is required by the test suite.

Account behavior above was initially verified locally; subsequent release/deployment status is recorded with the release checks.

## Articles and curriculum (2026-10-09)

Forum articles require a verified teacher/admin session; guests and students are refused by the API. Article content is public in the forum. Its WikiNB copy requires school authentication. D1 stores immutable article snapshots and atomically queues delivery to WikiNB and (when configured) Drive. Admin deletion is reversible and propagates a tombstone; no history is destroyed. Publication triggers background delivery, with a five-minute scheduled retry. A queued response is not a claim that delivery or Drive backup has completed.

Both `teachers` and `students` now use four English category folders: `academic`, `extracurricular`, `ai-resolved`, `ai-articles`. Automatic upload classification uses filename/text rules, never an LLM. Unmatched documents go to `extracurricular`. On first access the legacy taxonomy migrates with a complete sibling backup `<LIBRARY_DATA_DIR>.taxonomy-v1-backup`; originals, PDF assets and historical versions move together. If migration fails, stop the API and restore that backup before retrying. Never merge a partly migrated tree by hand.

The 16 reviewed Markdown lessons live in `school-content/teachers/ai-articles/` and are installed into private storage using:

```bash
LIBRARY_DATA_DIR=/school/private/library node scripts/install-school-content.mjs
```

Repeated imports compare content hashes and do not duplicate unchanged lessons. Revisions retain the previous version. Include these reviewed content files in a private handoff bundle, not a public static build. Copy the library storage and its manifest separately during transfer; the ZIP source code is not a database backup. Configure the receiver's own SMTP, model credentials, session/ingest secrets, Drive folder and allowed domains. No current claim of a completed Drive mirror is made.

`POST /api/library/forum-articles` and `/forum-solutions` accept only `WIKINB_INGEST_SECRET`, set on the receiver and the forum Worker. The gateway must explicitly allow both. Article ingest records use `articleId`, `version`, `title`, `author`, `markdown`, `deleted`; replay/stale versions are idempotent. New solution records retain teacher/student origin. Existing records whose origin was not stored remain in the teacher tree.

Five suggested prompts are defined in `src/lib/learning-prompts.js`; two appear at once and Reset selects a different pair. Guided learning loads the matching current/next lesson text and shared syllabus; teacher/admin exercises differ, core units are the same. Forum summaries only use records originating in the forum and report when none exist. Forum conversation translation is removed; no Workers AI inference is performed.
