export const siteCatalog = `KCIS sites and features (official entry points; link the URL when you recommend one):
- kcis.kainnne.com — KCIS AI Tools entry page; leads to AI Tools and KCIS AI.
- AI Tools, https://ai-tools.kcis.kainnne.com/
  1. AI Tool Navigator (/): recommends AI tools by role (teacher, student, staff) and task from 39 tools, with difficulty, cost, privacy and account needs, official and education links. No sign-in.
  2. Kuse Prompt Builder (/ → Kuse card): four steps (role, task, materials, specs) produce a structured prompt to paste into Kuse. No sign-in.
  3. AI Forum (/forum/): staff questions, replies and shared articles. School email sign-in.
  4. WikiNB KCIS (https://wikinb.kcis.kainnne.com/): teaching notes by teacher, subject and keyword; KCIS AI is at /codex/.
  5. AI Video Tutorials (/videos/): 27 KCIS AI tutorial videos. School email sign-in.
  6. AI-901 Practice (/ai-901/): Microsoft AI-901 certification practice, 656 questions, Chinese/English, suggested units, concept/hands-on filter, eight guided walkthroughs of the official labs, and mistake review. Needs the shared code from the course teacher — never reveal any code.
- Surveys, https://forms.kcis.kainnne.com/: AI workflow needs and training feedback.
Rules: when asked what tools exist, where to do something, or which tool to use, answer from this catalog and the
kcis_tools source; name specific tools with a one-line reason; do not invent tools or features; say when advice is
general knowledge rather than catalog content.`;

const toolIntent = /工具|推薦|推荐|可以用什[麼么]|去哪[裡里兒]|在哪[裡里兒]|哪[裡里兒](?:可以|能|有)|\b(?:tools?|recommend\w*|where (?:can|do|to|is|should)|what (?:can|should|could) (?:i|we) use|which (?:app|site|platform))\b/iu;

// Navigator task IDs are English. Recognize the words people use for the same
// tasks when they do not appear literally in a tool's short description.
const taskTerms = {
  lesson_plan: /教案|備課|lesson plan/i, worksheet: /學習單|練習單|worksheet/i,
  quiz: /測驗|出題|quiz|quizzes/i, presentation: /簡報|投影片|slides?|presentation/i,
  research: /研究|查資料|research/i, summary: /摘要|整理重點|summari[sz]|summary/i,
  translate: /翻譯|translat/i, image: /圖片|繪圖|插畫|images?/i,
  admin_draft: /行政|公文|administrative/i, fun_learn: /趣味學習|fun learn/i,
  homework_help: /作業|homework/i, study_notes: /筆記|study notes/i,
  simulation: /模擬|simulat/i, tutoring: /輔導|家教|tutor/i,
  poster: /海報|poster/i, video: /影片|視頻|video/i,
  collaboration: /協作|合作|collaborat/i, writing: /寫作|作文|writing/i,
  coding: /程式|編碼|coding|programming/i, web_project: /網頁|網站製作|web (?:project|development)/i,
  music: /音樂|配樂|歌曲|music|song/i, sound: /音效|sound|audio/i,
  feedback: /回饋|feedback/i, portfolio: /作品集|歷程檔案|portfolio/i,
  reading: /閱讀|reading/i, interest_explore: /探索興趣|explore interests/i,
  brainstorm: /腦力激盪|發想|brainstorm/i, language_practice: /口說|語言練習|speaking|language practice/i,
};
const roleTerms = {teacher: /老師|教師|teachers?/i, student: /學生|students?/i, staff: /行政|職員|staff|admin/i};
const filler = new Set('what which tools tool recommend recommends recommendations where could should can use for the with and you are some please'.split(' '));

export function toolSource(message, tools, accountRole) {
  const query = message.normalize('NFKC').toLowerCase();
  if (!toolIntent.test(query)) return null;
  const roles = Object.keys(roleTerms).filter(role => roleTerms[role].test(query));
  if (!roles.length && accountRole) roles.push(accountRole === 'admin' ? 'staff' : accountRole);
  const tasks = Object.keys(taskTerms).filter(task => taskTerms[task].test(query));
  const keywords = new Set();
  for (const word of query.match(/[a-z0-9]{2,}|\p{Script=Han}{2,}/gu) || []) {
    if (filler.has(word)) continue;
    keywords.add(word);
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 1; i < word.length; i++) keywords.add(word.slice(i - 1, i + 1));
    }
  }
  function score(tool) {
    const name = tool.name.toLowerCase();
    const description = (name + ' ' + Object.values(tool.shortDescription).join(' ')).toLowerCase();
    let points = query.includes(name) ? 24 : 0;
    for (const task of tasks) if (tool.tasks.includes(task)) points += 8;
    if (roles.some(role => tool.roles.includes(role))) points += 4;
    for (const term of keywords) if (description.includes(term)) points++;
    return points;
  }
  const ranked = tools.map(tool => ({tool, score: score(tool)})).sort((a, b) => b.score - a.score);
  return {scope: 'kcis_tools', tools: ranked.slice(0, 6).map(entry => entry.tool)};
}
