import { readErrorDetail } from './jira-error.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const ATTACHMENT_ID = /^\d+$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  mimeType?: string;
  created?: string;
}

export interface UploadFile {
  name: string;
  blob: Blob;
}

export interface JiraUser {
  displayName?: string;
}

export interface JiraClientOptions {
  apiBase: string;
  email: string;
  token: string;
  fetchImpl?: typeof fetch;
  allowedHosts?: RegExp[];
  allowInsecure?: boolean;
}

interface RawAttachment {
  id: string | number;
  filename: string;
  size: number;
  mimeType?: string;
  created?: string;
}

type HttpMethod = 'GET' | 'POST';

interface JsonRequestOptions {
  body?: FormData;
  headers?: Record<string, string>;
}

export const DEFAULT_ALLOWED_HOSTS: RegExp[] = [/(^|\.)atlassian\.net$/, /(^|\.)atlassian\.com$/];

export class HttpError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(method: HttpMethod, status: number, url: URL, detail?: string) {
    super(`${method} ${url.origin}${url.pathname} -> HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.detail = detail;
  }
}

function toAttachment(a: RawAttachment): Attachment {
  return { id: String(a.id), filename: a.filename, size: a.size, mimeType: a.mimeType, created: a.created };
}

export function assertIssueKey(key: string): void {
  if (!ISSUE_KEY.test(key)) throw new Error(`Invalid Jira key: ${key}`);
}

export class JiraClient {
  readonly #apiBase: URL;
  readonly #authorization: string;
  readonly #fetch: typeof fetch;
  readonly #allowedHosts: RegExp[];
  readonly #allowInsecure: boolean;

  constructor({
    apiBase,
    email,
    token,
    fetchImpl = fetch,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
    allowInsecure = false,
  }: JiraClientOptions) {
    this.#fetch = fetchImpl;
    this.#allowedHosts = allowedHosts;
    this.#allowInsecure = allowInsecure;
    this.#apiBase = new URL(apiBase.replace(/\/+$/, ''));
    this.#assertAllowedUrl(this.#apiBase);
    this.#authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  async myself(): Promise<JiraUser> {
    return (await this.#requestJson('GET', '/rest/api/3/myself')) as JiraUser;
  }

  async listAttachments(key: string): Promise<Attachment[]> {
    assertIssueKey(key);
    const issue = (await this.#requestJson('GET', `/rest/api/3/issue/${key}?fields=attachment`)) as {
      fields?: { attachment?: RawAttachment[] };
    };
    return (issue.fields?.attachment ?? []).map(toAttachment);
  }

  async uploadAttachments(key: string, files: UploadFile[]): Promise<Attachment[]> {
    assertIssueKey(key);
    const form = new FormData();
    for (const file of files) form.append('file', file.blob, file.name);
    const created = (await this.#requestJson('POST', `/rest/api/3/issue/${key}/attachments`, {
      body: form,
      headers: { 'X-Atlassian-Token': 'no-check' },
    })) as unknown;
    if (!Array.isArray(created)) throw new Error(`Unexpected upload response from Jira for ${key}`);
    return (created as RawAttachment[]).map(toAttachment);
  }

  // Follows redirects by hand: the content URL redirects to a signed media URL on another host,
  // and the Authorization header must not travel to any origin other than the API base.
  async openAttachment(id: string): Promise<Response> {
    if (!ATTACHMENT_ID.test(id)) throw new Error(`Invalid attachment id: ${id}`);
    let url = this.#url(`/rest/api/3/attachment/content/${id}`);
    let headers: Record<string, string> = { Authorization: this.#authorization, Accept: '*/*' };
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.#fetch(url, { headers, redirect: 'manual' });
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (!response.ok) {
          await response.body?.cancel();
          throw new HttpError('GET', response.status, url);
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

  #url(path: string): URL {
    return new URL(`${this.#apiBase.pathname.replace(/\/$/, '')}${path}`, this.#apiBase);
  }

  async #requestJson(method: HttpMethod, path: string, { body, headers }: JsonRequestOptions = {}): Promise<unknown> {
    const url = this.#url(path);
    const response = await this.#fetch(url, {
      method,
      body,
      headers: { ...headers, Authorization: this.#authorization, Accept: 'application/json' },
      redirect: 'error',
    });
    if (!response.ok) throw new HttpError(method, response.status, url, await readErrorDetail(response));
    return response.json();
  }

  #assertAllowedUrl(url: URL): void {
    const insecureOk = this.#allowInsecure && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !insecureOk) throw new Error(`Refusing non-HTTPS URL: ${url.origin}`);
    if (!this.#allowedHosts.some((pattern) => pattern.test(url.hostname))) {
      throw new Error(`Refusing host outside allowlist: ${url.hostname}`);
    }
  }
}
