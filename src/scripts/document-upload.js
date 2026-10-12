import {fetchMe, isTeacherUser, getAuthUrl} from './auth-client.js';
import {uiError} from './i18n.js';
const el=id=>document.getElementById(id);
const form=el('document-upload-form'), drop=el('upload-dropzone'), picker=el('upload-files');
const extensions=new Set(['pdf','md','docx','txt']);
let files=[], teacher=null, busy=false;
function status(message=''){el('upload-status').textContent=message;}
function draw(){
  el('upload-queue').replaceChildren();
  for(const item of files){
    const row=document.createElement('li');row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border:1px solid var(--kc-line);border-radius:14px;background:#fff';
    const name=document.createElement('strong');name.textContent=item.file.name;name.style.cssText='font-size:14px;overflow-wrap:anywhere;min-width:0';
    const state=document.createElement('span');state.textContent=item.state;state.style.cssText='font-size:12px;color:var(--kc-muted);flex-shrink:0';row.append(name,state);
    if(item.id){const link=document.createElement('a');link.textContent='View';link.href=`${document.documentElement.dataset.base}library/?file=${encodeURIComponent(item.id)}`;link.className='kc-btn-ghost';row.append(link);}
    el('upload-queue').append(row);
  }
  el('upload-submit').disabled=busy||!files.some(f=>!f.id);
  el('upload-clear').hidden=!files.length;el('upload-clear').disabled=busy;
  drop.disabled=busy;el('upload-keywords').disabled=busy;
}
function addFiles(incoming){
  if(busy||!teacher)return;
  const rejected=[];
  for(const file of incoming){
    if(!extensions.has(file.name.split('.').pop().toLowerCase())){rejected.push(`${file.name}: use PDF, MD, DOCX or TXT`);continue;}
    if(!file.size||file.size>12*1024*1024){rejected.push(`${file.name}: upload a nonempty file up to 12 MB`);continue;}
    if(!files.some(item=>item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified))files.push({file,state:'Ready'});
  }
  status(rejected.join(' · '));draw();picker.value='';
}
function keywords(){
  const words=el('upload-keywords').value.split(/[,，\n]/).map(word=>word.trim()).filter(Boolean);
  if(words.length>12||words.some(word=>word.length>40))throw Error('Add up to 12 keywords, each no longer than 40 characters.');
  return words;
}
drop.addEventListener('click',()=>picker.click());
picker.addEventListener('change',()=>addFiles([...picker.files]));
for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();if(!busy){drop.classList.add('is-dragging');if(event.dataTransfer)event.dataTransfer.dropEffect='copy';}});
for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('is-dragging');if(type==='drop')addFiles([...event.dataTransfer.files]);});
el('upload-clear').addEventListener('click',()=>{if(!busy){files=[];status();draw();}});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!teacher)return;
  let extra;try{extra=keywords();}catch(error){status(error.message);return;}
  busy=true;draw();status('Uploading and converting…');
  for(const item of files.filter(item=>!item.id)){
    item.state='Converting…';draw();
    try{
      const bytes=new Uint8Array(await item.file.arrayBuffer());let binary='';for(let n=0;n<bytes.length;n+=32768)binary+=String.fromCharCode(...bytes.subarray(n,n+32768));
      const response=await fetch(getAuthUrl()+'/api/library/upload',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:item.file.name,contentBase64:btoa(binary),keywords:extra}),signal:AbortSignal.timeout(180000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Upload failed');
      item.id=result.id;item.state=result.status==='conversion-failed'?'Conversion failed · original kept':result.readable?'Converted':'No searchable text';
    }catch(error){item.state=uiError(error,'Upload failed. Please try again.');}
    draw();
  }
  busy=false;draw();status(files.every(item=>item.id)?'Upload complete.':'Some files could not be uploaded.');
});
async function access(){
  const session=await fetchMe();teacher=session.authenticated&&isTeacherUser(session.user)?session.user:null;
  form.hidden=!teacher;el('upload-gate').hidden=!!teacher;
  if(teacher)el('upload-author').textContent=teacher.nickname||teacher.name;
}
document.addEventListener('wikinb:auth-change',event=>{teacher=event.detail?.loggedIn&&isTeacherUser(event.detail.user)?event.detail.user:null;form.hidden=!teacher;el('upload-gate').hidden=!!teacher;if(teacher)el('upload-author').textContent=teacher.nickname||teacher.name;});
void access();
