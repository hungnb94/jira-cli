import { assertSafe } from './account.js';
import { StoreUnavailableError } from './errors.js';
import { errorCode } from '../error-info.js';
import type { CredentialStore, RunOptions, RunResult, StoreDeps } from './types.js';

const SECRET_TOOL = 'secret-tool';
const SERVICE = 'jat-jira-token';
const LABEL = 'jat Jira API token';
const UNLOCK_PROMPT_TIMEOUT_MS = 120_000;
const NO_KEYRING = /org\.freedesktop\.secrets|not provided by any \.service files|autolaunch|DBUS_SESSION_BUS_ADDRESS|Could not connect|Failed to connect|No such file or directory/i;

export function createSecretServiceStore({ run }: Pick<StoreDeps, 'run'>): CredentialStore {
  async function secretTool(args: string[], options?: RunOptions): Promise<RunResult> {
    try {
      return await run(SECRET_TOOL, args, options);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new StoreUnavailableError('secret-tool is not installed (package libsecret-tools)');
      throw error;
    }
  }

  async function lookup(account: string): Promise<string> {
    assertSafe('account', account);
    const { code, stdout } = await secretTool(['lookup', 'service', SERVICE, 'account', account], {
      timeout: UNLOCK_PROMPT_TIMEOUT_MS,
    });
    return code === 0 ? stdout.trim() : '';
  }

  return {
    id: 'secret-service',
    label: 'Secret Service keyring',
    silentRead: () => true,

    async read(account) {
      const token = await lookup(account);
      if (!token) throw new Error('No token in the Secret Service keyring, or the keyring is locked or not running. Run: jat auth login');
      return token;
    },

    async has(account) {
      return Boolean(await lookup(account));
    },

    async store(account, token) {
      assertSafe('account', account);
      assertSafe('token', token);
      const { code, stderr = '' } = await secretTool(['store', `--label=${LABEL}`, 'service', SERVICE, 'account', account], {
        input: token,
        timeout: UNLOCK_PROMPT_TIMEOUT_MS,
      });
      if (code !== 0 && NO_KEYRING.test(stderr)) throw new StoreUnavailableError('no keyring daemon is running');
      if (code !== 0) {
        throw new Error(`secret-tool store failed (exit ${code}); unlock the keyring and accept its prompt, then log in again`);
      }
      if ((await lookup(account)) !== token) throw new Error('the keyring did not store the token');
    },

    async delete(account) {
      if (!(await lookup(account))) return false;
      const { code } = await secretTool(['clear', 'service', SERVICE, 'account', account]);
      if (code !== 0) throw new Error(`secret-tool clear failed (exit ${code})`);
      return true;
    },
  };
}
