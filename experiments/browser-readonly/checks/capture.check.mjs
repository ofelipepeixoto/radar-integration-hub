import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtures, CASES } from '../fixtures.mjs';
import { capture, LIMITS } from '../capture.mjs';
let lab;
before(async () => { lab = await startFixtures(); });
after(async () => { await lab.close(); });
const collect = (sourceId, mode = 'http') => capture({ sourceId, mode }, lab);
const code = expected => error => error.code === expected && error.message === expected;

for (const input of [null, [], {}, { sourceId: 'static', mode: 'agent' },
  { sourceId: 'http://example.com', mode: 'http' }, { sourceId: '../sink', mode: 'http' },
  { sourceId: 'static', mode: 'http', url: 'http://example.com' },
  { sourceId: 'static', mode: 'http', approved: true }]) {
  test(`rejects authority/invalid input: ${JSON.stringify(input)}`, async () => {
    const before = lab.hits.length;
    await assert.rejects(capture(input, lab), code('INVALID_INPUT'));
    assert.equal(lab.hits.length, before);
  });
}
for (const mode of ['http', 'browser']) {
  for (const row of CASES) test(`${mode} / ${row.id} has explicit capture or abstention`, async () => {
    const result = await collect(row.id, mode);
    assert.equal(result.receipt.outcome, row[mode]);
    assert.equal(result.text, row[mode] === 'captured' ? row.expected : null);
    assert.equal(result.receipt.review_status, 'pending');
    assert.equal(result.receipt.identity_verified, false);
    assert.equal(result.receipt.provider_cost, 0);
    assert.match(result.receipt.source_sha256, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(result.receipt).includes('127.0.0.1'), false);
  });
  for (const [id, error] of [['redirect', 'HTTP_STATUS'], ['oversized', 'BYTE_LIMIT'], ['badmime', 'CONTENT_TYPE'], ['longtext', 'TEXT_LIMIT']]) {
    test(`${mode} refuses ${id}`, async () => {
      await assert.rejects(collect(id, mode), code(error));
      assert.equal(lab.hits.some(hit => hit.path === '/sink'), false);
    });
  }
}
test('absolute HTTP timeout interrupts a response that never finishes promptly', async () => {
  const started = performance.now();
  await assert.rejects(collect('slow'), code('HTTP_TIMEOUT'));
  assert.ok(performance.now() - started < LIMITS.httpMs + 1000);
});
for (const id of ['post', 'subresource', 'frame', 'inlineframe', 'websocket', 'popup', 'foreign']) {
  test(`real Chromium refuses ${id}; sink receives nothing`, async () => {
    await assert.rejects(collect(id, 'browser'), code('POLICY_DENIED'));
    assert.equal(lab.hits.some(hit => hit.path === '/sink'), false);
  });
}
test('service worker registration is disabled and does not reach the server', async () => {
  assert.equal((await collect('serviceworker', 'browser')).receipt.outcome, 'abstained');
  assert.equal(lab.hits.some(hit => hit.path === '/sink'), false);
});
test('fresh process/context isolates cookies/local storage across consecutive jobs', async () => {
  assert.equal((await collect('storage', 'browser')).text, 'fresh');
  assert.equal((await collect('storage', 'browser')).text, 'fresh');
  assert.ok(lab.hits.every(hit => hit.cookie === null));
});
test('HTTP and browser evidence binds identical original response bytes', async () => {
  const http = await collect('static');
  const browser = await collect('static', 'browser');
  assert.equal(http.receipt.source_sha256, browser.receipt.source_sha256);
  assert.equal(http.receipt.content_sha256, browser.receipt.content_sha256);
});
