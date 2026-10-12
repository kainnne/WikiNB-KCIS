import { uiError } from './i18n.js';
import { getAuthUrl, clearSessionHint } from './auth-client.js';

export async function mountSchoolAccount({onChange=()=>{}}={}) {
  const el=id=>document.getElementById(id),dialog=el('school-account-dialog');
  if(!dialog||dialog.dataset.mounted)return;
  dialog.dataset.mounted='true';
  let user=null,view='login',step='email',busy=false,composing=false;
  el('school-nickname').addEventListener('compositionstart',()=>{composing=true;});
  el('school-nickname').addEventListener('compositionend',()=>{composing=false;});
  el('school-nickname').addEventListener('keydown',event=>{if(event.key==='Enter'&&(composing||event.isComposing||event.keyCode===229))event.preventDefault();});
  const tr=(zh,en)=>document.documentElement.lang.startsWith('zh')?zh:en;
  async function request(path,body,method) {
    const base=getAuthUrl();if(!base)throw Error(tr('登入服務未連接','Sign-in is not connected'));
    const response=await fetch(base+'/api/auth/'+path,{method:method||(body===undefined?'GET':'POST'),credentials:'include',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(path==='send-code'?75000:15000)});
    const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||tr('連線失敗','Connection failed')),{status:response.status});return data;
  }
  async function refresh(){try{user=(await request('shared-session')).user;try{if(user)localStorage.setItem('wikinb_kcis_signed_in','1');}catch{}}catch(e){if([401,403].includes(e.status))user=null;else throw e;}return user;}
  async function changed(){clearSessionHint();try{localStorage.setItem('kcis:auth-change',String(Date.now()));}catch{}window.dispatchEvent(new Event('kcis:session'));await onChange();window.dispatchEvent(new Event('kcis:account-updated'));}
  function finishLogin(){
    const next=new URLSearchParams(location.search).get('next');
    if(/\/login(?:\/|$)/.test(location.pathname)&&next){try{const url=new URL(next,location.origin);if(url.origin===location.origin&&!url.username&&!url.password){location.assign(url.href);return;}}catch{}}
    if(!/\/login(?:\/|$)/.test(location.pathname))location.reload();
  }
  function render() {
    const account=view==='account',logout=view==='logout',nickname=account;
    el('school-account-title').textContent=logout?tr('確定登出？','Sign out?'):account?tr('修改暱稱','Edit display name'):tr('校內登入','School sign-in');
    el('school-account-email').textContent=account?user?.email||'':step!=='email'?el('school-email').value:'';
    for(const [id,show] of [['email',!logout&&!account&&step==='email'],['code',!logout&&!account&&step==='code'],['nickname',!logout&&nickname]]){el('school-'+id+'-field').hidden=!show;el('school-'+id).required=show;el('school-'+id).disabled=!show||busy;}
    el('school-email-field').querySelector('span').textContent=tr('校內信箱','School email');el('school-code-field').querySelector('span').textContent=tr('驗證碼','Verification code');el('school-nickname-field').querySelector('span').textContent=tr('暱稱','Display name');
    el('school-account-submit').textContent=busy?tr('處理中…','Please wait…'):logout?tr('登出','Sign out'):account?tr('儲存','Save'):step==='email'?tr('寄送驗證碼','Send code'):tr('確認','Continue');
    el('school-account-submit').disabled=busy;el('school-account-close').disabled=busy;el('school-account-cancel').hidden=!logout&&!account;el('school-account-cancel').textContent=tr('取消','Cancel');el('school-account-cancel').disabled=busy;
  }
  async function open(mode){el('school-account-error').textContent='';el('school-account-notice').textContent='';try{await refresh();if(user&&mode==='login'&&/\/login(?:\/|$)/.test(location.pathname)&&new URLSearchParams(location.search).get('next')){finishLogin();return;}view=user?(mode==='logout'?'logout':'account'):'login';step='email';el('school-nickname').value=user?.nickname||user?.name||'';render();if(!dialog.open)dialog.showModal();el(view==='logout'?'school-account-cancel':view==='account'?'school-nickname':step==='email'?'school-email':'school-code').focus();}catch(e){el('school-account-notice').textContent=uiError(e);}}
  const close=()=>{if(!busy)dialog.close();};
  el('school-account-close').onclick=close;dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});el('school-account-cancel').onclick=close;
  for(const id of ['nav-login','nav-mobile-login','library-login'])el(id)?.addEventListener('click',e=>{e.preventDefault();void open('login');});
  document.querySelectorAll('[data-school-signin]').forEach(link=>link.addEventListener('click',e=>{e.preventDefault();void open('login');}));
  for(const id of ['nav-edit-nick','nav-mobile-edit-nick','school-account'])el(id)?.addEventListener('click',e=>{e.preventDefault();void open('account');});
  for(const id of ['nav-logout','nav-mobile-logout'])el(id)?.addEventListener('click',e=>{e.preventDefault();void open('logout');});
  el('school-account-form').onsubmit=async e=>{
    e.preventDefault();if(busy||composing)return;busy=true;el('school-account-error').textContent='';render();
    try {
      if(view==='logout'){await request('logout',{});user=null;await changed();dialog.close();location.reload();}
      else if(view==='account'){await request('nickname',{nickname:el('school-nickname').value.trim()},'PATCH');await refresh();await changed();dialog.close();el('school-account-notice').textContent=tr('暱稱已更新','Display name updated');}
      else if(step==='email'){el('school-email').value=el('school-email').value.trim().toLowerCase();await request('send-code',{email:el('school-email').value,purpose:'login'});step='code';el('school-code').value='';}
      else {
        const payload={email:el('school-email').value,code:el('school-code').value,purpose:'login'};
        await request('login-with-code',payload);await refresh();await changed();dialog.close();finishLogin();
      }
    }catch(error){el('school-account-error').textContent=uiError(error);}
    finally{busy=false;render();if(dialog.open&&view==='login')el(step==='code'?'school-code':'school-email').focus();}
  };
  document.addEventListener('wikinb:locale-change',render);
  const query=new URLSearchParams(location.search);
  if(query.get('account')==='1')void open('account');else if(query.get('signin')==='1')void open('login');
}
