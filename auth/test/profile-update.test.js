import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {uploadLibrary,listLibrary,readLibrary,ingestForumArticle,updateLibraryAccount,accountSubject} from '../lib/school-library.js';
import {accountKeywords} from '../lib/account.js';
import {ensureUserFromRoster,completeOtpLogin,updateNickname,findUserByEmail} from '../lib/users.js';
import {enqueueProfileUpdate,flushProfileUpdates,profileSyncStatus} from '../lib/profile-sync.js';
const teacher={email:'teacher@kcis.com.tw',nickname:'原本_老師',role:'teacher',department:'教職員',authType:'email-otp'};
test('name/department updates keep ownership, custom tags, originals and snapshots; delayed ingest cannot restore old keywords',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-profile-library-')),old=process.env.LIBRARY_DATA_DIR;process.env.LIBRARY_DATA_DIR=tmp;
 try{
  const bytes=Buffer.from('# Original material\nComplete body stays unchanged.');
  const upload=await uploadLibrary(teacher,{filename:'lesson.md',contentBase64:bytes.toString('base64'),keywords:['AI','教學']});
  const other=await uploadLibrary({...teacher,email:'other@kcis.com.tw',nickname:'另一位老師'},{filename:'other.md',contentBase64:bytes.toString('base64')});
  const id=randomUUID();await ingestForumArticle({articleId:id,title:'Forum article',author:teacher.nickname,ownerSubject:accountSubject(teacher.email),department:teacher.department,version:1,markdown:'# Body\nDo not discard context.'});
  const next={...teacher,nickname:'陳_老師',department:'英文科',updatedAt:'2026-10-12T01:00:00.000Z'};
  assert.equal((await updateLibraryAccount(next)).updated,2);
  const rows=listLibrary(next);assert.deepEqual(rows.find(r=>r.id===upload.id).keywords,['陳_老師','英文科','AI','教學']);assert.deepEqual(rows.find(r=>r.id===other.id).keywords,['另一位老師','教職員']);
  const dir=path.join(tmp,'teachers',upload.category,upload.id);assert.deepEqual(fs.readFileSync(path.join(dir,'original')),bytes);assert.ok(fs.readdirSync(path.join(dir,'versions')).some(name=>name.startsWith('profile-')));
  assert.match(readLibrary(next,upload.id).markdown,/Complete body stays unchanged/);assert.match(readLibrary(next,upload.id).markdown,/英文科/);
  assert.equal((await updateLibraryAccount(next)).updated,0);
  await ingestForumArticle({articleId:id,title:'Forum article',author:teacher.nickname,ownerSubject:accountSubject(teacher.email),department:teacher.department,version:2,markdown:'# New body\nLate old profile snapshot.'});
  const article=listLibrary(next).find(r=>r.articleId===id);assert.deepEqual(article.keywords,['陳_老師','英文科','AI Forum']);assert.equal(article.uploader,'陳_老師');
  assert.ok(!JSON.stringify(rows).includes('teacher@kcis.com.tw'));assert.ok(!JSON.stringify(rows).includes('ownerSubject'));
  assert.deepEqual(accountKeywords({...next,role:'student',department:'資訊科'}),['陳_老師','資訊科']);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});if(old===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=old;}
});
test('profile failures stay durable, latest edit wins and name conflicts or invalid departments change neither field',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-profile-outbox-')),keys=['USERS_FILE','STUDENT_ACCOUNTS_FILE','LIBRARY_DATA_DIR','SESSION_SECRET','FORUM_API_URL'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{USERS_FILE:path.join(tmp,'users.json'),STUDENT_ACCOUNTS_FILE:path.join(tmp,'students.json'),LIBRARY_DATA_DIR:path.join(tmp,'library'),SESSION_SECRET:'synthetic-profile-'.repeat(3),FORUM_API_URL:'https://forum.example.test'});
 try{
  ensureUserFromRoster({email:teacher.email,role:'teacher'});completeOtpLogin(teacher.email);ensureUserFromRoster({email:'other@kcis.com.tw',role:'teacher'});completeOtpLogin('other@kcis.com.tw');
  const first=updateNickname(teacher.email,'教師_甲','資源中心');enqueueProfileUpdate(first);await flushProfileUpdates({fetcher:async()=>new Response('',{status:503})});assert.equal(profileSyncStatus(teacher.email).forum,'pending');
  const next=updateNickname(teacher.email,'教師_乙','學務處');enqueueProfileUpdate(next);let payload;
  await flushProfileUpdates({fetcher:async(url,options)=>{payload=JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1],'base64url'));return new Response('{}');}});
  assert.equal(payload.nickname,'教師_乙');assert.equal(payload.department,'學務處');assert.equal(profileSyncStatus(teacher.email).forum,'synced');
  assert.throws(()=>updateNickname('other@kcis.com.tw','教師_乙','新部門'),/already taken/);assert.throws(()=>updateNickname(teacher.email,'教師_丙','x\ny'),/one line/);
  assert.throws(()=>updateNickname(teacher.email,'被覆蓋的名稱','錯誤部門',first.updatedAt),/changed elsewhere/);assert.equal(findUserByEmail(teacher.email).nickname,'教師_乙');assert.equal(findUserByEmail(teacher.email).department,'學務處');
 }finally{for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];fs.rmSync(tmp,{recursive:true,force:true});}
});
test('250 Markdown records: profile writes update only owned metadata within a bounded local time',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-profile-speed-')),old=process.env.LIBRARY_DATA_DIR;process.env.LIBRARY_DATA_DIR=tmp;
 try{
  for(let i=0;i<250;i++)await uploadLibrary(teacher,{filename:`lesson-${i}.md`,contentBase64:Buffer.from('# Synthetic lesson\nA complete practice document.').toString('base64'),keywords:['AI']});
  const times=[];for(let i=0;i<5;i++){const start=performance.now();const result=await updateLibraryAccount({...teacher,nickname:'測試_老師'+i,department:'英文科',updatedAt:new Date(1800000000000+i).toISOString()});times.push(performance.now()-start);assert.equal(result.updated,250);}
  times.sort((a,b)=>a-b);console.log('PROFILE_SPEED '+JSON.stringify({documents:250,runs:5,medianMs:Math.round(times[2]),maxMs:Math.round(times[4])}));assert.ok(times[4]<5000);assert.ok(listLibrary(teacher).every(r=>r.keywords.includes('測試_老師4')));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});if(old===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=old;}
});
