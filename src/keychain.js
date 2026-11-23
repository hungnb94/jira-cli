import { execFile, spawn } from 'node:child_process';

const SECURITY = '/usr/bin/security';
const SERVICE = 'jat-jira-token';
const SAFE_VALUE = /^[A-Za-z0-9._@+=/-]+$/;
const ITEM_NOT_FOUND = 44;
const USER_PROMPT_TIMEOUT_MS = 120_000;

function run(args, { timeout } = {}) {
  return new Promise((resolve, reject) => {
    execFile(SECURITY, args, { timeout }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function assertSafe(label, value) {
  if (!SAFE_VALUE.test(value)) throw new Error(`${label} contains unsupported characters`);
}

export async function readToken(account) {
  assertSafe('account', account);
  try {
    const stdout = await run(['find-generic-password', '-s', SERVICE, '-a', account, '-w'], {
      timeout: USER_PROMPT_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (error) {
    if (error.code === ITEM_NOT_FOUND) throw new Error('No token in Keychain. Run: jat auth login');
    throw new Error('Could not read the token from Keychain (denied or timed out)');
  }
}

export async function hasToken(account) {
  assertSafe('account', account);
  try {
    await run(['find-generic-password', '-s', SERVICE, '-a', account]);
    return true;
  } catch {
    return false;
  }
}

// The token goes through stdin of `security -i` so it never appears in argv (visible to `ps`).
// `-T ""` trusts no application, so every read shows a macOS dialog the user must approve.
export async function storeToken(account, token, { promptOnRead = true } = {}) {
  assertSafe('account', account);
  assertSafe('token', token);
  const trust = promptOnRead ? ' -T ""' : '';
  const command = `add-generic-password -U -s "${SERVICE}" -a "${account}"${trust} -w "${token}"\n`;
  await new Promise((resolve, reject) => {
    const child = spawn(SECURITY, ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`security exited with ${code}`))));
    child.stdin.end(command);
  });
  if (!(await hasToken(account))) throw new Error('Keychain did not store the token');
}

export async function deleteToken(account) {
  assertSafe('account', account);
  try {
    await run(['delete-generic-password', '-s', SERVICE, '-a', account]);
    return true;
  } catch (error) {
    if (error.code === ITEM_NOT_FOUND) return false;
    throw error;
  }
}
