import test from 'node:test';
import assert from 'node:assert/strict';
import {chatAnswer} from '../src/chat.mjs';

test('parallel tool calls keep signatures and receive matching responses beyond the execution budget',async()=>{
 const previous=globalThis.fetch;let calls=0;
 const modelContent={role:'model',parts:Array.from({length:5},(_,index)=>({functionCall:{name:'search_library',args:{query:index===4?'UNIQUE_FIFTH':'UNIQUE_FIRST'}},...(index===0?{thoughtSignature:'synthetic-signature'}:{})}))};
 const row={id:'first',metadata:JSON.stringify({title:'UNIQUE_FIRST',keywords:[]}),markdown:'UNIQUE_FIRST'};
 const env={DB:{prepare:()=>({all:async()=>({results:[row]})})},GEMINI_API_KEY:'synthetic-test-key'};
 globalThis.fetch=async(url,{body})=>{
  calls++;
  if(calls===1)return Response.json({candidates:[{content:modelContent}]});
  const contents=JSON.parse(body).contents;
  assert.deepEqual(contents.at(-2),modelContent);
  const results=contents.at(-1).parts;
  assert.equal(results.length,5);
  assert.ok(Array.isArray(results[0].functionResponse.response.result));
  assert.match(results[4].functionResponse.response.result.error,/limit|budget/i);
  return Response.json({candidates:[{content:{parts:[{text:'Synthetic answer'}]}}]});
 };
 try{const answer=await chatAnswer(env,{message:'Synthetic question'});assert.equal(calls,2);assert.equal(answer.answer,'Synthetic answer');}
 finally{globalThis.fetch=previous;}
});
