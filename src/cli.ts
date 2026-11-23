import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { configuredStore, login, logout, status } from './commands/auth.js';
import { OPTIONS, type Io, type Values } from './commands/types.js';
import { configPath, loadConfig } from './config.js';
import { downloadAttachments, selectAttachments } from './download.js';
import { errorMessage } from './error-info.js';
import { formatSize, printResults } from './format.js';
import { JiraClient, assertIssueKey } from './jira-client.js';
import { createStores, type CredentialStores } from './credential-store/index.js';
import { printable } from './safe-name.js';
import { packageVersion } from './version.js';

const DEFAULT_MAX_MB = 200;

const USAGE = `Usage:
  jat auth login --site <name>.atlassian.net --email <email> [--allow-silent-read]
  jat auth status
  jat auth logout
  jat list <KEY> [--json]
  jat get <KEY> [--out <dir>] [--filter <text>] [--max-size <MB>] [--json]
  jat --version

The API token is read from a hidden prompt (or the first line of stdin) and stored only in the OS credential
store: macOS Keychain, a DPAPI-encrypted file on Windows, or the Secret Service keyring on Linux (with a 0600
file as the fallback when no keyring is running).

Add the agent skill (Claude Code, Cursor, Codex …): npx skills add hungnb94/jira-cli --skill jira-attachments`;

interface TextSink {
  write(text: string): unknown;
}

export interface MainOptions {
  stdout?: TextSink;
  stderr?: TextSink;
  stores?: CredentialStores;
}

function parse(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
}

export async function main(
  argv: string[],
  { stdout = process.stdout, stderr = process.stderr, stores }: MainOptions = {},
): Promise<number> {
  const io: Io = { out: (line) => stdout.write(`${line}\n`), err: (line) => stderr.write(`${line}\n`) };
  try {
    const { values, positionals } = parse(argv);
    const [command, sub] = positionals;
    if (values.version) {
      io.out(packageVersion());
      return 0;
    }
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
    io.err(`jat: ${errorMessage(error)}`);
    return 1;
  }
}

async function authenticatedClient(stores: CredentialStores): Promise<JiraClient> {
  const config = await loadConfig(configPath());
  if (!config) throw new Error('Not logged in. Run: jat auth login --site <name>.atlassian.net --email <email>');
  const token = await configuredStore(config, stores).read(config.email);
  return new JiraClient({ apiBase: config.apiBase, email: config.email, token });
}

async function list(rawKey: string | undefined, values: Values, io: Io, stores: CredentialStores): Promise<number> {
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

async function get(rawKey: string | undefined, values: Values, io: Io, stores: CredentialStores): Promise<number> {
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
