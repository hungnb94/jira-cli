import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { main } from '../src/cli.js';
import type { CredentialStores } from '../src/credential-store/types.js';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `Usage:
  jat auth login --site <name>.atlassian.net --email <email> [--allow-silent-read]
  jat auth status
  jat auth logout
  jat list <KEY> [--json]
  jat get <KEY> [--out <dir>] [--filter <text>] [--max-size <MB>] [--json]
  jat upload <KEY> <file>... [--json]
  jat --version

The API token is read from a hidden prompt (or the first line of stdin) and stored only in the OS credential
store: macOS Keychain, a DPAPI-encrypted file on Windows, or the Secret Service keyring on Linux (with a 0600
file as the fallback when no keyring is running).

Add the agent skill (Claude Code, Cursor, Codex …): npx skills add hungnb94/jira-cli --skill jira-attachments
`;

const NO_STORES: CredentialStores = { byId: () => assert.fail('no store expected'), candidates: () => [] };

async function run(argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    stores: NO_STORES,
  });
  return { code, out, err };
}

test('--help, -h and no arguments print the usage', async () => {
  for (const argv of [['--help'], ['-h'], []]) {
    assert.deepEqual(await run(argv), { code: 0, out: USAGE, err: '' });
  }
});

test('--version prints the package version', async () => {
  assert.deepEqual(await run(['--version']), { code: 0, out: `${version}\n`, err: '' });
});

test('an unknown command prints the usage to stderr and exits 2', async () => {
  for (const argv of [['nope'], ['auth'], ['auth', 'nope']]) {
    assert.deepEqual(await run(argv), { code: 2, out: '', err: USAGE });
  }
});

test('an unknown option exits 1', async () => {
  const result = await run(['list', 'PROJ-1', '--nope']);
  assert.equal(result.code, 1);
  assert.match(result.err, /^jat: Unknown option '--nope'/);
});

test('exit codes for invalid input are unchanged', async () => {
  const cases: [string[], string][] = [
    [['list', 'bad'], 'jat: Invalid Jira key: BAD\n'],
    [['get', 'bad'], 'jat: Invalid Jira key: BAD\n'],
    [['get', 'PROJ-1', '--max-size', '0'], 'jat: --max-size must be a positive number of MB\n'],
    [['auth', 'login', '--site', 'example.com', '--email', 'me@example.com'], 'jat: --site must look like <name>.atlassian.net\n'],
    [['auth', 'login', '--site', 'acme.atlassian.net'], 'jat: --email is required\n'],
  ];
  for (const [argv, err] of cases) {
    assert.deepEqual(await run(argv), { code: 1, out: '', err }, argv.join(' '));
  }
});
