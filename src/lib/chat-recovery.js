const copy={
  en:{AI_RETRY:'AI service is busy. Retrying once…',AI_BUSY:'Gemini is temporarily busy. Please try again later.',AI_TIMEOUT:'AI response timed out. Please retry this question.',AI_QUOTA:'Gemini usage or request limits may have been reached. Please try again later.',AI_CONFIG:'Gemini rejected the request. Please ask the administrator to check the API key, permissions, and usage limits.',AI_INTERRUPTED:'AI response was interrupted. Please retry this question.',AI_EMPTY:'AI returned no answer. Please retry this question.',AI_CONNECTION:'AI connection failed. Please retry this question.',retry:'Retry',connecting:'Connecting…'},
  'zh-TW':{AI_RETRY:'AI 服務忙碌，正在重試一次…',AI_BUSY:'Gemini 服務暫時忙碌，請稍後再試。',AI_TIMEOUT:'AI 回覆逾時，請重試這一題。',AI_QUOTA:'Gemini 使用量或請求頻率可能已達上限，請稍後再試。',AI_CONFIG:'Gemini 拒絕這次請求，請聯絡管理員確認金鑰、權限及使用額度。',AI_INTERRUPTED:'AI 回覆中斷，請重試這一題。',AI_EMPTY:'AI 沒有傳回回答，請重試這一題。',AI_CONNECTION:'AI 連線失敗，請重試這一題。',retry:'重試',connecting:'連線中…'},
};
export function chatMessage(key,language='en',fallback=''){
  return (copy[language]||copy.en)[key]||fallback;
}
export function completedChatHistory(history,message,result){
  if(!result||result.stopped||result.type==='error'||result.ok===false||!String(result.answer||'').trim())return history;
  return [...history,{role:'user',content:message},{role:'assistant',content:result.answer}].slice(-24);
}
