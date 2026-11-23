import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { HttpError, JiraClient } from '../src/jira-client.js';
import { LOOPBACK, startServer, type TestServer } from './helpers.js';

let media: TestServer;
let api: TestServer;

before(async () => {
  media = await startServer((req, res) => {
    if (req.url?.startsWith('/file/1')) return res.end('payload');
    res.statusCode = 404;
    res.end();
  });
  api = await startServer((req, res) => {
    if (req.url === '/rest/api/3/issue/PROJ-1?fields=attachment') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ fields: { attachment: [{ id: 1, filename: 'log.txt', size: 7, mimeType: 'text/plain' }] } }));
    }
    const redirects: Record<string, string> = {
      '/rest/api/3/attachment/content/1': `${media.origin}/file/1?token=SIGNED`,
      '/rest/api/3/attachment/content/2': 'https://evil.example.com/steal',
      '/rest/api/3/attachment/content/3': '/rest/api/3/attachment/content/3',
      '/rest/api/3/attachment/content/4': `${media.origin}/missing?token=SIGNED`,
    };
    if (req.url === '/rest/api/3/attachment/content/5') {
      res.statusCode = 302;
      return res.end();
    }
    const location = redirects[req.url ?? ''];
    if (location) {
      res.statusCode = 302;
      res.setHeader('location', location);
      return res.end();
    }
    res.statusCode = 401;
    res.end();
  });
});

after(async () => {
  await api.close();
  await media.close();
});

const client = () =>
  new JiraClient({ apiBase: api.origin, email: 'me@x.io', token: 'SECRET', allowedHosts: LOOPBACK, allowInsecure: true });

test('lists attachments with string ids', async () => {
  assert.deepEqual(await client().listAttachments('PROJ-1'), [
    { id: '1', filename: 'log.txt', size: 7, mimeType: 'text/plain', created: undefined },
  ]);
});

test('rejects malformed keys and ids before any request', async () => {
  await assert.rejects(client().listAttachments('PROJ-1/../x'), /Invalid Jira key/);
  await assert.rejects(client().openAttachment('1?x=y'), /Invalid attachment id/);
});

test('sends auth to the API but not to the cross-origin media host', async () => {
  media.requests.length = 0;
  const response = await client().openAttachment('1');
  assert.equal(await response.text(), 'payload');
  const apiHit = api.requests.findLast((r) => r.url?.endsWith('/content/1'));
  assert.match(apiHit?.authorization ?? '', /^Basic /);
  assert.equal(media.requests[0].authorization, undefined);
});

test('refuses redirects to hosts outside the allowlist', async () => {
  await assert.rejects(client().openAttachment('2'), /non-HTTPS|outside allowlist/);
});

test('stops redirect loops', async () => {
  await assert.rejects(client().openAttachment('3'), /Too many redirects/);
});

test('fails clearly on a redirect without Location', async () => {
  await assert.rejects(client().openAttachment('5'), /Redirect without Location/);
});

test('errors never leak the signed query string', async () => {
  await assert.rejects(client().openAttachment('4'), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 404/);
    assert.doesNotMatch(error.message, /SIGNED/);
    return true;
  });
});

test('refuses plain HTTP unless explicitly allowed for loopback', () => {
  assert.throws(() => new JiraClient({ apiBase: 'http://your-site.atlassian.net', email: 'a', token: 'b' }), /non-HTTPS/);
  assert.throws(() => new JiraClient({ apiBase: 'https://evil.example.com', email: 'a', token: 'b' }), /allowlist/);
});

test('reports 401 without exposing credentials', async () => {
  await assert.rejects(client().listAttachments('PROJ-2'), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 401);
    assert.doesNotMatch(error.message, /SECRET|bWVA/);
    return true;
  });
});
