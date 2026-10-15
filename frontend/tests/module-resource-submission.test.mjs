import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/moduleResourceSubmission.ts');
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const helper = await import(`data:text/javascript,${encodeURIComponent(js)}`);
const file = (type, size = 10) => new File([new Uint8Array(size)], 'chosen.file', { type });
const draft = (kind, changes = {}) => ({ kind, title: 'Study notes', description: 'A useful resource', source: 'STUDENT', documentType: 'TD', file: null, url: '', ...changes });

test('file limits and types follow the MR2 endpoint', () => {
  assert.equal(helper.MAX_RESOURCE_IMAGE_BYTES, 10 * 1024 * 1024);
  assert.equal(helper.fileError('IMAGE', file('image/png')), null);
  assert.match(helper.fileError('IMAGE', file('image/gif')), /JPEG or PNG/);
  assert.match(helper.fileError('IMAGE', file('image/png', 0)), /nonempty/);
  assert.match(helper.fileError('IMAGE', file('image/png', helper.MAX_RESOURCE_IMAGE_BYTES + 1)), /10 MiB/);
  assert.equal(helper.fileError('PDF', file('application/pdf')), null);
  assert.match(helper.fileError('PDF', file('application/pdf', helper.MAX_RESOURCE_PDF_BYTES + 1)), /50 MiB/);
});

test('file request shapes contain only the matching kind fields', () => {
  const pdf = helper.submissionBody(draft('PDF', { file: file('application/pdf') }));
  assert.deepEqual([...pdf.keys()], ['kind', 'title', 'description', 'source', 'type', 'file']);
  assert.equal(pdf.get('type'), 'TD');
  const image = helper.submissionBody(draft('IMAGE', { file: file('image/png'), url: 'https://hidden.test' }));
  assert.deepEqual([...image.keys()], ['kind', 'title', 'description', 'source', 'file']);
  assert.equal(image.get('url'), null);
});

test('URL request shapes contain no file or taxonomy fields', () => {
  for (const kind of ['YOUTUBE', 'LINK']) {
    const body = JSON.parse(helper.submissionBody(draft(kind, { url: 'https://example.org/page', file: file('image/png') })));
    assert.deepEqual(Object.keys(body), ['kind', 'title', 'description', 'source', 'url']);
    assert.equal(body.kind, kind);
  }
  assert.equal(helper.urlError('YOUTUBE', 'https://youtu.be/dQw4w9WgXcQ'), null);
  assert.match(helper.urlError('YOUTUBE', 'https://evil.test/watch?v=dQw4w9WgXcQ'), /YouTube/);
  assert.match(helper.urlError('LINK', 'http://example.org'), /HTTPS/);
});

test('creation confirmation rejects wrong module, kind, source and status', () => {
  const submitted = draft('PDF', { file: file('application/pdf') });
  const response = { id: 'resource-1', module_id: 'module-1', kind: 'PDF', title: 'Study notes', source: 'STUDENT', status: 'PENDING', document_type: 'TD' };
  assert.equal(helper.validCreation(response, submitted, 'module-1'), true);
  for (const changed of [{ module_id: 'other' }, { kind: 'IMAGE' }, { source: 'OFFICIAL' }, { status: 'APPROVED' }, { document_type: 'OTHER' }]) {
    assert.equal(helper.validCreation({ ...response, ...changed }, submitted, 'module-1'), false);
  }
});
