import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('legacy school preview is opt-in, requires school session, and excludes destructive and login routes',async()=>{
 const upstream=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/auth/shared-session'&&(req.headers['content-length']||req.headers['transfer-encoding'])){res.statusCode=400;res.end('{}');return;}
  if(req.url==='/api/auth/shared-session'&&req.headers.cookie!=='synthetic-school-session')res.statusCode=401;
  res.end(JSON.stringify({ok:res.statusCode===200}));
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const target='http://127.0.0.1:'+upstream.address().port;
 const gateway=fileURLToPath(new URL('../public-gateway.js',import.meta.url));
 try {
  for(const enabled of [false,true]){
   const port=enabled?18907:18906,base='http://127.0.0.1:'+port;
   const child=spawn(process.execPath,[gateway],{env:{...process.env,SCHOOL_PRIVATE_API:target,SCHOOL_GATEWAY_PORT:String(port),ENABLE_SCHOOL_LEGACY_PREVIEW:String(enabled),FRONTEND_ORIGINS:'https://school.example'},stdio:'ignore'});
   try {
    let online=false;for(let i=0;i<100;i++){try{online=(await fetch(base+'/api/health')).ok;if(online)break;}catch{}await new Promise(resolve=>setTimeout(resolve,20));}
    assert.ok(online);
    assert.equal((await fetch(base+'/api/wiki/catalog')).status,enabled?401:404);
    const authorized={Cookie:'synthetic-school-session',Origin:'https://school.example'};
    assert.equal((await fetch(base+'/api/wiki/catalog',{headers:authorized})).status,enabled?200:404);
    assert.equal((await fetch(base+'/api/codex/chat',{method:'POST',headers:authorized,body:'{}'})).status,enabled?200:404);
    for(const path of ['/api/codex/chat','/api/codex/stop','/api/wiki/upload','/api/files/import']){
     assert.equal((await fetch(base+path,{method:'OPTIONS',headers:{Origin:'https://school.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}})).status,enabled?200:404);
     assert.equal((await fetch(base+path,{method:'POST',headers:{Origin:'https://school.example'},body:'{}'})).status,enabled?401:404);
    }
    if(enabled)assert.equal((await fetch(base+'/api/wiki/catalog',{headers:{...authorized,Origin:'https://evil.example'}})).status,403);
    for(const path of ['/api/sync','/api/wiki/delete','/api/auth/set-password','/api/auth/student-login'])assert.equal((await fetch(base+path,{method:'POST',headers:authorized})).status,404);
   }finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  }
 }finally{await new Promise(resolve=>upstream.close(resolve));}
});
