import {queryTerms,relevantExcerpt} from './retrieval.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { isAllowedLoginEmail } from './domain.js';
import { accountKeywords } from './account.js';

// Fixed taxonomy. Classification never calls an AI provider.
export const CATEGORIES = [
 {id:'academic',zh:'學科知識',en:'Academic knowledge',terms:['教材','教學','學科','數學','國文','英文','語文','閱讀','作文','文法','代數','幾何','微積分','物理','化學','生物','地理','歷史','公民','音樂','體育','academic','mathematics','english','grammar','science','physics','chemistry','biology','history','geography','curriculum']},
 {id:'extracurricular',zh:'課外知識',en:'Extracurricular knowledge',terms:['課外','行政','會議','生活','輔導','健康','生涯','活動','extracurricular','administration','meeting','wellbeing','career']},
 {id:'ai-resolved',zh:'AI 已解決紀錄',en:'AI Forum solutions',terms:[]},
 {id:'ai-articles',zh:'AI 分享文章',en:'AI articles',terms:['人工智慧','生成式','AI','AI Agent','Kuse','ChatGPT','Gemini','Claude','prompt','artificial intelligence','提示詞','提示字','代理人']},
];
export function requireSchool(user) {
  if (!user || user.authType !== 'email-otp' || !isAllowedLoginEmail(user.email)) {
    const e = new Error('Sign in with your school email'); e.status = user ? 403 : 401; throw e;
  }
}
export function uploadRole(user) {
  requireSchool(user);
  return user.role === 'student' ? 'students' : 'teachers';
}
export const TEACHER_DOCUMENT_EXTENSIONS = ['.pdf', '.md', '.docx', '.txt'];
export function requireTeacherUpload(user) {
  requireSchool(user);
  if (!['teacher','admin'].includes(user.role)) throw Object.assign(new Error('Only teachers can upload documents'), {status:403});
}
export function documentKeywords(user, extra = []) {
  if (!Array.isArray(extra) || extra.length > 12 || extra.some(value => typeof value !== 'string' || value.length > 80)) {
    throw Object.assign(new Error('Add up to 12 keywords, each no longer than 40 characters'), {status:400});
  }
  const nickname = String(user.nickname || user.name || user.email.split('@')[0]);
  const result = [], seen = new Set();
  const reserved = new Set(['教職員', '學生', 'staff', 'student', 'students', 'teacher', 'teachers']);
  for (const raw of [...accountKeywords({...user, nickname}), ...extra.filter(word => !reserved.has(word.normalize('NFKC').trim().toLowerCase()))]) {
    const word = raw.normalize('NFKC').replace(/[\x00-\x1f]/g,' ').trim().replace(/\s+/g,' ');
    if (word.length > 40) throw Object.assign(new Error('Each keyword must be 40 characters or fewer'), {status:400});
    const key = word.toLowerCase();
    if (word && !seen.has(key)) { seen.add(key); result.push(word); }
  }
  return result;
}
function normalized(value) { return String(value || '').normalize('NFKC').toLowerCase(); }
function matches(text, term) {
  term=normalized(term);
  if (/^[a-z ]+$/.test(term)) return new RegExp(`(?:^|[^a-z0-9])${term.replace(/ /g,'\\s+')}(?:$|[^a-z0-9])`,'i').test(text);
  return text.includes(term);
}
export function classifyFile(filename, text='') {
  const name=normalized(filename), content=normalized(text).slice(0,80000);
  const ranked=CATEGORIES.filter(c=>c.terms.length).map(c=>({id:c.id,score:c.terms.reduce((s,t)=>s+(matches(name,t)?6:0)+(matches(content,t)?1:0),0)})).sort((a,b)=>b.score-a.score);
  if (!ranked[0].score) return 'extracurricular';
  if(ranked[0].score===ranked[1].score)return ranked.filter(r=>r.score===ranked[0].score).some(r=>r.id==='ai-articles')?'ai-articles':'extracurricular';
  return ranked[0].id;
}
function root() { return path.resolve(process.env.LIBRARY_DATA_DIR || path.join(process.env.PROJECT_ROOT || process.cwd(),'data','library')); }
function initialize() {
  // Eight category folders; originals and parsed content stay with their document ID.
  for(const role of ['teachers','students'])for(const c of CATEGORIES)fs.mkdirSync(path.join(root(),role,c.id),{recursive:true});
}
const OLD_CATEGORIES=new Set(['ai-digital','languages','mathematics','science','humanities','arts-sports','administration','guidance','other']);
function pruneEmptyLegacyCategories(){for(const role of ['teachers','students'])for(const category of OLD_CATEGORIES){const dir=path.join(root(),role,category);if(fs.existsSync(dir)&&fs.readdirSync(dir).length===0)fs.rmdirSync(dir);}}
export function migrateLibraryTaxonomy(){
 initialize();const file=path.join(root(),'manifest.json');if(!fs.existsSync(file)){pruneEmptyLegacyCategories();return [];}
 const rows=JSON.parse(fs.readFileSync(file,'utf8'));
 const changes=rows.filter(row=>OLD_CATEGORIES.has(row.category));
 if(!changes.length){pruneEmptyLegacyCategories();return rows;}
 const backup=root()+'.taxonomy-v1-backup';
 if(!fs.existsSync(backup))fs.cpSync(root(),backup,{recursive:true,errorOnExist:true,force:false});
 for(const row of changes){
  const oldPath=recordPath(row),textPath=path.join(oldPath,'content.md');
  const text=fs.existsSync(textPath)?fs.readFileSync(textPath,'utf8'):'';
  const target=row.source==='forum'?'ai-resolved':row.category==='ai-digital'?'ai-articles':['administration','guidance','other'].includes(row.category)?'extracurricular':'academic';
  row.previousCategory=row.category;row.category=target;
  const destination=recordPath(row);
  if(fs.existsSync(oldPath)){
   if(fs.existsSync(destination))throw Error('Migration destination already exists; restore the backup before retrying');
   fs.renameSync(oldPath,destination);
  }else if(!fs.existsSync(destination))throw Error('Migration source is missing');
 }
 save(rows);
 pruneEmptyLegacyCategories();
 atomic(path.join(root(),'taxonomy.json'),JSON.stringify({version:2,categories:CATEGORIES.map(c=>c.id),backup,updatedAt:new Date().toISOString()},null,2));
 return rows;
}
function manifest(){return migrateLibraryTaxonomy();}
function atomic(p,value) { const temp=p+'.'+randomUUID()+'.tmp'; fs.writeFileSync(temp,value,{mode:0o600}); fs.renameSync(temp,p); }
function save(rows) { atomic(path.join(root(),'manifest.json'),JSON.stringify(rows,null,2)); }
let queue=Promise.resolve();
function serialized(fn) { const result=queue.then(fn); queue=result.catch(()=>{}); return result; }
function recordPath(record,file='') { return path.join(root(),record.role,record.category,record.id,file); }
function publicRecord(row) { const { ownerEmail,ownerSubject,accountKeywords,profileUpdatedAt, ...item }=row; return item; }
export function accountSubject(email){return createHash('sha256').update('account:'+String(email).trim().toLowerCase()).digest('hex');}
function profiles(){const file=path.join(root(),'account-profiles.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};}
function profileMarkdown(text,row){
 const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
 const header=(match?.[1]||'').replace(/^(?:teacher|author|department|keywords):[^\n]*(?:\n[ \t]+[^\n]*)*/gm,'').trim();
 const metadata=[header,'teacher: '+JSON.stringify(row.uploader),'department: '+JSON.stringify(row.department),'keywords:',...row.keywords.map(word=>'  - '+JSON.stringify(word))].filter(Boolean).join('\n');
 return '---\n'+metadata+'\n---\n'+(match?text.slice(match[0].length):text);
}
function applyProfile(row,profile){
 const previous=row.accountKeywords||[row.uploader,row.department|| (row.role==='students'?'學生':'教職員')];
 row.accountKeywords=accountKeywords(profile);row.department=profile.department;row.uploader=profile.nickname||profile.name;
 const extras=(row.keywords||[]).filter(word=>!previous.some(old=>normalized(old)===normalized(word)));
 row.keywords=[...new Set([...row.accountKeywords,...extras])];
 row.profileUpdatedAt=profile.updatedAt;
 return row;
}
export async function updateLibraryAccount(user,{references}={}){
 return serialized(()=>{
  const subject=accountSubject(user.email),map=profiles(),profile={nickname:user.nickname,department:accountKeywords(user)[1]||user.department,role:user.role,updatedAt:user.updatedAt};
  map[subject]=profile;initialize();atomic(path.join(root(),'account-profiles.json'),JSON.stringify(map));
  const rows=manifest();let updated=0;
  for(const row of rows.filter(row=>row.ownerEmail===user.email||row.ownerSubject===subject||(!row.ownerEmail&&!row.ownerSubject&&(references?.articles?.includes(row.articleId)||references?.questions?.includes(row.questionId))))){
   if(row.profileUpdatedAt===user.updatedAt)continue;
   const file=recordPath(row,'content.md'),text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
   const snapshot=recordPath(row,'versions/profile-'+randomUUID()+'.json');fs.mkdirSync(path.dirname(snapshot),{recursive:true});atomic(snapshot,JSON.stringify({metadata:row,markdown:text}));
   applyProfile(row,profile);row.ownerSubject=subject;
   if(text)atomic(file,profileMarkdown(text,row));updated++;
  }
  if(updated)save(rows);return {updated};
 });
}
export function listLibrary(user,{query='',role='',category='',mine=''}={}) {
  requireSchool(user); const q=normalized(query).slice(0,200);
  return manifest().filter(r=>!r.deletedAt&&(!mine||r.ownerEmail===user.email)&&(!role||r.role===role)&&(!category||r.category===category)&&(!q||normalized(r.filename+' '+r.title+' '+r.preview+' '+(r.keywords||[]).join(' ')).includes(q))).sort((a,b)=>a.source==='curriculum'&&b.source==='curriculum'?a.filename.localeCompare(b.filename):a.source==='curriculum'?1:b.source==='curriculum'?-1:b.updatedAt.localeCompare(a.updatedAt)).map(publicRecord);
}
function find(id) { if(!/^[a-f0-9-]{36}$/.test(String(id)))throw Object.assign(new Error('找不到檔案'),{status:404}); const row=manifest().find(r=>r.id===id); if(!row||row.deletedAt)throw Object.assign(new Error('找不到檔案'),{status:404});return row; }
export function readLibrary(user,id) { requireSchool(user);const row=find(id);return {...publicRecord(row),markdown:fs.existsSync(recordPath(row,'content.md'))?fs.readFileSync(recordPath(row,'content.md'),'utf8'):''}; }
export function libraryAttachment(user,id,asset='') {
  requireSchool(user); const row=find(id);
  if(asset && (!/^[a-zA-Z0-9._-]+$/.test(asset)||asset==='.'||asset==='..'))throw Object.assign(new Error('找不到附件'),{status:404});
  const file=recordPath(row,asset?path.join('assets',asset):'original');
  if(!fs.existsSync(file))throw Object.assign(new Error('找不到附件'),{status:404});
  return {file,filename:asset||row.filename};
}
export function libraryMarkdown(user,id) {
  requireSchool(user); const row=find(id), file=recordPath(row,'content.md');
  if (!fs.existsSync(file)) throw Object.assign(new Error('Markdown is not available for this file'), {status:404});
  return {file,filename:path.basename(row.filename,path.extname(row.filename))+'.md'};
}
export async function uploadLibrary(user,{filename,contentBase64,keywords=[]}) {
  requireTeacherUpload(user);
  const role='teachers';
  const noteKeywords=documentKeywords(user,keywords);
  if(typeof filename!=='string'||!filename.trim()||filename.length>240||/[\\/\r\n\x00-\x1f]/.test(filename))throw Object.assign(new Error('Invalid filename'),{status:400});
  const extension=path.extname(filename).toLowerCase();
  if(!TEACHER_DOCUMENT_EXTENSIONS.includes(extension))throw Object.assign(new Error('Supported files: PDF, MD, DOCX and TXT'),{status:415});
  if(typeof contentBase64!=='string'||contentBase64.length>16*1024*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64))throw new Error('Files must be smaller than 12 MB');
  const buffer=Buffer.from(contentBase64,'base64');if(!buffer.length||buffer.length>12*1024*1024)throw new Error('Upload a nonempty file, up to 12 MB');
  if(extension==='.pdf'&&!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Object.assign(new Error('This is not a valid PDF file'),{status:415});
  if(extension==='.docx'&&!buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw Object.assign(new Error('This is not a valid DOCX file'),{status:415});
  if(['.md','.txt'].includes(extension)) {
    try { const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer); if(text.includes('\0'))throw Error(); }
    catch {throw Object.assign(new Error('MD and TXT files must contain UTF-8 text'),{status:415});}
  }
  return serialized(async()=>{
    initialize();const id=randomUUID(), initial=classifyFile(filename), now=new Date().toISOString();
    const row={id,role,category:initial,filename,title:filename,ownerEmail:user.email,ownerSubject:accountSubject(user.email),department:user.department||accountKeywords(user)[1],accountKeywords:accountKeywords(user),uploader:user.nickname||user.name||user.email.split('@')[0],keywords:noteKeywords,size:buffer.length,readable:false,status:'stored',createdAt:now,updatedAt:now,preview:'',source:'upload'};
    const dir=recordPath(row);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'original'),buffer,{mode:0o600});
    try {
      const {isSupportedDocument,convertDocument}=await import('./document-import.js');
      if(isSupportedDocument(filename)) {
        const result=await convertDocument({filename,buffer,assetDir:path.join(dir,'assets'),assetUrlPrefix:`/api/library/files/${id}/assets`,originalUrl:`/api/library/files/${id}/download`});
        const text=String(result.markdown||result.body||'');
        // Image wrappers do not mean that OCR has occurred.
        row.readable=!!text.trim()&&(result.source?.type!=='pdf'||result.document?.pages?.some(p=>p.blocks?.length))&&!/^\.(png|jpe?g|gif|webp)$/i.test(path.extname(filename));
        row.status=row.readable?'readable':'stored';
        row.preview=row.readable?text.replace(/<[^>]+>/g,' ').slice(0,400):'';
        row.hasMarkdown=true;
        row.warnings=result.warnings||[];
        const metadata=['---','title: '+JSON.stringify(result.title||filename),'teacher: '+JSON.stringify(row.uploader),'keywords:',...noteKeywords.map(word=>'  - '+JSON.stringify(word)),'source_file: '+JSON.stringify(filename),'---',''].join('\n');
        atomic(path.join(dir,'content.md'),metadata+'\n'+text);
        if(result.document)atomic(path.join(dir,'document.json'),JSON.stringify(result.document,null,2));
        atomic(path.join(dir,'conversion-report.json'),JSON.stringify({convertedAt:now,warnings:row.warnings},null,2));
        row.category=classifyFile(filename,text.replace(/<[^>]+>/g,' '));
        if(row.category!==initial)fs.renameSync(dir,recordPath(row));
      }
    } catch { row.status='conversion-failed'; }
    const latest=profiles()[row.ownerSubject];if(latest){applyProfile(row,latest);const file=recordPath(row,'content.md');if(fs.existsSync(file))atomic(file,profileMarkdown(fs.readFileSync(file,'utf8'),row));}
    const rows=manifest();rows.push(row);save(rows);return publicRecord(row);
  });
}
export function verifyIngestSecret(value) {
  const expected=String(process.env.WIKINB_INGEST_SECRET||'');
  const provided=String(value||'').replace(/^Bearer /,'');
  return expected.length>=32&&Buffer.byteLength(provided)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
}
export async function ingestForumSolution(input) {
  const {questionId,version,markdown,deleted=false,role='teachers',ownerSubject='',author='AI Forum',department=role==='students'?'學生':'教職員'}=input||{};
  if(ownerSubject&&!/^[a-f0-9]{64}$/.test(ownerSubject))throw Error('Invalid owner subject');
  if(!['teachers','students'].includes(role)||typeof deleted!=='boolean'||!/^[a-f0-9-]{36}$/.test(String(questionId))||!Number.isInteger(version)||version<1||typeof markdown!=='string'||!markdown.trim()||markdown.length>20000)throw new Error('解決紀錄格式不符');
  return serialized(()=>{
    const rows=manifest(),existing=rows.find(r=>r.source==='forum'&&r.questionId===questionId);
    if(existing&&existing.sourceVersion>=version)return {id:existing.id,duplicate:true};
    const row=existing||{id:randomUUID(),role,category:'ai-resolved',questionId,source:'forum',createdAt:new Date().toISOString(),filename:`forum-${questionId}.md`,uploader:'AI Forum',ownerEmail:''};
    Object.assign(row,{ownerSubject,uploader:author,department,accountKeywords:[author,department],deletedAt:deleted?new Date().toISOString():null,title:'AI Forum solution',filename:'Forum solution — '+String(markdown.match(/## 問題\n([^\n]+)/)?.[1]||'AI 論壇').replace(/[\\/\r\n]/g,' ').slice(0,40)+'.md',keywords:[author,department,'AI Forum'],resolution:/^status: resolved$/m.test(markdown)?'resolved':'unresolved',hasMarkdown:true,sourceVersion:version,readable:true,status:'readable',size:Buffer.byteLength(markdown),preview:markdown.slice(0,400),updatedAt:new Date().toISOString()});
    fs.mkdirSync(recordPath(row,'versions'),{recursive:true});
    const latest=ownerSubject&&profiles()[ownerSubject];if(latest)applyProfile(row,latest);
    atomic(recordPath(row,`versions/v${version}.md`),markdown);atomic(recordPath(row,'content.md'),ownerSubject?profileMarkdown(markdown,row):markdown);atomic(recordPath(row,'original'),markdown);
    if(!existing)rows.push(row);save(rows);return {id:row.id,duplicate:false};
  });
}
export function searchLibraryText(user,query,{category='',source=''}={}) {
  requireSchool(user); const terms=queryTerms(query);
  const rows=manifest().filter(r=>r.readable&&!r.deletedAt&&(!category||r.category===category)&&(!source||r.source===source)).map(row=>{
    const text=fs.readFileSync(recordPath(row,'content.md'),'utf8').slice(0,100000);
    const normalizedText=normalized(row.filename+' '+(row.keywords||[]).join(' ')+' '+text);
    const score=terms.reduce((n,t)=>n+(normalizedText.includes(t)?1:0),0);
    return {id:row.id,title:row.filename,role:row.role,category:row.category,score,snippet:relevantExcerpt(text,terms,1600)};
  });
  return rows.filter(r=>!terms.length||r.score).sort((a,b)=>b.score-a.score).slice(0,8);
}

export async function ingestForumArticle(input) {
 const {articleId,version,markdown,title,author,deleted=false,ownerSubject='',department='教職員'}=input||{};
 if(ownerSubject&&!/^[a-f0-9]{64}$/.test(ownerSubject))throw Error('Invalid owner subject');
 if(typeof deleted!=='boolean'||!/^[a-f0-9-]{36}$/.test(String(articleId))||!Number.isInteger(version)||version<1||typeof markdown!=='string'||!markdown.trim()||markdown.length>30000||typeof title!=='string'||!title.trim()||title.length>160||typeof author!=='string'||!author.trim()||author.length>60)throw Error('Invalid article record');
 return serialized(()=>{
  const rows=manifest(),existing=rows.find(row=>row.source==='forum-article'&&row.articleId===articleId);
  if(existing&&existing.sourceVersion>=version)return {id:existing.id,duplicate:true};
  const now=new Date().toISOString(),row=existing||{id:randomUUID(),role:'teachers',category:'ai-articles',articleId,source:'forum-article',createdAt:now,ownerEmail:''};
  Object.assign(row,{ownerSubject,department,accountKeywords:[author,department],title,filename:title.replace(/[\\/\r\n\x00-\x1f]/g,' ').slice(0,160)+'.md',uploader:author,keywords:[author,department,'AI Forum'],sourceVersion:version,hasMarkdown:true,readable:true,status:'readable',deletedAt:deleted?now:null,updatedAt:now,size:Buffer.byteLength(markdown),preview:markdown.slice(0,400)});
  fs.mkdirSync(recordPath(row,'versions'),{recursive:true});
  const latest=ownerSubject&&profiles()[ownerSubject];if(latest)applyProfile(row,latest);
  atomic(recordPath(row,`versions/v${version}.md`),markdown);atomic(recordPath(row,'content.md'),ownerSubject?profileMarkdown(markdown,row):markdown);atomic(recordPath(row,'original'),markdown);
  if(!existing)rows.push(row);save(rows);return {id:row.id,duplicate:false};
 });
}

// Operator-only import for the bundled, reviewed curriculum. Not an HTTP route.
export async function installCourseLesson({filename,markdown}) {
 if(!/^[a-z0-9-]+\.md$/.test(filename)||typeof markdown!=='string'||markdown.length>30000)throw Error('Invalid lesson');
 return serialized(()=>{
  const rows=manifest(),hash=createHash('sha256').update(markdown).digest('hex'),existing=rows.find(r=>r.source==='curriculum'&&r.sourceFile===filename);
  if(existing?.contentHash===hash)return {id:existing.id,duplicate:true};
  const title=JSON.parse(markdown.match(/^title: (.+)$/m)?.[1]||JSON.stringify(filename));
  const now=new Date().toISOString(),row=existing||{id:randomUUID(),role:'teachers',category:'ai-articles',source:'curriculum',sourceFile:filename,createdAt:now,ownerEmail:'kainnne@kcis.com.tw'};
  Object.assign(row,{title,filename:title+'.md',uploader:'朱璽',keywords:['朱璽','教職員','AI入門課程','AI'],updatedAt:now,hasMarkdown:true,readable:true,status:'readable',size:Buffer.byteLength(markdown),preview:markdown.slice(0,400),contentHash:hash,sourceVersion:(existing?.sourceVersion||0)+1});
  fs.mkdirSync(recordPath(row,'versions'),{recursive:true});atomic(recordPath(row,`versions/v${row.sourceVersion}.md`),markdown);atomic(recordPath(row,'content.md'),markdown);atomic(recordPath(row,'original'),markdown);
  if(!existing)rows.push(row);save(rows);return {id:row.id,duplicate:false};
 });
}
