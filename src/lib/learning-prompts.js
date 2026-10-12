export const learningPrompts=[
 {id:'admin',label:'AI for administrative work',text:'我是行政同仁，想從基本操作開始學 AI。請依朱璽的 AI 入門筆記安排課程，先列出單元，再從第一單元教起。每次只教一個單元，搭配會議紀錄、通知或活動安排的練習。介紹完請問我一個問題，等我回答、確認我理解後再進下一單元。教師與行政版本使用相同的核心單元，練習情境不同。沒有找到筆記的部分請先說明，不要編造作者的說法。'},
 {id:'teacher',label:'AI for teaching',text:'我是教師同仁，想從基本操作開始學 AI。請依朱璽的 AI 入門筆記安排課程，先列出單元，再從第一單元教起。每次只教一個單元，搭配教材整理、出題或教學簡報的練習。介紹完請問我一個問題，等我回答、確認我理解後再進下一單元。教師與行政版本使用相同的核心單元，練習情境不同。沒有找到筆記的部分請先說明，不要編造作者的說法。'},
 {id:'media',label:'Slides, images & video',text:'我想學簡報、圖片和影片製作。請依朱璽的筆記，先帶我確認這次要做什麼、給誰看、手上有哪些素材，再協助我安排製作步驟與可直接使用的指令。圖片或影片先做少量樣張，確認方向後再完成。請先問我想從簡報、圖片還是影片開始，等我回答再繼續。'},
 {id:'forum',label:'What’s in AI Forum?',text:'目前 AI 論壇有哪些分享文章或解決紀錄？請只根據同步到資料庫的論壇內容，整理主題、解決方法和對應來源。沒有資料就直接說目前沒有論壇資料，不要用一般 AI 知識或其他教材補成論壇內容。'},
 {id:'knowledge',label:'Build my AI knowledge',text:'請依朱璽的 AI 筆記幫我補充 AI 知識。先問我目前會用哪些工具、想改善哪一項工作，再挑一個適合的主題，用筆記裡的例子說明，給我一個小練習。補充的一般知識請與筆記內容分開說明，不要把推測寫成作者的經驗。'}
];
export function pickLearningPrompts(previous=[],random=Math.random){
 const shuffled=[...learningPrompts];
 for(let i=shuffled.length-1;i>0;i--){const j=Math.min(i,Math.floor(random()*(i+1)));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
 let pair=shuffled.slice(0,2);
 if(previous.length===2&&pair.every(item=>previous.includes(item.id)))pair=[shuffled[0],shuffled.find(item=>!previous.includes(item.id))];
 return pair;
}

const englishTexts={
 admin:"I'm an administrative colleague learning basic AI skills. Plan a course using Zhu Xi's AI introductory notes. List the units, then teach unit one. Teach one unit at a time with exercises on meeting minutes, notices or event planning. Ask me a question after each lesson and wait for my answer; check my understanding before continuing. Teachers and administrative colleagues follow the same core syllabus with different exercises. Say when the source notes are unavailable, and do not invent the author's statements.",
 teacher:"I'm a teacher learning basic AI skills. Plan a course using Zhu Xi's AI introductory notes. List the units, then teach unit one. Teach one unit at a time with exercises on summarizing materials, writing questions or making teaching slides. Ask me a question after each lesson and wait for my answer; check my understanding before continuing. Teachers and administrative colleagues follow the same core syllabus with different exercises. Say when the source notes are unavailable, and do not invent the author's statements.",
 media:"I'd like to learn how to make slides, images and videos using Zhu Xi's notes. Help me clarify what to make, who it is for and what materials I have, then plan the steps and usable instructions. For images and videos, make a few samples before completing the work. First ask whether I want to begin with slides, images or video, and wait for my answer.",
 forum:"What's currently in AI Forum? Use only forum articles and resolved questions synced to the library. Summarize their topics, solutions and sources. If there is no forum data, say so. Do not substitute general AI knowledge or course materials for forum records.",
 knowledge:"Help me build my AI knowledge using Zhu Xi's notes. First ask which tools I already use and what work I want to improve. Choose one suitable topic, explain it using examples from the notes and give me a small exercise. Distinguish additional general knowledge from the notes, and do not present guesses as the author's experience."
};
const chineseLabels={admin:'行政同仁學 AI',teacher:'教師同仁學 AI',media:'簡報、圖片與影片',forum:'AI 論壇有哪些內容？',knowledge:'補充 AI 知識'};
export function localizeLearningPrompt(prompt,language){
 return {...prompt,label:language==='zh-TW'?chineseLabels[prompt.id]:prompt.label,text:language==='en'?englishTexts[prompt.id]:prompt.text};
}
