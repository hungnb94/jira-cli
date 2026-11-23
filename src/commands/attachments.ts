import { resolve } from 'node:path';
import { configPath, loadConfig } from '../config.js';
import type { CredentialStores } from '../credential-store/index.js';
import { downloadAttachments, selectAttachments } from '../download.js';
import { formatSize, printResults } from '../format.js';
import { JiraClient, assertIssueKey } from '../jira-client.js';
import { printable } from '../safe-name.js';
import { configuredStore } from './auth.js';
import type { Io, Values } from './types.js';

const DEFAULT_MAX_MB = 200;

async function authenticatedClient(stores: CredentialStores): Promise<JiraClient> {
  const config = await loadConfig(configPath());
  if (!config) throw new Error('Not logged in. Run: jat auth login --site <name>.atlassian.net --email <email>');
  const token = await configuredStore(config, stores).read(config.email);
  return new JiraClient({ apiBase: config.apiBase, email: config.email, token });
}

export async function list(rawKey: string | undefined, values: Values, io: Io, stores: CredentialStores): Promise<number> {
  const key = String(rawKey ?? '').toUpperCase();
  assertIssueKey(key);
  const client = await authenticatedClient(stores);
  const attachments = selectAttachments(await client.listAttachments(key), values.filter);
  if (values.json) {
    io.out(JSON.stringify(attachments, null, 2));
    return 0;
  }
  if (attachments.length === 0) io.out(values.filter ? `${key}: no matching attachments.` : `${key} has no attachments.`);
  for (const a of attachments) {
    io.out(`${a.id}\t${formatSize(a.size)}\t${printable(a.mimeType)}\t${printable(a.filename)}`);
  }
  return 0;
}

export async function get(rawKey: string | undefined, values: Values, io: Io, stores: CredentialStores): Promise<number> {
  const key = String(rawKey ?? '').toUpperCase();
  assertIssueKey(key);
  const maxMb = Number(values['max-size'] ?? DEFAULT_MAX_MB);
  if (!Number.isFinite(maxMb) || maxMb <= 0) throw new Error('--max-size must be a positive number of MB');
  const outDir = resolve(values.out ?? key);
  const client = await authenticatedClient(stores);
  const results = await downloadAttachments(client, key, {
    outDir,
    filter: values.filter,
    maxBytes: Math.floor(maxMb * 1024 * 1024),
  });
  if (values.json) io.out(JSON.stringify(results, null, 2));
  else printResults(key, results, io);
  return results.some((r) => r.status === 'failed') ? 1 : 0;
}
