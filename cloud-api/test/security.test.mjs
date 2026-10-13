import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedEmail,
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

test("MD upload stores originals and trusted account keywords; rejects empty and invalid UTF-8", async () => {
  const teacher = {
    email: "synthetic@kcis.com.tw",
    role: "teacher",
    nickname: "測試_同仁",
    department: "資源中心",
  };
  await assert.rejects(
    uploadDocument({}, teacher, { filename: "empty.md", contentBase64: "" }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    uploadDocument({}, teacher, {
      filename: "binary.md",
      contentBase64: "/w==",
    }),
    (e) => e.status === 400,
  );
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
  const saved = [],
    bound = [],
    previousFetch = globalThis.fetch;
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
        bind: (...values) => {
          bound.push({ sql, values });
          return { sql, values };
        },
      }),
      batch: async () => [],
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "https://oauth2.googleapis.com/token")
      return Response.json({
        access_token: "synthetic-token",
        expires_in: 3600,
      });
    if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?"))
      return Response.json({ files: [{ id: "synthetic-folder" }] });
    assert(
      String(url).startsWith(
        "https://www.googleapis.com/upload/drive/v3/files?",
      ),
    );
    saved.push(await options.body.text());
    return Response.json({ id: "synthetic-file-" + saved.length });
  };
  try {
    const text =
      '---\nteacher: "冒用作者"\ndepartment: "冒用部門"\nkeywords:\n  - "冒用關鍵字"\n---\n# 中文內容\n\nKeep this body.';
    const result = await uploadDocument(env, teacher, {
      filename: "material.md",
      contentBase64: Buffer.from(text).toString("base64"),
      keywords: ["AI"],
    });
    assert.equal(result.readable, true);
    assert.equal(saved.length, 2);
    assert(saved[0].includes(text));
    const record = bound.find((item) =>
      item.sql.startsWith("INSERT INTO documents"),
    ).values;
    assert.equal(record[2], teacher.email);
    const metadata = JSON.parse(record[6]);
    assert.deepEqual(metadata.keywords, ["測試_同仁", "資源中心", "AI"]);
    assert(record[7].includes("Keep this body."));
    assert(!record[7].includes("冒用作者"));
    assert(!record[7].includes("冒用關鍵字"));
  } finally {
    globalThis.fetch = previousFetch;
  }
});
