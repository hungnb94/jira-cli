import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeychainStore } from '../../src/credential-store/keychain.js';
import { fakeRun } from './fake-run.js';

const ACCOUNT = 'me@example.com';

test('reads the token with a timeout for the approval dialog', async () => {
  const { run, calls } = fakeRun(() => ({ stdout: 'secret-token\n' }));
  assert.equal(await createKeychainStore({ run }).read(ACCOUNT), 'secret-token');
  assert.deepEqual(calls[0].args, ['find-generic-password', '-s', 'jat-jira-token', '-a', ACCOUNT, '-w']);
  assert.ok(calls[0].timeout > 0);
});

test('read reports a missing item and a denied dialog differently', async () => {
  const missing = createKeychainStore(fakeRun(() => ({ code: 44 })));
  await assert.rejects(missing.read(ACCOUNT), /No token in Keychain/);
  const denied = createKeychainStore(fakeRun(() => ({ code: 128 })));
  await assert.rejects(denied.read(ACCOUNT), /denied or timed out/);
});

test('stores the token through stdin, never argv, and trusts no app by default', async () => {
  const { run, calls } = fakeRun(({ args }) => (args[0] === 'delete-generic-password' ? { code: 44 } : {}));
  await createKeychainStore({ run }).store(ACCOUNT, 'secret-token');
  const add = calls.find((c) => c.args[0] === '-i');
  assert.match(add.input, /add-generic-password .* -T "" -w "secret-token"/);
  assert.ok(calls.every((c) => !c.args.join(' ').includes('secret-token')));
});

test('--allow-silent-read stores without the empty trust list', async () => {
  const { run, calls } = fakeRun(() => ({}));
  const store = createKeychainStore({ run });
  await store.store(ACCOUNT, 'secret-token', { promptOnRead: false });
  assert.doesNotMatch(calls.find((c) => c.args[0] === '-i').input, /-T ""/);
  assert.equal(store.silentRead({ promptOnRead: false }), true);
  assert.equal(store.silentRead({ promptOnRead: true }), false);
});

test('store fails when the item cannot be found afterwards', async () => {
  const { run } = fakeRun(({ args }) => (args[0] === 'find-generic-password' ? { code: 44 } : {}));
  await assert.rejects(createKeychainStore({ run }).store(ACCOUNT, 'secret-token'), /did not store/);
});

test('rejects values that could break out of the security -i command', async () => {
  const { run, calls } = fakeRun(() => ({}));
  const store = createKeychainStore({ run });
  await assert.rejects(store.store(ACCOUNT, 'x" -w "y'), /token contains unsupported characters/);
  await assert.rejects(store.read('a b'), /account contains unsupported characters/);
  assert.equal(calls.length, 0);
});

test('delete reports whether an item existed', async () => {
  assert.equal(await createKeychainStore(fakeRun(() => ({}))).delete(ACCOUNT), true);
  assert.equal(await createKeychainStore(fakeRun(() => ({ code: 44 }))).delete(ACCOUNT), false);
  await assert.rejects(createKeychainStore(fakeRun(() => ({ code: 1 }))).delete(ACCOUNT), /Could not remove/);
});
