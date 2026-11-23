import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStores, storeWithFallback } from '../../src/credential-store/index.js';
import { fakeRun } from './fake-run.js';
import { fakeStore } from './fake-store.js';

test('stores in the first candidate that works', async () => {
  const keyring = fakeStore('secret-service');
  const file = fakeStore('file');
  const { store, skipped } = await storeWithFallback([keyring, file], 'me@example.com', 'tok', {});
  assert.equal(store, keyring);
  assert.deepEqual(skipped, []);
  assert.equal(file.tokens.size, 0);
});

test('falls back to the next candidate and reports why', async () => {
  const keyring = fakeStore('secret-service', { failStore: true });
  const file = fakeStore('file');
  const { store, skipped } = await storeWithFallback([keyring, file], 'me@example.com', 'tok', {});
  assert.equal(store, file);
  assert.equal(skipped[0].store, keyring);
  assert.match(skipped[0].reason, /not available/);
});

test('fails when no candidate can store the token, without echoing it', async () => {
  const stores = [fakeStore('a', { failStore: true }), fakeStore('b', { failStore: true })];
  await assert.rejects(storeWithFallback(stores, 'me@example.com', 'tok-secret', {}), (error) => {
    assert.match(error.message, /Fake a: a is not available; Fake b: b is not available/);
    assert.doesNotMatch(error.message, /tok-secret/);
    return true;
  });
});

test('macOS uses the Keychain only', () => {
  const stores = createStores({ platform: 'darwin', run: fakeRun(() => ({})).run, dir: '/tmp/jat' });
  assert.deepEqual(stores.candidates().map((s) => s.id), ['keychain']);
});

test('Linux prefers the Secret Service keyring and falls back to a file', () => {
  const stores = createStores({ platform: 'linux', run: fakeRun(() => ({})).run, dir: '/tmp/jat' });
  assert.deepEqual(stores.candidates().map((s) => s.id), ['secret-service', 'file']);
});

test('rejects unknown platforms and store ids', () => {
  const stores = createStores({ platform: 'aix', run: fakeRun(() => ({})).run, dir: '/tmp/jat' });
  assert.throws(() => stores.candidates(), /Unsupported platform: aix/);
  assert.throws(() => stores.byId('toString'), /Unknown credential store: toString/);
});
