import { Buffer } from "node:buffer";
import {
  canonical,
  hash,
  publicDocument,
  publicUser,
  signToken,
} from "./security.mjs";
import { documentFolder, writeDrive, drive } from "./drive.mjs";
export const CATEGORIES = [
  { id: "academic", zh: "學科知識", en: "Academic knowledge" },
  { id: "extracurricular", zh: "課外知識", en: "Extracurricular knowledge" },
  { id: "ai-resolved", zh: "AI 論壇已解決", en: "AI Forum solutions" },
  { id: "ai-articles", zh: "AI 文章", en: "AI articles" },
];
const now = () => new Date().toISOString();
export async function listDocuments(env, user, params = new URLSearchParams()) {
  let rows = (
    await env.DB.prepare(
      "SELECT * FROM documents WHERE deleted_at IS NULL",
    ).all()
  ).results;
  const subject = await hash("account:" + user.email),
    query = canonical(params.get("q") || params.get("query") || "");
  return rows
    .filter(
      (row) =>
        !params.get("mine") ||
        row.owner_email === user.email ||
        row.owner_subject === subject,
    )
    .map(publicDocument)
    .filter(
      (row) =>
        (!params.get("role") || row.role === params.get("role")) &&
        (!params.get("category") || row.category === params.get("category")) &&
        (!query ||
          canonical(
            row.filename +
              " " +
              row.title +
              " " +
              row.preview +
              " " +
              row.keywords.join(" "),
          ).includes(query)),
    )
    .sort((a, b) =>
      a.source === "curriculum" && b.source === "curriculum"
        ? a.filename.localeCompare(b.filename)
        : String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
}
export async function findDocument(env, id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id)))
    throw Object.assign(Error("Document not found."), { status: 404 });
  const row = await env.DB.prepare(
    "SELECT * FROM documents WHERE id=? AND deleted_at IS NULL",
  )
    .bind(id)
    .first();
  if (!row) throw Object.assign(Error("Document not found."), { status: 404 });
  return row;
}
export async function readDocument(env, id) {
  const row = await findDocument(env, id);
  const markdown = await (
    await drive(
      env,
      "files/" + row.markdown_drive_id + "?alt=media&supportsAllDrives=true",
    )
  ).text();
  return { ...publicDocument(row), markdown };
}
export function classify(filename, text) {
  const input = canonical(filename + " " + text.slice(0, 60000));
  if (
    /\bai\b|人工智慧|人工智能|gemini|chatgpt|claude|prompt|提示詞|agent/.test(
      input,
    )
  )
    return "ai-articles";
  if (
    /教材|教學|學科|數學|國文|英文|語文|文法|物理|化學|生物|歷史|地理|curriculum|academic|grammar|mathematics/.test(
      input,
    )
  )
    return "academic";
  return "extracurricular";
}
export function profileMarkdown(text, meta) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/),
    header = (match?.[1] || "")
      .replace(
        /^(?:teacher|author|department|keywords):[^\n]*(?:\n[ \t]+[^\n]*)*/gm,
        "",
      )
      .trim();
  return (
    "---\n" +
    [
      header,
      "teacher: " + JSON.stringify(meta.uploader),
      "department: " + JSON.stringify(meta.department),
      "keywords:",
      ...meta.keywords.map((word) => "  - " + JSON.stringify(word)),
    ]
      .filter(Boolean)
      .join("\n") +
    "\n---\n" +
    (match ? text.slice(match[0].length) : text)
  );
}
export async function saveDocument(
  env,
  meta,
  markdown,
  original,
  { sourceKey = "", existing = null } = {},
) {
  const parent = await documentFolder(env, meta.role, meta.category),
    props = { kcisId: meta.id, kcisSource: meta.source || "upload" };
  const originalName = meta.id + "--original--" + meta.filename;
  const originalFile = await writeDrive(env, {
    parent,
    name: originalName,
    bytes: original,
    mime: meta.filename.endsWith(".txt") ? "text/plain" : "text/markdown",
    id: existing?.original_drive_id,
    properties: { ...props, variant: "original" },
  });
  const markdownFile = await writeDrive(env, {
    parent,
    name: meta.filename,
    bytes: markdown,
    id: existing?.markdown_drive_id,
    properties: { ...props, variant: "markdown" },
  });
  const statements = [];
  let archiveFile;
  if (existing)
    archiveFile = await writeDrive(env, {
      parent,
      name: existing.id + ".v" + existing.version + ".md",
      bytes: existing.markdown,
      properties: { kcisId: existing.id, variant: "archive" },
    });
  if (existing)
    statements.push(
      env.DB.prepare(
        "INSERT INTO revisions(id,document_id,metadata,markdown,drive_id,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        existing.id,
        existing.metadata,
        existing.markdown,
        archiveFile.id,
        now(),
      ),
    );
  statements.push(
    env.DB.prepare(
      "INSERT INTO documents(id,source_key,owner_email,owner_subject,deleted_at,version,metadata,markdown,original_drive_id,markdown_drive_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_email=excluded.owner_email,owner_subject=excluded.owner_subject,deleted_at=excluded.deleted_at,version=excluded.version,metadata=excluded.metadata,markdown=excluded.markdown,original_drive_id=excluded.original_drive_id,markdown_drive_id=excluded.markdown_drive_id",
    ).bind(
      meta.id,
      sourceKey || null,
      meta.ownerEmail || "",
      meta.ownerSubject || "",
      meta.deletedAt || null,
      meta.sourceVersion || 1,
      JSON.stringify(meta),
      markdown,
      originalFile.id,
      markdownFile.id,
    ),
  );
  await env.DB.batch(statements);
  return { id: meta.id, status: "readable", readable: true, hasMarkdown: true };
}
export async function uploadDocument(env, user, input) {
  if (!["teacher", "admin"].includes(user.role))
    throw Object.assign(Error("Only staff can upload documents."), {
      status: 403,
    });
  const filename = String(input.filename || "");
  if (!filename || filename.length > 240 || /[\\/\r\n\x00-\x1f]/.test(filename))
    throw Object.assign(Error("Invalid filename."), { status: 400 });
  if (!/\.md$/i.test(filename))
    throw Object.assign(
      Error("PDF/DOCX conversion is currently unavailable. Upload MD."),
      { status: 415 },
    );
  if (
    typeof input.contentBase64 !== "string" ||
    input.contentBase64.length > 1400000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)
  )
    throw Object.assign(Error("Upload MD files up to 1 MB."), { status: 400 });
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length || bytes.length > 1048576)
    throw Object.assign(Error("Upload a file between 1 byte and 1 MB."), {
      status: 400,
    });
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Object.assign(Error("Use a UTF-8 text file."), { status: 400 });
  }
  const extras = input.keywords || [];
  if (
    !Array.isArray(extras) ||
    extras.length > 12 ||
    extras.some(
      (word) =>
        typeof word !== "string" ||
        word.length > 40 ||
        /[\r\n\x00-\x1f]/.test(word),
    )
  )
    throw Object.assign(Error("Use up to 12 keywords of 40 characters each."), {
      status: 400,
    });
  const accountKeywords = [user.nickname, user.department],
    meta = {
      id: crypto.randomUUID(),
      role: "teachers",
      category: classify(filename, text),
      filename,
      title: filename,
      ownerEmail: user.email,
      ownerSubject: await hash("account:" + user.email),
      accountKeywords,
      department: user.department,
      uploader: user.nickname,
      keywords: [
        ...new Set([
          ...accountKeywords,
          ...extras.map((s) => s.trim()).filter(Boolean),
        ]),
      ],
      source: "upload",
      createdAt: now(),
      updatedAt: now(),
      size: bytes.length,
      readable: true,
      hasMarkdown: true,
      status: "readable",
      preview: text.slice(0, 400),
      deletedAt: null,
    };
  return saveDocument(env, meta, profileMarkdown(text, meta), bytes);
}
export async function ingest(env, input, kind) {
  const isArticle = kind === "article",
    sourceId = isArticle ? input.articleId : input.questionId,
    source = isArticle ? "forum-article" : "forum",
    sourceKey = source + ":" + sourceId;
  if (
    !/^[a-f0-9-]{36}$/.test(String(sourceId)) ||
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    typeof input.markdown !== "string" ||
    !input.markdown.trim() ||
    input.markdown.length > 30000 ||
    (input.ownerSubject && !/^[a-f0-9]{64}$/.test(input.ownerSubject))
  )
    throw Object.assign(Error("Invalid forum record."), { status: 400 });
  const existing = await env.DB.prepare(
    "SELECT * FROM documents WHERE source_key=?",
  )
    .bind(sourceKey)
    .first();
  if (existing && existing.version >= input.version)
    return { id: existing.id, duplicate: true };
  const old = existing ? JSON.parse(existing.metadata) : null,
    role = isArticle
      ? "teachers"
      : input.role === "students"
        ? "students"
        : "teachers";
  const uploader = String(input.author || "AI Forum").slice(0, 60),
    department = String(
      input.department || (role === "students" ? "學生" : "教職員"),
    ).slice(0, 40),
    title = String(input.title || "AI Forum solution")
      .replace(/[\\/\r\n\x00-\x1f]/g, " ")
      .slice(0, 160);
  const resolution = isArticle
    ? "published"
    : input.markdown.match(/^status:\s*(resolved|unresolved)/m)?.[1] ||
      "resolved";
  const meta = {
    ...old,
    resolution,
    id: old?.id || crypto.randomUUID(),
    role,
    category: isArticle ? "ai-articles" : "ai-resolved",
    source,
    [isArticle ? "articleId" : "questionId"]: sourceId,
    sourceVersion: input.version,
    filename: title + ".md",
    title,
    uploader,
    department,
    keywords: [uploader, department, "AI Forum"],
    accountKeywords: [uploader, department],
    ownerEmail: old?.ownerEmail || "",
    ownerSubject: input.ownerSubject || "",
    createdAt: old?.createdAt || now(),
    updatedAt: now(),
    deletedAt:
      input.deleted || (!isArticle && resolution !== "resolved") ? now() : null,
    readable: true,
    hasMarkdown: true,
    status: "readable",
    preview: input.markdown.slice(0, 400),
    size: new TextEncoder().encode(input.markdown).length,
  };
  return saveDocument(
    env,
    meta,
    profileMarkdown(input.markdown, meta),
    input.markdown,
    { sourceKey, existing },
  );
}
export async function syncProfiles(env) {
  const jobs = (
    await env.DB.prepare(
      "SELECT * FROM sync_jobs WHERE next_attempt_at<=? ORDER BY CASE WHEN kind='forum' THEN 0 ELSE 1 END,rowid LIMIT 8",
    )
      .bind(Date.now())
      .all()
  ).results;
  for (const job of jobs) {
    try {
      if (job.kind === "profile") {
        const row = await env.DB.prepare("SELECT * FROM documents WHERE id=?")
          .bind(job.document_id)
          .first();
        if (row) {
          await writeDrive(env, {
            name: JSON.parse(row.metadata).filename,
            bytes: row.markdown,
            id: row.markdown_drive_id,
            properties: { kcisId: row.id, variant: "markdown" },
          });
        }
      } else if (job.kind === "forum") {
        const payload = JSON.parse(job.payload),
          userRow = await env.DB.prepare("SELECT data FROM users WHERE email=?")
            .bind(payload.email)
            .first();
        if (!userRow) throw Error("Account not found.");
        const token = await signToken(
          { ...publicUser(JSON.parse(userRow.data)), authType: "email-otp" },
          env.SESSION_SECRET,
        );
        const r = await fetch(env.FORUM_API_URL + "/api/account/profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: "{}",
        });
        if (!r.ok) throw Error("Forum sync failed.");
      }
      await env.DB.prepare("DELETE FROM sync_jobs WHERE id=?")
        .bind(job.id)
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE sync_jobs SET attempts=attempts+1,next_attempt_at=?,last_error='delivery_failed' WHERE id=?",
      )
        .bind(Date.now() + 60000, job.id)
        .run();
    }
  }
}
