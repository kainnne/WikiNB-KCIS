export function createRecentDocumentsState(readDocuments,onChange){
  const state={phase:'loading',files:[],categories:[]};
  let generation=0,accountKey='',pending=null;
  const notify=()=>onChange({...state});
  function signedOut(){generation++;accountKey='';pending=null;state.phase='anonymous';state.files=[];state.categories=[];notify();}
  function unavailable(){generation++;accountKey='';pending=null;state.phase='error';state.files=[];notify();}
  function load(user,{force=false}={}){
    const key=[user.email,user.updatedAt].join('|');
    if(!force&&key===accountKey&&pending)return pending;
    accountKey=key;const current=++generation;state.phase='loading';notify();
    pending=(async()=>{
      try{
        const data=await readDocuments();if(current!==generation)return;
        state.categories=data.categories||[];
        state.files=(data.files||[]).filter(file=>!file.deletedAt).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,6);
        state.phase='ready';
      }catch{if(current!==generation)return;state.phase='error';}
      finally{if(current===generation){pending=null;notify();}}
    })();
    return pending;
  }
  return {load,signedOut,unavailable,getState:()=>({...state})};
}
