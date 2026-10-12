import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {performance} from 'node:perf_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { libraryChat } from '../lib/library-agent.js';
import { DatabaseSync } from 'node:sqlite';
const forumRoot=process.env.KCIS_FORUM_ROOT;
test('real forum scheduled delivery reaches authenticated KCIS library; retries, versions and duplicates',{skip:!forumRoot,timeout:30000},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-forum-http-'));
 const authRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const qa=path.join(tmp,'auth');fs.mkdirSync(qa,{recursive:true});
 for(const name of ['server.js','package.json','lib'])fs.cpSync(path.join(authRoot,name),path.join(qa,name),{recursive:true});
 fs.symlinkSync(fs.realpathSync(path.join(authRoot,'node_modules')),path.join(qa,'node_modules'));
 fs.mkdirSync(path.join(qa,'data'));
 fs.cpSync(path.join(authRoot,'../src/lib'),path.join(qa,'../src/lib'),{recursive:true});
 const teacher='teacher@kcis.com.tw',student='s12345@kcis.com.tw',secret='test-session-'.repeat(5),ingest='test-ingest-'.repeat(6);
 fs.writeFileSync(path.join(qa,'data/users.json'),JSON.stringify({users:[teacher,student].map(email=>({email,nickname:'QA member',name:'QA member',role:email===teacher?'teacher':'student',verifiedAt:new Date().toISOString()}))}));
 fs.writeFileSync(path.join(tmp,'empty.env'),'');
 const wrapper=path.join(qa,'qa-server.js');
 fs.writeFileSync(wrapper,"import http from 'node:http';const listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){this.once('listening',()=>console.log('QA_PORT='+this.address().port));return listen.apply(this,args)};await import('./server.js');");
 const server=spawn(process.execPath,[wrapper],{env:{PATH:process.env.PATH,HOME:process.env.HOME,AUTH_ENV_FILE:path.join(tmp,'empty.env'),PORT:'0',HOST:'127.0.0.1',PROJECT_ROOT:tmp,LIBRARY_DATA_DIR:path.join(tmp,'library'),SESSION_SECRET:secret,WIKINB_INGEST_SECRET:ingest,DRIVE_ENABLED:'false',FORUM_API_URL:'http://127.0.0.1:18909'},stdio:['ignore','pipe','pipe']});
 let sql,profileServer;
 try{
 const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('QA backend start timeout')),10000);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/QA_PORT=(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});server.once('exit',code=>{clearTimeout(timer);reject(Error('QA backend exited '+code));});server.stderr.resume();});
 const base='http://127.0.0.1:'+port;
 const sign=email=>{const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({email,nickname:'QA member',role:email===student?'student':'teacher',authType:'email-otp',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return head+'.'+body+'.'+createHmac('sha256',secret).update(head+'.'+body).digest('base64url');};
 const teacherToken=sign(teacher),studentToken=sign(student);
 sql=new DatabaseSync(':memory:');
 for(const name of fs.readdirSync(path.join(forumRoot,'migrations')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(forumRoot,'migrations',name),'utf8'));
 const prepare=query=>{let args=[];return{bind(...v){args=v;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};};
 const env={DB:{prepare,async batch(statements){sql.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}}},SESSION_SECRET:secret,ALLOWED_ORIGIN:'https://school.example.test',LOCAL_MODE:'1',WIKINB_API_URL:base,WIKINB_INGEST_SECRET:ingest};
 const worker=(await import(pathToFileURL(path.join(forumRoot,'src/worker.mjs')))).default;
 const {syncWikiNBSolutions}=await import(pathToFileURL(path.join(forumRoot,'src/solutions.mjs')));
 profileServer=createServer(async(req,res)=>{const request=new Request('http://127.0.0.1:18909'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));});await new Promise(resolve=>profileServer.listen(18909,'127.0.0.1',resolve));
 const call=async(route,body,token=teacherToken)=>worker.fetch(new Request('https://forum.example.test/api'+route,{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const api=async(route,token=studentToken)=>fetch(base+'/api'+route,{headers:{Authorization:'Bearer '+token}});
 const id=randomUUID(),question={id,name:'QA member',department:'QA',body:'How can we verify school solution delivery?'};
 assert.equal((await call('/questions',question)).status,201);
 const solution={version:1,resolved:true,method:'Use the cobaltcheck workflow',steps:'1. Upload a document\n2. Read the converted Markdown',result:'cobaltcheck successful'};
 assert.equal((await call('/questions/'+id+'/resolve',solution,sign('other@kcis.com.tw'))).status,403);
 assert.equal((await call('/questions/'+id+'/resolve',solution)).status,200);
 assert.equal((await fetch(base+'/api/library')).status,401);
 assert.equal((await fetch(base+'/api/library/forum-solutions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 const now=Date.now();assert.equal((await syncWikiNBSolutions(env,{now,fetcher:async()=>new Response('',{status:503})})).synced,0);
 assert.equal(sql.prepare('SELECT synced_at FROM wikinb_outbox').get().synced_at,null);
 assert.equal((await syncWikiNBSolutions(env,{now:now+61000})).synced,1);
 let files=(await (await api('/library?query=cobaltcheck')).json()).files;assert.equal(files.length,1);
 const file=files[0];assert.equal(file.source,'forum');assert.equal(file.questionId,id);assert.equal(file.sourceVersion,2);assert.equal(file.resolution,'resolved');
 const read=await (await api('/library/files/'+file.id)).json();assert.ok(read.markdown.includes(solution.method));assert.ok(read.markdown.includes(solution.steps));assert.ok(read.markdown.includes(solution.result));
 assert.ok((await (await api('/library/files/'+file.id+'/markdown')).text()).includes('cobaltcheck'));
 assert.ok((await (await api('/library/files/'+file.id+'/download')).text()).includes('cobaltcheck'));
 const runCron=async()=>{const jobs=[];worker.scheduled({cron:'*/5 * * * *'},env,{waitUntil:p=>jobs.push(p)});await Promise.all(jobs);};
 await runCron();assert.equal((await (await api('/library')).json()).files.length,1);
 assert.equal((await call('/questions/'+id+'/resolve',{...solution,version:2,method:'Updated cobaltcheck workflow'})).status,200);
 await runCron();files=(await (await api('/library')).json()).files;
 assert.equal(files.length,1);assert.equal(files[0].id,file.id);assert.equal(files[0].sourceVersion,3);
 assert.ok((await (await api('/library/files/'+file.id)).json()).markdown.includes('Updated cobaltcheck'));
 assert.ok(fs.existsSync(path.join(tmp,'library','teachers','ai-resolved',file.id,'versions','v2.md')));
 assert.ok(fs.existsSync(path.join(tmp,'library','teachers','ai-resolved',file.id,'versions','v3.md')));
 const previousStorage=process.env.LIBRARY_DATA_DIR;process.env.LIBRARY_DATA_DIR=path.join(tmp,'library');
 try{let turns=0;const answer=await libraryChat({email:student,role:'student',authType:'email-otp'},'cobaltcheck',{generate:async({contents})=>{
  turns++;assert.ok(JSON.stringify(contents).includes('Updated cobaltcheck'));
  return turns===1?{candidates:[{content:{role:'model',parts:[{functionCall:{name:'read_document',args:{id:file.id}}}]}}]}:{candidates:[{content:{parts:[{text:'Based on the updated forum solution.'}]}}]};
 }});assert.equal(turns,2);assert.equal(answer.sources[0].id,file.id);}finally{if(previousStorage===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=previousStorage;}

 const articleId=randomUUID();
 assert.equal((await call('/articles',{id:articleId,title:'Teacher cobalt article',body:'cobaltarticle full steps and context'},studentToken)).status,403);
 assert.equal((await call('/articles',{id:articleId,title:'Teacher cobalt article',body:'cobaltarticle full steps and context'})).status,201);
 // A pre-profile library copy has no stable author subject. Forum ownership
 // references must backfill it safely rather than matching a display name.
 await fetch(base+'/api/library/forum-articles',{method:'POST',headers:{Authorization:'Bearer '+ingest,'Content-Type':'application/json'},body:JSON.stringify({articleId,version:1,title:'Teacher cobalt article',author:'QA member',markdown:'# Teacher cobalt article\ncobaltarticle full steps and context'})});

 await runCron();
 const articleFiles=(await (await api('/library?query=cobaltarticle')).json()).files;assert.equal(articleFiles.length,1);
 assert.equal(articleFiles[0].source,'forum-article');assert.equal(articleFiles[0].category,'ai-articles');
 assert.ok((await (await api('/library/files/'+articleFiles[0].id)).json()).markdown.includes('full steps and context'));
 await runCron();assert.equal((await (await api('/library?query=cobaltarticle')).json()).files.length,1);

 const studentQuestionId=randomUUID();
 assert.equal((await call('/questions',{id:studentQuestionId,name:'Student',department:'Students',body:'cobaltstudent school question'},studentToken)).status,201);
 assert.equal((await call('/questions/'+studentQuestionId+'/resolve',{version:1,resolved:true,method:'cobaltstudent method',steps:'Student reproducible steps',result:'Student verification'},studentToken)).status,200);
 await runCron();
 const studentFiles=(await (await api('/library?query=cobaltstudent')).json()).files;assert.equal(studentFiles.length,1);assert.equal(studentFiles[0].role,'students');assert.equal(studentFiles[0].category,'ai-resolved');


 const upload=await fetch(base+'/api/library/upload',{method:'POST',headers:{Authorization:'Bearer '+teacherToken,'Content-Type':'application/json'},body:JSON.stringify({filename:'profile-practice.md',contentBase64:Buffer.from('# Practice\nComplete source stays intact.').toString('base64'),keywords:['Extra tag']})});assert.equal(upload.status,201);
 const uploaded=await upload.json();const start=performance.now();
 const update=await fetch(base+'/api/auth/nickname',{method:'PATCH',headers:{Authorization:'Bearer '+teacherToken,'Content-Type':'application/json'},body:JSON.stringify({nickname:'老師_更新',department:'資源中心'})});
 assert.equal(update.status,200);const changed=await update.json();assert.equal(changed.user.department,'資源中心');assert.equal(changed.sync.forum,'synced');
 console.log('PROFILE_HTTP_SPEED '+JSON.stringify({elapsedMs:Math.round(performance.now()-start),includes:'account + local library + HTTP forum profile write'}));
 await runCron();
 const updatedFiles=(await (await api('/library')).json()).files;
 for(const key of [file.id,articleFiles[0].id,uploaded.id]){const row=updatedFiles.find(row=>row.id===key);assert.ok(row.keywords.includes('老師_更新'));assert.ok(row.keywords.includes('資源中心'));assert.ok(!row.keywords.includes('QA member'));}
 assert.ok(updatedFiles.find(row=>row.id===uploaded.id).keywords.includes('Extra tag'));
 assert.ok(!updatedFiles.find(row=>row.id===studentFiles[0].id).keywords.includes('老師_更新'));
 assert.equal(sql.prepare('SELECT department FROM public_articles WHERE id=?').get(articleId).department,'資源中心');
 assert.equal(sql.prepare('SELECT author FROM article_archive WHERE article_id=? AND version=1').get(articleId).author,'QA member');

 }finally{if(profileServer)await new Promise(resolve=>profileServer.close(resolve));if(sql)sql.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));fs.rmSync(tmp,{recursive:true,force:true});}
});
