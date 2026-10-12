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
