import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const CREATED = [
  { id: '20', filename: 'a.log', size: 3, mimeType: 'text/plain', created: '2026-01-03T00:00:00.000Z', self: 'x' },
  { id: '21', filename: 'b.png', size: 4, mimeType: 'image/png', created: '2026-01-03T00:00:00.000Z', self: 'y' },
];

function stubUpload(status = 200, errorBody?: object): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (status !== 200) return errorBody ? Response.json(errorBody, { status }) : new Response(null, { status });
    return Response.json(CREATED);
  }) as typeof fetch;
  return requests;
}

async function uploadFiles(): Promise<string[]> {
  const paths = [join(dir, 'a.log'), join(dir, 'b.png')];
  await writeFile(paths[0], 'aaa');
  await writeFile(paths[1], 'bbbb');
  return paths;
}

test('upload sends every file in one request and prints one row each', async () => {
  const requests = stubUpload();
  const result = await run(['upload', 'proj-1', ...(await uploadFiles())], await loggedIn());
  assert.deepEqual(result, { code: 0, out: '20\t3 B\ttext/plain\ta.log\n21\t4 B\timage/png\tb.png\n', err: '' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, 'https://acme.atlassian.net/rest/api/3/issue/PROJ-1/attachments');
  assert.equal(requests[0].redirect, 'error');
  const form = await requests[0].formData();
  assert.deepEqual(form.getAll('file').map((f) => (f as File).name), ['a.log', 'b.png']);
});

test('upload --json prints the created attachments in the list shape', async () => {
  stubUpload();
  const result = await run(['upload', 'PROJ-1', ...(await uploadFiles()), '--json'], await loggedIn());
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.out), CREATED.map(({ self: _self, ...a }) => a));
});

test('upload checks every path before sending anything', async () => {
  const requests = stubUpload();
  const [good] = await uploadFiles();
  const missing = join(dir, 'missing.log');
  const result = await run(['upload', 'PROJ-1', good, missing], await loggedIn());
  assert.deepEqual(result, { code: 1, out: '', err: `jat: File not found: ${missing}\n` });
  assert.equal(requests.length, 0);
});

test('upload explains a 403 from Jira', async () => {
  stubUpload(403);
  const result = await run(['upload', 'PROJ-1', ...(await uploadFiles())], await loggedIn());
  assert.equal(result.code, 1);
  assert.match(result.err, /^jat: Upload failed: no permission to attach files to PROJ-1\. .*HTTP 403\)\n$/);
});

test('upload explains a gateway 401 caused by a read-only token', async () => {
  stubUpload(401, { code: 401, message: 'Unauthorized; scope does not match' });
  const result = await run(['upload', 'PROJ-1', ...(await uploadFiles())], await loggedIn());
  assert.equal(result.code, 1);
  assert.match(result.err, /^jat: Upload failed: the API token lacks the write:jira-work scope needed to attach files to PROJ-1\./);
  assert.match(result.err, /HTTP 401: Unauthorized; scope does not match\)\n$/);
});

test('upload needs files and a valid key', async () => {
  const stores = await loggedIn();
  assert.deepEqual(await run(['upload', 'PROJ-1'], stores), { code: 1, out: '', err: 'jat: No files to upload\n' });
  assert.deepEqual(await run(['upload', 'nope', 'a.log'], stores), { code: 1, out: '', err: 'jat: Invalid Jira key: NOPE\n' });
});
