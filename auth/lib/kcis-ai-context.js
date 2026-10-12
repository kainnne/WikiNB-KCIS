import fs from 'node:fs';
import path from 'node:path';
import {searchLibraryText,listLibrary,readLibrary} from './school-library.js';
import {loadPrivateCorpusForUser} from './private-files.js';
import {queryTerms,relevantExcerpt,retrievalQuestion} from './retrieval.js';
export function kcisInstructions(){return fs.readFileSync(new URL('../prompts/kcis-ai.md',import.meta.url),'utf8');}
export function relevantWikiContext(user,query,maxChars=6500){
 if(!user||!query)return '';
 const terms=queryTerms(query),dir=path.join(process.env.PROJECT_ROOT||process.cwd(),'wiki/teachers'),matches=[];
 if(!terms.length||!fs.existsSync(dir))return '';
 function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  if(entry.name.startsWith('.')||entry.name==='private'||entry.isSymbolicLink())continue;
  const file=path.join(folder,entry.name);if(entry.isDirectory()){walk(file);continue;}
  if(!entry.name.endsWith('.md'))continue;
  const text=fs.readFileSync(file,'utf8').slice(0,100000),name=path.relative(dir,file),haystack=(name+' '+text).normalize('NFKC').toLowerCase();
  const score=terms.reduce((n,t)=>n+Number(haystack.includes(t)),0);if(score)matches.push({name,text,score});
 }}walk(dir);
 let result='';for(const row of matches.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,4)){
  const piece=JSON.stringify({source:row.name,excerpt:relevantExcerpt(row.text,terms)});result+=(result?'\n':'')+piece;
 }return result.slice(0,maxChars);
}
export function isForumOverview(message){return /(?:目前|現在|近期).*AI\s*論壇|AI\s*Forum.*(?:currently|available|recent)|(?:what|summari[sz]e).*(?:in|from)\s*(?:the\s*)?AI\s*Forum/i.test(String(message));}
export function forumOverview(user){
 const rows=listLibrary(user).filter(row=>['forum','forum-article'].includes(row.source));
 return {scope:'forum_only',count:rows.length,documents:rows.slice(0,12).map(row=>({id:row.id,title:row.title||row.filename,status:row.resolution||'published',updatedAt:row.updatedAt,excerpt:readLibrary(user,row.id).markdown.slice(0,1200)}))};
}
export function isAuthoredLessonRequest(message,history=[]){return [message,...(Array.isArray(history)?history.slice(-8).map(item=>String(item.content||'')):[])].some(text=>/朱璽.*(?:筆記|課程)|(?:依|根據).*朱璽/.test(text));}
export function groundedContext(user,message,history=[]){
 if(user?.authType==='email-otp'&&isForumOverview(message))return JSON.stringify(forumOverview(user)).slice(0,16000);
 const query=retrievalQuestion(message,history);if(!query)return '';
 const studyRequest=isAuthoredLessonRequest(message,history);
 if(user?.authType==='email-otp'&&studyRequest){
  const lessons=listLibrary(user,{category:'ai-articles'}).filter(row=>row.keywords?.includes('AI入門課程')).sort((a,b)=>a.filename.localeCompare(b.filename)).slice(0,16);
  let current=0;
  for(const turn of [...(Array.isArray(history)?history:[]),{role:'user',content:message}]){
   const text=String(turn.content||'');
   // Select the last unit mentioned in the text, rather than the highest
   // number in the syllabus. A full course list often precedes unit one.
   let position=-1,selected=current;
   for(let i=0;i<lessons.length;i++){
    const title=String(lessons[i].title||'').replace(/^\d+｜/,'');
    const found=title?text.lastIndexOf(title):-1;
    if(found>position){position=found;selected=i;}
   }
   const chinese=['','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六'];
   for(const unit of text.matchAll(/第\s*(\d{1,2}|十[一二三四五六]?|[一二三四五六七八九])\s*(?:個)?單元|\bunit\s+(\d{1,2})\b/gi)){
    const value=unit[1]||unit[2],number=/^\d+$/.test(value)?Number(value):chinese.indexOf(value);
    if(number>0&&number<=lessons.length&&unit.index>position){position=unit.index;selected=number-1;}
   }
   if(position>=0)current=selected;
  }
  const selected=lessons.slice(current,current+2);
  return JSON.stringify({scope:'authored_lessons',syllabus:lessons.map(row=>({id:row.id,title:row.title||row.filename})),unitNotes:selected.map(row=>({id:row.id,title:row.title||row.filename,text:readLibrary(user,row.id).markdown}))}).slice(0,11000);
 }
 let shared='';if(user?.authType==='email-otp')shared=searchLibraryText(user,query).slice(0,4).map(row=>JSON.stringify({source:row.title,id:row.id,excerpt:row.snippet})).join('\n');
 const legacy=relevantWikiContext(user,query,Math.max(0,6500-shared.length));
 const privateDocs=loadPrivateCorpusForUser(user,Math.max(0,6500-shared.length-legacy.length),{query});
 return [shared,legacy,privateDocs].filter(Boolean).join('\n').slice(0,6500);
}
