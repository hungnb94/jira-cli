import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DETAIL_CHARS, readErrorDetail } from '../src/jira-error.js';

const json = (body: unknown, status = 401) => Response.json(body, { status });

test('reads the gateway message', async () => {
  assert.equal(await readErrorDetail(json({ code: 401, message: 'Unauthorized; scope does not match' })), 'Unauthorized; scope does not match');
});

test('joins Jira errorMessages and field errors', async () => {
  const body = { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: { file: 'Too big' } };
  assert.equal(await readErrorDetail(json(body, 404)), 'Issue does not exist or you do not have permission to see it.; Too big');
});

test('ignores bodies that are not JSON', async () => {
  const html = new Response('<html>Unauthorized</html>', { status: 401, headers: { 'content-type': 'text/html' } });
  assert.equal(await readErrorDetail(html), undefined);
});

test('ignores malformed JSON, empty bodies and bodies without messages', async () => {
  const broken = new Response('{"message":', { status: 401, headers: { 'content-type': 'application/json' } });
  assert.equal(await readErrorDetail(broken), undefined);
  assert.equal(await readErrorDetail(new Response(null, { status: 401 })), undefined);
  assert.equal(await readErrorDetail(json({ message: 42, errorMessages: [null, ''] })), undefined);
});

test('replaces control characters so the terminal cannot be driven by the response', async () => {
  assert.equal(await readErrorDetail(json({ message: 'bad\u001b[31mred\nline' })), 'bad?[31mred?line');
});

test('caps the detail length', async () => {
  const detail = await readErrorDetail(json({ message: 'x'.repeat(10_000) }));
  assert.equal(detail?.length, MAX_DETAIL_CHARS);
});

test('stops reading a body larger than the limit', async () => {
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new TextEncoder().encode('{"message":"' + 'x'.repeat(1024)));
    },
  });
  const response = new Response(endless, { status: 401, headers: { 'content-type': 'application/json' } });
  assert.equal(await readErrorDetail(response), undefined);
  assert.ok(pulled < 64, `pulled ${pulled} chunks`);
});
