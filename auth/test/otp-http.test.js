import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const source=process.env.AUTH_TEST_SOURCE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('OTP HTTP flow: default names, existing login, fresh nickname, school access and logout without real mail',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-otp-http-'));
 const auth=path.join(tmp,'auth');fs.mkdirSync(auth);
 fs.cpSync(path.join(source,'lib'),path.join(auth,'lib'),{recursive:true});
 for(const name of ['server.js','public-gateway.js','package.json'])fs.copyFileSync(path.join(source,name),path.join(auth,name));
 fs.symlinkSync(path.join(source,'node_modules'),path.join(auth,'node_modules'),'dir');
 const mailFile=path.join(tmp,'mail.json');
 const mock=path.join(tmp,'mock-smtp.mjs');fs.writeFileSync(mock,`import fs from 'node:fs';export default {createTransport(){return {async sendMail(mail){fs.writeFileSync(${JSON.stringify(mailFile)},JSON.stringify({to:mail.to,code:mail.text.match(/驗證碼是：(\\d{6})/)[1]}));return {accepted:[mail.to]};}}}};`);
 const hook=path.join(tmp,'hook.mjs');fs.writeFileSync(hook,`import {registerHooks} from 'node:module';registerHooks({resolve(s,c,n){if(s==='nodemailer')return {url:${JSON.stringify(pathToFileURL(mock).href)},shortCircuit:true};return n(s,c);}});`);
 const port=18902;const base='http://127.0.0.1:'+port;
 const envFile=path.join(tmp,'test.env');fs.writeFileSync(envFile,`HOST=127.0.0.1\nPORT=${port}\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nALLOWED_EMAIL_DOMAINS=kcis.com.tw,kcis.ntpc.edu.tw\nAUTH_BASE_URL=https://api.school.example
SMTP_USER=synthetic@example.invalid\nSMTP_PASS=synthetic\nDEV_LOG_CODE=false\nLIBRARY_DATA_DIR=${path.join(tmp,'library')}\nPROJECT_ROOT=${tmp}\n`);
 const child=spawn(process.execPath,['--import',hook,path.join(auth,'server.js')],{cwd:tmp,env:{...process.env,AUTH_ENV_FILE:envFile},stdio:['ignore','ignore','pipe']});
 const gateway=spawn(process.execPath,[path.join(auth,'public-gateway.js')],{cwd:tmp,env:{...process.env,SCHOOL_PRIVATE_API:base,SCHOOL_GATEWAY_PORT:'18903',SCHOOL_PUBLIC_API_ORIGIN:'https://api.school.example',FRONTEND_ORIGINS:'http://localhost:3000'},stdio:'ignore'});
 let childError='';child.stderr.on('data',b=>{childError+=b;});
 async function request(route,body,cookie='',method){const r=await fetch(base+route,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie()[0]?.split(';')[0]||'',setCookie:r.headers.getSetCookie()[0]||''};}
 try {
  let online=false;for(let i=0;i<60;i++){try{online=(await fetch(base+'/api/health')).ok;if(online)break;}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(online,childError);
  assert.equal((await request('/api/library')).status,401);
  assert.equal((await request('/api/auth/send-code',{email:'intruder@gmail.com'})).status,403);
  async function signIn(email){
    assert.equal((await request('/api/auth/send-code',{email,purpose:'login'})).status,200);
    const {code}=JSON.parse(fs.readFileSync(mailFile));
    assert.equal((await request('/api/auth/verify-code',{email,code,purpose:'login'})).data.needsNickname,false);
    assert.equal((await request('/api/auth/login-with-code',{email,code:'invalid',purpose:'login'})).status,400);
    const result=await request('/api/auth/login-with-code',{email,code,purpose:'login'});
    assert.equal(result.status,200);assert.ok(result.cookie);assert.match(result.setCookie,/HttpOnly/);
    assert.equal((await request('/api/auth/login-with-code',{email,code,purpose:'login'})).status,400);
    return result;
  }
  const email='synthetic.teacher@kcis.com.tw',setup=await signIn(email),cookie=setup.cookie;
  assert.equal(setup.data.user.nickname,'synthetic.teacher');
  for(const route of ['/api/sync','/api/codex/chat','/api/wiki/catalog','/api/auth/set-password','/api/auth/student-login'])assert.equal((await fetch('http://127.0.0.1:18903'+route,{method:'POST'})).status,404);
  assert.equal((await fetch('http://127.0.0.1:18903/api/library')).status,401);
  assert.equal((await fetch('http://127.0.0.1:18903/api/auth/shared-session',{headers:{Cookie:cookie}})).status,200);
  const proxied=await fetch('http://127.0.0.1:18903/api/auth/nickname',{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:'http://localhost:3000'},body:JSON.stringify({nickname:'測試_同仁'})});
  assert.equal(proxied.status,200);assert.match(proxied.headers.getSetCookie()[0],/Secure/);assert.match(proxied.headers.getSetCookie()[0],/SameSite=None/);
  const current=await request('/api/auth/shared-session',undefined,cookie);
  assert.equal(current.data.user.nickname,'測試_同仁');assert.deepEqual(current.data.user.keywords,['測試_同仁','教職員']);
  const student=await signIn('s12345@kcis.com.tw');
  assert.equal(student.data.user.nickname,'s12345');assert.equal(student.data.user.role,'student');
  assert.deepEqual(student.data.user.keywords,['s12345','學生']);
  assert.equal((await request('/api/auth/nickname',{nickname:'小明_同學'},student.cookie,'PATCH')).status,200);
  for(const [nick,target] of [['測試_同仁',student.cookie],['小明_同學',cookie]]){
    const duplicate=await request('/api/auth/nickname',{nickname:nick},target,'PATCH');
    assert.equal(duplicate.status,400);assert.match(duplicate.data.error,/already taken/);
  }
  assert.equal((await request('/api/auth/nickname',{nickname:'測試_同仁'},cookie,'PATCH')).status,200);
  const login=await signIn(email);assert.equal(login.data.user.nickname,'測試_同仁');
  for(const [testEmail,role] of [['chaos60649@gmail.com','teacher'],['st101031616@gmail.com','student']]){
    const result=await signIn(testEmail);
    assert.equal(result.data.user.nickname,testEmail.split('@')[0]);assert.equal(result.data.user.role,role);
    assert.equal((await request('/api/library',undefined,result.cookie)).status,200);
    const upload=await request('/api/library/upload',{filename:'role-check.md',contentBase64:Buffer.from('# Role check').toString('base64')},result.cookie);
    assert.equal(upload.status,role==='teacher'?201:403);
  }
  const collision=await signIn('chaos60649@kcis.com.tw');assert.equal(collision.data.user.nickname,'chaos60649_2');
  const forbidden=await fetch(base+'/api/auth/nickname',{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:login.cookie,Origin:'https://evil.example'},body:JSON.stringify({nickname:'外站'})});assert.equal(forbidden.status,403);
  const logout=await request('/api/auth/logout',{},login.cookie);assert.equal(logout.status,200);assert.match(logout.setCookie,/Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/api/auth/shared-session')).status,401);assert.equal((await request('/api/library')).status,401);
 }finally{if(gateway.exitCode===null){gateway.kill('SIGTERM');await new Promise(resolve=>gateway.once('exit',resolve));}if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(tmp,{recursive:true,force:true});}
});
