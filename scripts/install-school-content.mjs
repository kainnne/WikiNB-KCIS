import fs from 'node:fs';import path from 'node:path';
import {installCourseLesson} from '../auth/lib/school-library.js';
const source=new URL('../school-content/teachers/ai-articles/',import.meta.url);
let installed=0,unchanged=0;
for(const filename of fs.readdirSync(source).filter(name=>name.endsWith('.md')).sort()){
 const result=await installCourseLesson({filename,markdown:fs.readFileSync(new URL(filename,source),'utf8')});
 result.duplicate?unchanged++:installed++;
}
console.log(JSON.stringify({installed,unchanged,storage:path.resolve(process.env.LIBRARY_DATA_DIR||path.join(process.env.PROJECT_ROOT||process.cwd(),'data','library'))}));
