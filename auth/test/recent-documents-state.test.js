import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecentDocumentsState} from '../../src/lib/recent-documents-state.js';
const user={email:'synthetic@kcis.com.tw',updatedAt:'one'};
test('slow loading stays loading until documents arrive; duplicate account events reuse the request',async()=>{
 let resolve,calls=0;const controller=createRecentDocumentsState(()=>{calls++;return new Promise(r=>resolve=r);},()=>{});
 const first=controller.load(user);const second=controller.load(user);
 assert.equal(controller.getState().phase,'loading');assert.equal(calls,1);assert.equal(first,second);
 resolve({files:[{id:'one',title:'A real document'}],categories:[]});await first;
 assert.equal(controller.getState().phase,'ready');assert.equal(controller.getState().files.length,1);
});
test('empty results are only ready after a completed read; failures remain errors',async()=>{
 const empty=createRecentDocumentsState(async()=>({files:[]}),()=>{});await empty.load(user);assert.equal(empty.getState().phase,'ready');assert.equal(empty.getState().files.length,0);
 const failed=createRecentDocumentsState(async()=>{throw Error('Offline');},()=>{});await failed.load(user);assert.equal(failed.getState().phase,'error');
});
test('a response arriving after sign-out cannot expose documents again',async()=>{
 let resolve;const controller=createRecentDocumentsState(()=>new Promise(r=>resolve=r),()=>{});const pending=controller.load(user);controller.signedOut();resolve({files:[{id:'old'}]});await pending;
 assert.equal(controller.getState().phase,'anonymous');assert.deepEqual(controller.getState().files,[]);
});
