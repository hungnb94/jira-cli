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

test('uploads files as one multipart POST with the no-check header', async () => {
  let seen: { method?: string; token?: string | string[]; type?: string; body: string } = { body: '' };
  const uploads = await startServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen = { method: req.method, token: req.headers['x-atlassian-token'], type: req.headers['content-type'], body };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ id: '20', filename: 'crash.log', size: 4, mimeType: 'text/plain', created: 'now', self: 'x' }]));
    });
  });
  try {
    const uploader = new JiraClient({ apiBase: uploads.origin, email: 'me@x.io', token: 'SECRET', allowedHosts: LOOPBACK, allowInsecure: true });
    const created = await uploader.uploadAttachments('PROJ-1', [{ name: 'crash.log', blob: new Blob(['boom']) }]);
    assert.deepEqual(created, [{ id: '20', filename: 'crash.log', size: 4, mimeType: 'text/plain', created: 'now' }]);
    assert.equal(uploads.requests[0].url, '/rest/api/3/issue/PROJ-1/attachments');
    assert.match(uploads.requests[0].authorization ?? '', /^Basic /);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.token, 'no-check');
    assert.match(seen.type ?? '', /^multipart\/form-data; boundary=/);
    assert.match(seen.body, /Content-Disposition: form-data; name="file"; filename="crash.log"\r\n[\s\S]*\r\n\r\nboom\r\n/);
  } finally {
    await uploads.close();
  }
});

test('rejects a malformed key before uploading', async () => {
  await assert.rejects(client().uploadAttachments('PROJ-1/../x', []), /Invalid Jira key/);
});

test('upload errors name the POST method and status', async () => {
  await assert.rejects(client().uploadAttachments('PROJ-9', [{ name: 'a', blob: new Blob(['a']) }]), (error) => {
    assert.ok(error instanceof HttpError);
    assert.match(error.message, /^POST .*\/rest\/api\/3\/issue\/PROJ-9\/attachments -> HTTP 401$/);
    return true;
  });
});
