import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { main } from '../src/cli.js';
import { saveConfig } from '../src/config.js';
import type { CredentialStores } from '../src/credential-store/types.js';
import { fakeStore, fakeStores } from './credential-store/fake-store.js';

const CONFIG = { site: 'acme.atlassian.net', email: 'me@example.com', apiBase: 'https://acme.atlassian.net' };
const MEDIA = 'https://api.media.atlassian.com/file';

const ATTACHMENTS = [
  { id: 10, filename: 'crash.log', size: 512, mimeType: 'text/plain', created: '2026-01-01T00:00:00.000Z' },
  { id: 11, filename: 'screen.png', size: 2048, mimeType: 'image/png', created: '2026-01-02T00:00:00.000Z' },
];

const BODIES: Record<string, string> = { 10: 'log body', 11: 'png body' };

let dir: string;
let previousConfigEnv: string | undefined;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jat-cli-attachments-'));
  previousConfigEnv = process.env.JAT_CONFIG;
  process.env.JAT_CONFIG = join(dir, 'config.json');
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  if (previousConfigEnv === undefined) delete process.env.JAT_CONFIG;
  else process.env.JAT_CONFIG = previousConfigEnv;
  await rm(dir, { recursive: true, force: true });
});

function stubJira(attachments: object[]): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === '/rest/api/3/issue/PROJ-1') return Response.json({ fields: { attachment: attachments } });
    const content = url.pathname.match(/^\/rest\/api\/3\/attachment\/content\/(\d+)$/);
    if (content) return new Response(null, { status: 302, headers: { location: `${MEDIA}/${content[1]}` } });
    const media = `${url.origin}${url.pathname}`.match(new RegExp(`^${MEDIA}/(\\d+)$`));
    if (media && media[1] in BODIES) return new Response(BODIES[media[1]]);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

async function loggedIn(): Promise<CredentialStores> {
  const keychain = fakeStore('keychain');
  keychain.tokens.set(CONFIG.email, 'secret-token');
  await saveConfig(process.env.JAT_CONFIG as string, CONFIG);
  return fakeStores([keychain]);
}

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

test('list prints one row per attachment', async () => {
  stubJira(ATTACHMENTS);
  const result = await run(['list', 'proj-1'], await loggedIn());
  assert.deepEqual(result, {
    code: 0,
    out: '10\t512 B\ttext/plain\tcrash.log\n11\t2.0 KB\timage/png\tscreen.png\n',
    err: '',
  });
});

test('list --json prints the attachments as JSON', async () => {
  stubJira(ATTACHMENTS);
  const result = await run(['list', 'PROJ-1', '--json', '--filter', 'png'], await loggedIn());
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.out), [
    { id: '11', filename: 'screen.png', size: 2048, mimeType: 'image/png', created: '2026-01-02T00:00:00.000Z' },
  ]);
});

test('list reports an issue without attachments', async () => {
  stubJira([]);
  const result = await run(['list', 'PROJ-1'], await loggedIn());
  assert.deepEqual(result, { code: 0, out: 'PROJ-1 has no attachments.\n', err: '' });
});

test('list reports when the filter matches nothing', async () => {
  stubJira(ATTACHMENTS);
  const result = await run(['list', 'PROJ-1', '--filter', 'mp4'], await loggedIn());
  assert.deepEqual(result, { code: 0, out: 'PROJ-1: no matching attachments.\n', err: '' });
});

test('list rejects an invalid issue key', async () => {
  const result = await run(['list', 'not-a-key'], await loggedIn());
  assert.deepEqual(result, { code: 1, out: '', err: 'jat: Invalid Jira key: NOT-A-KEY\n' });
});

test('get downloads the attachments into --out', async () => {
  stubJira(ATTACHMENTS);
  const outDir = join(dir, 'out');
  const result = await run(['get', 'PROJ-1', '--out', outDir], await loggedIn());
  assert.deepEqual(result, {
    code: 0,
    out: `downloaded  ${join(outDir, '10_crash.log')}\ndownloaded  ${join(outDir, '11_screen.png')}\n`,
    err: '',
  });
  assert.equal(await readFile(join(outDir, '10_crash.log'), 'utf8'), 'log body');
});

test('get --json prints the download results as JSON', async () => {
  stubJira(ATTACHMENTS);
  const outDir = join(dir, 'out');
  const result = await run(['get', 'PROJ-1', '--out', outDir, '--filter', 'log', '--json'], await loggedIn());
  assert.equal(result.code, 0);
  const [entry, ...rest] = JSON.parse(result.out);
  assert.deepEqual(rest, []);
  assert.equal(entry.id, '10');
  assert.equal(entry.status, 'downloaded');
  assert.equal(entry.path, join(outDir, '10_crash.log'));
});

test('get reports when no attachment matches', async () => {
  stubJira(ATTACHMENTS);
  const result = await run(['get', 'PROJ-1', '--out', join(dir, 'out'), '--filter', 'mp4'], await loggedIn());
  assert.deepEqual(result, { code: 0, out: 'PROJ-1: no matching attachments.\n', err: '' });
});

test('get skips attachments above --max-size and exits 0', async () => {
  stubJira(ATTACHMENTS);
  const result = await run(['get', 'PROJ-1', '--out', join(dir, 'out'), '--max-size', '0.001'], await loggedIn());
  assert.equal(result.code, 0);
  assert.match(result.out, /downloaded {2}.*10_crash\.log/);
  assert.match(result.err, /^skipped {5}screen\.png: size 2048 exceeds limit 1048$/m);
});

test('get exits 1 when a download fails', async () => {
  stubJira([...ATTACHMENTS, { id: 12, filename: 'gone.txt', size: 1 }]);
  const result = await run(['get', 'PROJ-1', '--out', join(dir, 'out')], await loggedIn());
  assert.equal(result.code, 1);
  assert.match(result.err, /^failed {6}gone\.txt: /m);
});

test('get rejects an invalid issue key', async () => {
  const result = await run(['get', 'bad'], await loggedIn());
  assert.deepEqual(result, { code: 1, out: '', err: 'jat: Invalid Jira key: BAD\n' });
});

for (const maxSize of ['0', '-1', 'abc']) {
  test(`get rejects --max-size ${maxSize}`, async () => {
    const result = await run(['get', 'PROJ-1', `--max-size=${maxSize}`], await loggedIn());
    assert.deepEqual(result, { code: 1, out: '', err: 'jat: --max-size must be a positive number of MB\n' });
  });
}

test('list and get need a login', async () => {
  for (const command of ['list', 'get']) {
    const result = await run([command, 'PROJ-1'], fakeStores([fakeStore('keychain')]));
    assert.equal(result.code, 1);
    assert.match(result.err, /Not logged in\. Run: jat auth login/);
  }
});
