import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/moduleResources.ts');
const moduleObject = { exports: {} };
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(js, {
  module: moduleObject, exports: moduleObject.exports, URL, URLSearchParams,
  require(name) {
    if (name === '@/lib/api') return { API_URL: 'https://api.example.test' };
    if (name === '@/lib/documentPresentation') return {
      isDocumentSource: value => ['STUDENT', 'OFFICIAL'].includes(value),
      isDocumentType: value => ['COURSE', 'TD', 'TP', 'EXAM', 'SOLUTION', 'OTHER'].includes(value),
      isDocumentReturnContext: value => ['module', 'mine', 'pending'].includes(value),
    };
    throw new Error(`Unexpected import: ${name}`);
  },
});
const helper = moduleObject.exports;
const item = { id: 'r-1', module_id: 'm-1', kind: 'PDF', title: 'Notes', description: null,
  source: 'STUDENT', status: 'APPROVED', created_at: '2026-10-14T12:00:00Z', updated_at: '2026-10-14T12:00:00Z', category: 'COURSE', document_type: 'COURSE' };

test('resource URL state keeps category independent of kind and validates return context', () => {
  const parsed = helper.readResourceUrl('?q=%20waves%20&category=TD&kind=IMAGE&source=STUDENT&from=pending');
  assert.equal(parsed.filters.q, 'waves');
  assert.equal(parsed.filters.category, 'TD');
  assert.equal(parsed.filters.kind, 'IMAGE');
  assert.equal(parsed.from, 'pending');
  assert.equal(helper.resourceModuleHref('module-a', parsed.filters, parsed.from), '/communities/irm/modules/module-a?q=waves&category=TD&kind=IMAGE&source=STUDENT&from=pending');
  const invalid = helper.readResourceUrl('?kind=EVIL&source=UNKNOWN&from=https://evil.test&category=BAD');
  assert.equal(invalid.filters.kind, '');
  assert.equal(invalid.filters.category, '');
  assert.equal(invalid.filters.source, '');
  assert.equal(invalid.from, 'module');
  assert.equal(helper.readResourceUrl('?kind=IMAGE&type=TD').filters.kind, 'PDF'); // legacy deep link
  assert.equal(helper.readResourceUrl('?category=TD').filters.kind, '');
  assert.equal(helper.readResourceUrl('?kind=PDF').filters.category, '');
});

test('feed query uses bounded keyset cursor and validates parent identity', () => {
  assert.equal(helper.resourceQuery({ q: 'waves', category: 'TD', kind: 'IMAGE', source: 'OFFICIAL' }, 'cursor-1'), 'q=waves&category=TD&kind=IMAGE&source=OFFICIAL&limit=20&after=cursor-1');
  assert.equal(helper.resourceQuery({ q: '', category: 'TD', kind: '', source: '' }), 'category=TD&limit=20');
  assert.equal(helper.resourceQuery({ q: '', category: '', kind: 'PDF', source: '' }), 'kind=PDF&limit=20');
  assert.equal(helper.validFeed({ items: [item], next_cursor: null }, 'm-1'), true);
  assert.equal(helper.validFeed({ items: [{ ...item, module_id: 'other' }], next_cursor: null }, 'm-1'), false);
  assert.equal(helper.validFeed({ items: [{ ...item, status: 'PENDING' }], next_cursor: null }, 'm-1'), false);
  assert.equal(helper.validFeed({ items: [{ ...item, category: 'UNKNOWN' }], next_cursor: null }, 'm-1'), false);
  assert.equal(helper.validFeed({ items: [{ ...item, category: 'TD' }], next_cursor: null }, 'm-1'), false);
  assert.equal(helper.validFeed({ items: [{ ...item, category: null }], next_cursor: null }, 'm-1'), false);
  assert.equal(helper.validFeed({ items: [{ ...item, category: undefined }], next_cursor: null }, 'm-1'), true);
  assert.equal(helper.resourceCategory({ ...item, category: undefined }), 'COURSE');
  assert.equal(helper.resourceCategory({ kind: 'LINK' }), null);
});

test('private preview requires the exact API origin and resource path', () => {
  const image = { id: 'r-1', preview_url: '/api/v1/communities/irm/resources/r-1/preview' };
  assert.equal(helper.resourcePreviewUrl('irm', image), 'https://api.example.test/api/v1/communities/irm/resources/r-1/preview');
  assert.equal(helper.resourcePreviewUrl('irm', { ...image, preview_url: 'https://evil.test/image' }), null);
  assert.equal(helper.resourcePreviewUrl('irm', { ...image, preview_url: `${image.preview_url}?q=1` }), null);
  assert.equal(helper.resourcePreviewUrl('irm', { ...image, preview_url: '/api/v1/communities/irm/resources/other/preview' }), null);
});

