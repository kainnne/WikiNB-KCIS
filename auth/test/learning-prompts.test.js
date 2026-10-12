import test from 'node:test';import assert from 'node:assert/strict';
import {learningPrompts,pickLearningPrompts,localizeLearningPrompt,learningPromptIcon} from '../../src/lib/learning-prompts.js';
import {isAuthoredLessonRequest,isForumOverview} from '../lib/kcis-ai-context.js';
test('five learning prompts show two unique choices; reset changes the pair even with repeated randomness',()=>{
 assert.equal(learningPrompts.length,5);const first=pickLearningPrompts([],()=>0.99),second=pickLearningPrompts(first.map(p=>p.id),()=>0.99);
 assert.equal(first.length,2);assert.equal(new Set(second.map(p=>p.id)).size,2);assert.notDeepEqual(new Set(first.map(p=>p.id)),new Set(second.map(p=>p.id)));
 for(const id of ['admin','teacher'])assert.match(learningPrompts.find(p=>p.id===id).text,/等我回答/);
 assert.match(learningPrompts.find(p=>p.id==='forum').text,/沒有資料/);
});
test('English and Chinese prompts keep the same curriculum and scoped retrieval',()=>{
 for(const prompt of learningPrompts){
  const english=localizeLearningPrompt(prompt,'en'),chinese=localizeLearningPrompt(prompt,'zh-TW');
  assert.equal(english.id,chinese.id);assert.match(chinese.label,/\p{Script=Han}/u);assert.doesNotMatch(english.text,/\p{Script=Han}/u);
  assert.ok(chinese.question.length<60);assert.ok(english.question.length<100);assert.notEqual(chinese.question,chinese.text);assert.notEqual(english.question,english.text);assert.match(learningPromptIcon(prompt.id),/aria-hidden="true"/);
  if(['admin','teacher'].includes(prompt.id)){assert.ok(isAuthoredLessonRequest(english.text));assert.ok(isAuthoredLessonRequest(chinese.text));assert.match(english.text,/wait for my answer/);}
  if(prompt.id==='forum'){assert.ok(isForumOverview(english.text));assert.ok(isForumOverview(chinese.text));}
 }
});
