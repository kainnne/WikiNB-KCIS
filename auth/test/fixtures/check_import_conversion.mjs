import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { convertDocument } from '../../lib/document-import.js';

const fixtureDir = path.resolve(process.argv[2]);
const outputDir = path.join(fixtureDir, 'converted');
fs.mkdirSync(outputDir, { recursive: true });

const docxAssets = path.join(outputDir, 'docx-assets');
const docx = await convertDocument({
  filename: 'import-fixture.docx',
  buffer: fs.readFileSync(path.join(fixtureDir, 'import-fixture.docx')),
  assetDir: docxAssets,
  assetUrlPrefix: '/WikiNB-KCIS/test-assets',
  originalUrl: '/WikiNB-KCIS/import-fixture.docx',
});
assert.match(docx.body, /DOCX Import Fixture/);
assert.match(docx.body, /https:\/\/example\.com\/kcis/);
assert.match(docx.body, /<img[^>]+test-assets\/image-01\.png/);
assert.match(docx.body, /<table>/);
assert.equal(fs.existsSync(path.join(docxAssets, 'image-01.png')), true);

const pdf = await convertDocument({
  filename: 'import-fixture.pdf',
  buffer: fs.readFileSync(path.join(fixtureDir, 'import-fixture.pdf')),
  assetDir: path.join(outputDir, 'pdf-assets'),
  assetUrlPrefix: '/WikiNB-KCIS/test-pdf-assets',
  originalUrl: '/WikiNB-KCIS/import-fixture.pdf',
});
assert.match(pdf.body, /Searchable PDF text for WikiNB and Gemini/);
assert.match(pdf.body, /<iframe[^>]+import-fixture\.pdf/);
assert.match(pdf.body, /第 1 頁/);

console.log('DOCX/PDF conversion fixture: PASS');
