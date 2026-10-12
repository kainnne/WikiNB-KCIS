import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { validateNickname } from './nickname.js';
import { assertStoredNicknameAvailable } from './nickname-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'student-accounts.json');
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function storePath() {
  return process.env.STUDENT_ACCOUNTS_FILE || DEFAULT_FILE;
}

function ensureStore() {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ students: [] }, null, 2));
  return file;
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(ensureStore(), 'utf8'));
  } catch {
    return { students: [] };
  }
}

function writeStore(store) {
  const file = ensureStore();
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function normalizeStudentNumber(value) {
  const number = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(number)) {
    throw new Error('康橋編號需為 3–32 碼英文字母、數字、底線或連字號');
  }
  return number;
}

function nicknameKey(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('zh-Hant');
}

function safeStudent(row) {
  if (!row) return null;
  const { passwordHash, ...safe } = row;
  return safe;
}

export function generateStudentPassword() {
  // 排除容易混淆的 0/O/1/l/I；密碼仍包含大小寫與數字。
  const required = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
  ].map((group) => group[crypto.randomInt(group.length)]);
  while (required.length < 6) required.push(PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)]);
  for (let i = required.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [required[i], required[j]] = [required[j], required[i]];
  }
  return required.join('');
}

export function findStudentById(id) {
  return safeStudent(readStore().students.find((row) => row.id === String(id || '')) || null);
}

export function listStudentsForTeacher(teacherId) {
  const target = String(teacherId || '').trim();
  return readStore().students
    .filter((row) => Array.isArray(row.teacherIds) && row.teacherIds.includes(target))
    .map(safeStudent)
    .sort((a, b) => String(a.nickname).localeCompare(String(b.nickname), 'zh-Hant'));
}

export async function createOrAttachStudent({ teacherId, studentNumber, nickname }) {
  const owner = String(teacherId || '').trim();
  if (!owner) throw new Error('老師帳號未綁定 teacherId');
  const number = normalizeStudentNumber(studentNumber);
  const checked = validateNickname(nickname);
  if (!checked.ok) throw new Error(checked.error);

  const store = readStore();
  const now = new Date().toISOString();
  let row = store.students.find((item) => item.studentNumber === number);
  if (row) {
    if (nicknameKey(row.nickname) !== nicknameKey(checked.nickname)) {
      throw new Error('此康橋編號已綁定其他暱稱，請向原建立老師確認');
    }
    row.teacherIds = [...new Set([...(row.teacherIds || []), owner])];
    row.active = true;
    row.updatedAt = now;
    writeStore(store);
    return { student: safeStudent(row), password: null, created: false, attached: true };
  }

  const nicknameConflict = store.students.find(
    (item) => nicknameKey(item.nickname) === nicknameKey(checked.nickname),
  );
  if (nicknameConflict) throw new Error('This display name is already taken.');
  assertStoredNicknameAvailable(checked.nickname);

  const password = generateStudentPassword();
  row = {
    id: crypto.randomUUID(),
    studentNumber: number,
    nickname: checked.nickname,
    role: 'student',
    active: true,
    teacherIds: [owner],
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: now,
    lastLoginAt: null,
  };
  // Hashing yields; re-read and re-check before committing the reservation.
  assertStoredNicknameAvailable(checked.nickname);
  const latest = readStore();
  if (latest.students.some(item => item.studentNumber === number)) throw new Error('This student ID is already registered.');
  latest.students.push(row);
  writeStore(latest);
  return { student: safeStudent(row), password, created: true, attached: true };
}

export async function resetStudentPassword({ teacherId, studentId }) {
  const store = readStore();
  const row = store.students.find((item) => item.id === String(studentId || ''));
  if (!row || !row.teacherIds?.includes(String(teacherId || ''))) throw new Error('找不到此班級學生');
  const password = generateStudentPassword();
  row.passwordHash = await bcrypt.hash(password, 10);
  row.passwordUpdatedAt = new Date().toISOString();
  row.updatedAt = row.passwordUpdatedAt;
  writeStore(store);
  return { student: safeStudent(row), password };
}

export async function authenticateStudent(nickname, password) {
  const key = nicknameKey(nickname);
  const store = readStore();
  const row = store.students.find((item) => nicknameKey(item.nickname) === key);
  if (
    !row?.passwordHash ||
    row.active === false ||
    !row.teacherIds?.length ||
    !(await bcrypt.compare(String(password || ''), row.passwordHash))
  ) return null;
  row.lastLoginAt = new Date().toISOString();
  row.updatedAt = row.lastLoginAt;
  writeStore(store);
  return safeStudent(row);
}

export function detachStudentFromTeacher({ teacherId, studentId }) {
  const store = readStore();
  const row = store.students.find((item) => item.id === String(studentId || ''));
  const owner = String(teacherId || '');
  if (!row || !row.teacherIds?.includes(owner)) throw new Error('找不到此班級學生');
  row.teacherIds = row.teacherIds.filter((id) => id !== owner);
  row.active = row.teacherIds.length > 0;
  row.updatedAt = new Date().toISOString();
  writeStore(store);
  return safeStudent(row);
}

export function canStudentAccessTeacher(studentId, teacherId) {
  const row = readStore().students.find((item) => item.id === String(studentId || ''));
  return Boolean(row?.teacherIds?.includes(String(teacherId || '')));
}

export function getStudentAccountsFilePath() {
  return ensureStore();
}
