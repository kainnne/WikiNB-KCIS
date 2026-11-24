import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installCourseLesson, listLibrary, readLibrary, searchLibraryText} from '../lib/school-library.js';
import {siteCatalog} from '../lib/kcis-catalog.mjs';
import {groundedContext, kcisInstructions} from '../lib/kcis-ai-context.js';

const user = {email:'teacher@kcis.com.tw',role:'teacher',authType:'email-otp'};
const scheduleQuery = 'What time do students meet at school?';

function tempLibrary(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kcis-series-'));
  const tempEnv = {
    LIBRARY_DATA_DIR: path.join(tmp, 'library'),
    PRIVATE_FILES_MANIFEST: path.join(tmp, 'private-files.json'),
    PROJECT_ROOT: tmp,
  };
  const saved = Object.fromEntries(Object.keys(tempEnv).map(key => [key, process.env[key]]));
  Object.assign(process.env, tempEnv);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmp, {recursive:true,force:true});
  });
  return tmp;
}

function hikingArticle(slug, unit, section, body, overrides = {}) {
  const fields = {
    title: `【教學範例】登山校外教學 0${unit}｜${section}`,
    author: '林老師',
    series: '登山校外教學（教學範例）',
    series_id: 'hiking-trip',
    unit,
    ...(unit > 0 && {parent:'00-overview'}),
    category: 'extracurricular',
    example: true,
    keywords: ['林老師','教職員','登山校外教學','教學範例'],
    ...overrides,
  };
  return {
    filename: `event-examples/hiking-trip/${slug}.md`,
    markdown: ['---', ...Object.entries(fields).map(([key,value]) => `${key}: ${JSON.stringify(value)}`), '---', '', body].join('\n'),
  };
}

test('nested article metadata is stored, duplicate installs reuse the ID, and category changes move its versions', async t => {
  const tmp = tempLibrary(t);
  const keywords = ['林老師','教職員','schedule','meeting time'];
  const article = hikingArticle('01-schedule', 1, '行程與集合時間', '行程說明', {keywords});
  const {id, duplicate} = await installCourseLesson(article);
  assert.equal(duplicate, false);
  assert.deepEqual(await installCourseLesson(article), {id,duplicate:true});
  const [row] = listLibrary(user);
  assert.equal(row.id, id);
  assert.equal(row.sourceFile, article.filename);
  assert.equal(row.uploader, '林老師');
  assert.deepEqual(row.keywords, keywords);
  assert.equal(row.category, 'extracurricular');
  assert.equal(row.series, '登山校外教學（教學範例）');
  assert.equal(row.series_id, 'hiking-trip');
  assert.equal(row.seriesId, 'hiking-trip');
  assert.equal(row.unit, 1);
  assert.equal(row.parent, '00-overview');
  assert.equal(row.example, true);

  const updated = hikingArticle('01-schedule', 1, '行程與集合時間', '更新行程', {category:'unknown',example:false});
  assert.deepEqual(await installCourseLesson(updated), {id,duplicate:false});
  const moved = readLibrary(user, id);
  assert.equal(moved.category, 'ai-articles');
  assert.equal(moved.example, false);
  assert.equal(moved.markdown, updated.markdown);
  const teacherDir = path.join(tmp, 'library', 'teachers');
  assert.equal(fs.existsSync(path.join(teacherDir, 'extracurricular', id)), false);
  assert.equal(fs.readFileSync(path.join(teacherDir, 'ai-articles', id, 'versions', 'v1.md'), 'utf8'), article.markdown);
});

