import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatInitialization} from '../../src/lib/chat-initialization.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('login arriving during a failed initial check queues exactly one fresh check',async()=>{
 const first=deferred();let calls=0;
 const state=createChatInitialization(async()=>{calls++;return calls===1?first.promise:true;});
 const running=state.request();state.request(true);state.request(true);
 first.resolve(false);await running;assert.equal(calls,2);
 await state.request();assert.equal(calls,2);
});

test('logout invalidates an in-flight success before it can reveal the chat',async()=>{
 const first=deferred();let revealed=false;
 const state=createChatInitialization(async({isCurrent})=>{await first.promise;if(isCurrent())revealed=true;return true;});
 const running=state.request();state.invalidate();first.resolve();await running;
 assert.equal(revealed,false);
});

test('offline results do not cause an automatic retry loop; explicit retry is allowed',async()=>{
 let calls=0;const state=createChatInitialization(async()=>{calls++;return false;});
 await state.request();assert.equal(calls,1);
 await state.request(true);assert.equal(calls,2);
});

test('even repeated auth notifications during a recheck cannot start an infinite loop',async()=>{
 let calls=0;let state;
 state=createChatInitialization(async()=>{calls++;await Promise.resolve();state.request(true);return false;});
 await state.request();assert.equal(calls,2);
});
