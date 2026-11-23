const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const ATTACHMENT_ID = /^\d+$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export const DEFAULT_ALLOWED_HOSTS = [/(^|\.)atlassian\.net$/, /(^|\.)atlassian\.com$/];

export class HttpError extends Error {
  constructor(status, url) {
    super(`GET ${url.origin}${url.pathname} -> HTTP ${status}`);
    this.status = status;
  }
}

export function assertIssueKey(key) {
  if (!ISSUE_KEY.test(key)) throw new Error(`Invalid Jira key: ${key}`);
}

export class JiraClient {
  #apiBase;
  #authorization;
  #fetch;
  #allowedHosts;
  #allowInsecure;

  constructor({ apiBase, email, token, fetchImpl = fetch, allowedHosts = DEFAULT_ALLOWED_HOSTS, allowInsecure = false }) {
    this.#fetch = fetchImpl;
    this.#allowedHosts = allowedHosts;
    this.#allowInsecure = allowInsecure;
    this.#apiBase = new URL(apiBase.replace(/\/+$/, ''));
    this.#assertAllowedUrl(this.#apiBase);
    this.#authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  async myself() {
    return this.#getJson('/rest/api/3/myself');
  }

  async listAttachments(key) {
    assertIssueKey(key);
    const issue = await this.#getJson(`/rest/api/3/issue/${key}?fields=attachment`);
    return (issue.fields?.attachment ?? []).map((a) => ({
      id: String(a.id),
      filename: a.filename,
      size: a.size,
      mimeType: a.mimeType,
      created: a.created,
    }));
  }

  // Follows redirects by hand: the content URL redirects to a signed media URL on another host,
  // and the Authorization header must not travel to any origin other than the API base.
  async openAttachment(id) {
    if (!ATTACHMENT_ID.test(id)) throw new Error(`Invalid attachment id: ${id}`);
    let url = this.#url(`/rest/api/3/attachment/content/${id}`);
    let headers = { Authorization: this.#authorization, Accept: '*/*' };
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.#fetch(url, { headers, redirect: 'manual' });
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (!response.ok) {
          await response.body?.cancel();
          throw new HttpError(response.status, url);
        }
        return response;
      }
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without Location for attachment ${id}`);
      const next = new URL(location, url);
      this.#assertAllowedUrl(next);
      if (next.origin !== url.origin) headers = { Accept: '*/*' };
      url = next;
    }
    throw new Error(`Too many redirects for attachment ${id}`);
  }

  #url(path) {
    return new URL(`${this.#apiBase.pathname.replace(/\/$/, '')}${path}`, this.#apiBase);
  }

  async #getJson(path) {
    const url = this.#url(path);
    const response = await this.#fetch(url, {
      headers: { Authorization: this.#authorization, Accept: 'application/json' },
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    return response.json();
  }

  #assertAllowedUrl(url) {
    const insecureOk = this.#allowInsecure && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !insecureOk) throw new Error(`Refusing non-HTTPS URL: ${url.origin}`);
    if (!this.#allowedHosts.some((pattern) => pattern.test(url.hostname))) {
      throw new Error(`Refusing host outside allowlist: ${url.hostname}`);
    }
  }
}
