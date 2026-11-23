import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSecretServiceStore } from '../../src/credential-store/secret-service.js';
import { fakeRun } from './fake-run.js';

const ACCOUNT = 'me@example.com';

function keyring() {
  const items = new Map();
  return fakeRun(({ args, input }) => {
    const account = args.at(-1);
    if (args[0] === 'store') items.set(account, input);
    if (args[0] === 'lookup') return items.has(account) ? { stdout: items.get(account) } : { code: 1 };
    if (args[0] === 'clear') items.delete(account);
    return {};
  });
}

test('stores through stdin and reads the token back', async () => {
  const { run, calls } = keyring();
  const store = createSecretServiceStore({ run });
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(await store.read(ACCOUNT), 'secret-token');
  assert.deepEqual(calls[0].args, ['store', '--label=jat Jira API token', 'service', 'jat-jira-token', 'account', ACCOUNT]);
  assert.equal(calls[0].input, 'secret-token');
  assert.ok(calls.every((c) => !c.args.includes('secret-token')));
});

test('read fails with a login hint when there is no token', async () => {
  await assert.rejects(createSecretServiceStore(keyring()).read(ACCOUNT), /No token in the Secret Service keyring.*jat auth login/);
});

test('store fails when no keyring daemon accepts the item', async () => {
  const { run } = fakeRun(() => ({ code: 1 }));
  await assert.rejects(createSecretServiceStore({ run }).store(ACCOUNT, 'secret-token'), /secret-tool store failed/);
});

test('a missing secret-tool binary is reported plainly', async () => {
  const run = async () => {
    throw Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' });
  };
  await assert.rejects(createSecretServiceStore({ run }).store(ACCOUNT, 'secret-token'), /secret-tool is not installed/);
});

test('delete clears only an existing item', async () => {
  const { run, calls } = keyring();
  const store = createSecretServiceStore({ run });
  assert.equal(await store.delete(ACCOUNT), false);
  assert.ok(!calls.some((c) => c.args[0] === 'clear'));
  await store.store(ACCOUNT, 'secret-token');
  assert.equal(await store.delete(ACCOUNT), true);
  assert.equal(await store.has(ACCOUNT), false);
});

test('reads are always silent', () => {
  assert.equal(createSecretServiceStore(keyring()).silentRead({ promptOnRead: true }), true);
});