test('English full-text search finds the Chinese article and context includes one complete ordered outline', async t => {
  tempLibrary(t);
  const roles = await installCourseLesson(hikingArticle('05-staff-roles', 5, '教職員分工', 'Staff meet at school.'));
  const schedule = await installCourseLesson(hikingArticle('01-schedule', 1, '行程與集合時間',
    '學生早上七點半在學校集合。\n\n## English summary\nStudents meet at school at 7:30 a.m.'));
  const overview = await installCourseLesson(hikingArticle('00-overview', 0, '活動總覽', '登山教學活動總覽。'));

  const hits = searchLibraryText(user, scheduleQuery);
  assert.equal(hits[0].id, schedule.id);
  assert.match(hits[0].snippet, /Students meet at school at 7:30 a\.m\./);

  const outlineQuery = 'When will students meet?';
  assert.deepEqual(searchLibraryText(user, outlineQuery).map(hit => hit.id), [schedule.id,roles.id]);
  const context = groundedContext(user, outlineQuery);
  const sources = context.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.equal(sources[0].id, schedule.id);
  assert.deepEqual(sources.filter(source => source.scope === 'series_outline'), [{
    scope: 'series_outline',
    series: '登山校外教學（教學範例）',
    seriesId: 'hiking-trip',
    example: true,
    units: [
      {id:overview.id,unit:0,title:'【教學範例】登山校外教學 00｜活動總覽'},
      {id:schedule.id,unit:1,title:'【教學範例】登山校外教學 01｜行程與集合時間'},
      {id:roles.id,unit:5,title:'【教學範例】登山校外教學 05｜教職員分工'},
    ],
  }]);
  assert.equal(sources.at(-1).scope, 'series_outline');
  assert.ok(context.length <= 6500);
});

test('series articles cannot enter the authored course even with matching category and keywords', async t => {
  tempLibrary(t);
  const course = await installCourseLesson({filename:'01-chat-and-materials.md',markdown:'---\ntitle: "01｜先從聊天開始"\n---\nApproved course notes.'});
  const taggedCourse = await installCourseLesson({
    filename: '02-clear-instructions.md',
    markdown: '---\ntitle: "02｜清楚交代工作"\nseries_id: "ai-intro-course"\n---\nApproved course notes.',
  });
  const query = '請依朱璽的筆記安排課程';
  const before = JSON.parse(groundedContext(user, query));
  await installCourseLesson(hikingArticle('00-overview', 0, '活動總覽', '登山教學活動總覽。'));
  await installCourseLesson(hikingArticle('01-schedule', 1, '行程與集合時間', '學生在學校集合。', {
    category:'ai-articles',
    keywords:['AI入門課程'],
  }));
  const after = JSON.parse(groundedContext(user, query));
  assert.deepEqual(after, before);
  assert.equal(after.scope, 'authored_lessons');
  assert.deepEqual(after.syllabus.map(row => row.id), [course.id,taggedCourse.id]);
});

test('article filenames reject traversal and uppercase names', async t => {
  tempLibrary(t);
  for (const filename of ['../x.md','A.md']) {
    await assert.rejects(installCourseLesson({filename,markdown:'# Invalid filename'}), /Invalid lesson/);
  }
});

test('the site catalog survives an override and recommendations retain their source and precedence', async t => {
  tempLibrary(t);
  const previous = process.env.KCIS_SYSTEM_PROMPT;
  t.after(() => {
    if (previous === undefined) delete process.env.KCIS_SYSTEM_PROMPT;
    else process.env.KCIS_SYSTEM_PROMPT = previous;
  });
  process.env.KCIS_SYSTEM_PROMPT = 'Custom base';
  assert.ok(kcisInstructions('en').startsWith('Custom base\n\n' + siteCatalog));
  assert.match(kcisInstructions(), /fictional teaching demo/);
  for (const message of ['有什麼工具', '推薦音樂工具', '哪個工具能作曲？', '可以用什麼做海報', '去哪裡找影片', 'Which tool?', 'Recommend a tool', 'What can I use for music?']) {
    const source = JSON.parse(groundedContext(user, message).split('\n')[0]);
    assert.equal(source.scope, 'kcis_tools');
    assert.equal(source.tools.length, 6);
    if (/音樂|music/.test(message)) assert.ok(source.tools[0].tasks.includes('music'));
  }
  assert.equal(JSON.parse(groundedContext(user, '目前 AI 論壇推薦哪些工具？')).scope, 'forum_only');
  assert.equal(JSON.parse(groundedContext(user, '推薦朱璽的課程筆記')).scope, 'authored_lessons');
});
