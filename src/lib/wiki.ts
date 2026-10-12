import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import katex from 'katex';

const WIKI_DIR = path.join(process.cwd(), 'wiki');
const TEACHERS_DIR = path.join(WIKI_DIR, 'teachers');

export interface WikiPage {
  slug: string;
  title: string;
  description: string;
  teacher: string;
  teacherId: string;
  subject: string;
  /** UI 英文顯示用科目名（MD 原文仍用 subject） */
  subjectEn: string;
  subjectId: string;
  keywords: string[];
  keywordsEn: string[];
  status: 'draft' | 'published';
  audience: string;
  tags: string[];
  date: string;
  updated?: string;
  body: string;
  html: string;
  excerpt: string;
}

export interface TeacherMeta {
  id: string;
  name: string;
  displayName: string;
  subjects: string[];
  status: string;
}

export interface SubjectMeta {
  id: string;
  name: string;
  nameEn: string;
  teacherId: string;
  keywords: string[];
  keywordsEn: string[];
  status: string;
}

const SUBJECT_EN_FALLBACK: Record<string, string> = {
  math: 'Math',
  english: 'English',
};

function readSubjectMeta(teacherId: string, subjectId: string): Partial<SubjectMeta> {
  if (!teacherId || !subjectId) return {};
  const metaPath = path.join(TEACHERS_DIR, teacherId, subjectId, '_meta.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SubjectMeta;
  } catch {
    return {};
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$]+\$/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function linkifyWikiLinks(html: string): string {
  const base = (import.meta.env?.BASE_URL as string) || '/';
  return html.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, rawSlug: string, label?: string) => {
      const slug = rawSlug.trim().replace(/\.md$/i, '');
      const text = (label || slug.split('/').pop() || slug).replace(/-/g, ' ');
      return `<a href="${base}wiki/${slug}" class="wiki-link">${text.trim()}</a>`;
    },
  );
}

/** 將 $...$ / $$...$$ 轉成 KaTeX HTML（避開 code block） */
function renderMathInMarkdown(md: string): string {
  const segments = md.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      let text = segment;
      text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
        try {
          return katex.renderToString(tex.trim(), {
            displayMode: true,
            throwOnError: false,
            strict: 'ignore',
          });
        } catch {
          return _m;
        }
      });
      text = text.replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => {
        try {
          return katex.renderToString(tex.trim(), {
            displayMode: false,
            throwOnError: false,
            strict: 'ignore',
          });
        } catch {
          return _m;
        }
      });
      return text;
    })
    .join('');
}

function markdownToHtml(content: string): string {
  const withMath = renderMathInMarkdown(content);
  const html = marked.parse(withMath, { async: false }) as string;
  return linkifyWikiLinks(html);
}

function formatDateField(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return s.slice(0, 32);
}

function parseWikiFile(filePath: string, slug: string): WikiPage {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const html = markdownToHtml(content);
  const plain = stripMarkdown(content);
  const date =
    formatDateField(data.date) ||
    formatDateField(data.updated) ||
    new Date().toISOString().slice(0, 10);

  const parts = slug.split('/');
  // teachers/{teacherId}/{subjectId}/{note}
  const teacherId =
    (data.teacher_id as string) ||
    (parts[0] === 'teachers' ? parts[1] : '') ||
    '';
  const subjectId =
    (data.subject_id as string) ||
    (parts[0] === 'teachers' ? parts[2] : '') ||
    '';

  const teacher = (data.teacher as string) || teacherId;
  const subjectMeta = readSubjectMeta(teacherId, subjectId);
  const subject = (data.subject as string) || subjectMeta.name || subjectId;
  const subjectEn =
    (data.subject_en as string) ||
    subjectMeta.nameEn ||
    SUBJECT_EN_FALLBACK[subjectId] ||
    subject;
  const keywords = Array.isArray(data.keywords)
    ? (data.keywords as string[])
    : [teacher, subject].filter(Boolean);
  const keywordsEn = Array.isArray(subjectMeta.keywordsEn)
    ? subjectMeta.keywordsEn
    : [teacher, subjectEn].filter(Boolean);

  return {
    slug,
    title: (data.title as string) || parts[parts.length - 1] || slug,
    description: (data.description as string) || plain.slice(0, 120),
    teacher,
    teacherId,
    subject,
    subjectEn,
    subjectId,
    keywords,
    keywordsEn,
    status: (data.status as WikiPage['status']) || 'published',
    audience: (data.audience as string) || 'students',
    tags: (data.tags as string[]) || [],
    date,
    updated: formatDateField(data.updated),
    body: content,
    html,
    excerpt: plain.slice(0, 200),
  };
}

function collectMarkdownFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'private') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md') && entry.name !== 'index.md' && entry.name !== 'README.md') {
      files.push(rel);
    }
  }
  return files;
}

/** 預設只回傳 published；開發預覽可傳 includeDrafts */
export function getAllWikiPages(options: { includeDrafts?: boolean } = {}): WikiPage[] {
  const teacherNotes = collectMarkdownFiles(TEACHERS_DIR, 'teachers');
  const pages = teacherNotes
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      return parseWikiFile(path.join(WIKI_DIR, file), slug);
    })
    .filter((p) => options.includeDrafts || p.status !== 'draft')
    .sort((a, b) => {
      const ta = new Date(a.updated || a.date).getTime();
      const tb = new Date(b.updated || b.date).getTime();
      return tb - ta;
    });
  return pages;
}

export function getWikiPage(slug: string): WikiPage | undefined {
  const filePath = path.join(WIKI_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return undefined;
  return parseWikiFile(filePath, slug);
}

export function getAllTeachers(): TeacherMeta[] {
  if (!fs.existsSync(TEACHERS_DIR)) return [];
  return fs
    .readdirSync(TEACHERS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const metaPath = path.join(TEACHERS_DIR, e.name, '_meta.json');
      if (fs.existsSync(metaPath)) {
        const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TeacherMeta;
        return {
          id: raw.id || e.name,
          name: raw.name || e.name,
          displayName: raw.displayName || raw.name || e.name,
          subjects: raw.subjects || [],
          status: raw.status || 'active',
        };
      }
      return {
        id: e.name,
        name: e.name,
        displayName: e.name,
        subjects: [],
        status: 'active',
      };
    })
    .filter((t) => t.status !== 'archived')
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hant'));
}

export function getSubjectsForTeacher(teacherId: string): SubjectMeta[] {
  const teacherDir = path.join(TEACHERS_DIR, teacherId);
  if (!fs.existsSync(teacherDir)) return [];
  return fs
    .readdirSync(teacherDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const metaPath = path.join(teacherDir, e.name, '_meta.json');
      if (fs.existsSync(metaPath)) {
        const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SubjectMeta;
        return {
          id: raw.id || e.name,
          name: raw.name || e.name,
          nameEn: raw.nameEn || SUBJECT_EN_FALLBACK[raw.id || e.name] || raw.name || e.name,
          teacherId: raw.teacherId || teacherId,
          keywords: raw.keywords || [],
          keywordsEn: raw.keywordsEn || [],
          status: raw.status || 'active',
        };
      }
      return {
        id: e.name,
        name: e.name,
        nameEn: SUBJECT_EN_FALLBACK[e.name] || e.name,
        teacherId,
        keywords: [],
        keywordsEn: [],
        status: 'active',
      };
    })
    .filter((s) => s.status !== 'archived');
}

export function getSearchIndex(pages: WikiPage[]) {
  return pages.map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    teacher: p.teacher,
    teacherId: p.teacherId,
    subject: p.subject,
    subjectEn: p.subjectEn,
    subjectId: p.subjectId,
    keywords: p.keywords,
    keywordsEn: p.keywordsEn,
    tags: p.tags,
    date: p.date,
    updated: p.updated,
    html: p.html,
    bodyText: stripMarkdown(p.body),
  }));
}

export function getPagesByTeacher(pages: WikiPage[], teacherId: string) {
  return pages.filter((p) => p.teacherId === teacherId);
}

export function getPagesByKeywords(pages: WikiPage[], teacherName?: string, subjectName?: string) {
  return pages.filter((p) => {
    const okTeacher = !teacherName || p.teacher === teacherName || p.keywords.includes(teacherName);
    const okSubject = !subjectName || p.subject === subjectName || p.keywords.includes(subjectName);
    return okTeacher && okSubject;
  });
}
