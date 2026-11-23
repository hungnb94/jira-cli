import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { configPath, loadConfig, saveConfig } from './config.js';
import { downloadAttachments, selectAttachments } from './download.js';
import { promptHidden } from './hidden-input.js';
import { HttpError, JiraClient, assertIssueKey } from './jira-client.js';
import { LEGACY_STORE, createStores, storeWithFallback } from './credential-store/index.js';
import { printable } from './safe-name.js';

const DEFAULT_MAX_MB = 200;
const SITE = /^[a-z0-9-]+\.atlassian\.net$/;
const EMAIL = /^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/;

const USAGE = `Usage:
  jat auth login --site <name>.atlassian.net --email <email> [--allow-silent-read]
  jat auth status
  jat auth logout
  jat list <KEY> [--json]
  jat get <KEY> [--out <dir>] [--filter <text>] [--max-size <MB>] [--json]

The API token is read from a hidden prompt (or the first line of stdin) and stored only in the OS credential
store: macOS Keychain, a DPAPI-encrypted file on Windows, or the Secret Service keyring on Linux (with a 0600
file as the fallback when no keyring is running).

Add the agent skill (Claude Code, Cursor, Codex …): npx skills add hungnb94/jira-cli --skill jira-attachments`;

const SKILL_HINT = 'Tip: add the agent skill with: npx skills add hungnb94/jira-cli --skill jira-attachments';

const OPTIONS = {
  site: { type: 'string' },
  email: { type: 'string' },
  'allow-silent-read': { type: 'boolean', default: false },
  out: { type: 'string' },
  filter: { type: 'string' },
  'max-size': { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, stores } = {}) {
  const io = { out: (line) => stdout.write(`${line}\n`), err: (line) => stderr.write(`${line}\n`) };
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    const [command, sub] = positionals;
    if (values.help || !command) {
      io.out(USAGE);
      return 0;
    }
    const credentials = stores ?? createStores();
    if (command === 'auth' && sub === 'login') return await login(values, io, credentials);
    if (command === 'auth' && sub === 'status') return await status(io, credentials);
    if (command === 'auth' && sub === 'logout') return await logout(io, credentials);
    if (command === 'list') return await list(sub, values, io, credentials);
    if (command === 'get') return await get(sub, values, io, credentials);
    io.err(USAGE);
    return 2;
  } catch (error) {
    io.err(`jat: ${error.message}`);
    return 1;
  }
}

async function login(values, io, stores) {
  const site = String(values.site ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const email = String(values.email ?? '').trim();
  if (!SITE.test(site)) throw new Error('--site must look like <name>.atlassian.net');
  if (!EMAIL.test(email)) throw new Error('--email is required');

  const token = await promptHidden('Jira API token (input hidden): ');
  if (!token) throw new Error('Empty token');

  const { apiBase, user } = await resolveApiBase(site, email, token);
  const previous = await loadConfig(configPath());
  const promptOnRead = !values['allow-silent-read'];
  const { store, skipped } = await storeWithFallback(stores.candidates(), email, token, { promptOnRead });
  await removePreviousToken(previous, { email, store }, stores);
  const silentRead = store.silentRead({ promptOnRead });
  await saveConfig(configPath(), { site, email, apiBase, store: store.id, silentRead });
  for (const { store: unavailable, reason } of skipped) {
    io.err(`warning: ${unavailable.label} is not available (${reason}); stored the token in ${store.label} instead.`);
  }
  if (silentRead) {
    io.err(`warning: any program running as your user can read the token from ${store.label} without asking you.`);
  }
  io.out(`Logged in as ${printable(user.displayName ?? email)} via ${apiBase}`);
  io.out(`Token stored in ${store.label}.`);
  io.out(SKILL_HINT);
  return 0;
}

async function removePreviousToken(previous, current, stores) {
  if (!previous?.email) return;
  const previousStoreId = previous.store ?? LEGACY_STORE;
  if (previous.email === current.email && previousStoreId === current.store.id) return;
  try {
    await stores.byId(previousStoreId).delete(previous.email);
  } catch {
    // The old token may already be gone or its store unreachable; the new login must still succeed.
  }
}

// Classic API tokens work on the site URL; scoped tokens only work through the api.atlassian.com gateway.
async function resolveApiBase(site, email, token) {
  const direct = `https://${site}`;
  try {
    return { apiBase: direct, user: await new JiraClient({ apiBase: direct, email, token }).myself() };
  } catch (error) {
    if (!(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error;
  }
  const tenant = await fetch(`https://${site}/_edge/tenant_info`, { redirect: 'error' });
  if (!tenant.ok) throw new Error(`Could not resolve cloudId for ${site} (HTTP ${tenant.status})`);
  const { cloudId } = await tenant.json();
  if (typeof cloudId !== 'string' || !cloudId) throw new Error(`Could not resolve cloudId for ${site}`);
  const gateway = `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}`;
  try {
    return { apiBase: gateway, user: await new JiraClient({ apiBase: gateway, email, token }).myself() };
  } catch (error) {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      throw new Error('Token rejected. Check the email, the token, and that it has scopes read:jira-work and read:jira-user');
    }
    throw error;
  }
}

async function status(io, stores) {
  const config = await loadConfig(configPath());
  if (!config) {
    io.out('Not logged in.');
    return 1;
  }
  const store = configuredStore(config, stores);
  const stored = await store.has(config.email);
  const lines = [`site: ${config.site}`, `email: ${config.email}`, `api: ${config.apiBase}`, `token store: ${store.label}`];
  if (typeof config.silentRead === 'boolean') lines.push(`silent read: ${config.silentRead ? 'yes' : 'no'}`);
  lines.push(`token stored: ${stored ? 'yes' : 'no'}`);
  io.out(lines.join('\n'));
  return stored ? 0 : 1;
}

async function logout(io, stores) {
  const config = await loadConfig(configPath());
  if (!config) {
    io.out('Not logged in.');
    return 0;
  }
  const store = configuredStore(config, stores);
  const removed = await store.delete(config.email);
  io.out(removed ? `Token removed from ${store.label}.` : 'No token was stored.');
  return 0;
}

async function authenticatedClient(stores) {
  const config = await loadConfig(configPath());
  if (!config) throw new Error('Not logged in. Run: jat auth login --site <name>.atlassian.net --email <email>');
  const token = await configuredStore(config, stores).read(config.email);
  return new JiraClient({ apiBase: config.apiBase, email: config.email, token });
}

function configuredStore(config, stores) {
  return stores.byId(config.store ?? LEGACY_STORE);
}

async function list(rawKey, values, io, stores) {
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

async function get(rawKey, values, io, stores) {
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

function printResults(key, results, io) {
  if (results.length === 0) io.out(`${key}: no matching attachments.`);
  for (const r of results) {
    const name = printable(r.filename);
    if (r.status === 'downloaded') io.out(`downloaded  ${r.path}`);
    else if (r.status === 'exists') io.out(`exists      ${r.path}`);
    else io.err(`${r.status.padEnd(11)} ${name}: ${printable(r.reason)}`);
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
