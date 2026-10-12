import fs from 'node:fs';
import path from 'node:path';
import {usersStorePath} from './nickname-store.js';
import {findUserByEmail,publicUser} from './users.js';
import {createSessionToken} from './session.js';
import {updateLibraryAccount} from './school-library.js';
const file=()=>path.join(path.dirname(usersStorePath()),'profile-outbox.json');
function read(){return fs.existsSync(file())?JSON.parse(fs.readFileSync(file(),'utf8')):{};}
function save(rows){fs.mkdirSync(path.dirname(file()),{recursive:true});const temp=file()+'.tmp';fs.writeFileSync(temp,JSON.stringify(rows),{mode:0o600});fs.renameSync(temp,file());}
export function enqueueProfileUpdate(user){const rows=read();rows[user.email]={revision:user.updatedAt,library:false,forum:false,attempts:0};save(rows);}
let pending=null;
export async function flushProfileUpdates({fetcher=fetch,onlyEmail}={}){
 if(pending){await pending;return flushProfileUpdates({fetcher,onlyEmail});}
 pending=(async()=>{
  const jobs=read();let changed=0;
  for(const [email,job] of Object.entries(jobs).filter(([email])=>!onlyEmail||email===onlyEmail).slice(0,1)){
   const stored=findUserByEmail(email);if(!stored)continue;const user={...publicUser(stored),authType:'email-otp'};
   try{
    if(!job.library){await updateLibraryAccount(user);job.library=true;}
    if(!job.forum&&process.env.FORUM_API_URL){
     const target=new URL('/api/account/profile',process.env.FORUM_API_URL);
     if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname)))throw Error('HTTPS required');
     const token=await createSessionToken(user,{expiresIn:'2m'});
     const response=await fetcher(target,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000),redirect:'error'});
     if(!response.ok)throw Error('Profile sync failed');
     const delivered=await response.json();if(delivered.owned)await updateLibraryAccount(user,{references:delivered.owned});job.forum=true;
    }
    changed++;
   }catch{job.attempts++;}
   // Preserve a newer edit queued while delivery was in flight.
   const current=read();if(current[email]?.revision===job.revision){if(job.library&&job.forum)delete current[email];else current[email]=job;save(current);}
  }
  return {processed:changed,pending:Object.keys(read()).length};
 })();try{return await pending;}finally{pending=null;}
}
export function profileSyncStatus(email){const job=read()[email];return {library:job&&!job.library?'pending':'synced',forum:job&&!job.forum?'pending':'synced'};}
