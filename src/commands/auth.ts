import { configPath, loadConfig, saveConfig, type Config } from '../config.js';
import {
  LEGACY_STORE,
  storeWithFallback,
  type CredentialStore,
  type CredentialStores,
} from '../credential-store/index.js';
import { promptHidden } from '../hidden-input.js';
import { HttpError, JiraClient, type JiraUser } from '../jira-client.js';
import { printable } from '../safe-name.js';
import type { Io, Values } from './types.js';

const SITE = /^[a-z0-9-]+\.atlassian\.net$/;
const EMAIL = /^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/;

const SKILL_HINT = 'Tip: add the agent skill with: npx skills add hungnb94/jira-cli --skill jira-attachments';

export async function login(values: Values, io: Io, stores: CredentialStores): Promise<number> {
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

async function removePreviousToken(
  previous: Config | null,
  current: { email: string; store: CredentialStore },
  stores: CredentialStores,
): Promise<void> {
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
async function resolveApiBase(site: string, email: string, token: string): Promise<{ apiBase: string; user: JiraUser }> {
  const direct = `https://${site}`;
  try {
    return { apiBase: direct, user: await new JiraClient({ apiBase: direct, email, token }).myself() };
  } catch (error) {
    if (!(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error;
  }
  const tenant = await fetch(`https://${site}/_edge/tenant_info`, { redirect: 'error' });
  if (!tenant.ok) throw new Error(`Could not resolve cloudId for ${site} (HTTP ${tenant.status})`);
  const { cloudId } = (await tenant.json()) as { cloudId?: unknown };
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

export async function status(io: Io, stores: CredentialStores): Promise<number> {
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

export async function logout(io: Io, stores: CredentialStores): Promise<number> {
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

export function configuredStore(config: Config, stores: CredentialStores): CredentialStore {
  return stores.byId(config.store ?? LEGACY_STORE);
}
