import {fetchMe, isTeacherUser, getAuthUrl} from './auth-client.js';
import {t,uiError} from './i18n.js';
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
    const state=document.createElement('span');state.textContent=item.error||t(item.state);state.style.cssText='font-size:12px;color:var(--kc-muted);flex-shrink:0';row.append(name,state);
    if(item.id){const link=document.createElement('a');link.textContent=t('upload.view');link.href=`${document.documentElement.dataset.base}note?file=${encodeURIComponent(item.id)}`;link.className='kc-btn-ghost';row.append(link);}
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
    if(!extensions.has(file.name.split('.').pop().toLowerCase())){rejected.push(t('upload.invalidFormat',{name:file.name}));continue;}
    if(!file.size||file.size>12*1024*1024){rejected.push(t('upload.invalidSize',{name:file.name}));continue;}
    if(!files.some(item=>item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified))files.push({file,state:'upload.ready'});
  }
  status(rejected.join(' · '));draw();picker.value='';
}
function keywords(){
  const words=el('upload-keywords').value.split(/[,，\n]/).map(word=>word.trim()).filter(Boolean);
  if(words.length>12||words.some(word=>word.length>40))throw Error(t('upload.keywordLimit'));
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
  busy=true;draw();status(t('upload.processing'));
  for(const item of files.filter(item=>!item.id)){
    item.error='';item.state='upload.converting';draw();
    try{
      const bytes=new Uint8Array(await item.file.arrayBuffer());let binary='';for(let n=0;n<bytes.length;n+=32768)binary+=String.fromCharCode(...bytes.subarray(n,n+32768));
      const response=await fetch(getAuthUrl()+'/api/library/upload',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:item.file.name,contentBase64:btoa(binary),keywords:extra}),signal:AbortSignal.timeout(180000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Upload failed');
      item.id=result.id;item.state=result.status==='conversion-failed'?'upload.conversionFailed':result.readable?'upload.converted':'upload.noText';
    }catch(error){item.error=uiError(error,t('upload.failed'));}
    draw();
  }
  busy=false;draw();status(t(files.every(item=>item.id)?'upload.complete':'upload.partial'));
});
async function access(){
  const session=await fetchMe();teacher=session.authenticated&&isTeacherUser(session.user)?session.user:null;
  form.hidden=!teacher;el('upload-gate').hidden=!!teacher;
  if(teacher)el('upload-author').textContent=[teacher.nickname||teacher.name,teacher.department].filter(Boolean).join(' · ');
}
document.addEventListener('wikinb:auth-change',event=>{teacher=event.detail?.loggedIn&&isTeacherUser(event.detail.user)?event.detail.user:null;form.hidden=!teacher;el('upload-gate').hidden=!!teacher;if(teacher)el('upload-author').textContent=[teacher.nickname||teacher.name,teacher.department].filter(Boolean).join(' · ');});
document.addEventListener('wikinb:locale-change',()=>{draw();if(busy)status(t('upload.processing'));else if(files.some(item=>item.id))status(t(files.every(item=>item.id)?'upload.complete':'upload.partial'));});
void access();
