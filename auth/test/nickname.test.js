import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateNickname, assertNicknameAvailable } from '../lib/nickname.js';
import { accountKeywords } from '../lib/account.js';
import { documentKeywords } from '../lib/school-library.js';
import { assertStoredNicknameAvailable } from '../lib/nickname-store.js';

test('Chinese and underscore names validate; uniqueness covers every role and normalized spelling',()=>{
 for(const name of ['康橋_同仁','小明','Kaine_Name','陳𠮷老師','Ｋａｉｎｅ','chaos60649','老師_01'])assert.equal(validateNickname(name).ok,true,name);
 for(const name of ['<script>','名字/路徑','名 字','A','名'.repeat(21)])assert.equal(validateNickname(name).ok,false,name);
 const users=[{email:'teacher@kcis.com.tw',nickname:'Ｋａｉｎｅ',role:'teacher'},{email:'s12345@kcis.com.tw',nickname:'小明_同學',role:'student'}];
 assert.throws(()=>assertNicknameAvailable(users,'kaine'),/already taken/);
 assert.throws(()=>assertNicknameAvailable(users,'小明_同學','teacher@kcis.com.tw'),/already taken/);
 assert.doesNotThrow(()=>assertNicknameAvailable(users,'Kaine','teacher@kcis.com.tw'));
 assert.deepEqual(accountKeywords({nickname:'小明',role:'student'}),['小明','學生']);
 assert.deepEqual(documentKeywords({nickname:'陳_老師',role:'admin'},['學生','Teacher','AI','ai']),['陳_老師','教職員','AI']);
});

test('email and legacy classroom accounts reserve names in one namespace without modifying stores',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-nickname-'));
 process.env.USERS_FILE=path.join(tmp,'users.json');process.env.STUDENT_ACCOUNTS_FILE=path.join(tmp,'students.json');
 try{
  fs.writeFileSync(process.env.USERS_FILE,JSON.stringify({users:[{email:'teacher@kcis.com.tw',nickname:'王_老師'}]}));
  fs.writeFileSync(process.env.STUDENT_ACCOUNTS_FILE,JSON.stringify({students:[{id:'legacy-id',nickname:'王_同學',role:'student'}]}));
  assert.throws(()=>assertStoredNicknameAvailable('王_老師'),/already taken/);
  assert.throws(()=>assertStoredNicknameAvailable('王_同學'),/already taken/);
  assert.doesNotThrow(()=>assertStoredNicknameAvailable('王_老師',{email:'TEACHER@kcis.com.tw'}));
  assert.doesNotThrow(()=>assertStoredNicknameAvailable('王_同學',{studentId:'legacy-id'}));
 }finally{delete process.env.USERS_FILE;delete process.env.STUDENT_ACCOUNTS_FILE;fs.rmSync(tmp,{recursive:true,force:true});}
});
