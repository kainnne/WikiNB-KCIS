import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {geminiRequestBody,chatStream} from '../lib/llm.js';
import {uploadLibrary} from '../lib/school-library.js';
import {groundedContext,relevantWikiContext} from '../lib/kcis-ai-context.js';
const user={email:'teacher@kcis.com.tw',nickname:'QA teacher',name:'QA teacher',teacherId:'qa',role:'teacher',authType:'email-otp'};
class ResponseSink extends EventEmitter{events=[];writableEnded=false;setHeader(){}flushHeaders(){}write(text){this.events.push(JSON.parse(text.slice(6).trim()));}end(){this.writableEnded=true;}}
test('KCIS identity stays small; document retrieval reads relevant Markdown including long-file matches',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-ai-context-')),oldRoot=process.env.PROJECT_ROOT,oldLibrary=process.env.LIBRARY_DATA_DIR;
 process.env.PROJECT_ROOT=tmp;process.env.LIBRARY_DATA_DIR=path.join(tmp,'library');
 try{
 const dir=path.join(tmp,'wiki/teachers/qa/science');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'cells.md'),'# Cells\n'+('Intro\n'.repeat(500))+'Unique chloroplast lesson: photosynthesis uses sunlight.');
 fs.writeFileSync(path.join(dir,'irrelevant.md'),'# Completely unrelated marine lesson');
 fs.mkdirSync(path.join(dir,'private'));fs.writeFileSync(path.join(dir,'private/secret.md'),'chloroplast PRIVATE_SENTINEL');
 await uploadLibrary(user,{filename:'science.md',contentBase64:Buffer.from('# Cell library\nCell membrane controls transport.').toString('base64')});
 const request=geminiRequestBody('你是誰',[],user,'gemini-3.1-flash-lite');
 assert.match(request.systemInstruction.parts[0].text,/You are KCIS AI/);assert.ok(request.systemInstruction.parts[0].text.length<4000);
 assert.ok(!JSON.stringify(request).includes('chloroplast'));assert.equal(request.contents.at(-1).parts.length,1);
 assert.deepEqual(request.generationConfig.thinkingConfig,{thinkingLevel:'minimal'});
 assert.equal(geminiRequestBody('What does the cell membrane do?',[],user,'gemini-3.1-flash-lite').contents.at(-1).parts.length,1);
 const wiki=relevantWikiContext(user,'chloroplast');assert.match(wiki,/photosynthesis/);assert.ok(!wiki.includes('PRIVATE_SENTINEL'));assert.ok(!wiki.includes('marine'));
 const context=groundedContext(user,'What does the cell membrane do?');assert.match(context,/controls transport/);assert.ok(context.length<=6500);
 assert.throws(()=>groundedContext({...user,email:'intruder@gmail.com'},'cell membrane'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});if(oldRoot===undefined)delete process.env.PROJECT_ROOT;else process.env.PROJECT_ROOT=oldRoot;if(oldLibrary===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=oldLibrary;}
});
test('chosen reply language overrides question language without changing source text',()=>{
 const english=geminiRequestBody('你是誰',[],user,'gemini-3.1-flash-lite','en');
 const chinese=geminiRequestBody('Who are you?',[],user,'gemini-3.1-flash-lite','zh-TW');
 assert.match(english.systemInstruction.parts[0].text,/Reply in English, even when/);
 assert.match(chinese.systemInstruction.parts[0].text,/請以繁體中文回答/);
 assert.equal(english.contents.at(-1).parts.at(-1).text,'你是誰');
 assert.equal(chinese.contents.at(-1).parts.at(-1).text,'Who are you?');
});
test('streaming delivers split CRLF frames and EOF remainder; quota/configuration failures never retry',async()=>{
 const originalFetch=globalThis.fetch,keys=['LLM_PROVIDER','GEMINI_API_MODE','GEMINI_API_KEY','AI_FIRST_TOKEN_TIMEOUT_MS','AI_REQUEST_TIMEOUT_MS'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{LLM_PROVIDER:'gemini',GEMINI_API_MODE:'apikey',GEMINI_API_KEY:'synthetic-test-key',AI_FIRST_TOKEN_TIMEOUT_MS:'80',AI_REQUEST_TIMEOUT_MS:'300'});
 try{
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.ok(!String(url).includes('synthetic-test-key'));assert.equal(options.headers['x-goog-api-key'],'synthetic-test-key');assert.match(JSON.parse(options.body).systemInstruction.parts[0].text,/Reply in English, even when/);const text='data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Hello'}]}}]})+'\r\n\r\ndata: '+JSON.stringify({candidates:[{content:{parts:[{text:' world'}]}}]});return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(text.slice(0,40)));controller.enqueue(new TextEncoder().encode(text.slice(40)));controller.close();}}));};
 let res=new ResponseSink();await chatStream(res,{message:'你好',user,model:'gemini-3.1-flash-lite',sessionKey:'qa-stream',responseLanguage:'en'});assert.equal(calls,1);assert.equal(res.events.at(-1).answer,'Hello world');assert.ok(res.events.at(-1).firstTokenMs!==null);assert.ok(res.writableEnded);
 for(const status of [400,401,403,429]){calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status});};res=new ResponseSink();await chatStream(res,{message:'你好',user,sessionKey:'qa-failed'});assert.equal(calls,1);assert.equal(res.events.at(-1).type,'error');assert.equal(res.events.at(-1).retryable,false);assert.ok(res.writableEnded);}
 globalThis.fetch=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 res=new ResponseSink();const started=Date.now();await chatStream(res,{message:'你好',user,sessionKey:'qa-timeout'});assert.ok(Date.now()-started<500);assert.equal(res.events.at(-1).code,'AI_TIMEOUT');assert.equal(res.events.at(-1).type,'error');assert.notEqual(res.events.at(-1).stopped,true);
 }finally{globalThis.fetch=originalFetch;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});
