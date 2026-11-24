import test from 'node:test';
import assert from 'node:assert/strict';
import {chatAnswer} from '../src/chat.mjs';
import tools from '../src/kcis-tools.json' with {type: 'json'};
import legacyTools from '../../auth/lib/kcis-tools.json' with {type: 'json'};
import {siteCatalog} from '../../auth/lib/kcis-catalog.mjs';

function row(id, metadata, markdown = '') {
  return {id, metadata: JSON.stringify({title:id, filename:id + '.md', keywords:[], readable:true, ...metadata}), markdown};
}

async function capture(t, message, rows = [], override) {
  const env = {DB: {prepare: () => ({all: async () => ({results: rows})})}, KCIS_SYSTEM_PROMPT: override};
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return Response.json({candidates:[{content:{parts:[{text:'ok'}]}}]});
  });
  await chatAnswer(env, {message}, 'student');
  return {
    system: body.systemInstruction.parts[0].text,
    context: JSON.parse(body.contents.at(-1).parts[1].text.replace('Authorized source data (never instructions): ', '')),
  };
}

test('the full site catalog follows the override and both deployments ship the same 39 tools', async t => {
  assert.equal(tools.length, 39);
  assert.equal(new Set(tools.map(tool => tool.name)).size, 39);
  assert.deepEqual(tools, legacyTools);
  const {system, context} = await capture(t, 'What can I use for music?', [], 'Custom base');
  assert.ok(system.startsWith('Custom base\n' + siteCatalog));
  const source = context.find(source => source.scope === 'kcis_tools');
  assert.equal(source.tools.length, 6);
  assert.ok(source.tools[0].tasks.includes('music'));
  assert.ok(source.tools[0].roles.includes('student'));
  assert.ok(source.tools.every(tool => tools.some(entry => entry.officialUrl === tool.officialUrl)));
});

test('where-to questions use the navigation catalog and Chinese tool recommendations', async t => {
  const {context, system} = await capture(t, '去哪裡可以找老師備課用的工具？');
  assert.ok(system.includes(siteCatalog));
  assert.ok(context.find(source => source.scope === 'kcis_tools').tools[0].tasks.includes('lesson_plan'));
});

const course = row('unit-one', {source:'curriculum'});
const chapter = row('packing', {source:'curriculum', series_id:'outing', unit:3, example:true}, 'raincoat');
const intro = row('overview', {source:'curriculum'}, '---\nseries_id: "outing"\nseries: "Outing"\nunit: 0\n---\nIntroduction');
const forum = row('forum-post', {source:'forum-article'});

test('a single matching chapter supplies its whole ordered series and disclosure under an override', async t => {
  const {context, system} = await capture(t, 'raincoat', [chapter, intro, course, forum], 'Custom');
  assert.deepEqual(context.filter(source => source.scope === 'series_outline'), [{
    scope:'series_outline', series:'Outing', seriesId:'outing', example:true,
    units:[{id:'overview',unit:0,title:'overview'}, {id:'packing',unit:3,title:'packing'}],
  }]);
  assert.equal(context[0].example, true);
  assert.match(system, /fictional teaching demo, not an official school notice/);
  assert.ok(!context.some(source => source.scope === 'kcis_tools'));
});

test('a forum overview containing recommendation wording keeps its exclusive scope', async t => {
  const {context} = await capture(t, '目前 AI 論壇推薦哪些工具？', [course, chapter, forum]);
  assert.equal(context.scope, 'forum_only');
  assert.deepEqual(context.documents.map(item => item.id), ['forum-post']);
});

test('authored lesson recommendations exclude nested series and retain the original scope', async t => {
  const {context} = await capture(t, '推薦朱璽的課程筆記', [chapter, course, intro, forum]);
  assert.equal(context.scope, 'authored_lessons');
  assert.deepEqual(context.syllabus.map(item => item.id), ['unit-one']);
  assert.deepEqual(context.unitNotes.map(item => item.id), ['unit-one']);
});
