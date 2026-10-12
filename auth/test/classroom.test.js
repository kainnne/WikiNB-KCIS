import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wikinb-classroom-'));
process.env.PROJECT_ROOT = tempRoot;
process.env.STUDENT_ACCOUNTS_FILE = path.join(tempRoot, 'data', 'students.json');
process.env.PRIVATE_FILES_MANIFEST = path.join(tempRoot, 'data', 'private-files.json');

let students;
let files;
let converter;

before(async () => {
  students = await import('../lib/student-accounts.js');
  files = await import('../lib/private-files.js');
  converter = await import('../lib/document-import.js');
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('generated student passwords are six mixed-case alphanumeric characters', () => {
  for (let index = 0; index < 40; index += 1) {
    const password = students.generateStudentPassword();
    assert.match(password, /^[A-Za-z0-9]{6}$/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
  }
});

test('one student account can be attached to multiple teachers and authenticate', async () => {
  const created = await students.createOrAttachStudent({
    teacherId: 'teacher-a',
    studentNumber: 'KCIS001',
    nickname: '小明',
  });
  assert.equal(created.created, true);
  assert.equal(created.password.length, 6);

  const linked = await students.createOrAttachStudent({
    teacherId: 'teacher-b',
    studentNumber: 'kcis001',
    nickname: '小明',
  });
  assert.equal(linked.created, false);
  assert.deepEqual(new Set(linked.student.teacherIds), new Set(['teacher-a', 'teacher-b']));

  const loggedIn = await students.authenticateStudent('小明', created.password);
  assert.equal(loggedIn.id, created.student.id);
  assert.equal(await students.authenticateStudent('小明', 'Wrong1'), null);
});

test('student uploads stay private and AI corpus is class-scoped', async () => {
  const [student] = students.listStudentsForTeacher('teacher-a');
  const user = {
    nickname: student.nickname,
    role: 'student',
    authType: 'student-code',
    studentAccountId: student.id,
    teacherIds: student.teacherIds,
  };
  const uploaded = await files.importUploadedDocument(user, {
    teacherId: 'teacher-a',
    filename: '作業.txt',
    mimeType: 'text/plain',
    dataBase64: Buffer.from('分數的核心概念').toString('base64'),
    visibility: 'public',
  });
  assert.equal(uploaded.file.visibility, 'private');
  assert.equal(uploaded.published, null);
  assert.match(uploaded.file.uploadedAt, /^\d{4}-\d{2}-\d{2}T/);

  const privateRoot = path.join(
    tempRoot,
    'wiki',
    'teachers',
    'teacher-a',
    'private',
    'student',
    student.id,
    uploaded.file.id,
  );
  assert.equal(fs.existsSync(path.join(privateRoot, '作業.txt')), true);
  assert.equal(fs.existsSync(path.join(privateRoot, 'converted.md')), true);
  assert.match(files.loadPrivateCorpusForUser({ role: 'teacher', teacherId: 'teacher-a' }), /分數的核心概念/);
  assert.doesNotMatch(files.loadPrivateCorpusForUser({ role: 'teacher', teacherId: 'teacher-c' }), /分數的核心概念/);
});

test('HTML imports keep safe links while removing active content', async () => {
  const assetDir = path.join(tempRoot, 'assets');
  const result = await converter.convertDocument({
    filename: 'lesson.html',
    buffer: Buffer.from('<h2>Lesson</h2><script>alert(1)</script><a href="javascript:alert(2)">bad</a><a href="https://example.com">good</a>'),
    assetDir,
    assetUrlPrefix: '/assets',
    originalUrl: '',
  });
  assert.doesNotMatch(result.body, /<script|javascript:/i);
  assert.match(result.body, /https:\/\/example\.com/);
  assert.match(result.body, /noopener noreferrer/);
});

test('PDF math classification requires expression structure rather than digits or symbol fonts', () => {
  assert.equal(converter.classifyPdfMath('E = mc^2 | F(x) = sum(i=1..n) w_i x_i + b').isMath, true);
  assert.equal(converter.classifyPdfMath('x = 3').isMath, true);
  assert.equal(converter.classifyPdfMath('2 + 3 = 5').isMath, true);
  assert.equal(converter.classifyPdfMath('Numbers: 2026 / 08 / 06 / 123,456.78').isMath, false);
  assert.equal(converter.classifyPdfMath('特殊符號：± × ÷ ∞ → ← ★').isMath, false);
  assert.equal(converter.classifyPdfMath('20 × 30 cm').isMath, false);
  assert.equal(converter.classifyPdfMath('TYPE + ART').isMath, false);
  assert.equal(converter.classifyPdfMath('const result = convert(pdf, { preserveLayout: true });').isMath, false);
});

test('private images are available to Gemini only inside the assigned class', async () => {
  const [student] = students.listStudentsForTeacher('teacher-a');
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await files.importUploadedDocument(
    {
      nickname: student.nickname,
      role: 'student',
      authType: 'student-code',
      studentAccountId: student.id,
      teacherIds: student.teacherIds,
    },
    {
      teacherId: 'teacher-a',
      filename: 'diagram.png',
      mimeType: 'image/png',
      dataBase64: onePixelPng.toString('base64'),
    },
  );
  assert.equal(files.loadPrivateMediaForUser({ role: 'teacher', teacherId: 'teacher-a' }).length, 1);
  assert.equal(files.loadPrivateMediaForUser({ role: 'teacher', teacherId: 'teacher-c' }).length, 0);
  await assert.rejects(
    () => files.importUploadedDocument(
      { nickname: student.nickname, role: 'student', authType: 'student-code', studentAccountId: student.id, teacherIds: student.teacherIds },
      { teacherId: 'teacher-a', filename: 'fake.png', dataBase64: Buffer.from('<script>').toString('base64') },
    ),
    /副檔名不符/,
  );
});

test('teachers can revoke only their own class membership', () => {
  const [student] = students.listStudentsForTeacher('teacher-a');
  const stillActive = students.detachStudentFromTeacher({ teacherId: 'teacher-a', studentId: student.id });
  assert.equal(stillActive.active, true);
  assert.deepEqual(stillActive.teacherIds, ['teacher-b']);
  const disabled = students.detachStudentFromTeacher({ teacherId: 'teacher-b', studentId: student.id });
  assert.equal(disabled.active, false);
  assert.deepEqual(disabled.teacherIds, []);
});
