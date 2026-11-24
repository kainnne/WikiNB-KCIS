import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCourseLesson} from '../auth/lib/school-library.js';

const source = fileURLToPath(new URL('../school-content/teachers/', import.meta.url));

function* articles(folder = '') {
  for (const entry of fs.readdirSync(path.join(source, folder), {withFileTypes: true})) {
    const {name} = entry;
    if (name.startsWith('.') || name.includes(' 2') || name.includes(' 3') || name === 'README.md') continue;
    const relativePath = folder + name;
    if (entry.isDirectory()) yield* articles(relativePath + '/');
    if (entry.isFile() && name.endsWith('.md')) yield relativePath;
  }
}

let installed = 0, unchanged = 0;
for (const relativePath of [...articles()].sort()) {
  // Keep the sourceFile keys used by the original course imports.
  const filename = /^ai-articles\/[^/]+$/.test(relativePath) ? path.posix.basename(relativePath) : relativePath;
  const result = await installCourseLesson({filename, markdown: fs.readFileSync(path.join(source, relativePath), 'utf8')});
  if (result.duplicate) unchanged++;
  else installed++;
}
console.log(JSON.stringify({installed,unchanged,storage:path.resolve(process.env.LIBRARY_DATA_DIR||path.join(process.env.PROJECT_ROOT||process.cwd(),'data','library'))}));
