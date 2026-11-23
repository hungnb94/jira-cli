import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createFileStore } from '../../src/credential-store/file.js';

const ACCOUNT = 'me@example.com';
const POSIX = process.platform !== 'win32';
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jat-file-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('stores the token in a 0600 file inside a 0700 directory', async () => {
  const dir = join(root, 'jat');
  const store = createFileStore({ dir });
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(await store.read(ACCOUNT), 'secret-token');
  if (POSIX) {
    assert.equal((await stat(join(dir, 'token.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
  }
});

test('replacing a token tightens a loosened file mode', { skip: !POSIX }, async () => {
  const path = join(root, 'token.json');
  await writeFile(path, '{}', { mode: 0o644 });
  await createFileStore({ dir: root }).store(ACCOUNT, 'secret-token');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('tokens for several accounts live side by side', async () => {
  const store = createFileStore({ dir: root });
  await store.store('other@example.com', 'other-token');
  assert.equal(await store.has(ACCOUNT), false);
  await assert.rejects(store.read(ACCOUNT), /No token in .*token\.json/);
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(await store.read('other@example.com'), 'other-token');
  assert.equal(await store.delete(ACCOUNT), true);
  assert.equal(await store.delete(ACCOUNT), false);
  assert.equal(await store.read('other@example.com'), 'other-token');
});

test('delete removes the file', async () => {
  const store = createFileStore({ dir: root });
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(await store.delete(ACCOUNT), true);
  assert.equal(await store.has(ACCOUNT), false);
});

test('a corrupt file is reported on read but does not block logout or a new login', async () => {
  const path = join(root, 'token.json');
  const store = createFileStore({ dir: root });
  await writeFile(path, 'not json');
  await assert.rejects(store.read(ACCOUNT), /Could not read .*jat auth logout/);
  assert.equal(await store.delete(ACCOUNT), true);
  await assert.rejects(stat(path), { code: 'ENOENT' });
  await writeFile(path, 'not json');
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(await store.read(ACCOUNT), 'secret-token');
});

test('a failed write keeps the previous token', { skip: !POSIX }, async () => {
  const store = createFileStore({ dir: root });
  await store.store(ACCOUNT, 'old-token');
  await chmod(root, 0o500);
  try {
    await assert.rejects(store.store(ACCOUNT, 'new-token'));
  } finally {
    await chmod(root, 0o700);
  }
  assert.equal(await store.read(ACCOUNT), 'old-token');
});

test('reads are always silent', () => {
  assert.equal(createFileStore({ dir: root }).silentRead({ promptOnRead: true }), true);
});
