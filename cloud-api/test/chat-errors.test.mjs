import test from 'node:test';
import assert from 'node:assert/strict';
import {chatAnswer} from '../src/chat.mjs';
const env={DB:{prepare:()=>({all:async()=>({results:[]})})},GEMINI_API_KEY:'synthetic-test-key'};
for(const scenario of [
  {status:429,provider:'RESOURCE_EXHAUSTED',code:'AI_QUOTA',calls:1,retryable:true},
  {status:403,provider:'RESOURCE_EXHAUSTED',code:'AI_QUOTA',calls:1,retryable:true},
  {status:403,provider:'PERMISSION_DENIED',code:'AI_CONFIG',calls:1,retryable:false},
  {status:503,provider:'UNAVAILABLE',code:'AI_BUSY',calls:2,retryable:true},
])test(`Gemini ${scenario.status}/${scenario.provider} reports ${scenario.code}`,async()=>{
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({error:{status:scenario.provider}},{status:scenario.status});};
  try{await assert.rejects(chatAnswer(env,{message:'Synthetic test'}),error=>error.code===scenario.code&&error.retryable===scenario.retryable);assert.equal(calls,scenario.calls);}
  finally{globalThis.fetch=previous;}
});
