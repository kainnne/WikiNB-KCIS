import test from 'node:test';import assert from 'node:assert/strict';
import {schoolDocumentsIndex} from '../../src/lib/wiki-documents.js';
test('shared documents join WikiNB with safe note links, updated keywords and no owner data',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const records=schoolDocumentsIndex([{id,title:'校內AI教材',filename:'01.md',category:'ai-articles',role:'teachers',uploader:'中文_姓名',keywords:['中文_姓名','資源中心','自訂標籤'],ownerEmail:'private@example.com',ownerSubject:'private-hash',markdown:'PRIVATE_BODY',href:'javascript:alert(1)'},{id:'../../unsafe',title:'invalid'},{id,deletedAt:'2026-10-12'}],[{id:'ai-articles',en:'AI articles',zh:'AI 文章'}],'/');
 assert.equal(records.length,1);assert.equal(records[0].href,'/note?file='+id);assert.equal(records[0].subject,'AI articles');assert.deepEqual(records[0].keywords,['中文_姓名','資源中心','自訂標籤']);assert.doesNotMatch(JSON.stringify(records),/private@example|private-hash|PRIVATE_BODY|javascript:/);assert.equal(records[0].displayFilename,'01.md');assert.equal(records[0].role,'teachers');assert.equal(records[0].category,'ai-articles');assert.equal(records[0].categoryZh,'AI 文章');
});
