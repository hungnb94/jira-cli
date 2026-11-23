import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { downloadAttachments } from '../src/download.js';

function fakeClient(attachments, bodies) {
  return {
    listAttachments: async () => attachments,
    openAttachment: async (id) => {
      if (!(id in bodies)) throw new Error(`HTTP 404 for ${id}`);
      return new Response(bodies[id]);
    },
  };
}

const tempDir = () => mkdtemp(join(tmpdir(), 'jat-test-'));

test('downloads matching attachments with private permissions', async () => {
  const outDir = join(await tempDir(), 'PROJ-1');
  const client = fakeClient(
    [
      { id: '1', filename: 'crash.log', size: 5 },
      { id: '2', filename: 'screen.png', size: 3 },
    ],
    { 1: 'hello', 2: 'png' },
  );
  const results = await downloadAttachments(client, 'PROJ-1', { outDir, filter: 'LOG', maxBytes: 100 });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'downloaded');
  assert.equal(await readFile(results[0].path, 'utf8'), 'hello');
  assert.equal((await stat(results[0].path)).mode & 0o777, 0o600);
});

test('skips attachments whose declared size exceeds the limit', async () => {
  const outDir = await tempDir();
  const client = fakeClient([{ id: '1', filename: 'big.mp4', size: 1000 }], { 1: 'x' });
  const [result] = await downloadAttachments(client, 'PROJ-1', { outDir, maxBytes: 10 });
  assert.equal(result.status, 'skipped');
  assert.deepEqual(await readdir(outDir), []);
});

test('aborts and removes the file when the body is larger than declared', async () => {
  const outDir = await tempDir();
  const client = fakeClient([{ id: '1', filename: 'lie.bin', size: 1 }], { 1: 'x'.repeat(50) });
  const [result] = await downloadAttachments(client, 'PROJ-1', { outDir, maxBytes: 10 });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /exceeds limit/);
  assert.deepEqual(await readdir(outDir), []);
});

test('does not overwrite an existing file', async () => {
  const outDir = await tempDir();
  await writeFile(join(outDir, '1_a.txt'), 'old');
  const client = fakeClient([{ id: '1', filename: 'a.txt', size: 3 }], { 1: 'new' });
  const [result] = await downloadAttachments(client, 'PROJ-1', { outDir, maxBytes: 10 });
  assert.equal(result.status, 'exists');
  assert.equal(await readFile(join(outDir, '1_a.txt'), 'utf8'), 'old');
});

test('reports a failed download without leaving a partial file', async () => {
  const outDir = await tempDir();
  const client = fakeClient([{ id: '9', filename: 'gone.txt', size: 3 }], {});
  const [result] = await downloadAttachments(client, 'PROJ-1', { outDir, maxBytes: 10 });
  assert.equal(result.status, 'failed');
  assert.deepEqual(await readdir(outDir), []);
});

test('writes traversal names inside the output directory only', async () => {
  const outDir = await tempDir();
  const client = fakeClient([{ id: '1', filename: '../../escape.sh', size: 2 }], { 1: 'hi' });
  const [result] = await downloadAttachments(client, 'PROJ-1', { outDir, maxBytes: 10 });
  assert.equal(result.path, join(outDir, '1_escape.sh'));
});
