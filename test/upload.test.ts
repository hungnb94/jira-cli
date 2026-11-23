import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { HttpError } from '../src/jira-client.js';
import { MAX_FILES_PER_REQUEST, explainUploadError, openUploadFiles } from '../src/upload.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jat-upload-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('opens each path as a named blob with its content', async () => {
  await writeFile(join(dir, 'crash.log'), 'boom');
  await writeFile(join(dir, 'screen.png'), 'png!!');
  const files = await openUploadFiles([join(dir, 'crash.log'), join(dir, 'screen.png')]);
  assert.deepEqual(
    await Promise.all(files.map(async (f) => [f.name, f.blob.size, await f.blob.text()])),
    [
      ['crash.log', 4, 'boom'],
      ['screen.png', 5, 'png!!'],
    ],
  );
});

test('rejects an empty file list', async () => {
  await assert.rejects(openUploadFiles([]), /No files to upload/);
});

test('rejects more files than one Jira request accepts', async () => {
  const path = join(dir, 'a.txt');
  await writeFile(path, 'a');
  await assert.rejects(openUploadFiles(Array(MAX_FILES_PER_REQUEST + 1).fill(path)), /Too many files: 61/);
});

test('names a path that does not exist', async () => {
  const missing = join(dir, 'missing.log');
  await assert.rejects(openUploadFiles([missing]), new RegExp(`File not found: ${missing}`));
});

test('names a path that is not a regular file', async () => {
  const sub = join(dir, 'sub');
  await mkdir(sub);
  await assert.rejects(openUploadFiles([sub]), new RegExp(`Not a regular file: ${sub}`));
});

const httpError = (status: number) => new HttpError('POST', status, new URL('https://acme.atlassian.net/rest/api/3/issue/PROJ-1/attachments'));

test('explains the documented upload failures', () => {
  const cases: [number, RegExp][] = [
    [403, /Create attachments/],
    [404, /PROJ-1 was not found/],
    [413, /size limit/],
  ];
  for (const [status, cause] of cases) {
    const error = explainUploadError(httpError(status), 'PROJ-1');
    assert.ok(error instanceof Error);
    assert.match(error.message, cause);
    assert.match(error.message, new RegExp(`HTTP ${status}`));
  }
});

test('passes other errors through unchanged', () => {
  const unauthorized = httpError(401);
  const network = new Error('socket hang up');
  assert.equal(explainUploadError(unauthorized, 'PROJ-1'), unauthorized);
  assert.equal(explainUploadError(network, 'PROJ-1'), network);
});
