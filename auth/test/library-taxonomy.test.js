import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {migrateLibraryTaxonomy,readLibrary,listLibrary,ingestForumArticle,installCourseLesson} from '../lib/school-library.js';
import {groundedContext,forumOverview} from '../lib/kcis-ai-context.js';
const user={email:'teacher@kcis.com.tw',role:'teacher',authType:'email-otp'};
test('taxonomy migration preserves original bytes, PDF assets, solution versions and a recoverable backup',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-taxonomy-')),saved=process.env.LIBRARY_DATA_DIR;process.env.LIBRARY_DATA_DIR=path.join(tmp,'library');
 try{
  const rows=[{id:randomUUID(),role:'teachers',category:'mathematics',source:'upload',filename:'lesson.pdf',updatedAt:'2026-10-08',readable:true},{id:randomUUID(),role:'teachers',category:'ai-digital',source:'forum',filename:'solution.md',updatedAt:'2026-10-08',readable:true}];
  fs.mkdirSync(process.env.LIBRARY_DATA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.LIBRARY_DATA_DIR,'manifest.json'),JSON.stringify(rows));
  for(const row of rows){const dir=path.join(process.env.LIBRARY_DATA_DIR,row.role,row.category,row.id);fs.mkdirSync(path.join(dir,'assets'),{recursive:true});fs.mkdirSync(path.join(dir,'versions'));fs.writeFileSync(path.join(dir,'original'),Buffer.from([0,1,2,255]));fs.writeFileSync(path.join(dir,'content.md'),'Complete original lesson');fs.writeFileSync(path.join(dir,'assets/page.png'),'page bytes');fs.writeFileSync(path.join(dir,'versions/v2.md'),'old snapshot');}
  const migrated=migrateLibraryTaxonomy();assert.deepEqual(migrated.map(row=>row.category),['academic','ai-resolved']);
  assert.equal(fs.readdirSync(path.join(process.env.LIBRARY_DATA_DIR,'teachers')).length,4);assert.equal(fs.readdirSync(path.join(process.env.LIBRARY_DATA_DIR,'students')).length,4);
  for(const row of migrated){const dir=path.join(process.env.LIBRARY_DATA_DIR,row.role,row.category,row.id);assert.deepEqual(fs.readFileSync(path.join(dir,'original')),Buffer.from([0,1,2,255]));assert.equal(fs.readFileSync(path.join(dir,'assets/page.png'),'utf8'),'page bytes');assert.equal(fs.readFileSync(path.join(dir,'versions/v2.md'),'utf8'),'old snapshot');}
  assert.equal(migrateLibraryTaxonomy().length,2);assert.ok(fs.existsSync(process.env.LIBRARY_DATA_DIR+'.taxonomy-v1-backup/manifest.json'));
  const id=randomUUID();const a=await ingestForumArticle({articleId:id,version:1,title:'AI article',author:'老師',markdown:'# Full article\nNo omitted context'});
  assert.equal(listLibrary(user,{category:'ai-articles'}).length,1);assert.match(readLibrary(user,a.id).markdown,/No omitted context/);
  assert.equal((await ingestForumArticle({articleId:id,version:1,title:'AI article',author:'老師',markdown:'duplicate'})).duplicate,true);
  await ingestForumArticle({articleId:id,version:2,title:'AI article',author:'老師',markdown:'# Full article',deleted:true});assert.throws(()=>readLibrary(user,a.id));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});if(saved===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=saved;}
});
test('forum overview stays empty even when unrelated lessons exist',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-forum-scope-')),saved=process.env.LIBRARY_DATA_DIR;process.env.LIBRARY_DATA_DIR=tmp;
 try{fs.mkdirSync(path.join(tmp,'teachers','mathematics'),{recursive:true});await installCourseLesson({filename:'01-example.md',markdown:'---\ntitle: \"01｜課程筆記\"\n---\nAI notes unrelated to forum'});assert.equal(listLibrary(user).length,1);assert.equal(fs.readdirSync(path.join(tmp,'teachers')).length,4);assert.equal(forumOverview(user).count,0);const context=groundedContext(user,'目前 AI 論壇有哪些分享文章或解決紀錄？');assert.equal(JSON.parse(context).scope,'forum_only');assert.deepEqual(JSON.parse(context).documents,[]);}finally{fs.rmSync(tmp,{recursive:true,force:true});if(saved===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=saved;}
});

test('a syllabus followed by unit one keeps retrieval on units 01/02; explicit Chinese/English progress advances correctly',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-course-progress-')),saved=process.env.LIBRARY_DATA_DIR;process.env.LIBRARY_DATA_DIR=tmp;
 try{
  const titles=['先從聊天開始','指令就像交代工作','建立專案，使用畫布'];
  for(let i=0;i<titles.length;i++)await installCourseLesson({filename:`0${i+1}-lesson.md`,markdown:'---\ntitle: '+JSON.stringify(`0${i+1}｜${titles[i]}`)+'\n---\n# '+titles[i]+'\nComplete approved lesson '+(i+1)});
  const request={role:'user',content:'請依朱璽的筆記安排課程'};
  const assistant={role:'assistant',content:'課程目錄：\n01｜先從聊天開始\n02｜指令就像交代工作\n03｜建立專案，使用畫布\n\n### 第一單元：先從聊天開始\n請回答練習問題。'};
  let context=JSON.parse(groundedContext(user,'我了解了',[request,assistant]));assert.deepEqual(context.unitNotes.map(note=>note.title),['01｜先從聊天開始','02｜指令就像交代工作']);
  context=JSON.parse(groundedContext(user,'請教我第二單元',[request,assistant]));assert.equal(context.unitNotes[0].title,'02｜指令就像交代工作');
  context=JSON.parse(groundedContext(user,'Please teach unit 2',[request,assistant]));assert.equal(context.unitNotes[0].title,'02｜指令就像交代工作');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});if(saved===undefined)delete process.env.LIBRARY_DATA_DIR;else process.env.LIBRARY_DATA_DIR=saved;}
});
