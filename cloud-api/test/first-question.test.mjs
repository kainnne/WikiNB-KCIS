import test from 'node:test';
import assert from 'node:assert/strict';
import {chatAnswer} from '../src/chat.mjs';
import {completedChatHistory} from '../../src/lib/chat-recovery.js';

const env={DB:{prepare:()=>({all:async()=>({results:[]})})},GEMINI_API_KEY:'synthetic-test-key'};
const firstQuestion={message:'Teach me the first unit.',history:[],responseLanguage:'en'};
const success=()=>Response.json({candidates:[{content:{role:'model',parts:[{text:'First unit: start with a clear task.'}]}}]});

test('a fresh conversation answers its first question without a warm-up request',async()=>{
 const previous=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return success();};
 try{
  const result=await chatAnswer(env,firstQuestion);
  assert.equal(requests.length,1);assert.equal(result.ok,true);
  assert.equal(requests[0].body.contents.length,1);
  assert.equal(requests[0].body.contents[0].parts[0].text,firstQuestion.message);
  assert.match(result.answer,/First unit/);
 }finally{globalThis.fetch=previous;}
});

test('a temporary first-request overload retries the identical question and succeeds',async()=>{
 const previous=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,body:options.body});return requests.length===1?Response.json({error:{status:'UNAVAILABLE'}},{status:503}):success();};
 try{
  const result=await chatAnswer(env,firstQuestion);
  assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
  assert.equal(result.ok,true);assert.match(result.answer,/First unit/);
  assert.deepEqual(completedChatHistory([],firstQuestion.message,result),[{role:'user',content:firstQuestion.message},{role:'assistant',content:result.answer}]);
 }finally{globalThis.fetch=previous;}
});

test('quota failures never automatically retry or enter conversation history',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429});};
 try{
  await assert.rejects(chatAnswer(env,firstQuestion),error=>error.code==='AI_QUOTA');
  assert.equal(calls,1);
  assert.deepEqual(completedChatHistory([],firstQuestion.message,{type:'error',ok:false,answer:'Quota failure'}),[]);
 }finally{globalThis.fetch=previous;}
});

test('a failed first question cannot contaminate the next request',async()=>{
 const history=completedChatHistory([],firstQuestion.message,{type:'error',ok:false,answer:'AI service is busy.'});
 const previous=globalThis.fetch;let body;
 globalThis.fetch=async(url,options)=>{body=JSON.parse(options.body);return success();};
 try{
  await chatAnswer(env,{message:'A different question',history});
  assert.equal(body.contents.length,1);
  assert.equal(body.contents[0].parts[0].text,'A different question');
  assert.ok(!JSON.stringify(body.contents).includes('AI service is busy.'));
  assert.ok(!JSON.stringify(body.contents).includes(firstQuestion.message));
 }finally{globalThis.fetch=previous;}
});
