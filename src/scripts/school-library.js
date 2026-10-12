import {getAuthUrl, fetchMe, isTeacherUser, listAllWikiFiles} from './auth-client.js';
import {markdownToHtml} from './md-render.js';
import {uiError} from './i18n.js';
const el=id=>document.getElementById(id), mine=el('school-library').dataset.mine==='true';
let categories=[],files=[],role='',category='',current=null,busy=false;
const base=getAuthUrl(), pageBase=document.documentElement.dataset.base;
async function request(path,body){
  const response=await fetch(base+'/api/library'+path,{method:body===undefined?'GET':'POST',credentials:'include',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='/chat'?240000:30000)});
  const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Request failed'),{status:response.status});return data;
}
function status(text=''){el('library-status').textContent=text;}
async function perform(fn){if(busy)return;busy=true;status('Loading…');try{await fn();status();}catch(error){status(uiError(error));if([401,403].includes(error.status)){el('library-content').hidden=true;el('library-gate').hidden=false;}}finally{busy=false;}}
function categoryName(id){return categories.find(c=>c.id===id)?.en||id;}
function tags(words){const box=document.createElement('div');box.className='library-tags';for(const word of words||[]){const tag=document.createElement('span');tag.className='tag-badge';tag.textContent=({教職員:'Staff',學生:'Student'})[word]||word;box.append(tag);}return box;}
function render(){
  el('library-categories').replaceChildren();
  for(const c of [{id:'',en:'All categories'},...categories]){const button=document.createElement('button');button.type='button';button.textContent=c.en;button.setAttribute('aria-pressed',String(c.id===category));button.onclick=()=>{category=c.id;render();};el('library-categories').append(button);}
  const q=el('library-query').value.toLowerCase();el('library-files').replaceChildren();
  const visible=files.filter(f=>(!role||(role==='forum'?['forum','forum-article'].includes(f.source):f.role===role))&&(!category||f.category===category)&&(!q||(f.filename+' '+f.preview+' '+(f.keywords||[]).join(' ')).toLowerCase().includes(q)));
  for(const f of visible){
    const button=document.createElement('button');button.type='button';button.className='library-file';
    const title=document.createElement('strong');title.textContent=f.filename;
    const meta=document.createElement('small');meta.textContent=['forum','forum-article'].includes(f.source)?`AI Forum · ${f.source==='forum-article'?'Article':f.resolution||'Solution'} · ${categoryName(f.category)}`:`${f.uploader} · ${categoryName(f.category)} · ${f.readable?'Searchable':f.status==='conversion-failed'?'Conversion failed':'No searchable text'}`;
    button.append(title,meta,tags(f.keywords));button.onclick=()=>void perform(()=>openFile(f.id));el('library-files').append(button);
  }
  if(!visible.length){const p=document.createElement('p');p.textContent='No documents found.';el('library-files').append(p);}
}
function renderMarkdown(target,text){
  target.innerHTML=markdownToHtml(String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,''),{base:pageBase,linkifyWiki:false});
  target.querySelectorAll('img[src],a[href]').forEach(node=>{const attribute=node.tagName==='IMG'?'src':'href';const value=node.getAttribute(attribute);if(value?.startsWith('/api/library/'))node.setAttribute(attribute,base+value);});
}
async function openFile(id){
  current=await request('/files/'+id);el('library-files').hidden=true;el('library-reader').hidden=false;
  el('library-reader-title').textContent=current.filename;el('library-reader-keywords').replaceChildren(...tags(current.keywords).children);
  el('library-markdown-download').hidden=!current.markdown;renderMarkdown(el('library-markdown'),current.markdown||'Conversion is not available. You can download the original file.');
}
async function download(converted=false){
  const response=await fetch(base+`/api/library/files/${current.id}/${converted?'markdown':'download'}`,{credentials:'include'});
  if(!response.ok)throw Error('Download failed');
  const url=URL.createObjectURL(await response.blob()),anchor=document.createElement('a');anchor.href=url;anchor.download=converted?current.filename.replace(/\.[^.]+$/,'.md'):current.filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
el('library-close').onclick=()=>{el('library-reader').hidden=true;el('library-files').hidden=false;current=null;};
el('library-download').onclick=()=>void perform(()=>download());
el('library-markdown-download').onclick=()=>void perform(()=>download(true));
document.querySelectorAll('[data-role]').forEach(button=>button.onclick=()=>{role=button.dataset.role;document.querySelectorAll('[data-role]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));render();});
el('library-query').oninput=render;
el('library-ask')?.addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
  el('library-answer').textContent='Reading documents…';el('library-sources').replaceChildren();
  try{const data=await request('/chat',{message:el('library-question').value});renderMarkdown(el('library-answer'),data.answer);for(const source of data.sources){const button=document.createElement('button');button.type='button';button.textContent=source.title;button.onclick=()=>void perform(()=>openFile(source.id));el('library-sources').append(button);}}
  catch(error){el('library-answer').textContent='';throw error;}
});});
async function earlierNotes(user){
  if(!mine||!isTeacherUser(user))return;
  try{const data=await listAllWikiFiles({teacherId:user.teacherId});const list=el('legacy-notes-list');list.replaceChildren();for(const note of data.files||[]){const link=document.createElement('a');link.className='library-file';link.textContent=note.title||note.slug;link.href=pageBase+'note?'+new URLSearchParams({teacherId:note.teacherId||user.teacherId,subjectId:note.subjectId,slug:note.slug});list.append(link);}el('legacy-notes').hidden=!list.children.length;}catch{status('Earlier notes could not be loaded.');}
}
async function access(){
  const session=await fetchMe();el('library-upload').hidden=!(session.authenticated&&isTeacherUser(session.user));
  if(!session.authenticated){el('library-gate').hidden=false;return;}
  const data=await request(mine?'?mine=1':'');categories=data.categories;files=data.files;
  el('library-gate').hidden=true;el('library-content').hidden=false;render();await earlierNotes(session.user);
  const selected=new URLSearchParams(location.search).get('file');if(selected)await openFile(selected);
}
void perform(access);

let observedProfile='',accountRefresh=0;
async function refreshAccountFiles(){
 const generation=++accountRefresh,selected=current?.id;
 try{const data=await request(mine?'?mine=1':'');if(generation!==accountRefresh)return;categories=data.categories;files=data.files;el('library-gate').hidden=true;el('library-content').hidden=false;render();
  if(selected){const fresh=await request('/files/'+selected);if(generation!==accountRefresh||current?.id!==selected)return;current=fresh;el('library-reader-keywords').replaceChildren(...tags(fresh.keywords).children);}
 }catch(error){if(generation===accountRefresh)status(uiError(error));}
}
document.addEventListener('wikinb:auth-change',event=>{
 const session=event.detail||{},key=session.loggedIn?[session.user.email,session.user.nickname,session.user.department].join('|'):'';
 if(key===observedProfile)return;observedProfile=key;
 if(!session.loggedIn){accountRefresh++;files=[];current=null;el('library-content').hidden=true;el('library-gate').hidden=false;return;}
 if(!files.length&&busy)return;void refreshAccountFiles();
});
window.addEventListener('kcis:account-updated',event=>{if(event.detail?.user)event.detail.waitUntil?.(refreshAccountFiles());});
