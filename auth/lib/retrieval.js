const stopwords=new Set(['the','and','for','are','you','your','this','that','what','how','can','with','from','about','please','does','have']);
export function queryTerms(value){
 const normalized=String(value||'').normalize('NFKC').toLowerCase();const terms=[];
 for(const word of normalized.match(/[a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu)||[]){
  if(stopwords.has(word))continue;terms.push(word);
  if(/\p{Script=Han}/u.test(word)&&word.length>2)for(let n=0;n<word.length-1;n++)terms.push(word.slice(n,n+2));
 }
 return [...new Set(terms)].slice(0,80);
}
export function relevantExcerpt(text,terms,limit=1600){
 const body=String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,''),normalized=body.normalize('NFKC').toLowerCase();
 const matches=terms.map(term=>normalized.indexOf(term)).filter(n=>n>=0);const start=Math.max(0,(matches.length?Math.min(...matches):0)-160);
 return body.slice(start,start+limit);
}
export function isDirectConversation(message){return /^(?:你好|您好|嗨|你是誰|你是谁|你叫什麼|你叫什麼名字|介紹一下你自己|hi|hello|hey|who are you|what is your name|introduce yourself)[?？!！。.\s]*$/iu.test(String(message||'').normalize('NFKC').trim());}
export function retrievalQuestion(message,history=[]){
 if(isDirectConversation(message))return '';
 const context=String(message||'').length<80?(Array.isArray(history)?history:[]).filter(t=>t.role==='user'&&!isDirectConversation(t.content)).slice(-2).map(t=>String(t.content||'').slice(0,500)).join('\n'):'';
 return [context,message].filter(Boolean).join('\n').slice(-4000);
}

export function isVisualQuestion(message){return /\b(?:pdf|image|figure|diagram|chart|table|page)\b|圖片|圖表|圖形|版面|插圖|第.{0,3}頁/iu.test(String(message||''));}
