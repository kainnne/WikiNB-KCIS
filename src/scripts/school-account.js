import { uiError } from './i18n.js';
import { getAuthUrl, clearSessionHint } from './auth-client.js';
export async function mountSchoolAccount({onChange=()=>{}}={}) {
 const el=id=>document.getElementById(id),dialog=el('school-account-dialog');if(!dialog||dialog.dataset.mounted)return;dialog.dataset.mounted='true';
 let user=null,view='login',step='email',busy=false,composing=false;
 document.addEventListener('wikinb:auth-change',event=>{user=event.detail?.loggedIn?event.detail.user:null;});
 el('school-nickname').addEventListener('compositionstart',()=>{composing=true;});el('school-nickname').addEventListener('compositionend',()=>{composing=false;});
 el('school-nickname').addEventListener('keydown',event=>{if(event.key==='Enter'&&(composing||event.isComposing||event.keyCode===229))event.preventDefault();});
 async function request(path,body,method){
  const base=getAuthUrl();if(!base)throw Error('Sign-in is not connected');
  const response=await fetch(base+'/api/auth/'+path,{method:method||(body===undefined?'GET':'POST'),credentials:'include',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(path==='send-code'?75000:15000)});
  const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Connection failed'),{status:response.status});return data;
 }
 async function refresh(){try{user=(await request('shared-session')).user;}catch(e){if([401,403].includes(e.status))user=null;else throw e;}return user;}
 async function changed(){clearSessionHint({notify:!user});try{localStorage.setItem('kcis:auth-change',String(Date.now()));}catch{}await onChange();const updates=[];window.dispatchEvent(new CustomEvent('kcis:account-updated',{detail:{user,waitUntil:promise=>updates.push(promise)}}));await Promise.all(updates);}
 function finishLogin(){
  const next=new URLSearchParams(location.search).get('next');
  if(/\/login(?:\/|$)/.test(location.pathname)&&next){try{const url=new URL(next,location.origin);if(url.origin===location.origin&&!url.username&&!url.password)location.assign(url.href);}catch{}}
 }
 function render(){
  const account=view==='account',logout=view==='logout';
  el('school-account-title').textContent=logout?'Sign out?':account?'Account':'School sign-in';
  el('school-account-email').textContent=account?user?.email||'':step!=='email'?el('school-email').value:'';el('school-account-email').hidden=!el('school-account-email').textContent;el('school-account-error').hidden=!el('school-account-error').textContent;
  for(const [id,show] of [['email',!logout&&!account&&step==='email'],['code',!logout&&!account&&step==='code'],['nickname',account],['department',account]]){el('school-'+id+'-field').hidden=!show;el('school-'+id).required=show;el('school-'+id).disabled=!show||busy;}
  el('school-account-submit').textContent=busy?'Saving…':logout?'Sign out':account?'Save':step==='email'?'Send code':'Continue';
  el('school-account-form').setAttribute('aria-busy',String(busy));
  el('school-account-submit').disabled=busy;el('school-account-close').disabled=busy;
  el('school-account-cancel').hidden=!logout&&!account;el('school-account-cancel').textContent=logout?'Cancel':'Sign out';el('school-account-cancel').disabled=busy;
 }
 async function open(mode){
  el('school-account-error').textContent='';el('school-account-notice').textContent='';
  try{await refresh();await onChange();if(user&&mode==='login'&&/\/login(?:\/|$)/.test(location.pathname)&&new URLSearchParams(location.search).get('next')){finishLogin();return;}
   view=user?(mode==='logout'?'logout':'account'):'login';step='email';el('school-nickname').value=user?.nickname||user?.name||'';el('school-department').value=user?.department||(user?.role==='student'?'學生':'教職員');
   render();if(!dialog.open)dialog.showModal();el(view==='logout'?'school-account-cancel':view==='account'?'school-nickname':'school-email').focus();
  }catch(error){el('school-account-notice').textContent=uiError(error);}
 }
 const close=()=>{if(!busy)dialog.close();};el('school-account-close').onclick=close;dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 el('school-account-cancel').onclick=()=>{if(busy)return;view=view==='logout'?'account':'logout';el('school-account-error').textContent='';render();};
 for(const id of ['nav-login','nav-mobile-login','library-login'])el(id)?.addEventListener('click',event=>{event.preventDefault();void open('login');});
 document.querySelectorAll('[data-school-signin]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();void open('login');}));
 for(const id of ['nav-user','nav-edit-nick','nav-mobile-edit-nick','school-account'])el(id)?.addEventListener('click',event=>{event.preventDefault();void open('account');});
 for(const id of ['nav-logout','nav-mobile-logout'])el(id)?.addEventListener('click',event=>{event.preventDefault();void open('logout');});
 el('school-account-form').onsubmit=async event=>{
  event.preventDefault();if(busy||composing)return;busy=true;el('school-account-error').textContent='';render();
  try{
   if(view==='logout'){await request('logout',{});user=null;await changed();dialog.close();el('school-account-notice').textContent='Signed out';}
   else if(view==='account'){
    const result=await request('nickname',{nickname:el('school-nickname').value.trim(),department:el('school-department').value.trim(),expectedRevision:user?.updatedAt},'PATCH');user=result.user;
    await changed();dialog.close();el('school-account-notice').textContent=(result.sync?.library==='pending'||result.sync?.forum==='pending')?'Account saved · Sync pending':'Account updated';
   }else if(step==='email'){el('school-email').value=el('school-email').value.trim().toLowerCase();await request('send-code',{email:el('school-email').value,purpose:'login'});step='code';el('school-code').value='';}
   else{const result=await request('login-with-code',{email:el('school-email').value,code:el('school-code').value,purpose:'login'});user=result.user;await changed();dialog.close();finishLogin();}
  }catch(error){el('school-account-error').textContent=uiError(error);}
  finally{busy=false;render();if(dialog.open&&view==='login')el(step==='code'?'school-code':'school-email').focus();}
 };
 const query=new URLSearchParams(location.search);if(query.get('account')==='1')void open('account');else if(query.get('signin')==='1')void open('login');
}
