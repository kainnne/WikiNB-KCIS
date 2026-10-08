import fs from 'node:fs';
import path from 'node:path';
const output=path.resolve('dist');
fs.rmSync(path.join(output,'wiki'),{recursive:true,force:true});
for(const name of ['data','auth','secrets'])if(fs.existsSync(path.join(output,name)))throw Error('Private data in static build: '+name);
console.log('School build: private data and legacy public document assets excluded.');
