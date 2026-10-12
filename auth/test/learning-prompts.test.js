import test from 'node:test';import assert from 'node:assert/strict';
import {learningPrompts,pickLearningPrompts} from '../../src/lib/learning-prompts.js';
test('five learning prompts show two unique choices; reset changes the pair even with repeated randomness',()=>{
 assert.equal(learningPrompts.length,5);const first=pickLearningPrompts([],()=>0.99),second=pickLearningPrompts(first.map(p=>p.id),()=>0.99);
 assert.equal(first.length,2);assert.equal(new Set(second.map(p=>p.id)).size,2);assert.notDeepEqual(new Set(first.map(p=>p.id)),new Set(second.map(p=>p.id)));
 for(const id of ['admin','teacher'])assert.match(learningPrompts.find(p=>p.id===id).text,/等我回答/);
 assert.match(learningPrompts.find(p=>p.id==='forum').text,/沒有資料/);
});
