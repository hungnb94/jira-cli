import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { main } from '../src/cli.js';
import { loadConfig, saveConfig } from '../src/config.js';
import type { CredentialStores } from '../src/credential-store/types.js';
import { fakeStore, fakeStores } from './credential-store/fake-store.js';

let dir: string;
let configFile: string;
let previousConfigEnv: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jat-cli-'));
  previousConfigEnv = process.env.JAT_CONFIG;
  configFile = join(dir, 'config.json');
  process.env.JAT_CONFIG = configFile;
});

afterEach(async () => {
  if (previousConfigEnv === undefined) delete process.env.JAT_CONFIG;
  else process.env.JAT_CONFIG = previousConfigEnv;
  await rm(dir, { recursive: true, force: true });
});

async function run(argv: string[], stores: CredentialStores) {
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
  await saveConfig(configFile, CONFIG);
  assert.equal((await run(['auth', 'status'], fakeStores([keychain]))).code, 1);
  keychain.tokens.set(CONFIG.email, 'secret-token');
  const result = await run(['auth', 'status'], fakeStores([keychain]));
  assert.equal(result.code, 0);
  assert.match(result.out, /site: acme\.atlassian\.net/);
  assert.match(result.out, /token store: Fake keychain/);
  assert.match(result.out, /token stored: yes/);
  assert.doesNotMatch(result.out + result.err, /secret-token/);
});

test('logout removes the token', async () => {
  const keychain = fakeStore('keychain');
  keychain.tokens.set(CONFIG.email, 'secret-token');
  await saveConfig(configFile, CONFIG);
  const result = await run(['auth', 'logout'], fakeStores([keychain]));
  assert.equal(result.code, 0);
  assert.equal(keychain.tokens.size, 0);
  assert.ok(await loadConfig(configFile));
});

test('a config from 0.2.0 without a store id uses the Keychain', async () => {
  const keychain = fakeStore('keychain');
  const file = fakeStore('file');
  keychain.tokens.set(CONFIG.email, 'secret-token');
  await saveConfig(configFile, CONFIG);
  const result = await run(['auth', 'status'], fakeStores([file, keychain]));
  assert.equal(result.code, 0);
  assert.match(result.out, /token store: Fake keychain/);
  assert.doesNotMatch(result.out, /silent read/);
});

test('status and logout use the store recorded at login', async () => {
  const keyring = fakeStore('secret-service');
  const file = fakeStore('file');
  file.tokens.set(CONFIG.email, 'secret-token');
  await saveConfig(configFile, { ...CONFIG, store: 'file', silentRead: true });
  const status = await run(['auth', 'status'], fakeStores([keyring, file]));
  assert.match(status.out, /token store: Fake file\nsilent read: yes\ntoken stored: yes/);
  const logout = await run(['auth', 'logout'], fakeStores([keyring, file]));
  assert.match(logout.out, /Token removed from Fake file\./);
  assert.equal(file.tokens.size, 0);
});

test('an unknown recorded store is an error, not a silent fallback', async () => {
  await saveConfig(configFile, { ...CONFIG, store: 'vault' });
  const result = await run(['auth', 'status'], fakeStores([fakeStore('keychain')]));
  assert.equal(result.code, 1);
  assert.match(result.err, /Unknown credential store: vault/);
});

test('help mentions the agent skill install command', async () => {
  const result = await run(['--help'], fakeStores([]));
  assert.match(result.out, /npx skills add hungnb94\/jira-cli --skill jira-attachments/);
});
