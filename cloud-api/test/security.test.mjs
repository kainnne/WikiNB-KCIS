import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import {
  allowedEmail,
  canonical,
  roleFor,
  checkProfile,
  signToken,
  verifyToken,
  publicDocument,
} from "../src/security.mjs";
import { listDocuments, uploadDocument, classify } from "../src/library.mjs";
test("school domains and the two approved test accounts only", () => {
  assert(allowedEmail("teacher@kcis.com.tw", {}));
  assert(allowedEmail("chaos60649@gmail.com", {}));
  assert(allowedEmail("st101031616@gmail.com", {}));
  assert(!allowedEmail("other@gmail.com", {}));
  assert(!allowedEmail("teacher@kcis.com.tw.attacker.test", {}));
  assert(!allowedEmail("bad\n@kcis.com.tw", {}));
});
test("all approved domains pass both deployed and fallback email gates", () => {
  const { vars } = JSON.parse(readFileSync(new URL("../wrangler.json", import.meta.url), "utf8"));
  for (const env of [{}, vars]) {
    for (const domain of ["kcis.ntpc.edu.tw", "kcis.com.tw", "knsh.com.tw"]) {
      // send-code and login-with-code both canonicalize before this shared gate.
      assert(allowedEmail(canonical(`  Synthetic@${domain.toUpperCase()}  `), env));
      assert(!allowedEmail(`synthetic@${domain}.attacker.test`, env));
      assert(!allowedEmail(`synthetic@sub.${domain}`, env));
      assert(!allowedEmail(`synthetic@fake${domain}`, env));
    }
    assert(!allowedEmail("synthetic@gmail.com", env));
    assert(!allowedEmail("synthetic@@knsh.com.tw", env));
  }
});
test("five-digit student prefixes and sole administrator", () => {
  assert.equal(roleFor("s12345@kcis.com.tw"), "student");
  assert.equal(roleFor("j12345@kcis.com.tw"), "student");
  assert.equal(roleFor("s123456@kcis.com.tw"), "teacher");
  assert.equal(roleFor("sxxxxx@kcis.com.tw"), "teacher");
  assert.equal(roleFor("kainnne@kcis.com.tw"), "admin");
  assert.equal(roleFor("testadmin@kcis.com.tw"), "teacher");
});
test("Chinese names and underscore are accepted; control characters rejected", () => {
  assert.deepEqual(checkProfile("朱璽_教職員", "資源中心"), {
    nickname: "朱璽_教職員",
    department: "資源中心",
  });
  assert.throws(() => checkProfile("a", "中心"));
  assert.throws(() => checkProfile("<script>", "中心"));
  assert.throws(() => checkProfile("中文姓名", "部門\n偽造"));
});
test("signed tokens reject tampering and expiration", async () => {
  const secret = "a".repeat(64),
    token = await signToken(
      {
        email: "synthetic@kcis.com.tw",
        authType: "email-otp",
        sid: "synthetic-session",
      },
      secret,
    );
  assert.equal(
    (await verifyToken(token, secret)).email,
    "synthetic@kcis.com.tw",
  );
  assert.equal(await verifyToken(token + "x", secret), null);
  assert.equal(await verifyToken(token, "b".repeat(64)), null);
  const expired = await signToken(
    { email: "synthetic@kcis.com.tw", authType: "email-otp" },
    secret,
    -1,
  );
  assert.equal(await verifyToken(expired, secret), null);
});
test("school list shares other accounts; My documents still filters owner", async () => {
  const rows = [
    {
      id: "one",
      owner_email: "a@kcis.com.tw",
      owner_subject: "",
      metadata: JSON.stringify({
        id: "one",
        filename: "Shared curriculum.md",
        title: "Shared curriculum",
        role: "teachers",
        category: "ai-articles",
        source: "curriculum",
        keywords: ["作者"],
        updatedAt: "2026-10-13",
        ownerEmail: "a@kcis.com.tw",
      }),
    },
    {
      id: "two",
      owner_email: "b@kcis.com.tw",
      owner_subject: "",
      metadata: JSON.stringify({
        id: "two",
        filename: "Own upload.md",
        title: "Own upload",
        role: "teachers",
        category: "academic",
        source: "upload",
        keywords: ["本人"],
        updatedAt: "2026-10-13",
      }),
    },
  ];
  const env = {
      DB: { prepare: () => ({ all: async () => ({ results: rows }) }) },
    },
    user = { email: "b@kcis.com.tw" };
  assert.equal((await listDocuments(env, user)).length, 2);
  assert.deepEqual(
    (await listDocuments(env, user, new URLSearchParams("mine=1"))).map(
      (r) => r.id,
    ),
    ["two"],
  );
  assert.equal(publicDocument(rows[0]).ownerEmail, undefined);
});
test("conversion is disabled server-side, and students cannot upload", async () => {
  await assert.rejects(
    uploadDocument({}, { role: "student" }, { filename: "a.md" }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    uploadDocument({}, { role: "teacher" }, { filename: "a.pdf" }),
    (e) => e.status === 415,
  );
  await assert.rejects(
    uploadDocument({}, { role: "teacher" }, { filename: "a.docx" }),
    (e) => e.status === 415,
  );
  await assert.rejects(
    uploadDocument({}, { role: "teacher" }, { filename: "a.txt" }),
    (e) => e.status === 415,
  );
  assert.equal(classify("AI 筆記.md", ""), "ai-articles");
  assert.equal(classify("教學教材.md", ""), "academic");
});

const teacher = {
  email: "synthetic@kcis.com.tw",
  role: "teacher",
  nickname: "測試_同仁",
  department: "資源中心",
};

async function uploadFixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(readFileSync(new URL("../migrations/0001_school.sql", import.meta.url), "utf8"));
  const key = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const encoded = Buffer.from(
    await crypto.subtle.exportKey("pkcs8", key.privateKey),
  ).toString("base64");
  const saved = [];
  const env = {
    GOOGLE_DRIVE_FOLDER_ID: "synthetic-root",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "synthetic@example.test",
      private_key:
        "-----BEGIN PRIVATE KEY-----\n" +
        encoded +
        "\n-----END PRIVATE KEY-----",
    }),
    DB: {
      prepare: (sql) => ({
        bind: (...values) => ({
          first: async () => db.prepare(sql).get(...values),
          run: () => db.prepare(sql).run(...values),
        }),
      }),
      async batch(statements) {
        db.exec("BEGIN");
        try {
          const results = statements.map((statement) => statement.run());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({
        access_token: "synthetic-token",
        expires_in: 3600,
      });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?"))
      return Response.json({ files: [{ id: "synthetic-folder" }] });
    const {origin, pathname} = new URL(url);
    assert.equal(origin, "https://www.googleapis.com");
    assert.match(pathname, /^\/upload\/drive\/v3\/files(?:\/[^/]+)?$/);
    const id = options.method === "PATCH"
      ? pathname.split("/").at(-1)
      : "synthetic-file-" + (saved.length + 1);
    saved.push({ id, method: options.method, body: await options.body.text() });
    return Response.json({ id });
  });
  return { db, saved, env };
}

