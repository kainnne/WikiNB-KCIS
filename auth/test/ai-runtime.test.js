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
 assert.match(request.systemInstruction.parts[0].text,/You are KCIS AI/);assert.ok(request.systemInstruction.parts[0].text.length<2500);
 assert.ok(!JSON.stringify(request).includes('chloroplast'));assert.equal(request.contents.at(-1).parts.length,1);
 assert.deepEqual(request.generationConfig.thinkingConfig,{thinkingLevel:'minimal'});
 assert.equal(geminiRequestBody('What does the cell membrane do?',[],user,'gemini-3.1-flash-lite').contents.at(-1).parts.length,1);
 const wiki=relevantWikiContext(user,'chloroplast');assert.match(wiki,/photosynthesis/);assert.ok(!wiki.includes('PRIVATE_SENTINEL'));assert.ok(!wiki.includes('marine'));
 const context=groundedContext(user,'What does the cell membrane do?');assert.match(context,/controls transport/);assert.ok(context.length<=6500);
 assert.throws(()=>groundedContext({...user,email:'intruder@gmail.com'},'cell membrane'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});if(oldRoot===undefined)delete process.env.PROJECT_ROOT;else process.env.PROJECT_ROOT=oldRoot;if(oldLibrary===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=oldLibrary;}
});
test('streaming delivers split CRLF frames and EOF remainder; failures never create another paid request',async()=>{
 const originalFetch=globalThis.fetch,keys=['LLM_PROVIDER','GEMINI_API_MODE','GEMINI_API_KEY','AI_FIRST_TOKEN_TIMEOUT_MS','AI_REQUEST_TIMEOUT_MS'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{LLM_PROVIDER:'gemini',GEMINI_API_MODE:'apikey',GEMINI_API_KEY:'synthetic-test-key',AI_FIRST_TOKEN_TIMEOUT_MS:'80',AI_REQUEST_TIMEOUT_MS:'300'});
 try{
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.ok(!String(url).includes('synthetic-test-key'));assert.equal(options.headers['x-goog-api-key'],'synthetic-test-key');const text='data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Hello'}]}}]})+'\r\n\r\ndata: '+JSON.stringify({candidates:[{content:{parts:[{text:' world'}]}}]});return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(text.slice(0,40)));controller.enqueue(new TextEncoder().encode(text.slice(40)));controller.close();}}));};
 let res=new ResponseSink();await chatStream(res,{message:'你好',user,model:'gemini-3.1-flash-lite',sessionKey:'qa-stream'});assert.equal(calls,1);assert.equal(res.events.at(-1).answer,'Hello world');assert.ok(res.events.at(-1).firstTokenMs!==null);assert.ok(res.writableEnded);
 for(const status of [400,401,403,429,503]){calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status});};res=new ResponseSink();await chatStream(res,{message:'你好',user,sessionKey:'qa-failed'});assert.equal(calls,1);assert.equal(res.events.at(-1).type,'error');assert.ok(res.writableEnded);}
 globalThis.fetch=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 res=new ResponseSink();const started=Date.now();await chatStream(res,{message:'你好',user,sessionKey:'qa-timeout'});assert.ok(Date.now()-started<500);assert.equal(res.events.at(-1).code,'AI_TIMEOUT');assert.equal(res.events.at(-1).type,'error');assert.notEqual(res.events.at(-1).stopped,true);
 }finally{globalThis.fetch=originalFetch;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});
