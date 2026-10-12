// Optional public ingress. Keeps legacy APIs on the private backend only.
import {createServer,request as httpRequest} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const target=new URL(process.env.SCHOOL_PRIVATE_API||'http://127.0.0.1:8790');
if(target.protocol!=='http:'||!['localhost','127.0.0.1'].includes(target.hostname)||target.username||target.password)throw Error('Private API must use loopback HTTP.');
const publicOrigin=process.env.SCHOOL_PUBLIC_API_ORIGIN||'';
const publicUrl=publicOrigin?new URL(publicOrigin):null;
if(publicUrl&&(publicUrl.protocol!=='https:'||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash||publicUrl.username||publicUrl.password))throw Error('Public origin must be an HTTPS origin.');
const origins=(process.env.FRONTEND_ORIGINS||'https://ai-tools.kcis.kainnne.com,https://wikinb.kcis.kainnne.com').split(',').map(s=>s.trim());
export function allowedLegacySchoolRoute(method,pathname){
 if(['GET','OPTIONS'].includes(method))return ['/api/wiki/catalog','/api/wiki/subjects','/api/wiki/list','/api/wiki/list-all','/api/wiki/read','/api/files','/api/codex/models'].includes(pathname)||/^\/api\/files\/[A-Za-z0-9_-]+\/download$/.test(pathname);
 return ['POST','OPTIONS'].includes(method)&&['/api/wiki/upload','/api/wiki/upload-image','/api/wiki/rename','/api/files/import','/api/codex/chat','/api/codex/stop'].includes(pathname);
}
export function allowedSchoolRoute(method,pathname){
 if(pathname==='/api/health'||pathname==='/api/auth/config'||pathname==='/api/auth/shared-session'||pathname==='/api/library')return ['GET','OPTIONS'].includes(method);
 if(['/api/auth/send-code','/api/auth/verify-code','/api/auth/login-with-code','/api/auth/complete-setup','/api/auth/logout','/api/library/upload','/api/library/chat','/api/library/forum-solutions','/api/library/forum-articles'].includes(pathname))return ['POST','OPTIONS'].includes(method);
 if(pathname==='/api/auth/nickname')return ['PATCH','OPTIONS'].includes(method);
 return ['GET','OPTIONS'].includes(method)&&/^\/api\/library\/files\/[a-f0-9-]{36}(?:\/markdown|\/download|\/assets\/[A-Za-z0-9._-]+)?$/.test(pathname);
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.txt':'text/plain; charset=utf-8'};
function serveStatic(req,res,pathname){
 const wiki=pathname==='/library'||pathname.startsWith('/library/');
 const dir=wiki?process.env.SCHOOL_WIKI_STATIC_DIR:process.env.SCHOOL_PORTAL_STATIC_DIR;
 if(!dir||!['GET','HEAD'].includes(req.method))return false;
 let relative;try{relative=decodeURIComponent(wiki?pathname.slice('/library'.length)||'/':pathname);}catch{return false;}
 if(relative.split('/').some(part=>part.startsWith('.')))return false;
 const root=fs.realpathSync(dir);let file=path.resolve(root,'.'+relative);
 if(file!==root&&!file.startsWith(root+path.sep))return false;
 if(!fs.existsSync(file))return false;
 if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return false;
 file=fs.realpathSync(file);if(!file.startsWith(root+path.sep))return false;
 const type=mime[path.extname(file)];if(!type)return false;
 res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':type.startsWith('text/html')?'no-store':'public, max-age=300'});
 if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);return true;
}
const server=createServer((req,res)=>{
 const reject=(code)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:code===404?'Not found':'Forbidden'}));};
 let pathname;try{pathname=new URL(req.url,'http://gateway.local').pathname;}catch{return reject(404);}
 const legacy=process.env.ENABLE_SCHOOL_LEGACY_PREVIEW==='true'&&allowedLegacySchoolRoute(req.method,pathname);
 if(!allowedSchoolRoute(req.method,pathname)&&!legacy){if(!pathname.startsWith('/api/')&&serveStatic(req,res,pathname))return;return reject(404);}
 if(req.headers.origin&&!origins.includes(req.headers.origin))return reject(403);
 const headers={...req.headers,host:publicUrl?.host||req.headers.host};
 delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];delete headers['x-forwarded-proto'];
 function forward(){const upstream=httpRequest(target,{method:req.method,path:req.url,headers,timeout:240000},reply=>{
   res.writeHead(reply.statusCode,{...reply.headers,'cache-control':'private, no-store'});reply.pipe(res);
 });
 upstream.on('timeout',()=>upstream.destroy());
 upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Service unavailable"}');}else res.destroy();});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);}
 if(legacy&&req.method!=='OPTIONS'){
   const sessionHeaders={...headers};delete sessionHeaders['content-length'];delete sessionHeaders['transfer-encoding'];delete sessionHeaders['content-type'];
   const check=httpRequest(target,{method:'GET',path:'/api/auth/shared-session',headers:sessionHeaders,timeout:15000},reply=>{reply.resume();if(reply.statusCode===200)forward();else reject([401,403].includes(reply.statusCode)?reply.statusCode:502);});
   check.on('timeout',()=>check.destroy());check.on('error',()=>reject(502));check.end();
 }else forward();
});
server.listen(Number(process.env.SCHOOL_GATEWAY_PORT||8791),'127.0.0.1',()=>console.log('School API gateway listening on loopback.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