function uploadMarkdown(env, owner, filename, text, keywords) {
  return uploadDocument(env, owner, {
    filename, contentBase64: Buffer.from(text).toString("base64"), keywords,
  });
}

test("MD upload stores the original, trusted account keywords and series frontmatter", async (t) => {
  await assert.rejects(
    uploadDocument({}, teacher, { filename: "empty.md", contentBase64: "" }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    uploadDocument({}, teacher, { filename: "binary.md", contentBase64: "/w==" }),
    (e) => e.status === 400,
  );
  const { db, saved, env } = await uploadFixture(t);
  const fields = {
    title: "登山總覽", series: "登山校外教學", series_id: "hiking-trip",
    unit: 0, parent: "00-overview", example: false,
  };
  const header = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
  const text = `---\n${header}\nteacher: "冒用作者"\ndepartment: "冒用部門"\nkeywords:\n  - "冒用關鍵字"\n---\n# 中文內容\n\nKeep this body.`;
  const result = await uploadMarkdown(env, teacher, "material.md", text, ["AI"]);
  assert.equal(result.readable, true);
  assert.equal(saved.length, 2);
  assert(saved[0].body.includes(text));
  const record = db.prepare("SELECT * FROM documents").get();
  assert.equal(record.owner_email, teacher.email);
  const metadata = JSON.parse(record.metadata);
  for (const [key, value] of Object.entries(fields)) assert.equal(metadata[key], value, key);
  assert.deepEqual(metadata.keywords, ["測試_同仁", "資源中心", "AI"]);
  assert(record.markdown.includes("Keep this body."));
  assert(!record.markdown.includes("冒用作者"));
  assert(!record.markdown.includes("冒用關鍵字"));
});

test("re-upload by the same account replaces one live document and archives the previous version", async (t) => {
  const { db, saved, env } = await uploadFixture(t);
  const liveDocuments = db.prepare("SELECT * FROM documents WHERE deleted_at IS NULL");
  const first = await uploadMarkdown(env, teacher, "material.md", "First version");
  const before = liveDocuments.get();
  const second = await uploadMarkdown(env, {...teacher, nickname: "新名稱"}, "material.md", "Second version");
  const [after, ...others] = liveDocuments.all();
  assert.equal(others.length, 0);
  assert.equal(after.id, first.id);
  assert.equal(second.id, first.id);
  assert.equal(after.version, 2);
  assert.equal(JSON.parse(after.metadata).createdAt, JSON.parse(before.metadata).createdAt);
  assert.match(after.markdown, /Second version/);
  assert.equal(after.original_drive_id, before.original_drive_id);
  assert.equal(after.markdown_drive_id, before.markdown_drive_id);
  assert.deepEqual(saved.slice(2).filter((write) => write.method === "PATCH").map((write) => write.id), [
    before.original_drive_id, before.markdown_drive_id,
  ]);
  const revisions = db.prepare("SELECT * FROM revisions WHERE document_id=?").all(first.id);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].metadata, before.metadata);
  assert.equal(revisions[0].markdown, before.markdown);
  const archive = saved.find((file) => file.id === revisions[0].drive_id);
  assert.equal(archive.method, "POST");
  assert(archive.body.includes(first.id + ".v1.md"));
  assert(archive.body.includes(before.markdown));
});

