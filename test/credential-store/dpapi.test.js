import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createDpapiStore } from '../../src/credential-store/dpapi.js';
import { fakeRun } from './fake-run.js';

const ACCOUNT = 'me@example.com';
const ENV = { SystemRoot: 'C:\\Windows' };
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jat-dpapi-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakePowerShell() {
  const hex = (s) => Buffer.from(s).toString('hex');
  const unhex = (s) => Buffer.from(s, 'hex').toString();
  return fakeRun(({ args, input }) => {
    const script = args.at(-1);
    if (script.includes('-AsPlainText')) return { stdout: `${hex(input)}\r\n` };
    return { stdout: `${unhex(input)}\r\n` };
  });
}

test('encrypts through PowerShell stdin and keeps only the blob on disk', async () => {
  const { run, calls } = fakePowerShell();
  const store = createDpapiStore({ run, dir, env: ENV });
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(calls[0].input, 'secret-token');
  assert.ok(calls.every((c) => !c.args.join(' ').includes('secret-token')));
  const saved = await readFile(join(dir, 'token.dpapi.json'), 'utf8');
  assert.doesNotMatch(saved, /secret-token/);
  assert.equal(await store.read(ACCOUNT), 'secret-token');
});

test('store fails when PowerShell does not return a blob', async () => {
  const { run } = fakeRun(() => ({ code: 1 }));
  await assert.rejects(createDpapiStore({ run, dir, env: ENV }).store(ACCOUNT, 'secret-token'), /could not encrypt/);
});

test('read explains a blob that cannot be decrypted', async () => {
  await writeFile(join(dir, 'token.dpapi.json'), JSON.stringify({ accounts: { [ACCOUNT]: '01000000d08c' } }));
  const { run } = fakeRun(() => ({ code: 1 }));
  await assert.rejects(createDpapiStore({ run, dir, env: ENV }).read(ACCOUNT), /only works for the Windows user/);
});

test('a blob with odd characters is never passed to PowerShell', async () => {
  const { run, calls } = fakePowerShell();
  const store = createDpapiStore({ run, dir, env: ENV });
  await writeFile(join(dir, 'token.dpapi.json'), JSON.stringify({ accounts: { [ACCOUNT]: '; Remove-Item' } }));
  assert.equal(await store.has(ACCOUNT), false);
  await assert.rejects(store.read(ACCOUNT), /No token in/);
  assert.equal(calls.length, 0);
  await store.store('other@example.com', 'other-token');
  assert.equal(await store.read('other@example.com'), 'other-token');
});

test('delete removes the file and reads are always silent', async () => {
  const store = createDpapiStore({ ...fakePowerShell(), dir, env: ENV });
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(await store.delete(ACCOUNT), true);
  assert.equal(await store.has(ACCOUNT), false);
  assert.equal(store.silentRead({ promptOnRead: true }), true);
});
