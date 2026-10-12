import test from 'node:test';
import assert from 'node:assert/strict';
import {completedChatHistory,chatMessage} from '../../src/lib/chat-recovery.js';
test('failed, stopped and partial answers cannot advance a course or contaminate the next question',()=>{
 const history=[{role:'user',content:'第一單元'},{role:'assistant',content:'學完後請回答問題。'}];
 for(const result of [{type:'error',answer:'AI service is busy'},{ok:false,answer:'第二單元'},{ok:true,stopped:true,answer:'Partial answer'},{ok:true,answer:''}])assert.deepEqual(completedChatHistory(history,'下一單元',result),history);
 const updated=completedChatHistory(history,'下一單元',{type:'done',ok:true,answer:'第二單元'});assert.deepEqual(updated.slice(-2),[{role:'user',content:'下一單元'},{role:'assistant',content:'第二單元'}]);assert.equal(history.length,2);
});
test('busy, retry, timeout and quota feedback uses the chosen conversation language',()=>{
 for(const code of ['AI_BUSY','AI_RETRY','AI_TIMEOUT','AI_QUOTA','AI_INTERRUPTED','AI_EMPTY']){assert.match(chatMessage(code,'zh-TW'),/\p{Script=Han}/u);assert.ok(!/\p{Script=Han}/u.test(chatMessage(code,'en')));}
 assert.equal(chatMessage('retry','zh-TW'),'重試');assert.equal(chatMessage('retry','en'),'Retry');
});
