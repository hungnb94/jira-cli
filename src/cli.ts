import { parseArgs } from 'node:util';
import { get, list } from './commands/attachments.js';
import { login, logout, status } from './commands/auth.js';
import { OPTIONS, type Io } from './commands/types.js';
import { createStores, type CredentialStores } from './credential-store/index.js';
import { errorMessage } from './error-info.js';
import { packageVersion } from './version.js';

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