test('503 rejection retries the identical question once; repeated overload stops with a recoverable error',async()=>{
 const originalFetch=globalThis.fetch,keys=['LLM_PROVIDER','GEMINI_API_MODE','GEMINI_API_KEY','AI_BUSY_RETRY_DELAY_MS','AI_FIRST_TOKEN_TIMEOUT_MS','AI_REQUEST_TIMEOUT_MS'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{LLM_PROVIDER:'gemini',GEMINI_API_MODE:'apikey',GEMINI_API_KEY:'synthetic-test-key',AI_BUSY_RETRY_DELAY_MS:'10',AI_FIRST_TOKEN_TIMEOUT_MS:'100',AI_REQUEST_TIMEOUT_MS:'300'});
 try{
  const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,body:options.body});if(requests.length===1)return new Response('{}',{status:503});return new Response('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'第一單元，先從聊天開始。'}]}}]})+'\n\n');};
  let res=new ResponseSink();await chatStream(res,{message:'我是行政同仁，想學AI',user,responseLanguage:'zh-TW',sessionKey:'qa-busy-retry'});
  assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(res.events.filter(x=>x.code==='AI_RETRY').length,1);assert.equal(res.events.at(-1).ok,true);assert.match(res.events.at(-1).answer,/第一單元/);
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:503});};res=new ResponseSink();await chatStream(res,{message:'我是行政同仁，想學AI',user,sessionKey:'qa-still-busy'});
  assert.equal(calls,2);assert.equal(res.events.at(-1).code,'AI_BUSY');assert.equal(res.events.at(-1).retryable,true);assert.ok(!res.events.some(x=>x.type==='done'));assert.ok(res.writableEnded);
 }finally{globalThis.fetch=originalFetch;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});
test('retry keeps the total deadline; stop during backoff and interruption after a delta never restart generation',async()=>{
 const originalFetch=globalThis.fetch,keys=['LLM_PROVIDER','GEMINI_API_MODE','GEMINI_API_KEY','AI_BUSY_RETRY_DELAY_MS','AI_FIRST_TOKEN_TIMEOUT_MS','AI_REQUEST_TIMEOUT_MS'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{LLM_PROVIDER:'gemini',GEMINI_API_MODE:'apikey',GEMINI_API_KEY:'synthetic-test-key',AI_BUSY_RETRY_DELAY_MS:'100',AI_FIRST_TOKEN_TIMEOUT_MS:'100',AI_REQUEST_TIMEOUT_MS:'30'});
 try{
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:503});};let res=new ResponseSink();await chatStream(res,{message:'你好',user,sessionKey:'qa-retry-deadline'});assert.equal(calls,1);assert.equal(res.events.at(-1).code,'AI_TIMEOUT');
  process.env.AI_REQUEST_TIMEOUT_MS='300';calls=0;res=new ResponseSink();globalThis.fetch=async()=>{calls++;setTimeout(()=>res.emit('close'),20);return new Response('{}',{status:503});};await chatStream(res,{message:'你好',user,sessionKey:'qa-stop-backoff'});assert.equal(calls,1);assert.equal(res.events.at(-1).stopped,true);
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Partial answer'}]}}]})+'\n\ndata: '+JSON.stringify({error:{code:503}})+'\n\n');};res=new ResponseSink();await chatStream(res,{message:'你好',user,sessionKey:'qa-interrupted'});assert.equal(calls,1);assert.ok(res.events.some(x=>x.type==='delta'));assert.equal(res.events.at(-1).code,'AI_INTERRUPTED');assert.ok(!res.events.some(x=>x.type==='done'));
 }finally{globalThis.fetch=originalFetch;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});
