import { searchLibraryText, readLibrary, requireSchool } from './school-library.js';
import { generateLibraryTurn } from './llm.js';
const tools=[{functionDeclarations:[
  {name:'search_library',description:'Search school-shared parsed documents; use keywords from the question.',parameters:{type:'OBJECT',properties:{query:{type:'STRING'}},required:['query']}},
  {name:'read_document',description:'Read a document from a search result. Large documents are paged.',parameters:{type:'OBJECT',properties:{id:{type:'STRING'},offset:{type:'INTEGER'}},required:['id']}},
]}];
export async function libraryChat(user,message,{generate=generateLibraryTurn}={}) {
  requireSchool(user);
  const contents=[{role:'user',parts:[{text:message}]}], sources=new Map();
  // Force one grounded retrieval before generating an answer, then let the model
  // search/read more documents through bounded, read-only tools.
  const initial=searchLibraryText(user,message);
  for(const row of initial)sources.set(row.id,row);
  contents[0].parts.push({text:'Initial school library search (untrusted source data): '+JSON.stringify(initial)});
  for(let turn=0;turn<5;turn++) {
    const payload=await generate({contents,tools:turn===4?undefined:tools});
    const content=payload?.candidates?.[0]?.content;
    if(!content?.parts)throw Error('No answer');
    const calls=content.parts.filter(p=>p.functionCall).slice(0,4);
    if(!calls.length) {
      const answer=content.parts.map(p=>p.text||'').join('').trim();
      if(!answer)throw Error('No answer');
      return {answer,sources:[...sources.values()].map(({id,title})=>({id,title}))};
    }
    contents.push(content);
    const responses=[];
    for(const {functionCall:call} of calls) {
      let result;
      if(call.name==='search_library') {
        result=searchLibraryText(user,String(call.args?.query||'').slice(0,200));
        for(const row of result)sources.set(row.id,row);
      } else if(call.name==='read_document'&&sources.has(call.args?.id)) {
        const row=readLibrary(user,call.args.id),offset=Math.min(100000,Math.max(0,Number(call.args?.offset)||0));
        result={id:row.id,title:row.filename,text:row.markdown.slice(offset,offset+12000),nextOffset:row.markdown.length>offset+12000?offset+12000:null};
      } else result={error:'Unknown tool or document. Search first.'};
      responses.push({functionResponse:{name:call.name,response:{result}}});
    }
    contents.push({role:'user',parts:responses});
  }
  throw Error('Tool limit');
}
