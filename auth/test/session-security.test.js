import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionToken,verifySessionToken,sessionCookieOptions} from '../lib/session.js';
import {createLoginCode,checkLoginCode,verifyLoginCode} from '../lib/mail-code.js';
import {isAllowedLoginEmail} from '../lib/domain.js';
test('OTP is one-use and locks after five wrong attempts without sending email',()=>{
 const email='synthetic@example.invalid';const {code}=createLoginCode(email,'login');
 for(let i=0;i<5;i++)assert.equal(checkLoginCode(email,code==='000000'?'111111':'000000','login').ok,false);
 assert.equal(checkLoginCode(email,code,'login').ok,false);
 const renewed=createLoginCode(email,'login');assert.equal(verifyLoginCode(email,renewed.code,'login').ok,true);assert.equal(verifyLoginCode(email,renewed.code,'login').ok,false);
});
test('shared JWT expiry, strict school domain and Express cookie duration',async()=>{
 process.env.SESSION_SECRET='t'.repeat(64);
 const token=await createSessionToken({email:'teacher@kcis.com.tw',role:'teacher'},{expiresIn:'15m'});const user=await verifySessionToken(token);assert.equal(user.email,'teacher@kcis.com.tw');
 const expired=await createSessionToken({email:'teacher@kcis.com.tw'},{expiresIn:'0s'});assert.equal(await verifySessionToken(expired),null);assert.equal(await verifySessionToken(token.slice(0,-5)+'bogus'),null);
 assert.equal(sessionCookieOptions().maxAge,7*24*60*60*1000);assert.equal(isAllowedLoginEmail('a@gmail.com'),false);assert.equal(isAllowedLoginEmail('chaos60649@gmail.com'),true);assert.equal(isAllowedLoginEmail('st101031616@gmail.com'),true);assert.equal(isAllowedLoginEmail('chaos60649+other@gmail.com'),false);assert.equal(isAllowedLoginEmail('a@evil@kcis.com.tw'),false);assert.equal(isAllowedLoginEmail('s123@kcis.com.tw'),true);
 delete process.env.SESSION_SECRET;await assert.rejects(createSessionToken({email:'teacher@kcis.com.tw'}),/SESSION_SECRET/);
});
