import {getAuthUrl} from './auth-client.js';
export async function readSchoolDocuments(path=''){
  const response=await fetch(getAuthUrl()+'/api/library'+path,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'Could not read documents'),{status:response.status});
  return data;
}
export async function downloadSchoolDocument(id,filename,converted=false){
  const response=await fetch(getAuthUrl()+'/api/library/files/'+encodeURIComponent(id)+(converted?'/markdown':'/download'),{credentials:'include',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Download failed');
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=converted?filename.replace(/\.[^.]+$/,'.md'):filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
