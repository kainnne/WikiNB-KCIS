// Queue one auth recheck; stale requests may never reopen a signed-out chat.
export function createChatInitialization(run) {
  let epoch=0,ready=false,running=null,pending=false;
  return {
    invalidate(){epoch++;ready=false;pending=false;},
    request(recheck=false){
      if(running){if(recheck)pending=true;return running;}
      if(ready&&!recheck)return Promise.resolve();
      running=(async()=>{
        for(let attempt=0;attempt<2;attempt++){
          pending=false;
          const currentEpoch=epoch;
          const isCurrent=()=>epoch===currentEpoch;
          const success=await run({isCurrent});
          if(isCurrent())ready=Boolean(success);
          if(!pending)break;
        }
      })().finally(()=>{running=null;pending=false;});
      return running;
    },
  };
}
