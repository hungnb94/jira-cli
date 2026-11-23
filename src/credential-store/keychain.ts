import { assertSafe } from './account.js';
import type { CredentialStore, StoreDeps } from './types.js';

const SECURITY = '/usr/bin/security';
const SERVICE = 'jat-jira-token';
const ITEM_NOT_FOUND = 44;
const USER_PROMPT_TIMEOUT_MS = 120_000;

export function createKeychainStore({ run }: Pick<StoreDeps, 'run'>): CredentialStore {
  async function has(account: string): Promise<boolean> {
    assertSafe('account', account);
    const { code } = await run(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', account]);
    return code === 0;
  }

  async function remove(account: string): Promise<boolean> {
    assertSafe('account', account);
    const { code } = await run(SECURITY, ['delete-generic-password', '-s', SERVICE, '-a', account]);
    if (code === 0) return true;
    if (code === ITEM_NOT_FOUND) return false;
    throw new Error(`Could not remove the token from Keychain (security exited with ${code})`);
  }

  return {
    id: 'keychain',
    label: 'macOS Keychain',
    silentRead: ({ promptOnRead }) => !promptOnRead,

    async read(account) {
      assertSafe('account', account);
      const { code, stdout } = await run(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], {
        timeout: USER_PROMPT_TIMEOUT_MS,
      });
      if (code === 0) return stdout.trim();
      if (code === ITEM_NOT_FOUND) throw new Error('No token in Keychain. Run: jat auth login');
      throw new Error('Could not read the token from Keychain (denied or timed out)');
    },

    has,

    // The token goes through stdin of `security -i` so it never appears in argv (visible to `ps`).
    // `-T ""` trusts no application, so every read shows a macOS dialog the user must approve.
    async store(account, token, { promptOnRead = true } = {}) {
      assertSafe('account', account);
      assertSafe('token', token);
      // Delete any existing item first: `-U` keeps the old item's access list, so a switch between
      // prompting and --allow-silent-read would not apply, and a failed update would leave the old token.
      await remove(account);
      const trust = promptOnRead ? ' -T ""' : '';
      const command = `add-generic-password -s "${SERVICE}" -a "${account}"${trust} -w "${token}"\n`;
      const { code } = await run(SECURITY, ['-i'], { input: command });
      if (code !== 0) throw new Error(`security exited with ${code}`);
      if (!(await has(account))) throw new Error('Keychain did not store the token');
    },

    delete: remove,
  };
}
