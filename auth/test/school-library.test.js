import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CATEGORIES, classifyFile, uploadLibrary, listLibrary, readLibrary, libraryAttachment, ingestForumSolution, verifyIngestSecret } from '../lib/school-library.js';
import { resolveAccountRole } from '../lib/account.js';
import { schoolLibraryContext } from '../lib/llm.js';
import { libraryChat } from '../lib/library-agent.js';
const teacher={email:'teacher@kcis.com.tw',nickname:'老師',role:'teacher',authType:'email-otp'},student={email:'s12345@kcis.com.tw',nickname:'學生',role:'student',authType:'email-otp'};
test('school-shared library: exact role taxonomy, deterministic routing, teacher document storage, authenticated read/download, relocation and agent tools',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-library-test-'));process.env.LIBRARY_DATA_DIR=path.join(tmp,'library');
  try {
    assert.equal(CATEGORIES.length,4);
    for(const email of ['s12345@kcis.com.tw','j98765@kcis.com.tw','S12345@kcis.com.tw','s12345.study@kcis.com.tw'])assert.equal(resolveAccountRole(null,email),'student');
    for(const email of ['sam@kcis.com.tw','jane@kcis.com.tw','teacher@kcis.com.tw','s123@kcis.com.tw','j9876@kcis.com.tw','s123456@kcis.com.tw','j12a45@kcis.com.tw'])assert.equal(resolveAccountRole(null,email),'teacher');
    assert.equal(resolveAccountRole({role:'teacher'},student.email),'teacher');
    assert.equal(classifyFile('微積分教材.pdf'),'academic');assert.equal(classifyFile('AI教學.md'),'ai-articles');assert.equal(classifyFile('file.bin'),'extracurricular');assert.equal(classifyFile('英文數學.md'),'academic');assert.equal(classifyFile('chair.png'),'extracurricular');
    const file=await uploadLibrary(teacher,{filename:'數學筆記.md',contentBase64:Buffer.from('# 微積分\n導數是函數的變化率。').toString('base64')});
    await assert.rejects(uploadLibrary(student,{filename:'資料.md',contentBase64:Buffer.from('test').toString('base64')}),error=>error.status===403);
    assert.equal(file.role,'teachers');assert.equal(file.category,'academic');assert.equal(file.readable,true);
    assert.equal(listLibrary(student).length,1);assert.equal(listLibrary(teacher).length,1);assert.ok(readLibrary(student,file.id).markdown.includes('導數'));
    for(const user of [null,{email:'intruder@gmail.com',role:'teacher'}, {...student,authType:'student-code'}])assert.throws(()=>listLibrary(user),/school/);
    assert.throws(()=>libraryAttachment(student,file.id,'../manifest.json'));
    await assert.rejects(uploadLibrary(teacher,{filename:'../unsafe.md',contentBase64:'eA=='}));
    await assert.rejects(uploadLibrary(teacher,{filename:'x.md',contentBase64:'not base64!!'}));
    const teacherFolders=fs.readdirSync(path.join(process.env.LIBRARY_DATA_DIR,'teachers'));assert.equal(teacherFolders.length,4);
    assert.equal(fs.readdirSync(path.join(process.env.LIBRARY_DATA_DIR,'students' )).length,4);
    const questionId=randomUUID();const solution=await ingestForumSolution({questionId,version:2,markdown:'# 解決方法\n用提示詞產生教案'});
    assert.equal((await ingestForumSolution({questionId,version:2,markdown:'duplicate'})).duplicate,true);
    await ingestForumSolution({questionId,version:3,markdown:'# 解決方法\n更新步驟'});
    assert.ok(readLibrary(student,solution.id).markdown.includes('更新'));
    assert.ok(schoolLibraryContext(student,'更新步驟').includes('更新步驟'));
    assert.equal(schoolLibraryContext({...student,authType:'student-code'},'更新步驟'),'');
    await ingestForumSolution({questionId,version:4,markdown:'# 已刪除',deleted:true});assert.throws(()=>readLibrary(student,solution.id));assert.equal(listLibrary(student).length,1);
    await ingestForumSolution({questionId,version:5,markdown:'# 恢復紀錄',deleted:false});assert.ok(readLibrary(student,solution.id).markdown.includes('恢復')); assert.ok(fs.existsSync(path.join(process.env.LIBRARY_DATA_DIR,'teachers','ai-resolved',solution.id,'versions','v2.md')));
    process.env.WIKINB_INGEST_SECRET='s'.repeat(64);assert.equal(verifyIngestSecret('Bearer '+'s'.repeat(64)),true);assert.equal(verifyIngestSecret('wrong'),false);
    const relocated=path.join(tmp,'moved');fs.renameSync(process.env.LIBRARY_DATA_DIR,relocated);process.env.LIBRARY_DATA_DIR=relocated;assert.ok(readLibrary(student,file.id).markdown.includes('導數'));
    let turn=0;
    const result=await libraryChat(student,'微積分',{generate:async({contents})=>{
      turn++;
      if(turn===1)return {candidates:[{content:{role:'model',parts:[{functionCall:{name:'read_document',args:{id:file.id}}}]}}]};
      assert.ok(JSON.stringify(contents).includes('導數'));
      return {candidates:[{content:{role:'model',parts:[{text:'依據數學筆記，導數是變化率。'}]}}]};
    }});
    assert.equal(turn,2);assert.ok(result.sources.find(s=>s.id===file.id));assert.ok(result.answer.includes('導數'));
  } finally {fs.rmSync(tmp,{recursive:true,force:true});delete process.env.LIBRARY_DATA_DIR;}
});