test("uploads with a different owner or filename create separate documents", async (t) => {
  const { db, env } = await uploadFixture(t);
  const otherTeacher = {...teacher, email: "other-synthetic@kcis.com.tw"};
  const first = await uploadMarkdown(env, teacher, "material.md", "First document");
  const second = await uploadMarkdown(env, otherTeacher, "material.md", "Another account");
  const third = await uploadMarkdown(env, teacher, "Material.md", "Different filename");
  const rows = db.prepare("SELECT id, version FROM documents WHERE deleted_at IS NULL").all();
  assert.equal(new Set([first.id, second.id, third.id]).size, 3);
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set([first.id, second.id, third.id]));
  assert(rows.every((row) => row.version === 1));
  assert.equal(db.prepare("SELECT count(*) AS count FROM revisions").get().count, 0);
});

test("re-upload leaves deleted uploads and curriculum with the same owner and filename alone", async (t) => {
  const { db, env } = await uploadFixture(t);
  const filename = "material.md";
  const deleted = await uploadMarkdown(env, teacher, filename, "Deleted upload");
  db.prepare("UPDATE documents SET deleted_at=? WHERE id=?").run("2026-10-01", deleted.id);
  const curriculum = await uploadMarkdown(env, teacher, filename, "Curriculum import");
  db.prepare("UPDATE documents SET metadata=json_set(metadata,'$.source','curriculum') WHERE id=?").run(curriculum.id);
  const fresh = await uploadMarkdown(env, teacher, filename, "New upload");
  assert.equal(new Set([deleted.id, curriculum.id, fresh.id]).size, 3);
  assert.equal(db.prepare("SELECT count(*) AS count FROM documents").get().count, 3);
  assert.equal(db.prepare("SELECT count(*) AS count FROM revisions").get().count, 0);
});
