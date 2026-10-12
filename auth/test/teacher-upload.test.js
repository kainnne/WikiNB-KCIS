import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {uploadLibrary,readLibrary,listLibrary,libraryAttachment,libraryMarkdown,searchLibraryText} from '../lib/school-library.js';
const teacher={email:'teacher@kcis.com.tw',nickname:'Ms Example',role:'teacher',authType:'email-otp'};
const student={email:'s98765@kcis.com.tw',nickname:'Student',role:'student',authType:'email-otp'};
test('teacher uploads enforce formats and preserve originals, converted Markdown and trusted nickname keywords',async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'kcis-upload-test-'));
 process.env.LIBRARY_DATA_DIR=temporary;
 const encoded=text=>Buffer.from(text).toString('base64');
 try{
  await assert.rejects(uploadLibrary(student,{filename:'notes.md',contentBase64:encoded('# Notes')}),error=>error.status===403);
  for(const filename of ['slides.exe','picture.png','data.zip','page.html'])await assert.rejects(uploadLibrary(teacher,{filename,contentBase64:encoded('data')}),error=>error.status===415);
  await assert.rejects(uploadLibrary(teacher,{filename:'fake.pdf',contentBase64:encoded('not a pdf')}),error=>error.status===415);
  await assert.rejects(uploadLibrary(teacher,{filename:'bad.txt',contentBase64:Buffer.from([0xff,0]).toString('base64')}),error=>error.status===415);
  await assert.rejects(uploadLibrary(teacher,{filename:'notes.md',contentBase64:encoded('hello'),keywords:['x'.repeat(41)]}));
  const original='---\nteacher: Impersonator\nkeywords:\n  - forged\n---\n# Algebra\nThe derivative describes a rate of change.';
  const row=await uploadLibrary(teacher,{filename:'algebra.md',contentBase64:encoded(original),keywords:['Calculus','calculus',' Ms Example ','  Grade 7  ','學生','Staff']});
  assert.deepEqual(row.keywords,['Ms Example','教職員','Calculus','Grade 7']);assert.equal(row.uploader,teacher.nickname);
  assert.equal(fs.readFileSync(libraryAttachment(student,row.id).file,'utf8'),original);
  const markdown=readLibrary(student,row.id).markdown;
  assert.match(markdown,/teacher: "Ms Example"/);assert.ok(!markdown.includes('Impersonator'));assert.ok(!markdown.includes('forged'));
  assert.match(markdown,/derivative/);assert.ok(fs.existsSync(libraryMarkdown(student,row.id).file));
  assert.equal(listLibrary(student,{query:'Grade 7'}).length,1);assert.equal(listLibrary(student,{mine:'1'}).length,0);assert.equal(listLibrary(teacher,{mine:'1'}).length,1);
  assert.equal(searchLibraryText(student,'Grade 7')[0].id,row.id);
  const text=await uploadLibrary(teacher,{filename:'science.txt',contentBase64:encoded('Biology: cells are the basic unit of life.'),keywords:[]});
  assert.equal(text.readable,true);assert.match(readLibrary(student,text.id).markdown,/cells/);
  const fixture=process.env.KCIS_IMPORT_FIXTURES;
  if(fixture)for(const ext of ['pdf','docx']){
    const buffer=fs.readFileSync(path.join(fixture,'import-fixture.'+ext));
    const converted=await uploadLibrary(teacher,{filename:'import-fixture.'+ext,contentBase64:buffer.toString('base64'),keywords:['conversion-fixture']});
    assert.equal(converted.readable,true,ext+' conversion failed');assert.equal(converted.hasMarkdown,true);
    assert.deepEqual(fs.readFileSync(libraryAttachment(student,converted.id).file),buffer);
    const md=readLibrary(student,converted.id).markdown;assert.match(md,ext==='pdf'?/Searchable PDF text/:/semantic text conversion/);
    assert.ok(fs.existsSync(libraryMarkdown(student,converted.id).file));
    if(ext==='pdf'){
      const dir=path.dirname(libraryAttachment(student,converted.id).file);
      const document=JSON.parse(fs.readFileSync(path.join(dir,'document.json')));assert.equal(document.pageCount,1);assert.ok(document.pages[0].blocks.length);
      assert.ok(fs.readdirSync(path.join(dir,'assets')).some(name=>name.endsWith('.png')));
      // Copy only the synthetic rendered page for visual inspection.
      if(process.env.KCIS_PDF_RENDER_OUTPUT){const image=fs.readdirSync(path.join(dir,'assets')).find(name=>name.endsWith('.png'));fs.copyFileSync(path.join(dir,'assets',image),process.env.KCIS_PDF_RENDER_OUTPUT);}
    }
  }
 }finally{fs.rmSync(temporary,{recursive:true,force:true});delete process.env.LIBRARY_DATA_DIR;}
});
