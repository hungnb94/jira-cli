import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { main } from '../src/cli.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { fakeStore, fakeStores } from './credential-store/fake-store.js';

let dir;
let previousConfigEnv;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jat-cli-'));
  previousConfigEnv = process.env.JAT_CONFIG;
  process.env.JAT_CONFIG = join(dir, 'config.json');
});

afterEach(async () => {
  if (previousConfigEnv === undefined) delete process.env.JAT_CONFIG;
  else process.env.JAT_CONFIG = previousConfigEnv;
  await rm(dir, { recursive: true, force: true });
});

async function run(argv, stores) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    stores,
  });
  return { code, out, err };
}

const CONFIG = { site: 'acme.atlassian.net', email: 'me@example.com', apiBase: 'https://acme.atlassian.net' };

test('status without a config says not logged in', async () => {
  const result = await run(['auth', 'status'], fakeStores([fakeStore('keychain')]));
  assert.equal(result.code, 1);
  assert.match(result.out, /Not logged in/);
});

test('status reports whether the token is stored', async () => {
  const keychain = fakeStore('keychain');
  await saveConfig(process.env.JAT_CONFIG, CONFIG);
  assert.equal((await run(['auth', 'status'], fakeStores([keychain]))).code, 1);
  keychain.tokens.set(CONFIG.email, 'secret-token');
  const result = await run(['auth', 'status'], fakeStores([keychain]));
  assert.equal(result.code, 0);
  assert.match(result.out, /site: acme\.atlassian\.net/);
  assert.doesNotMatch(result.out + result.err, /secret-token/);
});

test('logout removes the token', async () => {
  const keychain = fakeStore('keychain');
  keychain.tokens.set(CONFIG.email, 'secret-token');
  await saveConfig(process.env.JAT_CONFIG, CONFIG);
  const result = await run(['auth', 'logout'], fakeStores([keychain]));
  assert.equal(result.code, 0);
  assert.equal(keychain.tokens.size, 0);
  assert.ok(await loadConfig(process.env.JAT_CONFIG));
});