test('outbound URL actions accept canonical YouTube and safe HTTPS links', () => {
  assert.equal(helper.safeExternalUrl({ kind: 'YOUTUBE', video_id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(helper.safeExternalUrl({ kind: 'YOUTUBE', video_id: 'dQw4w9WgXcQ', url: 'https://evil.test/watch?v=dQw4w9WgXcQ' }), null);
  assert.equal(helper.safeExternalUrl({ kind: 'LINK', url: 'https://example.org/guide' }), 'https://example.org/guide');
  assert.equal(helper.safeExternalUrl({ kind: 'LINK', url: 'javascript:alert(1)' }), null);
});

test('pending feed validates all four kinds and rejects mismatched preview or authority state', () => {
  const common = { ...item, status: 'PENDING', module_slug: 'module-a', module_name: 'Module A',
    is_uploader: false, my_vote: null, can_vote: true, can_approve: false, can_delete: false, full_resource_access: false };
  const route = id => `/api/v1/communities/irm/resources/${id}/preview`;
  const pdf = { ...common, preview: { url: route(item.id), media_type: 'image/png' } };
  const image = { ...common, id: 'r-2', kind: 'IMAGE', category: 'TD', preview_url: route('r-2'), preview: { url: route('r-2'), media_type: 'image/webp' }, full_resource_access: true };
  const legacyImage = { ...image, id: 'r-3', preview_url: route('r-3'), preview: { url: route('r-3'), media_type: 'image/png' } };
  const youtube = { ...common, id: 'r-4', kind: 'YOUTUBE', category: null, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    video_id: 'dQw4w9WgXcQ', preview: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, full_resource_access: true };
  const link = { ...common, id: 'r-5', kind: 'LINK', category: 'TP', url: 'https://example.org/guide', preview: { url: 'https://example.org/guide' }, full_resource_access: true };
  const feed = { items: [pdf, image, legacyImage, youtube, link], next_cursor: null };
  assert.equal(helper.validPendingFeed(feed), true);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...pdf, preview: { url: 'https://evil.test/a', media_type: 'image/png' } }] }), false);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...youtube, preview: { url: 'https://evil.test/watch' } }] }), false);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...pdf, is_uploader: true }] }), false);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...pdf, my_vote: 'YES' }] }), false);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...pdf, status: 'APPROVED' }] }), false);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...pdf, category: 'TP' }] }), false);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...link, category: 'INVALID' }] }), false);
  assert.equal(helper.validPendingFeed({ ...feed, items: [{ ...link, can_delete: undefined }] }), false);
});

test('typed mine feed validates removal capability and every kind', () => {
  const common = { ...item, module_slug: 'module-a', module_name: 'Module A', can_delete: false };
  const pdf = { ...common, status: 'PENDING', can_delete: true };
  const image = { ...common, kind: 'IMAGE', preview_url: '/api/v1/communities/irm/resources/r-1/preview', status: 'REJECTED', can_delete: true };
  const youtube = { ...common, kind: 'YOUTUBE', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video_id: 'dQw4w9WgXcQ' };
  const link = { ...common, kind: 'LINK', url: 'https://example.org/guide', category: null };
  const feed = { items: [pdf, image, youtube, link], next_cursor: null };
  assert.equal(helper.validMyResourceFeed(feed), true);
  assert.equal(helper.validMyResourceFeed({ ...feed, items: [{ ...pdf, can_delete: false }] }), false);
  assert.equal(helper.validMyResourceFeed({ ...feed, items: [{ ...youtube, can_delete: true }] }), false);
  assert.equal(helper.validMyResourceFeed({ ...feed, items: [{ ...link, url: 'javascript:alert(1)' }] }), false);
});

test('reader return helper preserves only allowlisted PDF kind', () => {
  const source = fs.readFileSync(new URL('../src/lib/documentPresentation.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, URLSearchParams });
  const href = loaded.exports.moduleDocumentHref('module-a', { q: 'waves', type: '', source: 'STUDENT' }, 'module', 'PDF');
  assert.equal(href, '/communities/irm/modules/module-a?q=waves&kind=PDF&source=STUDENT&from=module');
  assert.equal(loaded.exports.moduleDocumentHref('module-a', { q: '', type: '', source: '' }, 'module', 'IMAGE').includes('kind='), false);
  const categories = loaded.exports.DOCUMENT_CATEGORY_OPTIONS;
  assert.deepEqual(Array.from(categories, ({ value, label }) => [value, label]), [
    ['COURSE', 'Cours'], ['TD', 'TD'], ['TP', 'TP'], ['EXAM', 'Examen'],
    ['SOLUTION', 'Solution'], ['OTHER', 'Autre'],
  ]);
  assert.equal(loaded.exports.moduleDocumentHref('module-a', { q: 'waves', type: '', category: 'TD', source: 'STUDENT' }, 'module', 'PDF'),
    '/communities/irm/modules/module-a?q=waves&category=TD&kind=PDF&source=STUDENT&from=module');
});
